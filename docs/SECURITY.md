# Security

This document is the authoritative statement of the platform's trust boundaries: who may read what,
who may write what, where personal data lives, and which attacks the design accepts rather than
prevents.

Two rules govern everything below.

1. **Rules are a firewall, not a validator.** Firestore security rules enforce _who_ and _shape_.
   They never enforce business invariants — stock, pricing, state transitions — because rules cannot
   read another document transactionally in a way that survives concurrency. Invariants live in
   Cloud Functions transactions.
2. **Absence is indistinguishable from denial.** A resource the caller does not own returns **404,
   not 403**. A 403 confirms the resource exists, which is itself a disclosure. This applies to
   orders, refunds, notifications, users and reviews.

---

## 1. Trust boundaries

```
                      ┌───────────────────────────────────────────────┐
   Untrusted          │  Semi-trusted                                 │  Trusted
                      │                                               │
   Browser ──────────▶│  Next.js server (Admin SDK, server-only env)  │
   (client SDK,       │  Cloud Functions (Admin SDK)                  │──▶ Firestore
    ID token)         │                                               │    Storage
                      │  Trust derives from: verified ID token        │    Auth
                      └───────────────────────────────────────────────┘
```

| Zone                      | What it may assume       | What it must verify                                 |
| ------------------------- | ------------------------ | --------------------------------------------------- |
| Browser                   | Nothing                  | — (all input is hostile)                            |
| Client Firestore SDK      | Rules are enforced       | —                                                   |
| Next.js server components | Admin SDK bypasses rules | Ownership, on every read of user-scoped data        |
| Cloud Functions           | Admin SDK bypasses rules | ID token, custom claims, Zod-parsed body, ownership |

**The Admin SDK bypasses security rules.** Every server-side read of user-scoped data must filter by
the authenticated `uid` explicitly. Rules will not save a server bug. This is the single most
important consequence of the hybrid architecture ([ADR-0001](adr/0001-hybrid-backend.md)) and the
reason repository methods take an explicit caller identity rather than reading it from ambient state.

---

## 2. Authentication and authorisation

### Authentication

One Firebase Auth user per person. Login is email **or** mobile plus password; mobile is normalised
to E.164 and mapped to a deterministic internal alias so a single provider (Email/Password) serves
both. Mechanism and its accepted gaps: [`IDENTITY.md`](IDENTITY.md),
[ADR-0006](adr/0006-password-identity-without-otp.md).

Firebase phone auth is **disabled** — it requires SMS OTP, which is out of scope. Anonymous auth is
**disabled**. Only the Email/Password provider is enabled, in both environments.

### Authorisation

Roles are Firebase Auth **custom claims**, set only by the seeding script or an existing owner. They
are never derived from a Firestore document a client can influence.

| Claim           | Granted to                | Grants                                                              |
| --------------- | ------------------------- | ------------------------------------------------------------------- |
| _(none)_        | Every registered customer | Own cart, orders, notifications, wishlist, addresses, reviews       |
| `role: "staff"` | Seeded operators          | Backoffice read, order fulfilment, payment verification, moderation |
| `role: "owner"` | Seeded owners             | Everything staff can do, plus settings, refunds, admin seeding      |

Claim propagation is not instant: a revoked claim persists in an already-issued ID token for up to an
hour. Revocation therefore does two things — clears the claim **and** calls
`revokeRefreshTokens(uid)`, with server-side session verification using
`verifyIdToken(token, /* checkRevoked */ true)` on admin routes. Customer routes skip the revocation
check to avoid the extra round trip; the blast radius of a stale customer token is the customer's own
data.

---

## 3. Firestore rules model

The full ruleset lives in `infra/firestore.rules` and is tested against the emulator with
`@firebase/rules-unit-testing`. Rules tests are **required**, not optional: an untested rule is an
assumption. Every table row below has at least one allow-case and one deny-case test.

### Read matrix

The status values below are the ones in `@romp/contracts`, not paraphrases of them.
`PUBLIC_PRODUCT_STATUS` and `PUBLIC_REVIEW_STATUS` are exported constants, and
`infra/tests/rules/coverage.test.ts` asserts that each appears literally in the rules file —
so a rename on either side fails a test rather than silently closing the catalogue.

| Collection                       | Public                           | Owner                                   | Staff                       | Notes                                                                                                         |
| -------------------------------- | -------------------------------- | --------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `products`                       | ✅ when `status == "active"`     | ✅                                      | ✅ all statuses             | Drafts and archived products are invisible to the public                                                      |
| `products/{id}/variants`         | ✅ when the **parent** is active | ✅                                      | ✅ all                      | A variant has no status of its own, so the rule does a `get()` on the product                                 |
| `categories`                     | ✅ all                           | ✅                                      | ✅ all                      | Navigation metadata; `showInNav` / `showInFilters` control **where** it appears, not whether it may be read   |
| `inventory`                      | ❌                               | ❌                                      | ✅                          | Exact stock counts are commercially sensitive; the storefront gets a derived `inStock` boolean on the variant |
| `warehouses`                     | ❌                               | ❌                                      | ✅                          |                                                                                                               |
| `reservations`                   | ❌                               | ❌                                      | ✅                          |                                                                                                               |
| `inventoryLedger`                | ❌                               | ❌                                      | ✅                          |                                                                                                               |
| `users/{uid}` and subcollections | ❌                               | ✅ self                                 | ✅                          | Addresses and wishlist are client-**read**, API-**written**                                                   |
| `identityIndex`                  | ❌                               | ❌                                      | ❌                          | **Server-only**, staff included. Readable, it is a bulk account-enumeration oracle                            |
| `carts`                          | ❌                               | ✅ own                                  | ✅                          | Matched on the stored `userId`, not on the document ID. Anonymous carts are unreachable by any client         |
| `orders`                         | ❌                               | ✅ own                                  | ✅                          |                                                                                                               |
| `orders/{id}/events`             | ❌                               | ✅ own                                  | ✅                          | Customer-safe by construction: internal notes go on the store-wide `events` spine, which no client can read   |
| `events`                         | ❌                               | ❌                                      | ❌                          | **Server-only**, staff included. The audit spine carries every actor identity in the store                    |
| `notifications`                  | ❌                               | ✅ `audience: "user"` addressed to self | ✅ `audience: "admin"` only | Staff cannot read customer notifications, and customers cannot read staff ones                                |
| `reviews`                        | ✅ when `status == "published"`  | ✅ own, any status                      | ✅ all                      | Authors see their own pending and rejected reviews; the rejection **reason** is never rendered to them        |
| `refunds`                        | ❌                               | ✅ own                                  | ✅                          | Ownership via a denormalised `userId`, so the rule needs no `get()` on the order                              |
| `paymentRefGuards`               | ❌                               | ❌                                      | ❌                          | **Server-only**, staff included; readable, it leaks whether a UTR has been spent                              |
| `counters`                       | ❌                               | ❌                                      | ❌                          | **Server-only**, staff included; readable, it discloses order volume                                          |
| `settings/checkout`              | ✅                               | —                                       | ✅                          | Every value is shown to the customer before they pay. A UPI VPA is a payee address, not a secret              |
| `settings/*` (anything else)     | ❌                               | ❌                                      | ✅                          | Named explicitly so the next settings document is not public by default                                       |
| `analytics/**`                   | ❌                               | ❌                                      | ✅                          | Revenue is not a public figure. Matched as a subtree, since rollups nest a level deeper                       |

Four rows are denied to **staff as well as customers**. That is deliberate in each case: none of
`events`, `identityIndex`, `paymentRefGuards` or `counters` serves an operational need the API cannot
meet, and each is a disclosure whose blast radius is the whole store rather than one document. Staff
reach them through API endpoints that log the access.

### Write matrix

The complete client write surface — two rules, both on notification read state, both on the same
collection ([`DATA_MODEL.md § client write surface`](DATA_MODEL.md#client-write-surface)):

| Path                 | Client may               | Constraint enforced in rules                                                                                                                                                             |
| -------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notifications/{id}` | Update `readAt`          | Caller is the addressee and the audience is `user`; **only** `readAt` changes; the new value is `request.time`; the existing value is `null`                                             |
| `notifications/{id}` | Update `readBy[own uid]` | Caller is staff and the audience is `admin`; **only** `readBy` changes; the nested diff touches **only the caller's own key**; the value is `request.time`; that key was not already set |

Read state is modelled twice because the audiences differ. A customer notification has one recipient,
so `readAt` is a single instant. A staff notification has many, so `readBy` is a map keyed by uid — a
shared `readAt` there would let the first admin to open the bell clear a new order for the entire
team. The nested key diff is what stops one admin marking a notification read on another's behalf and
hiding work from the person it was meant for.

`infra/tests/rules/coverage.test.ts` counts the `allow update` statements in the ruleset and fails if
there are not exactly two, so a third client write path cannot be added without the claim above being
updated with it.

Everything else — carts, addresses, wishlists, orders, reviews, refunds — is written through the API.
Carts in particular are API-written even though a client-write cart would be less code: a
client-written cart lets the browser choose the price. Availability checks, price refresh, and
quantity ceilings must run server-side.

### Rule-level shape guards

Where a client can write, rules assert field-level shape, not just identity:

- `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['readAt'])` — and the same for
  `['readBy']`.
- `request.resource.data.readAt == request.time`, so the value is a fact about when the server saw
  the write rather than a claim by the client.
- `resource.data.readAt == null`, so there is no un-reading and no re-stamping. Idempotence here is a
  **denial**, not an overwrite: permitting a rewrite would let a client churn the document
  indefinitely at our cost.
- `request.resource.data.readBy.diff(resource.data.get('readBy', {})).affectedKeys().hasOnly([uid()])`,
  which scopes a staff read-state write to the caller's own key.
- Creates and deletes are denied everywhere for clients, on every collection. Data is soft-deleted
  server-side to preserve audit history.

Roles come from Firebase Auth **custom claims**, read as `request.auth.token.get('role', '')`. No rule
calls `get()` on a `users` document to decide a role: a role stored where a client can write is a role
a client can grant itself, and one stored where a client can read still costs a document read on every
rule evaluation. `isStaff()` is an allowlist of exactly `staff` and `owner`, and the test suite
includes a caller holding a role we never issue to prove it behaves like one.

### Storage rules

`infra/storage.rules`:

| Path                                    | Read          | Write                                                         | Delete     |
| --------------------------------------- | ------------- | ------------------------------------------------------------- | ---------- |
| `products/{productId}/{file}`           | Public        | Staff only, ≤ 5 MB, `image/jpeg png webp avif`                | Staff      |
| `payment-proofs/{orderId}/{uid}/{file}` | Owner + staff | **Owner only**, ≤ 5 MB, those image types plus PDF            | **Nobody** |
| `store-assets/**`                       | Public        | Nobody — written by the deploy pipeline, which bypasses rules | Nobody     |

Four things about that table are load-bearing.

**SVG is not in the allowed list**, even though it is an image format. It is a script container, and
these files are rendered on the admin origin. GIF is excluded too: nothing here needs animation, and
every format allowed is another decoder attack surface.

**PDF is allowed for payment proofs**, because some banks share a receipt as a PDF and refusing it
would push the customer into screenshotting a PDF viewer.

**Payment proofs cannot be deleted by anyone**, including the customer who uploaded one. It is the
evidence behind a verification decision, and a customer who could remove it after the fact would break
the reconciliation trail. Retention is 18 months, after which a lifecycle rule removes it (§ 6).

**Staff cannot upload into a customer's proof path.** An admin who could plant the evidence they then
verify defeats the point of having evidence.

`contentType` from the client is a claim, not a fact — `size` is the only value in that table a client
cannot lie about. A Function re-derives the type from the file's magic bytes on finalize and
quarantines mismatches. Payment proofs are additionally served with `Content-Disposition: attachment`
plus `X-Content-Type-Options: nosniff`, so a file that survives both checks still does not execute in
an admin's browser.

---

## 4. API surface hardening

Every Cloud Functions route passes through the same chain, in this order:

1. **Correlation ID** — generated or propagated; every log line and error response carries it.
2. **Rate limit** — Firestore-backed fixed-window counter keyed by `uid` when authenticated,
   otherwise by IP. Login and payment-proof submission have their own tighter buckets
   ([`IDENTITY.md § rate limits`](IDENTITY.md#rate-limits-and-abuse)).
3. **Auth** — `verifyIdToken`; admin routes additionally check revocation and the required claim.
4. **Zod parse** — body, params and query. Unknown keys are stripped, not accepted. A parse failure
   is a 400 with field-level detail; no other layer trusts unparsed input.
5. **Idempotency** — mutating routes accept an `Idempotency-Key`; the key is stored with the response
   so a retry returns the original result instead of double-charging or double-reserving.
6. **Handler** — business logic, in a transaction where invariants span documents.
7. **Error mapping** — `AppError` → RFC 7807 problem+json. Unknown errors become a bare 500 with the
   correlation ID and nothing else; stack traces and Firestore messages never reach a client.

### Headers

Set at the edge and in `next.config.mjs`:

- `Content-Security-Policy` — nonce-based, no `unsafe-inline` for scripts. Report-only for one
  release, then enforced.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — camera, microphone, geolocation all denied.
- `X-Frame-Options: DENY` on the admin origin.

CORS allows exactly the storefront and admin origins per environment. No wildcard, ever, including in
dev — a permissive dev config is what ships to prod by accident.

---

## 5. Secrets

| Secret                         | Home                                                                          | Never                                                 |
| ------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| Service account keys           | Not used — Functions and App Hosting use the runtime service account          | In the repo, in env vars, in CI                       |
| WhatsApp API token             | Cloud Secret Manager, referenced by Functions                                 | In `NEXT_PUBLIC_*`                                    |
| Seeded admin initial passwords | Generated at seed time, delivered out of band, forced rotation on first login | Committed, logged                                     |
| Firebase web config            | Public by design (`NEXT_PUBLIC_*`)                                            | Treated as a secret — it isn't; rules are the control |

`NEXT_PUBLIC_` is a publication instruction. Any value with that prefix is in the JavaScript bundle.
The lint config flags a `NEXT_PUBLIC_` name containing `SECRET`, `KEY`, `TOKEN` or `PASSWORD`.

Prod deploys require a manual approval on a tagged release, so no single automated path reaches
production data.

---

## 6. PII map

| Data                    | Collection / field                                             | Classification                                     | Why it exists                                      | Retention                                                                             |
| ----------------------- | -------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Name                    | `users.displayName`                                            | Personal                                           | Orders, addressing                                 | Life of account                                                                       |
| Email                   | `users.email`, Auth record                                     | Personal, **login identifier**                     | Authentication                                     | Life of account                                                                       |
| **Mobile number**       | `users.phone` (E.164), `identityIndex` key, Auth alias         | Personal, **login identifier and support channel** | Authentication, WhatsApp support, delivery contact | Life of account                                                                       |
| Postal address          | `users/{uid}/addresses/*`, `orders.shippingAddress` (snapshot) | Personal                                           | Delivery                                           | Order copy retained for statutory period even after the address book entry is deleted |
| Order history           | `orders`, `orders/*/events`                                    | Personal + financial                               | Fulfilment, statutory records                      | 8 years (Indian tax record-keeping)                                                   |
| UTR / payment reference | `orders.payment.upiRef`, `paymentRefGuards`                    | Financial                                          | Manual reconciliation                              | With the order                                                                        |
| Payment proof image     | Storage `payment-proofs/**`                                    | Financial, potentially bank-statement screenshots  | Verification evidence                              | 18 months, then lifecycle-deleted; the UTR and the verification decision remain       |
| Review text             | `reviews`                                                      | Personal, public once approved                     | Social proof                                       | Until deleted                                                                         |
| IP address              | Logs only                                                      | Personal                                           | Abuse control                                      | 30 days                                                                               |

Mobile numbers deserve emphasis. Elsewhere a phone number is contact detail; here it is a **credential
identifier**. Exposing one enables targeted credential attacks against a known-existing account.
Consequences:

- `identityIndex` is server-only. It maps identifier → uid, which makes it a bulk enumeration target.
- Registration and login return the same generic failure whether or not the identifier exists.
- Numbers are masked in the admin UI by default (`+91 98•••• ••74`) and revealed on an explicit,
  audited click.
- Numbers never appear in logs, error messages, URLs, query strings, or analytics events. The logger
  redacts `phone`, `email`, `utr`, `password` and `authorization` keys at serialisation time, so a
  careless `logger.info({ user })` cannot leak them.

### Deletion

A deletion request removes the Auth user, clears `identityIndex`, and redacts `users/{uid}` to
`{ deletedAt, deletionReason }`. Orders are **not** deleted — statutory retention wins — but the
address snapshot on each order is replaced with a redacted form and the customer name becomes
`Deleted customer`. Payment proofs are deleted. This is documented rather than automated in v1.0;
[`RUNBOOKS.md`](RUNBOOKS.md) carries the procedure.

---

## 7. Threat notes

Ordered by expected loss, not by novelty.

### Manual payment verification is the primary fraud surface

There is no gateway confirming that money moved. An admin looks at a UTR and a screenshot and decides.

| Attack                                    | Control                                                                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reuse of a real UTR across orders         | `paymentRefGuards/{normalizedUtr}` — a globally unique document created in the same transaction as the proof. Second use fails on document existence, not on a query                                            |
| Forged screenshot                         | Amount and order reference are encoded in the per-order QR, so the admin verifies against an expected exact amount rather than eyeballing plausibility. Verification is a two-field match, not a judgement call |
| Amount short-paid                         | Verification compares to `order.totalMinor` exactly; a mismatch routes to a partial-payment path, never to "close enough"                                                                                       |
| Insider marking unpaid orders verified    | Every verification writes an immutable `events` record with the actor uid; refunds require the `owner` claim; daily verified-total reconciliation against the bank statement is an ops task                     |
| Verification backlog used as a DoS on ops | Rate limit on proof submission per account; alert on queue depth                                                                                                                                                |

Residual risk is real and accepted: a determined attacker plus an inattentive admin can obtain goods.
The bound is per-order value, the detection is the daily reconciliation, and the mitigation path is a
payment gateway in v1.1.

### Oversell

Stock is decremented in a Firestore transaction that reads inventory and reservations and writes
both; concurrent checkouts serialise. The failure mode that actually causes oversell is not the
transaction — it is the **sweeper not running**, so expired reservations hold stock forever, or
crashing after release but before ledger write. Hence: alert on sweeper non-execution (backlog age),
not on sweeper errors. A silent sweeper throws nothing.

### Enumeration

Login, registration, password reset and order lookup all return uniform responses. Order IDs are
random, not sequential; the human-facing order number is sequential from `counters`, but it is not
the document ID, so a guessed number does not address a document.

### Stored XSS via uploads and review text

Uploads: magic-byte re-derivation, no HTML rendering, `nosniff`, attachment disposition. Review text:
stored raw, escaped at render, never injected via `dangerouslySetInnerHTML`, and CSP has no
`unsafe-inline` for scripts as defence in depth.

### Account takeover

No MFA, by product decision. The controls are: password minimum 10 characters with a zxcvbn strength
floor and **no composition rules** (composition rules reduce real entropy by pushing users to
predictable patterns); Firebase's own throttling plus an application-level per-identifier limit;
notification of any password or address change to the account's own notification feed, so a takeover
is visible to the victim on next login. Accepted gap, with WhatsApp-OTP step-up in the roadmap.

### Admin-assisted password reset as a social-engineering target

Mobile-only accounts cannot self-serve reset because there is no email and no OTP. An admin issues a
single-use, short-TTL link over WhatsApp to the number **on file**, never to a number supplied in the
request. That constraint is the whole control: the attacker must already control the registered
number. The action is audited with the actor uid and rate-limited per account.
[`IDENTITY.md § password reset`](IDENTITY.md#password-reset--including-the-gap).

### Dependency and supply chain

Manifests carry caret ranges; the committed `pnpm-lock.yaml` is what actually pins every version,
transitive ones included, and CI installs with `--frozen-lockfile` so a resolution a reviewer never
saw fails the build rather than shipping. The lockfile is the control — exact versions in manifests
without a lockfile would be weaker, and with one they add nothing but manual bump friction.

`pnpm audit --audit-level high` runs as its own job in the PR gate and fails on high or critical.
Moderate advisories are visible but do not block, because a permanently red gate gets ignored and
then bypassed. Dependabot batches updates weekly rather than opening a PR per package — a stream of
single-dependency PRs gets rubber-stamped.

Two dependencies are excluded from automated updates and reviewed by hand, for stated reasons:
`libphonenumber-js`, because a change in normalisation behaviour can orphan existing accounts whose
mobile number is their login identifier ([ADR-0006](adr/0006-password-identity-without-otp.md)) — an
upgrade there is a data-migration question; and TypeScript majors, which change what typechecks
across every package at once.

New dependencies are reviewed for maintenance status and for name similarity to popular packages
before they are added.

---

## 8. What v1.0 does not do

Stated plainly, so nobody mistakes silence for coverage:

- No MFA, no OTP, no device trust.
- No WAF rules beyond Cloudflare's managed ruleset and rate limiting.
- No automated PII deletion — it is a documented manual procedure.
- No field-level encryption. Firestore encryption at rest is the control.
- No penetration test. A rules-focused review and an automated header/CSP check are the substitute.
- No fraud scoring on orders.
- No SIEM. Cloud Logging with alerting policies is the substitute.

Each of these is a roadmap item, not an oversight. [`ROADMAP.md`](ROADMAP.md) carries the sequencing.

---

## 9. Verification

Security claims in this document are only true if tested. The mapping:

| Claim                              | Test                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Read matrix                        | `infra/tests/rules/{catalogue,user-scoped,staff-and-server-only}.test.ts` — allow **and** deny per row              |
| Write matrix                       | `infra/tests/rules/notifications.test.ts` — every constraint in the table has its own deny-case                     |
| Client write surface is two fields | `infra/tests/rules/coverage.test.ts` counts `allow update` in the ruleset and requires exactly two                  |
| Every collection has a rule        | `infra/tests/rules/coverage.test.ts` cross-checks `COLLECTIONS` from `@romp/data` against the `match` blocks        |
| Status literals agree              | `infra/tests/rules/coverage.test.ts` asserts `PUBLIC_PRODUCT_STATUS` and `PUBLIC_REVIEW_STATUS` appear verbatim     |
| Roles come from claims             | `infra/tests/rules/coverage.test.ts` asserts the ruleset never calls `get()` on a `users` document                  |
| Staff is an allowlist              | Every rules suite includes a caller holding a role we never issue                                                   |
| Storage matrix                     | `infra/tests/storage-rules.test.ts`, including SVG rejection and the size ceiling                                   |
| Documents match their schemas      | `@romp/data` converters validate on read **and** write; `infra/tests/seed.test.ts` reads every seeded document back |
| Seed is idempotent                 | `infra/tests/seed.test.ts` runs it twice and compares counts and document contents                                  |
| Ownership on server reads          | Repository unit tests asserting a foreign `uid` yields not-found (Task 7)                                           |
| 404-not-403                        | API integration tests per owned resource type                                                                       |
| Zod at boundaries                  | Contract tests with malformed and over-supplied payloads                                                            |
| UTR uniqueness                     | Emulator test submitting the same UTR on two orders concurrently                                                    |
| No oversell                        | Emulator test with concurrent checkouts on a single unit of stock                                                   |
| Log redaction                      | Unit test asserting a serialised log line containing a user object has no phone or email                            |
| Headers and CSP                    | Automated check against a deployed preview                                                                          |
| No secrets in the bundle           | CI grep over the built client output for known secret patterns                                                      |

A security change without a corresponding test in this table is incomplete.
