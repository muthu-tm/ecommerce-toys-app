import type { FastifyRequest } from 'fastify';

import type { AddressCreateResponse } from '@romp/contracts';
import { AddressCreateRequestSchema, AddressUpdateRequestSchema } from '@romp/contracts';
import { createAddress, deleteAddress, findAddress, updateAddress } from '@romp/data';
import { parseOrThrow } from '@romp/observability';

import type { RompApp } from '../app';
import { requireAuthHook } from '../plugins/auth';
import { RATE_LIMITS, rateLimitKey } from '../plugins/rate-limit';
import { requireUser } from '../request-context';

import { toAddressView } from './address-view';

/**
 * The customer's address routes — the API-owned write half of the addresses subcollection.
 *
 * A customer reads their own addresses straight from Firestore under the rules (the account and
 * checkout pages do), but every write goes through here because the "exactly one default, never
 * zero" invariant is a multi-document transaction a client cannot make and rules cannot enforce.
 * Each route is scoped to the caller's own uid — there is no address path that names another
 * customer — so ownership is the identity, checked in the repository.
 */
export function registerAddressRoutes(app: RompApp): void {
  const { context } = app.deps;

  const limit = (request: FastifyRequest): void => {
    app.rateLimiter.consume(rateLimitKey(request, 'accountWrite'), RATE_LIMITS.accountWrite);
  };

  // --- create an address --------------------------------------------------
  app.post('/v1/addresses', { preHandler: requireAuthHook }, async (request, reply) => {
    const uid = requireUser(request);
    limit(request);
    const body = parseOrThrow(AddressCreateRequestSchema, request.body);

    const { id } = await createAddress(context, request.caller, uid, {
      label: body.label,
      recipientName: body.recipientName,
      line1: body.line1,
      line2: body.line2,
      city: body.city,
      state: body.state,
      pincode: body.pincode,
      phone: body.phone,
      isDefault: body.isDefault,
    });

    // Re-read so the response reflects the server-decided default (the first address is always
    // default; a promotion demotes the others).
    const created = await findAddress(context, request.caller, uid, id);
    const response: AddressCreateResponse = toAddressView(created);
    return reply.code(201).send(response);
  });

  // --- edit an address ----------------------------------------------------
  app.patch('/v1/addresses/:id', { preHandler: requireAuthHook }, async (request, reply) => {
    const uid = requireUser(request);
    limit(request);
    const { id: addressId } = request.params as { id: string };
    const body = parseOrThrow(AddressUpdateRequestSchema, request.body);

    // Drop absent keys so the patch carries only the fields the customer sent — `exactOptionalPropertyTypes`
    // distinguishes "absent" from "undefined", and the repository patch type means the former.
    await updateAddress(context, request.caller, uid, addressId, {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.recipientName !== undefined ? { recipientName: body.recipientName } : {}),
      ...(body.line1 !== undefined ? { line1: body.line1 } : {}),
      ...(body.line2 !== undefined ? { line2: body.line2 } : {}),
      ...(body.city !== undefined ? { city: body.city } : {}),
      ...(body.state !== undefined ? { state: body.state } : {}),
      ...(body.pincode !== undefined ? { pincode: body.pincode } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    });
    return reply.code(204).send();
  });

  // --- delete an address --------------------------------------------------
  app.delete('/v1/addresses/:id', { preHandler: requireAuthHook }, async (request, reply) => {
    const uid = requireUser(request);
    limit(request);
    const { id: addressId } = request.params as { id: string };

    await deleteAddress(context, request.caller, uid, addressId);
    return reply.code(204).send();
  });
}
