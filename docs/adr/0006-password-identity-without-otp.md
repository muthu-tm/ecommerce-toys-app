# ADR-0006 — Email-or-mobile identity with a password, and no OTP

- **Status** — Accepted
- **Date** — 2026-09-09
- **Deciders** — Platform / Product
- **Supersedes** — none

## Context

Three product constraints, all given explicitly, collide:

1. _"Signup / login using email / mobile + password."_ Indian commerce customers overwhelmingly expect
   to identify themselves with a mobile number. Many do not have an email address they use.
2. _"No MFA / OTP."_ Excluded from scope — no SMS cost, no OTP UX, no second factor.
3. _"No email communication to the customer — or for any."_ The platform sends no email
   ([ADR-0007](0007-notifications-not-email.md)).

Firebase Auth's providers do not fit this shape:

- **Email/Password** does what we want, but the identifier must be a syntactically valid email address.
- **Phone** authenticates by SMS OTP. That _is_ the OTP flow we excluded, and it carries per-message
  cost. It also cannot be combined with a password — Firebase phone auth has no password concept.
- **Custom tokens** let us mint a session for any identifier, but the Admin SDK **cannot verify a
  password**. Using custom tokens means storing and verifying password hashes ourselves — implementing
  Argon2, salting, pepper management, rehashing on parameter changes, timing-safe comparison, and
  throttling. That is a security-critical subsystem we would own for the life of the product, replacing
  one Google already operates correctly.

Constraints 2 and 3 together produce a hard consequence that has to be faced rather than designed
around: **a customer who registers with a mobile number and forgets their password has no automated
recovery channel.** No email to send a reset link to. No SMS to send a code to. That is not an oversight
in the design; it is a direct arithmetic result of the two constraints.

## Decision

**One Firebase Auth user per person, on the Email/Password provider only. A mobile number is normalised
to E.164 and mapped to a deterministic internal alias email. The client always calls
`signInWithEmailAndPassword`.**

### The alias mechanism

```ts
// @romp/core — pure functions, no I/O, domain-tier coverage
normalizePhone('98450 21174', 'IN'); // → '+919845021174'   (libphonenumber-js)
toAuthEmail('+919845021174'); // → 'p.919845021174@auth.romp.internal'
toAuthEmail('asha@example.com'); // → 'asha@example.com'
```

- Mobile registrations create an Auth user whose email is the alias. The alias domain is internal and
  non-routable — it is a namespace, not a mailbox, and no mail is ever sent to it.
- Email registrations use the address directly.
- The `p.` prefix keeps aliases in their own namespace, so a real address can never collide with a
  generated one.
- The mapping is **pure and deterministic**, so login recomputes it from user input without a lookup.

`normalizePhone` uses **libphonenumber-js, not a regular expression**. A regex that accepts
`9845021174` and `+919845021174` will not agree with one that also handles `0 98450 21174` or
`+91-98450-21174`. Two functions that disagree about normalisation create two accounts for one person —
or worse, let one person's login reach another's account. Normalisation must be **total**: every input
either produces exactly one canonical form or is rejected. Round-trip property tests enforce it.

### One account, one primary login identifier

`users/{uid}` stores both `email` and `phone` where known, plus which one is the login identifier.
`identityIndex/{normalizedIdentifier}` maps identifier → uid, written **server-side only**, and is what
makes uniqueness enforceable across both spaces: registering an email that already exists as a
secondary contact on another account is rejected.

`identityIndex` is unreadable by clients. Readable, it is a bulk user-enumeration oracle, and since a
mobile number is a login identifier here, enumeration directly enables targeted credential attacks.

### Password policy

- Minimum **10 characters**.
- **zxcvbn strength score ≥ 3**, evaluated client-side for feedback and re-evaluated server-side as the
  gate.
- **No composition rules** — no required uppercase, digit or symbol.

The absence of composition rules is deliberate, not lenient. Composition rules reduce real entropy by
pushing users toward predictable patterns (`Password1!`), and they are what
[NIST SP 800-63B](https://pages.nist.gov/800-63-3/sp800-63b.html) recommends against. Length plus a
strength estimator that rejects `qwertyuiop` and `9845021174` is a better filter than a checklist that
accepts `Toys@123`.

### Password reset, including the gap

| Account type | Path                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------- |
| Has an email | Firebase's built-in password-reset email                                                    |
| Mobile only  | **Admin-assisted**: a single-use, short-TTL link sent by WhatsApp to the number **on file** |

Firebase's reset email is the one email the platform sends. That is a deliberate, narrow exception to
[ADR-0007](0007-notifications-not-email.md): it is an authentication primitive triggered by the user,
not a communication channel we use to talk to customers.

The admin-assisted path is a social-engineering target, so its constraints are the control:

- The link goes to the number **stored on the account**, never to a number supplied in the request. The
  attacker must already control the registered number. This single rule carries most of the security.
- Identity is verified out of band first — a recent order number _plus_ a detail not printed on the order
  confirmation.
- The action is audited with the acting admin's uid and rate-limited per account.

Procedure: [`RUNBOOKS.md` runbook 6](../RUNBOOKS.md#6-password-reset-for-a-mobile-only-account).

## Alternatives considered

### A. Firebase Phone provider for mobile users

The native fit for phone identity, and Firebase handles the OTP.

Rejected: **it requires SMS OTP**, which is explicitly out of scope, and it has no password concept, so
the two login paths would behave differently — one password, one code. It also introduces per-SMS cost
and a delivery-failure support burden.

### B. Custom tokens with our own password verification

Full control. Any identifier, no alias hack, no fake email domain in the Auth console.

Rejected: **the Admin SDK cannot verify passwords.** Accepting this means owning password hashing —
Argon2id parameters, per-user salts, pepper storage and rotation, rehash-on-login when parameters change,
timing-safe comparison, and brute-force throttling. Every one of those is a place to be subtly wrong, and
being subtly wrong means a credential database that looks fine until it is breached. Trading a cosmetic
oddity in the Auth console for ownership of a password store is a bad trade.

### C. Two Auth users per person — one email, one phone — linked

Uses each provider natively.

Rejected: account linking across providers is where identity bugs live. Two uids for one human means
every ownership check must consider both, orders can attach to either, and a partial link leaves a person
with two carts and two order histories. One human, one uid, one login identifier is worth an alias.

### D. Mobile stored as a profile field; email required for login

Simplest possible identity model.

Rejected: it fails the stated requirement, and it excludes customers who do not have or use an email
address. That is a material share of the target market.

### E. Require an email for mobile-first users as a recovery address

Would close the reset gap.

Rejected as a product decision: it reintroduces the email requirement at exactly the point the customer
is least willing to comply — registration — and creates a field customers fill with `a@a.com`, which is
worse than no field because it looks like a recovery channel and is not.

### F. Chosen: alias mapping onto Email/Password, with an admin-assisted reset for the gap

## Consequences

### Good

- One Auth user per person, one uid, one password store — and Google operates the password store.
- Both login paths are the same code path: normalise → alias → `signInWithEmailAndPassword`. No branching
  on identifier type in the client, which means one flow to test and one to get right.
- No SMS cost, no OTP UX, no delivery failures.
- The mapping is pure, so it is exhaustively unit-testable in milliseconds and property-testable for
  round-tripping. Identity correctness is verified without infrastructure.
- Firebase's own brute-force protection applies, on top of our per-identifier limits.
- Mobile numbers are normalised to E.164 at the boundary, which the WhatsApp integration needs anyway.

### Bad, and accepted

- **Mobile-only users cannot self-serve password reset.** This is the real cost. It is a support ticket
  per occurrence, with a human verifying identity — which is both slow and the weakest link in the whole
  identity design. Bounded by: the link goes only to the number on file, the action is audited and
  rate-limited, and volume is measured so it can justify WhatsApp Business API OTP in v1.1.
- **A mobile number is now a credential identifier, not just contact detail.** Exposing one enables
  targeted attacks on a known-existing account. Consequences ripple through the design:
  `identityIndex` is server-only, login and registration return uniform failures, numbers are masked in
  the admin UI and revealed on an audited click, and the logger redacts `phone` at serialisation so a
  careless `logger.info({ user })` cannot leak it.
- **Alias emails look odd in the Firebase console.** `p.919845021174@auth.romp.internal` needs
  explaining to anyone new. Documented here and in [`IDENTITY.md`](../IDENTITY.md).
- **Changing a login mobile number is a real operation**, not a profile edit: it changes the Auth
  record's email, the `identityIndex` key, and must be atomic across both. Admin-assisted in v1.0.
- **No MFA anywhere, including admin accounts.** A compromised admin password is a compromised
  backoffice with access to payment evidence. Partially mitigated by revocation on every admin request
  and full audit trails, but this is a genuine gap and the first repeat incident should pull admin MFA
  forward.
- **`normalizePhone` is now security-critical.** A change in its behaviour can orphan existing accounts —
  a customer whose number normalised one way at registration cannot log in if it normalises differently
  later. libphonenumber-js is a dependency whose upgrades need to be treated as data migrations, not
  routine bumps.
- **The alias domain is a permanent commitment.** It is embedded in every mobile user's Auth record, so
  changing it later is a migration over the entire user base.

## Related

- [`IDENTITY.md`](../IDENTITY.md) — full mechanism, session handling, rate limits
- [`SECURITY.md § PII map`](../SECURITY.md#6-pii-map) — why mobile numbers are handled as credentials
- [`RUNBOOKS.md § password reset`](../RUNBOOKS.md#6-password-reset-for-a-mobile-only-account)
- [ADR-0007](0007-notifications-not-email.md) — the no-email decision that creates the reset gap
- [`ROADMAP.md`](../ROADMAP.md) — WhatsApp Business API OTP, admin MFA
