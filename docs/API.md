# API

`apps/api` — a Fastify application deployed as a single Cloud Functions v2 HTTP function, served at
`api.<domain>`. It owns **every write** in the system. Clients read some data directly from Firestore
under security rules ([`ARCHITECTURE.md` §2](ARCHITECTURE.md#2-readwrite-split)); nothing writes
without passing through here.

---

## Conventions

**Base path** `/v1`. The version is in the path so a breaking change can run alongside its predecessor.

**Authentication** Firebase ID token as `Authorization: Bearer <token>`. Admin routes additionally
require the `admin` custom claim ([`IDENTITY.md`](IDENTITY.md)).

**Content type** `application/json` for requests. Success responses are `application/json`; errors are
`application/problem+json` (RFC 7807).

**Idempotency** Every state-changing `POST` accepts `Idempotency-Key: <uuid>`. It is **required** on
`POST /v1/orders` and `POST /v1/orders/:id/payment-proof`, where a duplicate submission would
otherwise double-reserve stock or double-claim a payment reference. Replaying a key returns the
original response.

**Correlation** Every request carries or is assigned `x-request-id`, echoed in the response and
attached to every log line and Sentry event it produces.

**Money** Every amount in every payload is an integer in paise, in a field suffixed `Minor`. Clients
never send a total — they send intent, and the server computes and returns the authoritative amounts.

### Error shape

```json
{
  "type": "https://romp.dev/errors/insufficient-stock",
  "title": "Insufficient stock",
  "status": 409,
  "code": "INSUFFICIENT_STOCK",
  "detail": "Only 2 units of BRK-2401 remain.",
  "requestId": "01JD8Z3K7Q0000000000000000",
  "errors": [{ "path": "items.0.qty", "message": "Requested 5, available 2" }]
}
```

`code` is the stable, machine-readable contract — clients branch on `code`, never on `detail`, which
is human-facing and may be reworded. `errors[]` appears only for validation failures.

### Error catalogue

| `code`                        | HTTP | Raised when                                                                 |
| ----------------------------- | ---- | --------------------------------------------------------------------------- |
| `VALIDATION_FAILED`           | 400  | Zod rejects a body, query or param                                          |
| `FILTER_LIMIT_EXCEEDED`       | 400  | More than 10 values in a multi-value filter — Firestore's `in` ceiling      |
| `UNSUPPORTED_QUERY`           | 400  | Well-formed but unservable: two range fields, or a cursor from another sort |
| `UNAUTHENTICATED`             | 401  | Missing, malformed or expired ID token                                      |
| `FORBIDDEN`                   | 403  | Authenticated but lacking the required claim or ownership                   |
| `NOT_FOUND`                   | 404  | Resource absent, or present but not visible to the caller                   |
| `IDENTIFIER_TAKEN`            | 409  | Email or mobile already registered                                          |
| `INSUFFICIENT_STOCK`          | 409  | Reservation would drive available stock negative                            |
| `RESERVATION_EXPIRED`         | 409  | Action attempted against a lapsed reservation                               |
| `DUPLICATE_PAYMENT_REFERENCE` | 409  | UTR already claimed by another order                                        |
| `INVALID_STATE_TRANSITION`    | 409  | Illegal order or fulfilment transition                                      |
| `VARIANT_IN_USE`              | 409  | Deleting a variant referenced by an open order                              |
| `REFUND_EXCEEDS_REFUNDABLE`   | 409  | Refund exceeds the remaining refundable amount                              |
| `WEAK_PASSWORD`               | 422  | Password below the policy floor                                             |
| `RATE_LIMITED`                | 429  | Per-route limit exceeded; `Retry-After` is set                              |
| `INTERNAL`                    | 500  | Unexpected. Logged with stack and reported; no internals in the response    |

`FILTER_LIMIT_EXCEEDED` and `UNSUPPORTED_QUERY` are both 400s and both distinct from
`VALIDATION_FAILED`, for reasons worth keeping apart.

A filter carrying eleven category IDs is **not** truncated to ten. A truncated filter returns wrong
results that look exactly like right ones — a shorter list, with no way for the customer to know the
eleventh category was dropped. The response names the field and the ceiling so the caller can act
([ADR-0002](adr/0002-firestore-search-port.md)).

`UNSUPPORTED_QUERY` means nothing about the request is malformed; it is a combination _this engine_
cannot serve. Firestore permits one range field per query, so a price filter can only be sorted by
price. The code is separate because the set of unsupported queries **shrinks** when Typesense arrives
in v1.1 — folded into `VALIDATION_FAILED`, those failures would be indistinguishable from real bad
input and nobody could tell what the migration fixed. The same code covers a pagination cursor used
against a different sort order, which is the normal consequence of a sort dropdown that keeps the
`cursor` parameter.

---

## Middleware order

Order is load-bearing — auth cannot run before the request ID exists, and the error handler must wrap
everything.

```
request-id → pino request logging → CORS (explicit origin allowlist) → rate limit
  → body/query Zod validation → Firebase ID-token verification → role guard
  → idempotency → route handler → error handler → response logging
```

CORS uses an explicit allowlist of the storefront and admin origins per environment. No wildcard.

---

## Endpoints

### Health and identity

| Method  | Path                                  | Auth  | Purpose                                                              |
| ------- | ------------------------------------- | ----- | -------------------------------------------------------------------- |
| `GET`   | `/v1/health`                          | none  | Liveness. Returns version and commit.                                |
| `POST`  | `/v1/auth/register`                   | none  | Create an account from email **or** mobile + password                |
| `POST`  | `/v1/auth/check-identifier`           | none  | Availability check. Rate-limited hard — it is an enumeration surface |
| `POST`  | `/v1/auth/password-change`            | user  | Change password, current password required                           |
| `GET`   | `/v1/me`                              | user  | Profile and derived tier                                             |
| `PATCH` | `/v1/me`                              | user  | Update display name, secondary contact                               |
| `GET`   | `/v1/admin/me`                        | admin | Admin profile and claim confirmation                                 |
| `POST`  | `/v1/admin/users/:uid/password-reset` | admin | Mint a single-use, short-TTL reset link for WhatsApp-assisted reset  |

### Catalogue reads (server-to-server)

The storefront reads the catalogue directly via the Admin SDK, so these exist for the admin app and
future clients rather than for page rendering.

Both are thin wrappers over `SearchPort` from `@romp/data` — `GET /v1/products` parses its query string
with `ProductQuerySchema` and hands the result straight to `searchProducts`. Nothing in the API layer
builds a Firestore query, and a lint rule enforces that rather than leaving it to review
([ADR-0002](adr/0002-firestore-search-port.md)). Which also means the query parameters, the sort
options and the `Paged` response shape are the same for the API and for a server-rendered page, so
there is only one contract to keep correct.

| Method | Path                    | Auth | Purpose                                              |
| ------ | ----------------------- | ---- | ---------------------------------------------------- |
| `GET`  | `/v1/products`          | none | Search and filter. Mirrors `SearchPort` parameters   |
| `GET`  | `/v1/products/:slug`    | none | Product with variants and availability               |
| `GET`  | `/v1/categories`        | none | Category tree with counts                            |
| `GET`  | `/v1/delivery-estimate` | none | `?pincode=` → estimate from nearest active warehouse |

### Cart and checkout

| Method   | Path                        | Auth     | Purpose                                                                                                                 |
| -------- | --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/v1/cart/items`            | optional | Add or update a line. Validates availability, refreshes the price snapshot                                              |
| `DELETE` | `/v1/cart/items/:variantId` | optional | Remove a line                                                                                                           |
| `PATCH`  | `/v1/cart`                  | optional | Toggle gift wrap                                                                                                        |
| `POST`   | `/v1/cart/merge`            | user     | Merge an anonymous cart into the account on sign-in                                                                     |
| `POST`   | `/v1/checkout/quote`        | optional | **The only source of totals.** Returns `{ subtotalMinor, giftWrapMinor, shippingMinor, taxMinor, totalMinor, lines[] }` |

Anonymous access is by signed cart cookie; the endpoints accept either that or a bearer token.

### Orders

| Method | Path                           | Auth                  | Purpose                                                                                                                                                                             |
| ------ | ------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/v1/orders`                   | user                  | **Money-critical.** Re-quotes, reserves stock across warehouses by priority, allocates `humanId`, snapshots items and address, mints the UPI QR payload. Requires `Idempotency-Key` |
| `GET`  | `/v1/orders/:id`               | user (owner) or admin | Order detail                                                                                                                                                                        |
| `POST` | `/v1/orders/:id/payment-proof` | user (owner)          | Submit UTR + optional screenshot. Claims the UTR guard. Requires `Idempotency-Key`                                                                                                  |
| `POST` | `/v1/orders/:id/reorder`       | user (owner)          | Re-add available lines at current prices; reports skipped lines                                                                                                                     |
| `GET`  | `/v1/orders/:id/invoice`       | user (owner) or admin | Branded PDF                                                                                                                                                                         |

### Addresses and wishlist

| Method                      | Path                      | Auth | Purpose                                             |
| --------------------------- | ------------------------- | ---- | --------------------------------------------------- |
| `POST` / `PATCH` / `DELETE` | `/v1/addresses[/:id]`     | user | Address CRUD; enforces the single-default invariant |
| `PUT` / `DELETE`            | `/v1/wishlist/:productId` | user | Idempotent add / remove                             |

### Reviews

| Method | Path                         | Auth | Purpose                                                                          |
| ------ | ---------------------------- | ---- | -------------------------------------------------------------------------------- |
| `POST` | `/v1/reviews`                | user | Submit. Verified-purchase check, one per product, profanity screen, rate-limited |
| `GET`  | `/v1/products/:slug/reviews` | none | Published reviews, paginated                                                     |

### Admin — catalogue

| Method                      | Path                                         | Purpose                                                                       |
| --------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST` / `PATCH`            | `/v1/admin/products[/:id]`                   | Create / update. Publishing without a live variant is refused                 |
| `POST`                      | `/v1/admin/products/:id/variants`            | Add a variant; maintains `variantSummary` and `priceFromMinor` in-transaction |
| `PATCH` / `DELETE`          | `/v1/admin/products/:id/variants/:variantId` | Update / delete. Delete refused if referenced by an open order                |
| `POST`                      | `/v1/admin/inventory/adjust`                 | Adjust stock; writes a ledger entry                                           |
| `POST`                      | `/v1/admin/media/signed-url`                 | Upload URL for `products/{productId}/{uuid}.{ext}`                            |
| `POST` / `PATCH` / `DELETE` | `/v1/admin/categories[/:id]`                 | CRUD; delete refused when non-empty                                           |
| `POST`                      | `/v1/admin/categories/reorder`               | Persist nav order                                                             |
| `POST`                      | `/v1/admin/products/bulk`                    | Bulk price / age-band / status changes                                        |

### Admin — orders and money

| Method          | Path                                  | Purpose                                                                   |
| --------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| `GET`           | `/v1/admin/orders`                    | List with status filters and search                                       |
| `POST`          | `/v1/admin/orders/:id/verify-payment` | Commit reserved stock, mark paid, audit with the acting admin. Idempotent |
| `POST`          | `/v1/admin/orders/:id/reject-payment` | Release stock, record reason, permit resubmission                         |
| `POST`          | `/v1/admin/orders/:id/fulfilment`     | Advance the fulfilment state machine                                      |
| `POST`          | `/v1/admin/orders/:id/cancel`         | Cancel with restock                                                       |
| `POST`          | `/v1/admin/refunds`                   | Full or partial refund, append-only, optional restock                     |
| `GET`           | `/v1/admin/customers`                 | List with aggregates                                                      |
| `GET`           | `/v1/admin/analytics/daily`           | Dashboard series from the rollup                                          |
| `GET` / `PATCH` | `/v1/admin/settings/checkout`         | Commerce parameters                                                       |

### Internal

| Method | Path              | Auth          | Purpose                                                                    |
| ------ | ----------------- | ------------- | -------------------------------------------------------------------------- |
| `POST` | `/api/revalidate` | signed secret | On the **storefront**, not the API. Called by Functions to bust cache tags |

---

## Rate limits

Applied at Cloudflare and again in-process, because the app-level limit must hold even if a request
bypasses the edge.

| Route                                | Limit                                 |
| ------------------------------------ | ------------------------------------- |
| `POST /v1/auth/register`             | 5 / hour / IP                         |
| `POST /v1/auth/check-identifier`     | 20 / hour / IP                        |
| Sign-in (Firebase Auth, client-side) | Firebase throttling + Cloudflare rule |
| `POST /v1/orders`                    | 10 / hour / user                      |
| `POST /v1/orders/:id/payment-proof`  | 10 / hour / user                      |
| `POST /v1/reviews`                   | 5 / day / user                        |
| Everything else                      | 120 / minute / user                   |

---

## OpenAPI

The specification is **generated**, never hand-maintained. Request and response schemas live in
`@romp/contracts` as Zod schemas, and the same schemas validate at runtime. Drift between docs and
behaviour is therefore not expressible.

Generation uses Zod 4's built-in `toJSONSchema` against an explicit registry the package owns
(`@romp/contracts/openapi`), not a schema-to-OpenAPI library. The libraries in this space work by
patching `ZodType.prototype` with an `.openapi()` method, which only holds if every schema and the
generator share one Zod module instance — and under Vite they do not, so the patch was visible to the
generator and invisible to the schemas it was generating from. Owning the registry object removes that
dependency on bundler behaviour, along with a dependency and a global side effect.

```bash
pnpm --filter @romp/api openapi:generate   # → apps/api/openapi.json
pnpm --filter @romp/api openapi:serve      # Scalar UI at :8788
```

Two details worth knowing when adding routes:

- **`input` and `output` are different documents.** `EmailSchema` accepts a mixed-case address with
  whitespace on the way in and yields a trimmed lowercase one on the way out. Components are emitted
  from the output side, because that is what responses contain; request bodies are described from the
  same schemas with `io: 'input'`.
- **OpenAPI keys responses by status, and four distinct codes share 409.** A route declaring several
  conflict codes documents one 409 entry whose description names all of them; `code` in the body is
  what distinguishes them at runtime.

CI regenerates the spec and fails if the committed copy is stale, so a schema change cannot land
without the contract updating with it.

---

## Testing

| Layer          | What is asserted                                                                      |
| -------------- | ------------------------------------------------------------------------------------- |
| Route contract | Status codes, problem+json shape, `code` values, field-level validation paths         |
| Auth           | No token → 401; wrong claim → 403; non-owner → 404 (not 403 — absence, not existence) |
| Idempotency    | Replaying a key produces one effect and the original response                         |
| Concurrency    | N parallel `POST /v1/orders` for one remaining unit → exactly one 201                 |
| Transactions   | Emulator-backed: reserve, commit, release and restock leave stock consistent          |
| Rate limits    | Burst produces 429 with `Retry-After`                                                 |

Note the deliberate choice above: a resource the caller does not own returns **404, not 403**. A 403
confirms the resource exists, which leaks information about other customers' orders.
