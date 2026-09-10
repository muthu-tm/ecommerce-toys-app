# Feature inventory

Every feature the platform has, is deliberately without, or plans. Derived from the ROMP prototype
(`ROMP Toy Store.html`) plus the agreed scope decisions.

**Status key**

| Status      | Meaning                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| ✅ v1.0     | Built in v1.0. Acceptance detail in [`V1_SCOPE.md`](V1_SCOPE.md).             |
| 🚫 Excluded | Deliberately not built. Rationale given — these are decisions, not omissions. |
| 🗓 Roadmap   | Planned. Sequencing in [`ROADMAP.md`](ROADMAP.md).                            |

---

## Storefront — discovery

| Feature                                                     | Status    | Notes                                                       |
| ----------------------------------------------------------- | --------- | ----------------------------------------------------------- |
| Home: hero, headline, CTAs                                  | ✅ v1.0   | Copy and imagery from store config, not code                |
| Home: shop-by-age grid                                      | ✅ v1.0   | Age bands are config values, not a hardcoded union          |
| Home: featured / parents'-picks rail                        | ✅ v1.0   |                                                             |
| Home: promotional banner                                    | ✅ v1.0   | Static copy from config; not tied to a discount engine      |
| Home: trust badges                                          | ✅ v1.0   | Config content dictionary                                   |
| Category listing (`/c/[slug]`)                              | ✅ v1.0   | SSR + ISR                                                   |
| Age-band listing (`/age/[band]`)                            | ✅ v1.0   |                                                             |
| Filter by age band                                          | ✅ v1.0   | URL search param, server-side                               |
| Filter by category (multi-select)                           | ✅ v1.0   | Firestore `in`, capped at 10 with a typed error             |
| Filter by price range                                       | ✅ v1.0   | Single range field — a Firestore constraint, documented     |
| Filter by safety attributes (BIS, BPA-free, no small parts) | ✅ v1.0   | Boolean equality filters                                    |
| Sort: popularity, price asc/desc, rating                    | ✅ v1.0   | One composite index per sort                                |
| Facet counts beside filters                                 | ✅ v1.0   | From maintained `categories.productCount`, not query counts |
| Pagination                                                  | ✅ v1.0   | Firestore cursor (`startAfter`), no offset paging           |
| Text search                                                 | ✅ v1.0   | Prefix match on normalised tokens only — a known limitation |
| Typo-tolerant / full-text search                            | 🗓 Roadmap | Typesense behind the existing `SearchPort`                  |
| Empty-state with filter reset                               | ✅ v1.0   |                                                             |
| Mobile filter bottom sheet                                  | ✅ v1.0   |                                                             |

## Storefront — product detail

| Feature                                                | Status      | Notes                                              |
| ------------------------------------------------------ | ----------- | -------------------------------------------------- |
| PDP with gallery, thumbnails, keyboard nav             | ✅ v1.0     |                                                    |
| Mobile pinch-zoom gallery                              | ✅ v1.0     |                                                    |
| Variant selection (age band, finish)                   | ✅ v1.0     | Via URL param, so variants are shareable           |
| Out-of-stock variants shown as sold out                | ✅ v1.0     | Shown, never hidden — matches prototype behaviour  |
| Price, MRP, savings badge                              | ✅ v1.0     | Integer paise throughout                           |
| Rating summary and review list                         | ✅ v1.0     | Published reviews only                             |
| "In the box" contents                                  | ✅ v1.0     |                                                    |
| "Skills it builds" tags                                | ✅ v1.0     |                                                    |
| Safety and certification block                         | ✅ v1.0     | BIS cert number and expiry                         |
| Delivery-date estimate by pincode                      | ✅ v1.0     | Nearest active warehouse per config serviceability |
| Returns policy block                                   | ✅ v1.0     | Config copy                                        |
| Structured data (Product, Breadcrumb, AggregateRating) | ✅ v1.0     |                                                    |
| Social share image (OG)                                | ✅ v1.0     | Generated, brand from config                       |
| No-cost EMI messaging                                  | 🚫 Excluded | Requires a gateway                                 |
| Back-in-stock notification                             | 🗓 Roadmap   | Dispatcher already supports the audience           |

## Storefront — cart and checkout

| Feature                                      | Status      | Notes                                                 |
| -------------------------------------------- | ----------- | ----------------------------------------------------- |
| Anonymous cart                               | ✅ v1.0     | Signed cookie ID                                      |
| Cart merge on sign-in                        | ✅ v1.0     | Sum quantities, cap at available                      |
| Quantity change, remove                      | ✅ v1.0     | API-mediated, availability-checked                    |
| Gift wrap add-on                             | ✅ v1.0     | Fee from config, feature-flaggable                    |
| Server-authoritative totals                  | ✅ v1.0     | `POST /v1/checkout/quote` is the only source of truth |
| GST-inclusive pricing display                | ✅ v1.0     | Rate from config                                      |
| Free-shipping threshold                      | ✅ v1.0     | From config                                           |
| Express delivery option                      | ✅ v1.0     | Fee from config, feature-flaggable                    |
| Stale-price banner                           | ✅ v1.0     | When a snapshot drifts from current price             |
| Save for later                               | 🗓 Roadmap   | Wishlist covers most of the need in v1.0              |
| 3-step checkout (address → payment → review) | ✅ v1.0     |                                                       |
| Address book at checkout                     | ✅ v1.0     |                                                       |
| Gift order (hide prices on invoice)          | ✅ v1.0     |                                                       |
| Coupon / offer code entry                    | 🚫 Excluded | No discount engine in v1.0                            |
| ROMP coins redemption                        | 🚫 Excluded | Ledger deferred — real financial-integrity complexity |

## Storefront — payment

| Feature                                      | Status      | Notes                                                  |
| -------------------------------------------- | ----------- | ------------------------------------------------------ |
| Dynamic per-order UPI QR                     | ✅ v1.0     | Encodes exact amount + order note; server-rendered SVG |
| UPI deep link / tap-to-pay on mobile         | ✅ v1.0     | `upi://pay?...`                                        |
| UTR / reference submission                   | ✅ v1.0     | Globally unique, transaction-guarded                   |
| Payment screenshot upload                    | ✅ v1.0     | Optional; admin-only Storage path                      |
| Reservation TTL countdown                    | ✅ v1.0     | Stock released on expiry                               |
| Resubmit proof after rejection               | ✅ v1.0     |                                                        |
| Payment gateway (cards, netbanking, wallets) | 🚫 Excluded | Explicit product decision                              |
| Cash on delivery                             | 🚫 Excluded | Explicit product decision                              |
| EMI                                          | 🚫 Excluded | Requires a gateway                                     |
| Automated bank reconciliation                | 🗓 Roadmap   | Bank-statement CSV import                              |

## Storefront — account

| Feature                               | Status      | Notes                                                        |
| ------------------------------------- | ----------- | ------------------------------------------------------------ |
| Register with email + password        | ✅ v1.0     |                                                              |
| Register with mobile + password       | ✅ v1.0     | Deterministic alias; no OTP — see [IDENTITY.md](IDENTITY.md) |
| Login with either identifier          | ✅ v1.0     | Any common phone spelling normalises to one account          |
| Password reset (email accounts)       | ✅ v1.0     | Firebase's built-in reset email — an auth primitive          |
| Password reset (mobile-only accounts) | ✅ v1.0     | Admin-assisted via WhatsApp; documented gap                  |
| Password change while signed in       | ✅ v1.0     |                                                              |
| Order history                         | ✅ v1.0     |                                                              |
| Live order tracking timeline          | ✅ v1.0     | 4 steps; client SDK listener                                 |
| Reorder                               | ✅ v1.0     | Skips unavailable lines and says which                       |
| Invoice PDF                           | ✅ v1.0     | Branded from config                                          |
| Address book CRUD                     | ✅ v1.0     | Default-address flag                                         |
| Wishlist                              | ✅ v1.0     | Instant cross-tab toggle                                     |
| Notification bell + feed              | ✅ v1.0     | Unread badge, mark read, deep links                          |
| WhatsApp support CTA                  | ✅ v1.0     | Pre-filled with order reference                              |
| Saved cards / payment methods         | 🚫 Excluded | No gateway, nothing to save                                  |
| ROMP coins balance and ledger         | 🚫 Excluded | Deferred                                                     |
| Refer & earn                          | 🚫 Excluded | Deferred                                                     |
| Kids profiles                         | 🚫 Excluded | Deferred                                                     |
| MFA / OTP                             | 🚫 Excluded | Explicit product decision                                    |
| Customer ↔ admin chat                 | 🗓 Roadmap   | WhatsApp covers support in v1.0                              |

## Storefront — reviews

| Feature                         | Status    | Notes                                            |
| ------------------------------- | --------- | ------------------------------------------------ |
| Submit rating + review          | ✅ v1.0   | Verified-purchase check against delivered orders |
| One review per user per product | ✅ v1.0   |                                                  |
| Profanity screen, rate limit    | ✅ v1.0   |                                                  |
| Moderation before publication   | ✅ v1.0   |                                                  |
| Review helpfulness voting       | 🗓 Roadmap |                                                  |
| Photo reviews                   | 🗓 Roadmap |                                                  |

## Admin — catalogue

| Feature                            | Status    | Notes                                                       |
| ---------------------------------- | --------- | ----------------------------------------------------------- |
| Product list with status tabs      | ✅ v1.0   | Active / draft / out-of-stock / missing certification       |
| Product search                     | ✅ v1.0   |                                                             |
| Bulk selection + bulk actions      | ✅ v1.0   | Price edit, age-band change, unpublish                      |
| Product editor — Details           | ✅ v1.0   | Name, description, brand, category, age band                |
| Product editor — Variants          | ✅ v1.0   | Per-variant SKU, price, MRP, live toggle                    |
| Product editor — Inventory         | ✅ v1.0   | Per-warehouse stock, ledger, low-stock threshold            |
| Product editor — Media             | ✅ v1.0   | Upload, reorder, cover selection, 4 generated widths        |
| Product editor — SEO               | ✅ v1.0   | Title, meta description, slug, index toggle, Google preview |
| Draft autosave + dirty-state guard | ✅ v1.0   |                                                             |
| Publish gating (needs a variant)   | ✅ v1.0   | Typed rejection, not a silent failure                       |
| Safety / compliance fields         | ✅ v1.0   | BIS cert, expiry, BPA-free, small-parts warning             |
| Category CRUD                      | ✅ v1.0   | Slug collisions, parent categories                          |
| Category filter / nav toggles      | ✅ v1.0   | Drives storefront sidebar and header                        |
| Category reorder                   | ✅ v1.0   | Drag to set nav order                                       |
| Product-count maintenance          | ✅ v1.0   | Function-maintained; these are the facet counts             |
| Warehouse management UI            | 🗓 Roadmap | v1.0 seeds warehouses from config                           |
| Bulk CSV product import            | 🗓 Roadmap |                                                             |

## Admin — orders and money

| Feature                                    | Status    | Notes                                                            |
| ------------------------------------------ | --------- | ---------------------------------------------------------------- |
| Order list with status filters             | ✅ v1.0   | Separate payment and fulfilment columns                          |
| Order search by reference / email / mobile | ✅ v1.0   |                                                                  |
| Order detail master-view                   | ✅ v1.0   | Line items, address, payment, audit trail                        |
| Payment verification queue                 | ✅ v1.0   | Oldest-first, UTR and screenshot side by side                    |
| Verify payment → commit stock              | ✅ v1.0   | One transaction; idempotent on retry                             |
| Reject payment → release stock             | ✅ v1.0   | Reason recorded; resubmission allowed                            |
| Fulfilment state machine                   | ✅ v1.0   | Unfulfilled → Packed → Shipped → Delivered, + On hold, Cancelled |
| Carrier + tracking number                  | ✅ v1.0   |                                                                  |
| Cancel with restock                        | ✅ v1.0   | Returns stock to the right warehouses                            |
| Refunds, full and partial                  | ✅ v1.0   | Append-only; never mutates original amounts                      |
| Refund with optional restock               | ✅ v1.0   |                                                                  |
| Printable packing slip                     | ✅ v1.0   | Branded from config                                              |
| Actor-attributed audit trail               | ✅ v1.0   | Every money mutation names the admin and timestamp               |
| Bank-statement reconciliation              | 🗓 Roadmap |                                                                  |
| Shipping-carrier API integration           | 🗓 Roadmap | Manual tracking numbers in v1.0                                  |

## Admin — insight and settings

| Feature                                        | Status      | Notes                                                           |
| ---------------------------------------------- | ----------- | --------------------------------------------------------------- |
| Dashboard KPIs                                 | ✅ v1.0     | Revenue, orders, AOV, verification queue depth                  |
| Revenue chart                                  | ✅ v1.0     | From scheduled `analytics/daily` rollup, never a page-load scan |
| Low-stock panel                                | ✅ v1.0     |                                                                 |
| Customer list with aggregates                  | ✅ v1.0     | Order count, lifetime value, derived tier                       |
| Customer detail                                | ✅ v1.0     |                                                                 |
| Checkout settings                              | ✅ v1.0     | Reservation TTL, fees, thresholds, UPI payee                    |
| Notification bell                              | ✅ v1.0     | New orders, proofs, low stock, pending reviews                  |
| Admin login (seeded accounts only)             | ✅ v1.0     | No signup, no invite                                            |
| Admin team management / invites                | 🚫 Excluded | Seeded accounts only in v1.0                                    |
| Role-based permissions                         | 🚫 Excluded | Single `admin` role in v1.0                                     |
| Discount / coupon builder                      | 🚫 Excluded |                                                                 |
| Gateway settings (methods, 3-DS, capture mode) | 🚫 Excluded | No gateway                                                      |
| COD rules                                      | 🚫 Excluded | No COD                                                          |
| Sandbox / test-mode toggle                     | 🚫 Excluded | No gateway to sandbox                                           |
| CSV exports                                    | 🗓 Roadmap   |                                                                 |

## Platform capabilities

| Feature                                                  | Status      | Notes                                                       |
| -------------------------------------------------------- | ----------- | ----------------------------------------------------------- |
| White-label config (brand, palette, fonts, copy, locale) | ✅ v1.0     | [`WHITE_LABEL.md`](WHITE_LABEL.md)                          |
| Configurable feature flags                               | ✅ v1.0     | Reviews, wishlist, gift wrap, express delivery              |
| Configurable age bands and categories                    | ✅ v1.0     |                                                             |
| Configurable warehouses (one or many)                    | ✅ v1.0     | Admin UI iterates them dynamically                          |
| `pnpm store:new` generator                               | ✅ v1.0     |                                                             |
| Notification pipeline with routing table                 | ✅ v1.0     | [`NOTIFICATIONS.md`](NOTIFICATIONS.md)                      |
| Reservation TTL sweeper                                  | ✅ v1.0     | Alerts on non-execution                                     |
| Structured logging with correlation IDs                  | ✅ v1.0     |                                                             |
| Typed error taxonomy → problem+json                      | ✅ v1.0     |                                                             |
| Idempotent write endpoints                               | ✅ v1.0     | `Idempotency-Key`                                           |
| Rate limiting                                            | ✅ v1.0     | Cloudflare + app-level on auth and order routes             |
| Accessibility (WCAG-oriented)                            | ✅ v1.0     | Automated axe checks + keyboard traversal; see caveat below |
| Reduced-motion support                                   | ✅ v1.0     | Animations collapse to no-ops                               |
| Lighthouse performance budgets in CI                     | ✅ v1.0     |                                                             |
| Daily Firestore backup + rehearsed restore               | ✅ v1.0     |                                                             |
| Sentry error tracking                                    | ✅ v1.0     |                                                             |
| Multi-tenant (one deploy, many stores)                   | 🗓 Roadmap   | `StoreContext` seam already in place                        |
| Email delivery                                           | 🚫 Excluded | Notifications + WhatsApp instead                            |
| FCM web push                                             | 🗓 Roadmap   | Dispatcher extension point                                  |
| Playwright full E2E suite                                | 🗓 Roadmap   | Smoke only in v1.0                                          |
| Staging environment                                      | 🗓 Roadmap   | dev + prod in v1.0                                          |

**Accessibility caveat:** automated checks and keyboard traversal catch a meaningful share of issues,
but full WCAG conformance requires manual testing with assistive technology and expert review. v1.0
delivers the automated gates and a keyboard-complete purchase path, not a certified conformance
claim.

---

## Why the exclusions

| Excluded                  | Reason                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Payment gateway, COD, EMI | Product decision: UPI with manual verification, no gateway relationship                              |
| MFA / OTP                 | Product decision; shapes the identity design ([ADR-0006](adr/0006-password-identity-without-otp.md)) |
| All email                 | Product decision: notifications + WhatsApp ([ADR-0007](adr/0007-notifications-not-email.md))         |
| Coupons / discounts       | Not needed for launch; a discount engine touches every price path and deserves its own phase         |
| ROMP coins ledger         | A financial ledger needs idempotency and reconciliation guarantees of its own                        |
| Refer & earn              | Depends on the coins ledger, and carries fraud rules                                                 |
| Kids profiles             | Personalisation, not commerce; also child-data handling deserves deliberate design                   |
| Admin teams & RBAC        | Seeded single-role admins are sufficient at launch                                                   |
| Saved cards               | Nothing to save without a gateway                                                                    |
