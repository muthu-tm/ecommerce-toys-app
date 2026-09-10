import {
  CheckIdentifierRequestSchema,
  PasswordChangeRequestSchema,
  RegisterRequestSchema,
  UidSchema,
  money,
} from '@romp/contracts';
import type { E164Phone, Email, IdentifierType } from '@romp/contracts';
import {
  InvalidPhoneNumberError,
  assessPassword,
  classifyIdentifier,
  normalizeEmail,
  normalizePhone,
  toAuthEmail,
} from '@romp/core';
import { createUserProfile, isIdentifierTaken, releaseIdentity, reserveIdentity } from '@romp/data';
import {
  IdentifierTakenError,
  ValidationFailedError,
  WeakPasswordError,
  parseOrThrow,
} from '@romp/observability';

import type { RompApp } from '../app';
import { requireAuthHook } from '../plugins/auth';
import { RATE_LIMITS, rateLimitKey } from '../plugins/rate-limit';
import { requireUser } from '../request-context';

/**
 * The public identity routes: register, check-identifier, password-change.
 *
 * Registration is the load-bearing one. It classifies the identifier, normalises it with
 * `@romp/core` (so the client and server derive the same login alias), enforces the
 * password policy, and then performs the three-system dance — Auth user, `identityIndex`
 * reservation, `users` profile — with compensation on failure so a partial account is
 * never left behind.
 */
export function registerAuthRoutes(app: RompApp): void {
  const { auth, context, config } = app.deps;

  app.post('/v1/auth/register', async (request, reply) => {
    // Rate limit first: registration is a spam and enumeration surface.
    app.rateLimiter.consume(rateLimitKey(request, 'register'), RATE_LIMITS.register);

    const body = parseOrThrow(RegisterRequestSchema, request.body);

    // Classify, then normalise to the canonical identifier and the derived login email.
    const type = classifyIdentifier(body.identifier);
    const { normalizedIdentifier, loginEmail, phone, email } = normalizeIdentifier(
      type,
      body.identifier,
      config.storeId,
      config.defaultPhoneRegion,
    );

    // Password policy, with the identifier and brand as context so a password echoing
    // either scores as the weak choice it is.
    const assessment = assessPassword(body.password, {
      identifier: body.identifier,
      brandNames: config.brandNames,
    });
    if (!assessment.ok) {
      throw new WeakPasswordError({ suggestions: assessment.suggestions });
    }

    // Create the Auth user first — we need its uid for both the index entry and the
    // profile. The login email is derived one-to-one from the identifier, so Auth's own
    // uniqueness on it is a second gate on the identifier: an `email-already-exists` here
    // means the identifier is taken, mapped to the same 409 that does not echo it. If a
    // later step fails, we delete the user, so no orphan is left.
    let created;
    try {
      created = await auth.createUser({
        email: loginEmail,
        password: body.password,
        displayName: body.displayName,
        ...(phone !== null ? { phoneNumber: phone } : {}),
      });
    } catch (error) {
      if (isEmailAlreadyExists(error)) throw new IdentifierTakenError();
      throw error;
    }

    try {
      // Reserve the identifier atomically. A concurrent duplicate fails here as
      // IDENTIFIER_TAKEN, which is a 409 that does not echo the identifier.
      await reserveIdentity(context, normalizedIdentifier, {
        uid: UidSchema.parse(created.uid),
        type,
        createdAt: context.clock.now(),
      });
    } catch (error) {
      await auth.deleteUser(created.uid).catch(() => undefined);
      throw error;
    }

    try {
      await createUserProfile(context, created.uid, {
        displayName: body.displayName,
        primaryIdentifierType: type,
        email,
        phone,
        orderCount: 0,
        lifetimeValueMinor: money(0),
        lastOrderAt: null,
        createdAt: context.clock.now(),
        updatedAt: context.clock.now(),
        deletedAt: null,
        deletionReason: null,
      });
    } catch (error) {
      // Roll back both the reservation and the Auth user, so a failed profile write does
      // not strand a claimed identifier or a login-able account with no profile.
      await releaseIdentity(context, normalizedIdentifier).catch(() => undefined);
      await auth.deleteUser(created.uid).catch(() => undefined);
      throw error;
    }

    return reply.code(201).send({
      uid: created.uid,
      loginEmail,
      primaryIdentifierType: type,
    });
  });

  app.post('/v1/auth/check-identifier', async (request, reply) => {
    // Hard-limited: this is the enumeration surface, so the ceiling is low and per-IP.
    app.rateLimiter.consume(rateLimitKey(request, 'checkIdentifier'), RATE_LIMITS.checkIdentifier);

    const body = parseOrThrow(CheckIdentifierRequestSchema, request.body);
    const type = classifyIdentifier(body.identifier);

    let normalizedIdentifier: string;
    try {
      normalizedIdentifier = normalizeIdentifier(
        type,
        body.identifier,
        config.storeId,
        config.defaultPhoneRegion,
      ).normalizedIdentifier;
    } catch {
      // A malformed identifier is not "available"; it is invalid. But telling the caller
      // that here still leaks nothing about existence, so a clean false is the safe answer.
      return reply.send({ available: false });
    }

    // `isIdentifierTaken` returns a boolean and never the uid — `check-identifier` is public
    // by design and must not map an identifier to an account.
    const taken = await isIdentifierTaken(context, normalizedIdentifier);
    return reply.send({ available: !taken });
  });

  app.post('/v1/auth/password-change', { preHandler: requireAuthHook }, async (request, reply) => {
    const uid = requireUser(request);
    const body = parseOrThrow(PasswordChangeRequestSchema, request.body);

    const assessment = assessPassword(body.newPassword, { brandNames: config.brandNames });
    if (!assessment.ok) {
      throw new WeakPasswordError({ suggestions: assessment.suggestions });
    }

    // The caller proved possession of a current session by presenting a valid, unrevoked
    // token (the auth middleware verified it with `checkRevoked`). We change the password
    // and then revoke every refresh token, so all *other* sessions are ended — the
    // takeover-visible property `IDENTITY.md` requires. The client re-authenticates with
    // the new password afterward.
    // `body.currentPassword` is validated for shape but not verified server-side in v1.0:
    // verifying it needs the store's Web API key via the Identity Toolkit REST endpoint (a
    // deployment secret), and the possession proof here is the valid, unrevoked session
    // token the auth middleware already checked. The field is accepted now so adding that
    // verification later is not a breaking change to the request contract.
    await auth.updateUser(uid, { password: body.newPassword });
    await auth.revokeRefreshTokens(uid);

    return reply.code(204).send();
  });
}

interface NormalizedIdentifier {
  readonly normalizedIdentifier: string;
  readonly loginEmail: string;
  readonly email: Email | null;
  readonly phone: E164Phone | null;
}

/**
 * Normalises a raw identifier into everything the registration flow needs: the canonical
 * form (the `identityIndex` key), the Auth login email, and the profile's email/phone.
 *
 * A phone that will not parse throws `ValidationFailedError` with a field path, so the
 * client can mark the input — distinct from `IDENTIFIER_TAKEN`, which is about existence.
 */
function normalizeIdentifier(
  type: IdentifierType,
  raw: string,
  storeId: string,
  defaultRegion: string,
): NormalizedIdentifier {
  if (type === 'email') {
    const email = normalizeEmail(raw);
    return { normalizedIdentifier: email, loginEmail: email, email, phone: null };
  }

  try {
    const phone = normalizePhone(raw, defaultRegion);
    return {
      normalizedIdentifier: phone,
      loginEmail: toAuthEmail(phone, storeId),
      email: null,
      phone,
    };
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      throw new ValidationFailedError([{ path: 'identifier', message: error.message }], {
        detail: 'That mobile number could not be read.',
      });
    }
    throw error;
  }
}

/**
 * Whether an Admin SDK error means the identifier is already in use.
 *
 * Covers both `email-already-exists` (the derived login email collides) and
 * `phone-number-already-exists` (a mobile registration whose number is already on an
 * account). Both mean the same thing to the caller — the identifier is taken — and map to
 * the same 409 that does not echo which.
 */
function isEmailAlreadyExists(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'auth/email-already-exists' || code === 'auth/phone-number-already-exists';
}
