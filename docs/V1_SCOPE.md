# v1.0 acceptance scope

What "done" means for v1.0, screen by screen, with the acceptance criteria each screen must satisfy.
Feature-level status lives in [`FEATURES.md`](FEATURES.md); this document is the checklist you hold
the build against.

**Definition of done, applied to every item below**

1. Behaviour matches the acceptance criteria stated here.
2. Tests exist at the appropriate layer (domain / repository / route / component) and pass.
3. Accessibility: keyboard-reachable, labelled, axe-clean, reduced-motion respected.
4. Nothing branded is hardcoded — colours, fonts, copy and names come from store config.
5. Errors surface as typed, human-readable states — never a raw stack or a silent no-op.
6. `docs/PROGRESS.md` updated.

---

## Storefront

### 1. Home — `/`

Hero with configured headline, sub-copy and two CTAs; shop-by-age grid; featured product rail;
promotional banner; trust-badge row; header with shop-by-age / all-toys, search, account, notification bell, cart count;
footer with policy links.

**Acceptance**

- Every string, colour, font and logo originates in `stores/<id>/store.config.ts`.
- Age-band tiles are generated from configured bands — changing the bands changes the grid.
- Renders server-side and is ISR-cached under `cacheTag('home')`.
- Responsive from 360 px to 1920 px; mobile shows the bottom bar.
- Featured rail links resolve to live PDPs.

### 2. Listing — `/c/[slug]`, `/age/[band]`

Filter sidebar (age, price, category with counts, safety), sort control, product grid, pagination,
empty state with reset, mobile filter bottom sheet.

**Acceptance**

- All filter and sort state lives in URL search params; refresh and back-button reproduce the view
  exactly; the URL is shareable.
- Filtering happens server-side through `SearchPort` — no client-side over-fetch-and-filter.
- Category facet counts come from maintained counters and match reality after a product moves.
- Selecting more than 10 categories produces a clear message, not a truncated result set.
- Zero results shows the empty state with a working reset.
- Pagination produces no duplicate or skipped products across pages.

### 3. Product detail — `/p/[slug]`

Gallery with thumbnails, variant selector, price/MRP/savings, rating summary, description,
"in the box", "skills it builds", safety block, delivery estimate by pincode, returns block, review
list, add-to-bag with quantity, wishlist toggle.

**Acceptance**

- Variant selection is a URL param, so a specific variant is shareable.
- A zero-stock variant is **shown as sold out** with add-to-bag disabled — never hidden.
- Switching variants updates price, MRP, SKU and stock state without a full reload.
- Pincode entry returns a delivery date derived from the nearest active warehouse.
- `Product`, `BreadcrumbList` and `AggregateRating` JSON-LD are present and well-formed.
- OG image renders with the configured brand.
- Gallery is fully keyboard-operable; pinch-zoom works on touch.

### 4. Cart — `/cart`

Line items with image, name, variant, quantity stepper, remove, per-line and order totals, gift-wrap
toggle, stock warnings, checkout CTA, continue-shopping.

**Acceptance**

- Totals come exclusively from `POST /v1/checkout/quote`; a tampered client value cannot change what
  is charged.
- Anonymous cart survives refresh; signing in merges it into the account cart without loss.
- Quantity beyond available stock is refused with a clear message.
- Cart badge updates live in a second tab.
- Gift wrap disabled in config disappears from both UI and quote.

### 5. Checkout — `/checkout`

Step 1 address (book + new address, delivery speed, gift option). Step 2 UPI payment (QR, deep link,
amount, TTL countdown, UTR field, optional screenshot). Step 3 review and confirm.

**Acceptance**

- Progress indicator reflects the current step; back navigation preserves entered data.
- Placing the order reserves stock in one transaction and mints a QR whose amount and order note
  match the order exactly.
- The TTL countdown is visible; on expiry the page moves to an expired state and stock is released.
- UTR submission is validated, globally unique, and moves the order to pending verification.
- A rejected payment can be resubmitted.
- Unauthenticated users are routed to sign-in and returned to checkout afterwards.

### 6. Order confirmation and tracking — `/orders/[id]`

Status headline, order reference, item summary, amounts, payment state, four-step fulfilment
timeline, WhatsApp support CTA.

**Acceptance**

- Status updates live via the client SDK — no refresh needed when an admin verifies payment.
- Timeline reflects real fulfilment state, with timestamps.
- WhatsApp CTA opens a chat pre-filled with the order reference.
- The page is readable and truthful even if the notification pipeline is down.

### 7. Account — `/account/*`

Orders, order detail, addresses, wishlist, profile (identifier, password change), notification feed.

**Acceptance**

- Orders list shows payment and fulfilment status distinctly.
- Reorder adds available lines at current prices and states which lines were skipped.
- Invoice PDF downloads, branded from config.
- Address CRUD works; the only default address cannot be deleted.
- Wishlist heart toggles instantly and reflects in a second tab.
- Password change requires the current password.
- A signed-in user cannot read or affect another user's data (proven by rules tests).

### 8. Authentication — `/signin`, `/register`

One identifier field accepting email or mobile, password with strength meter, inline validation,
reset entry point.

**Acceptance**

- Registering with `98450 21174` and signing in with `+91 98450 21174` reach the same account.
- Duplicate identifier is refused with a clear message.
- Weak passwords are refused with specific guidance.
- Email accounts can self-reset; mobile-only accounts are directed to WhatsApp-assisted reset.
- Auth routes are rate-limited.

### 9. Reviews

Submission form on delivered-order products; published reviews on the PDP.

**Acceptance**

- Only a verified purchaser of a delivered order may submit; one review per product per user.
- Submitted reviews are invisible publicly until an admin publishes them.
- Publishing recalculates the product's rating average and count.
- `features.reviews: false` removes submission and PDP review sections entirely.

### 10. Notification bell (customer)

Unread badge, dropdown feed, mark-one/mark-all read, deep links, empty state, pagination.

**Acceptance**

- New notifications appear without a refresh.
- Read state persists and is correct across two concurrent tabs.
- Clicking an item navigates to the referenced order or product.
- A user never sees another user's or an admin's notifications.

---

## Admin

### 11. Login — `/login`

Identifier + password. No signup, no invite, no password self-service.

**Acceptance**

- A customer account with valid credentials but no `admin` claim is refused with a clear message.
- A seeded admin signs in and reaches the dashboard.
- Rate-limited; failed attempts are logged without credentials.

### 12. Dashboard — `/`

KPI cards (revenue, orders, AOV, payment verification depth), revenue chart, low-stock panel,
orders-needing-action list, notification bell.

**Acceptance**

- Figures come from the scheduled `analytics/daily` rollup, not a page-load collection scan.
- Low-stock panel lists variants at or below threshold with their warehouse.
- Verification-queue depth matches the queue.

### 13. Orders — `/orders`

List with status filters and search; detail with line items, address, payment, audit trail,
fulfilment actions, packing slip.

**Acceptance**

- Payment status and fulfilment status are separate, filterable columns.
- Search resolves by order reference, email and mobile.
- Fulfilment transitions follow the state machine; illegal transitions are refused with a typed error.
- Shipping requires carrier and tracking number.
- Cancelling restocks the correct quantities to the correct warehouses.
- Every transition appends an actor-attributed audit event and emits the mapped notification.

### 14. Payment verification — `/payments`

Oldest-first queue; order, amount, UTR and screenshot side by side; verify and reject actions;
refund initiation.

**Acceptance**

- Verifying converts reserved stock to committed in one transaction, and is idempotent on retry.
- Rejecting releases stock and records a reason; the customer may resubmit.
- Refunds are append-only, cannot exceed the remaining refundable amount, and optionally restock.
- Every action names the acting admin with a timestamp.
- The customer's page and bell reflect the outcome within seconds.

### 15. Products — `/products`

List with status tabs, search, bulk selection and bulk actions; editor with Details, Variants,
Inventory, Media and SEO tabs.

**Acceptance**

- Publishing without at least one variant is refused with a typed error.
- Media upload produces four widths plus a blurhash placeholder.
- Saving busts the affected storefront cache tags; the public PDP reflects changes within seconds.
- Draft autosave works; navigating away with unsaved changes warns.
- Inventory tab renders one column per active warehouse, derived from data — adding a warehouse in
  config needs no UI change.
- Every stock adjustment writes a ledger entry that reconciles to the on-hand total.
- SKUs are unique; deleting a variant referenced by an open order is refused.

### 16. Categories — `/categories`

CRUD, parent assignment, filter and nav toggles, drag reorder, product counts.

**Acceptance**

- Slug collisions get a numeric suffix.
- `showInFilters` and `showInNav` immediately affect the storefront after revalidation.
- Product counts stay correct across create, reassign, archive and delete.
- Deleting a non-empty category is refused, with the count in the message.

### 17. Customers — `/customers`

List with aggregates and tier; detail with contact, order history and address summary.

**Acceptance**

- Order count and lifetime value are correct, including after a refund.
- Mobile numbers are displayed to admins but never written to logs.

### 18. Settings — `/settings`

Checkout settings: reservation TTL, gift-wrap fee, express fee, free-shipping threshold, UPI payee
details, GST rate.

**Acceptance**

- Changes take effect on the next quote without a deploy.
- Values are validated; a nonsensical TTL or negative fee is refused.

---

## Non-functional acceptance

| Area          | Bar                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Performance   | LCP < 2.5 s on emulated 4G, CLS < 0.1, TBT < 200 ms on home, listing and PDP — enforced in CI               |
| Accessibility | axe-clean at component and page level; purchase path completable by keyboard alone; reduced-motion honoured |
| SEO           | Config-driven sitemap and robots, canonicals, JSON-LD on PDPs, per-page OG images                           |
| Security      | Rules suite green as a release gate; no client write path to money or inventory; strict CSP, HSTS           |
| Reliability   | Sweeper and dispatcher alert on non-execution; daily backup with a rehearsed restore                        |
| Observability | Structured logs with correlation IDs; Sentry across all three surfaces; alerts on 5xx, latency, queue depth |
| White-label   | A second store deploys with zero changes under `apps/` or `packages/`                                       |

## Launch gate

v1.0 ships when: every screen above meets its acceptance criteria; `pnpm verify` and the rules suite
are green; performance budgets pass; a restore has been rehearsed; the runbooks in
[`RUNBOOKS.md`](RUNBOOKS.md) are complete; and the second-store clone test passes.
