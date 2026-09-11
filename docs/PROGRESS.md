# Progress

Living build checklist for ROMP v1.0. **Updated at the end of every task** — this is step 6 of the
definition of done in [`V1_SCOPE.md`](V1_SCOPE.md).

Rules for this document:

- A task is `Done` only when it is demoable, tested, and `pnpm verify` is green. Not when the code
  exists.
- Deviations from the plan are recorded in the decision log at the bottom, not silently absorbed.
- Anything discovered mid-task that is real work goes in **Carried forward** so it does not evaporate.

**Legend** — `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Summary

|                |                                                 |
| -------------- | ----------------------------------------------- |
| Tasks complete | **19 / 24**                                     |
| Current phase  | Phase 6 — Commerce                              |
| Current task   | Task 20 — Customer account and WhatsApp support |
| Blocked        | Nothing in code; account-level actions pending  |
| Last updated   | 2026-09-09                                      |

**Outstanding account-level actions.** These need the owner's Google and GitHub accounts, so they are
scripted and documented but not executed:

1. Run `infra/scripts/setup-projects.sh` then `setup-wif.sh`, for `romp-dev` and `romp-prod`. Requires
   a Blaze billing account. Firebase project IDs are globally unique, so if `romp-dev` is taken, change
   `.firebaserc` — it is the only place the IDs appear.
2. Add required reviewers to the GitHub `production` environment, and restrict its deployment branches
   to `v*` tags. Until then `deploy-prod.yml` runs unattended and the approval gate does not exist.
3. **Install the Resize Images extension** on `romp-dev`/`romp-prod` (`firebase deploy --only extensions`
   — configured in `firebase.json` and `extensions/storage-resize-images.env`), and create the **admin**
   App Hosting backend (`apphosting` in `firebase.json`). Set the admin's deploy env — `NEXT_PUBLIC_API_BASE_URL`,
   `NEXT_PUBLIC_FIREBASE_*` including `STORAGE_BUCKET` — and add the admin host to the API's `CORS_ORIGINS`.

### Phase overview

| Phase                         | Tasks | Outcome                                                        | Status |
| ----------------------------- | ----- | -------------------------------------------------------------- | ------ |
| 0. Foundations                | 1–2   | Repo, tooling, docs, Firebase environments, CI                 | `[x]`  |
| 1. Platform packages          | 3–4   | Contracts, observability, store config and theming             | `[x]`  |
| 2. Shell and data layer       | 5–7   | Design system, deployed storefront shell, schema, repositories | `[x]`  |
| 3. Public catalogue           | 8–9   | Home, listing, PDP — the SEO surface                           | `[x]`  |
| 4. Identity and notifications | 10–11 | Login, seeded admins, API service, navbar bells                | `[x]`  |
| 5. Backoffice catalogue       | 12–14 | Products, media, variants, inventory, categories               | `[~]`  |

| 6. Commerce | 15–19 | Cart, orders, UPI, verification, refunds, fulfilment | `[x]` |
| 7. Account and social | 20–21 | Customer account, WhatsApp support, reviews | `[ ]` |
| 8. Hardening and launch | 22–24 | Performance, SEO, a11y, security, cutover, launch | `[ ]` |

---

## Phase 0 — Foundations

### `[x]` Task 1 — Monorepo, tooling, and the complete documentation set

Everything downstream inherits these choices, so they are made once, deliberately, before any feature
code exists.

- [x] pnpm workspace + Turborepo pipeline (`package.json`, `pnpm-workspace.yaml`, `turbo.json`)
- [x] `.gitignore`, `.npmrc`, `.nvmrc`, `.editorconfig`, Prettier config and ignore
- [x] `@romp/config` — shared TypeScript, ESLint and Vitest presets, source-only, no build step
- [x] Strict TypeScript base: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- [x] ESLint 9 flat config with type-aware presets scoped to TS files; JS files explicitly
      type-check-disabled
- [x] Enforced standards as lint errors: `no-console`, `no-floating-promises`, `import/no-default-export`,
      `import/order`
- [x] Coverage tiers with an enforced gate — domain 95/95/90/95, standard 80/80/75/80, ui 70/70/65/70
- [x] Husky + lint-staged pre-commit; commitlint on commit-msg with workspace-matching scopes
- [x] `pnpm verify` green from a clean install
- [x] Documentation set: `ARCHITECTURE`, `V1_SCOPE`, `FEATURES`, `ROADMAP`, `DATA_MODEL`, `API`,
      `WHITE_LABEL`, `IDENTITY`, `NOTIFICATIONS`, `SECURITY`, `RUNBOOKS`, `PROGRESS`
- [x] ADRs 0001–0007, each with alternatives considered and consequences
- [x] `README.md` — quickstart, workspace map, standards, contribution rules

**Demo.** Clean clone → `pnpm install && pnpm verify` green; the docs set browsable with no dangling
internal links.

**Notes.**

- Coverage gate initially reported 0%. Two causes: a blanket `**/index.ts` exclusion, and toolchain
  files being counted. Fixed with an explicit `src/**/*.{ts,tsx}` include. Barrel files are
  deliberately **not** excluded — an untested re-export is still untested surface.
- `allowImportingTsExtensions: false` means every relative import is extensionless. Enforced by
  typecheck, so it fails loudly rather than at runtime.
- Turbo's `test.outputs` is `[]` — coverage artefacts belong to `test:coverage`, not `test`, otherwise
  every run warns about missing outputs.

### `[x]` Task 2 — Firebase environments, emulator suite, CI

Two isolated projects from the start. Sharing one project between dev and prod is the mistake that
ends with a test order in a real customer's history.

- [x] `romp-dev` and `romp-prod` in `asia-south1`, Firestore in Native mode — **scripted**, in
      `infra/scripts/setup-projects.sh`; execution needs the owner's billing account
- [x] Auth: **Email/Password only** — phone and anonymous providers explicitly disabled, set through
      the Identity Toolkit admin API rather than left as a console instruction
- [x] `firebase.json` with the emulator suite: Auth, Firestore, Storage, UI
- [x] `.firebaserc` project aliases (`dev`, `prod`, `demo`); `pnpm emulators` script
- [x] Emulator smoke test — 11 assertions, run inside `pnpm verify`
- [x] GitHub Actions PR gate: install → format → lint → typecheck → test (incl. emulators) → build,
      plus a separate dependency-audit job
- [x] Deploy to dev on merge to `main`
- [x] Deploy to prod on a `v*` tag, behind the `production` environment, with an ancestor-of-main guard
- [x] `STORE_ID` as a workflow input, falling back to a repository variable then the default store
- [x] Least-privilege deploy identity via Workload Identity Federation — no service-account JSON
      anywhere, scoped by an attribute condition to this repository

**Demo.** `pnpm verify` runs the emulator suite as part of the workspace gate: 6 turbo tasks green,
30 tests (19 unit + 11 emulator). The smoke test proves the emulators start, the Admin SDK round-trips
documents and commits multi-document transactions, the Email/Password provider accepts the internal
alias format mobile login depends on, and `firebase.json` really resolves `infra/*.rules` — the last
proven by observing client access being _denied_.

**Notes.**

- The smoke test asserts an unauthenticated client read **fails**. That is the assertion that catches a
  broken rules path: a misconfigured `firebase.json` leaves the emulator permissive, which looks
  identical to working rules until something leaks.
- It also creates a user at `p.919845021174@auth.romp.internal`. If the Email/Password provider
  rejected that address shape, the entire mobile-login design would be unworkable — better to know now
  than in Task 10.
- `pnpm audit --audit-level high` immediately failed on the Vitest pinned in Task 1: 2.1.9 carries a
  critical advisory (`GHSA-5xrq-8626-4rwp`) and pulled a Vite with a high one. Upgraded to Vitest 5 /
  Vite 8. The gate earned its place on day one.
- Firestore emulator is on **8181**, not the default 8080, which Docker was holding. 8080 is the most
  contended port in local development; every other emulator stays on its default.
- Functions and Pub/Sub emulators are deliberately absent until `apps/api` exists in Task 10, rather
  than declared and idle.

---

## Phase 1 — Platform packages

### `[x]` Task 3 — Contracts and observability packages

- [ ] `@romp/contracts` — Zod schemas as the single source of truth for types **and** runtime
      validation; inferred types exported, never hand-written twice
- [x] `Money` as a branded integer-paise type; construction only through validated helpers
      ([ADR-0004](adr/0004-money-in-minor-units.md)), plus `BasisPoints` for tax rates
- [x] Enums and state machines for order, fulfilment, reservation, review, product; refund reasons and
      modes (refunds are append-only, so they have no machine — by design)
- [x] OpenAPI document generated from the schemas, not maintained alongside them
- [x] `@romp/observability` — structured logger with correlation IDs and **redaction of `phone`,
      `email`, `utr`, `password`, `authorization` at serialisation time**
- [x] `AppError` taxonomy → RFC 7807 problem+json mapping; internal detail never crosses the boundary
- [x] Error reporting behind a port, with a no-op and a logging implementation — Sentry adapters land
      with the surfaces that need them (see deviations)
- [x] Coverage at the domain tier

**Demo.** Verified: `parseOrThrow` on a malformed cart body yields a 400 problem document with
`errors: [{ path: 'items.0.qty', … }]`; and a logger writing a real user document to a real stream
produces a line with no email, no phone number and no UTR anywhere in the serialised bytes, while
keeping `uid`, `displayName` and `totalMinor`.

**Notes.**

- `@romp/contracts`: 179 tests, 100% statements/functions/lines. The order-status machine is asserted
  over **every ordered pair of states**, not just the paths someone remembered — so a future edit
  cannot quietly open, say, `cancelled → paid`.
- `allocateProportionally` has a property test over 200 generated splits asserting the parts always sum
  exactly to the whole. Losing a paise there would surface as an order total that disagrees with the
  sum of its lines.
- Two ordering bugs found and fixed while testing: `EmailSchema` and `UtrSchema` validated _before_
  normalising, so a pasted address with trailing whitespace was rejected, and `'   123   '` passed the
  UTR minimum-length check before normalising to three characters. Both now normalise first.
- `@romp/observability`: 96 tests. Redaction tracks the **current ancestor path** rather than every
  object seen, so an object referenced twice as siblings renders twice instead of the second copy being
  mislabelled `[circular]`.
- Redaction is exact-match on normalised key names, not substring. Substring matching would blank
  `emailVerified` and `hasPhone`, and over-redaction that hides operational signal is how the whole
  mechanism ends up switched off.
- The dependency points one way: observability knows about contracts, never the reverse. That is why the
  state machines _report_ transition failures and `assertTransition` — which throws — lives in
  observability.

### `[x]` Task 4 — Store configuration and theming engine (white-label core)

- [x] `@romp/store-config` — Zod-validated config schema; a malformed store config fails the **build**,
      not a page render
- [x] `stores/romp/store.config.ts` + `stores/_template/`, both real workspace packages
- [x] Config → CSS custom properties emitter; palette, typography, radii, shadows, motion
- [x] Font config drives `next/font` — family, explicit weight list, source and fallback stack are all
      config; wiring into the app layout is Task 5
- [x] Feature flags, locale, currency, tax, warehouse list, WhatsApp number, UPI VPA
- [x] Lint rule failing raw colour literals and brand names, exposed as
      `createAppConfig({ brandNames })`; applied to `apps/` in Task 5, since none exist yet
- [x] `pnpm store:new <id>` scaffold, plus `pnpm store:tokens` to emit artefacts
- [x] Contrast assertion in tests — a config cannot ship a palette that fails WCAG AA

**Demo.** Verified by diffing the emitted artefacts across `STORE_ID` with no code change:

|                           | `romp`               | `_template`                   |
| ------------------------- | -------------------- | ----------------------------- |
| `--store-color-page`      | `#131417`            | `#ffffff`                     |
| `--store-color-primary`   | `#d8fd4f`            | `#5b3df5`                     |
| `--store-font-display`    | `"Archivo Black", …` | `Fraunces, ui-serif, …`       |
| `--store-motion-duration` | `220ms`              | `108ms` (subtle scales 180ms) |
| brand / prefix            | ROMP / RMP           | Example Store / EXA           |
| wishlist feature          | on                   | off                           |
| GST                       | 1800 bps             | 1200 bps                      |

`pnpm store:new toybox` was also run end to end: it rewrote the identity fields, produced a store that
validated and emitted on the first try, refused to clobber itself on a second run, and rejected
`Toybox` as an invalid ID. The throwaway store was removed afterwards.

**Notes.**

- 134 tests; coverage 99.5% statements, 95.1% branches, 100% functions and lines.
- The palette was **chosen against the gate rather than by eye.** Candidate greys were measured before
  being written into the config, which is why `textMuted` clears AA normal text at 5.50:1 instead of
  landing at the 4.1:1 a plausible-looking grey would have given.
- Borders cannot reach 3:1 between two dark surfaces, so the gate distinguishes decorative `border`
  (ungated) from interactive `borderStrong` and `focusRing` (gated at 3:1). Gating the hairline would
  have forced every dark theme into mid-grey dividers for no accessibility gain.
- `_template` is a **valid, light-themed** store, not a stub. It is the second config in the matrix, so
  anything assuming ROMP's dark palette, fonts, feature set or warehouse count fails on it.
- Two ordering bugs were found by the colour tests: `parseHexColor` spreading a string (flagged for
  code-unit handling) and the shorthand expansion. Both now use an ASCII-safe regex replace.
- The `no-hardcoded-brand` rule immediately caught a real design flaw — see the deviation below.

---

## Phase 2 — Shell and data layer

### `[x]` Task 5 — Design system and storefront shell, deployed

- [x] `@romp/ui` — every colour, radius, font and duration is a token; no literal in the package
- [x] Motion primitives honouring `prefers-reduced-motion` at two layers — the duration token
      collapses to `0ms`, and `useReducedMotion` covers what duration alone cannot fix
- [x] Accessible components: shared focus-visible ring, label/`aria-describedby`/`aria-invalid`
      wiring done once in `Field`, required accessible names on icon buttons, `Dialog` focus trap
- [x] Storefront app shell: header, nav, footer, responsive from 320 px up
- [~] **Deployed to dev on App Hosting** — `apphosting.yaml` and the deploy target are in place and
  the production build is verified locally, but creating the backend needs the owner's Firebase
  project. See the outstanding account-level actions above.

**Demo.** Verified by regenerating for a second store and rebuilding with no code change:

|                           | `romp`        | `_template`        |
| ------------------------- | ------------- | ------------------ |
| `--store-color-page`      | `#131417`     | `#ffffff`          |
| `--store-color-primary`   | `#d8fd4f`     | `#5b3df5`          |
| `--store-font-display`    | Archivo Black | Fraunces           |
| `--store-motion-duration` | `220ms`       | `108ms`            |
| `public/brand/mark.svg`   | ROMP mark     | Example Store mark |
| `next build`              | passes        | passes             |

Both builds are clean with no warnings. The storefront renders the configured hero, age-band grid
(one tile per configured band), trust badges, nav built from `showInNav` categories in configured
order, and a WhatsApp support link built from the configured number.

**Notes.**

- 78 tests in `@romp/ui`, 42 in the storefront, all axe-clean at component and page level.
- `Dialog` is the "keyboard traps handled" deliverable, and it cuts both ways: it **must** trap Tab,
  or a keyboard user walks into the inert page behind it, and it must **not** trap the user, so
  Escape always closes and focus returns to the trigger. Both directions of the Tab cycle are
  asserted, as is focus restoration and scroll-lock restoration.
- `IconButton` makes its `label` a **required** prop. An unlabelled icon button is the most common
  accessibility defect in a commerce UI — it is every cart, close, menu and bell control — and a
  required prop cannot be forgotten, only done badly.
- `Reveal` renders **visible** on the server and only hides itself after mount, so a reveal
  animation cannot leave the page blank when its script fails. Asserted with
  `renderToStaticMarkup`, because Testing Library flushes effects and cannot observe it.
- The `no-hardcoded-brand` rule found a real defect on its first run against app code:
  `themeColor: '#0e0e10'` in the viewport export. Fixed by exposing `theme` through
  `publicRuntimeConfig` — it is already public, since every one of those values is in the
  stylesheet the browser downloads — and reading `theme.colors.surfaceDeep`.
- Two accessibility and copy defects surfaced from tests rather than review: the WhatsApp CTA's
  accessible name read `WhatsApp(opens in a new tab)` because JSX drops whitespace before an
  element, and the configured greeting collapsed to "I need help with." for a general enquiry. Both
  fixed, and a test now holds every store's greeting to reading correctly with and without an order
  reference — which immediately caught the same defect in the scaffold.

### `[x]` Task 6 — Data model, rules, indexes, warehouses, config-driven seed

- [x] Firestore converters for every collection in [`DATA_MODEL.md`](DATA_MODEL.md)
- [x] `infra/firestore.rules` implementing the matrices in [`SECURITY.md`](SECURITY.md)
- [x] **Rules test suite with an allow-case and a deny-case per matrix row** — required, not optional
- [x] `infra/firestore.indexes.json`, `infra/storage.rules`
- [x] Warehouses seeded from store config — one or many, iterated dynamically
- [x] Config-driven catalogue seed; deterministic and re-runnable

**Demo.**

| Claim                              | How to see it                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| Rules do what the docs say         | `pnpm test:rules` — 239 tests, allow **and** deny per matrix row                   |
| The seed produces a real catalogue | `pnpm seed:emulator` — 78 documents from `stores/romp/*`                           |
| The seed is re-runnable            | Run it twice; `infra/tests/seed.test.ts` asserts counts and contents are identical |
| A second store works unchanged     | `pnpm seed --store _template` seeds one warehouse instead of two, no code change   |
| Nothing writes an invalid document | Every write goes through a converter that validates against its Zod schema         |

**Notes.**

- **Document schemas live in `@romp/contracts`, converters in the new `@romp/data`.** The split is
  forced by one constraint: contracts is in the browser bundle, so it cannot import the Firebase SDK.
  Schemas therefore describe instants as `Date`, and `@romp/data`'s converters own the
  `Timestamp ↔ Date` conversion. That turned out to be the right seam for a second reason — the client
  SDK and the Admin SDK have _different_ `Timestamp` classes, so the codec is duck-typed on
  `toDate()` rather than using `instanceof`, which would work in tests and fail in a browser whose
  bundler failed to dedupe the SDK.
- **Converters validate on read as well as on write**, which is the half usually skipped. Write
  validation catches a bug where it was written; read validation catches a document that is _already_
  wrong — written weeks ago, by a script, or before the invariant existed. Without it,
  `order.amounts.totalMinor` is simply believed. The cost is a Zod parse per document, which against a
  Firestore round trip is not measurable.
- **Every cross-field invariant a single document can violate is in its schema**, so it fails on read
  as well as on write: a subtotal that disagrees with its lines, a paid order with no verifying admin,
  an inventory total that disagrees with its per-warehouse map, a reservation whose allocation does not
  sum to its quantity. Invariants that span documents are not there and cannot be — they live in the
  transactions that write them.
- **Schemas strip unknown keys rather than rejecting them.** During a rolling deploy the new version
  writes a field the old version has never heard of, and the old version keeps reading those documents.
  Strict parsing would turn that overlap into a storefront outage.
- The rules file **cannot import TypeScript**, so `infra/tests/rules/coverage.test.ts` asserts against
  it as text: every collection in `COLLECTIONS` has a `match` block, the status literals appear
  verbatim, exactly two `allow update` statements exist, every `allow create`/`allow delete` is
  `if false`, and no rule calls `get()` on a `users` document to decide a role. Without those checks a
  rename leaves the rules file guarding a collection that no longer exists — which does not error, it
  just leaves the real one covered only by the catch-all.
- **Four collections are denied to staff as well as customers**: `events`, `identityIndex`,
  `paymentRefGuards`, `counters`. Each is a store-wide disclosure rather than a per-document one, and
  none serves a need the API cannot meet.
- The **seed refuses to run** when any inventory document has `reserved > 0`, and aborts the whole run
  rather than skipping those documents. Writing `reserved: 0` under a live order releases units without
  releasing the order holding them; a half-seeded catalogue where products exist but inventory does not
  is worse than no change.
- Rules tests run **one file at a time**. They share a single emulator database, and `clearFirestore()`
  in one file's `beforeEach` was deleting fixtures another file was midway through asserting on. This
  surfaced as a test that failed only alongside its neighbours — the shape of flake that gets a suite
  retried instead of fixed. `packages/config/vitest/base.mjs` gained a `fileParallelism` option for it.
- Several **documentation inconsistencies were found and corrected rather than coded around**, listed
  in the decision log below. The read matrix named product and review statuses that the contracts do
  not use, gated categories on a field the data model does not have, and the notification write surface
  was described one way in `SECURITY.md` and another in `NOTIFICATIONS.md`. The code follows the
  contracts; the docs now follow the code.

### `[x]` Task 7 — Repository layer and the SearchPort

- [x] `@romp/data` repositories, every method taking an explicit `StoreContext` — the multi-tenant seam
      ([ADR-0005](adr/0005-single-tenant-white-label.md))
- [x] Ownership filtering on every user-scoped read; **the Admin SDK bypasses rules**, so this is the
      only control
- [x] `SearchPort` interface with the Firestore adapter ([ADR-0002](adr/0002-firestore-search-port.md))
- [x] Typed errors for documented Firestore limits — `in` > 10 raises rather than silently truncating
- [x] Emulator integration tests

**Demo.**

| Claim                                    | How to see it                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| A foreign uid yields not-found           | `infra/tests/repositories.test.ts` — and the same message as "absent"       |
| The ownership filter is in the query     | `packages/data/src/repositories/repositories.test.ts`, via a query recorder |
| The port cannot be bypassed              | A `firebase-admin/firestore` import in an app fails lint with a reason      |
| Every query has an index                 | `infra/tests/indexes.test.ts` drives the adapter and checks the index file  |
| Eleven filter values raise, not truncate | `FILTER_LIMIT_EXCEEDED`, a 400 naming the field and the ceiling             |
| Search finds nothing for a typo          | Asserted, so ADR-0002's weak point is in the suite rather than in support   |

**Notes.**

- **Caller identity is a required parameter, and that is the whole design.** The Admin SDK bypasses
  `infra/firestore.rules` entirely, so ownership filtering in `@romp/data` is not defence in depth —
  it is the only control. Ambient identity is how that fails: read the caller from an async-local store
  or a request-scoped singleton and a repository method compiles and runs whether or not anyone
  remembered to set it, so a background job reads with whatever identity was left behind. As a
  parameter, "I forgot who is asking" is a compile error.
- `Caller` is a **discriminated union**, so an anonymous owner is unrepresentable rather than merely
  unlikely. `system` is its own kind rather than an operator with a synthetic uid, because an audit
  entry must never be ambiguous about whether a person was involved.
- `requireOwnership` **returns the resource** rather than answering a boolean. A `canRead()` helper is
  easy to call and forget to branch on; making the check the only way to obtain the document removes
  that failure mode.
- **Two tests of the same repository, deliberately.** A recorder-based unit test asserts _where the
  ownership filter lives_, which a real database cannot distinguish — `listOrdersForUser` returns the
  right documents whether the uid is a `where` clause or a `.filter()` after the read, and only the
  first is correct. The emulator suite asserts the queries are well-formed and return the right rows.
  Neither replaces the other.
- **The emulator does not prove index coverage**, and finding that out mattered. It creates whatever
  index a query needs, on demand; production rejects the query instead. So `infra/tests/indexes.test.ts`
  drives the real adapter through a recorder and matches the clauses it builds against
  `firestore.indexes.json`, including negative cases proving the matcher can fail — a coverage check
  that cannot fail is a green light on an empty index file.
- **Cursors are bound to their sort.** Without that, a sort dropdown that keeps the `cursor` parameter
  makes Firestore compare a price against `ratingAvg` and return a plausible page in no meaningful
  order with items missing. It is the failure nobody reports because nobody can see it.
- The lint rule ADR-0002 called "the real control" now exists rather than being aspirational: apps
  cannot import `firebase-admin`, `firebase-admin/firestore`, `firebase-admin/auth` or
  `@google-cloud/firestore`, and the message names what a direct read would bypass.
- Writing that rule surfaced an unrelated defect: the shared ESLint ignores contained `**/lib/**`,
  which silently excluded `apps/storefront/src/lib/` — real source — from linting entirely. An ignored
  file reports no errors, which is indistinguishable from a clean one, so it had gone unnoticed since
  Task 5. Narrowed to `lib/**`.

---

## Phase 3 — Public catalogue

### `[x]` Task 8 — Home and listing pages (SSR + ISR)

- [x] Home: hero, category rails, featured products, all config-driven
- [x] Listing by category and age band, with filters, sort and pagination
- [x] ISR with tag-based revalidation on catalogue writes
- [x] Skeletons and empty states; no layout shift
- [x] Image pipeline with correct `sizes` and priority hints

**Demo.**

| Claim                                 | How to see it                                                               |
| ------------------------------------- | --------------------------------------------------------------------------- |
| A config-driven home page             | `STORE_ID=romp pnpm --filter @romp/storefront dev` — hero, rails, age tiles |
| Listing with sort, filter, paging     | `/c/wooden`, `/age/6-8` — sort dropdown, in-stock toggle, cursor pages      |
| ISR without a build-time database     | `STORE_ID=romp next build` — home is `○ (Static)`, no DB reached            |
| No layout shift as images load        | Cards reserve a square box; the grid does not reflow                        |
| The catalogue swap is still contained | An app import of `firebase-admin/firestore` fails lint outside `src/server` |

**Notes.**

- **The server data layer is the storefront's read path, and it is `server-only`.** Everything a
  page reads comes through `src/server/catalogue.ts`, which imports `@romp/data` and the Admin SDK
  and is marked `import 'server-only'` — a compile-time wall against the SDK ever reaching a browser
  bundle. Pages never touch Firestore or the `SearchPort` directly; the app-wide `no-restricted-imports`
  rule forbids `firebase-admin` everywhere except `src/server`, which is the one door.
- **Every read passes the anonymous caller.** The storefront is a public surface, so its reads see
  only what an unauthenticated visitor may — active products, published reviews, the category tree.
  That is the security posture, not a convenience: the ownership filtering Task 7 built is the only
  control, because the Admin SDK bypasses rules, and passing `ANONYMOUS` is what makes these reads
  public rather than privileged.
- **ISR degrades cleanly with no database at build.** `next build` has no project in CI or locally,
  and a catalogue page reads Firestore — so a read short-circuits to empty when nothing is reachable,
  the page prerenders a shell, and ISR fills it on the first real request. The home page is therefore
  `○ (Static)` in the build output _despite_ reading a database: generation is deferred, not skipped.
- **The tag vocabulary lives in one pure module** so a read and a future write cannot disagree about a
  tag name — a mismatch there does not error, it serves a stale page forever.
- **The in-memory `SearchPort` is the reason the page tests need no emulator.** It enforces the same
  query guards, sort mapping, projection and cursor binding as Firestore, so a query that renders in a
  test is a query production accepts. Page tests supply it through a global override; the real adapter
  is otherwise untouched.
- **Async server components are tested by calling them.** RTL cannot mount an async component
  synchronously, so a test calls `ListingView(...)`, awaits the element, and renders that — which is
  also why `FeaturedRail` and `NavCategoryRails` were extracted from the page into `HomeRails.tsx`.
- Product media is a Storage object _path_ joined onto `NEXT_PUBLIC_MEDIA_BASE_URL` at render, never a
  stored URL. Unset, a card renders a placeholder rather than a broken image — the honest state of a
  store before its media host is configured, and of every product on a freshly seeded store.

### `[x]` Task 9 — Product detail page

- [x] Gallery, variant selection, derived stock state, add to cart
- [x] JSON-LD `Product` + `Offer`; canonical; per-page OG image
- [x] Exact stock counts never exposed — a derived boolean only

**Demo.**

| Claim                                    | How to see it                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| A config-driven detail page              | `STORE_ID=romp pnpm --filter @romp/storefront dev` → `/p/{slug}`              |
| Variant selection drives price and stock | Pick a variant; the price and the add-to-cart state change together           |
| Availability is a word, never a number   | An out-of-stock variant disables the button and says so; no count appears     |
| A valid rich result                      | The `<script type="application/ld+json">` parses as `Product` + `Offer`       |
| Per-product SEO control                  | `seo.index: false` sets `robots noindex`; each page has its own canonical     |
| The category swap is still contained     | The PDP reads only through `src/server/catalogue.ts`; no app-level SDK import |

**Notes.**

- **The buy box derives everything from one selected variant.** Price, discount strike, availability
  and whether add-to-cart is live all come from the same `selected` — which is what stops the classic
  bug of a price for one variant beside an "out of stock" for another. Only _active_ variants are
  offered; an inactive one still resolves (an old order reprints) but is not something a customer picks.
- **Availability is a boolean, end to end.** `VariantOption.inStock` is all that crosses the boundary,
  the buy box renders it as a word, and the JSON-LD derives `InStock` / `OutOfStock` from the same
  value — a count is never computed on the public surface, because exact stock is staff-only and, more
  honestly, changes between the render and the checkout.
- **Structured data is built from the rendered data, not alongside it.** `productJsonLd` takes the same
  `ProductDoc` and variants the page shows, so the rich result cannot advertise a price the page does
  not. It returns a typed object the page serialises with `JSON.stringify` — which escapes product copy,
  so a quote in a name cannot break the script — and the object is asserted directly in tests rather
  than by parsing a string.
- **Add to cart is a real, labelled, stateful control that does nothing yet.** Wiring is Task 15; the
  affordance ships now so the layout and the accessibility (disabled state, focus, the out-of-stock
  word) are settled before the behaviour lands. A button that appears in a later task is a button whose
  states were never designed.
- **`generateStaticParams` is deliberately absent.** Pre-rendering every product at build would couple
  the build to a populated database — which CI does not have, by Task 8's degradation design — and would
  not scale with the catalogue. On-demand ISR gives the same cached HTML; the first visitor to a product
  pays a single render, and `product:{slug}` busts it on edit.
- **All PDP copy is a new `content.product` config block.** Breadcrumb label, buy-box labels, section
  headings and the safety notices are configuration, so a second store's detail page reads in its own
  voice — verified by `_template` carrying genuinely different copy ("Add to cart" / "What's included"
  against ROMP's "Add to bag" / "In the box"). The safety block renders only the claims a product
  actually makes; a product with none shows no safety section rather than a row of reassuring absences.

---

## Phase 4 — Identity and notifications

### `[x]` Task 10 — Identity (email or mobile + password), seeded admins, API service

- [x] `normalizePhone()` / `toAuthEmail()` as pure functions in `@romp/core` using **libphonenumber-js,
      not a regex** ([ADR-0006](adr/0006-password-identity-without-otp.md))
- [x] Registration and login for email or mobile; one Auth user, one primary identifier
- [x] `identityIndex` written server-side only — readable, it is an enumeration oracle
- [x] Password policy: ≥ 10 characters with a zxcvbn floor, **no composition rules**
- [x] Uniform failure responses — no existence disclosure
- [x] Fastify API on Cloud Functions with the full middleware chain: correlation ID → rate limit → auth
      → Zod → idempotency → handler → error mapping
- [x] Seeded admin script setting `role` custom claims; forced rotation of initial passwords
- [x] Admin-assisted reset: single-use short-TTL link, audited, rate-limited
- [x] Session revocation checked on admin routes

**Demo.**

| Claim                                    | How to see it                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Five phone spellings reach one account   | `pnpm --filter @romp/infra test` — `api-identity` registers, then a differently-spelled number is `IDENTIFIER_TAKEN` |
| A duplicate leaves no orphan Auth user   | Same suite — the Auth user count is unchanged after a rejected duplicate                                             |
| The full middleware chain                | `apps/api` tests — `x-request-id` echoed, CORS allowlist, 401/403 guards, problem+json                               |
| A weak password is refused with guidance | `POST /v1/auth/register` with `password` → 422 `WEAK_PASSWORD` and suggestions                                       |
| `identityIndex` is closed to clients     | `pnpm test:rules` — the rules suite denies every client read                                                         |
| Admins exist only by seeding             | `pnpm seed:admins` mints the `infra/admins.config.ts` list with a `role` claim                                       |
| The spec matches the code                | `pnpm --filter @romp/api openapi:check` — generated from the same Zod schemas                                        |

**Notes.**

- **The API is built from injected dependencies, not module singletons.** `buildApp(deps)` takes the
  logger, the Auth client and a `StoreContext`, so a route test runs against an emulator-backed backend
  and a unit test against a fake — the app never reaches for a global. Production assembles the real
  clients in `bootstrap.ts`; the Cloud Functions entrypoint is a thin `onRequest` wrapper.
- **The identity alias is one implementation, imported by client and server.** `@romp/core`'s
  `normalizePhone` + `toAuthEmail` are pure and dependency-light, so the browser deriving a login alias
  and the server creating the Auth user cannot disagree about who a customer is — the failure that
  produces duplicate accounts or a cross-account login. Five spellings of a number are held to one
  alias by an exhaustive test.
- **Registration is compensated, not transactional, because it spans three systems.** Auth, the
  `identityIndex` and the `users` profile cannot share one transaction. The flow creates the Auth user
  first (it needs the uid), reserves the identifier, then writes the profile — and on any later failure
  deletes what it created, so a partial account is never left behind. Uniqueness is enforced twice: the
  `identityIndex` `create` and Auth's own uniqueness on the derived login email, both mapped to the same
  409 that never echoes the identifier.
- **The password policy is a strength estimator, not composition rules.** `assessPassword` runs zxcvbn
  with the identifier and brand as context, so `<brand>123` scores as the weak choice it is, and a long
  lowercase passphrase passes. The same function drives the registration UI's meter and the API's gate,
  so the meter cannot promise a password the server refuses.
- **Every failure is uniform.** A duplicate is `IDENTIFIER_TAKEN` with no identifier echoed;
  `check-identifier` returns only a boolean and is rate-limited hard; a bad token is treated as no token
  and the reason is logged by type, never surfaced. None of these is an enumeration oracle.
- **Session revocation is real but asserted by its cause.** A password change calls
  `revokeRefreshTokens`, and the API verifies tokens with `checkRevoked`. The revocation timestamp is
  second-granular, so the emulator test asserts the deterministic half — the old password no longer
  signs in, the new one does — rather than a same-second timestamp change.

### `[x]` Task 11 — Notification subsystem and navbar bells

- [x] Append-only `events` spine as the source of truth — `appendEvent` and an in-transaction variant
      for Task 16, both writing through the validating converter
- [x] `notificationDispatcher` with a declarative routing table in `@romp/core` — `planNotifications`
      is pure; the Cloud Function is thin glue over it
- [x] **Deterministic IDs from `(eventId, audience, recipient)`** so replay is idempotent — a redelivered
      trigger overwrites the same document rather than duplicating it
- [x] Customer and admin bells with live unread counts, grouped by day, via Firestore `onSnapshot`
- [x] Client may write `readAt` (customer) or its own key in `readBy` (admin) and nothing else — the
      entire client write surface, enforced by the rules from Task 6
- [x] WhatsApp send is an independent step, not coupled to notification creation — the dispatcher writes
      the in-app notification; the WhatsApp path is a roadmap seam that reads the same documents
- [x] Alert on dispatcher **backlog age**, not error rate — a stalled dispatcher throws nothing, so the
      alarm measures the age of the oldest event with no matching notification

**Demo.**

| Claim                                       | How to see it                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| One event fans out to the right recipients  | `pnpm --filter @romp/infra test` — an `order.created` event yields exactly two notifications         |
| Replay is idempotent                        | Same suite — writing the event twice still leaves two notifications, not four                        |
| The routing table is exhaustive             | `@romp/core` `dispatch` tests assert an entry for every `EventType`, only valid notification types   |
| Templates render with real values           | The emulator dispatcher test asserts the body carries the order reference and the deep link          |
| A template cannot reach for a missing token | `pnpm --filter @romp/store-config test` — every store's templates use only tokens its event supplies |
| The bell shows a live unread count          | `NotificationBell` renders a `9+`-capped badge and a day-grouped list; signed-out it is a link       |
| Backlog is measured by age, not errors      | `measureDispatchBacklog` reports the oldest undispatched event's age; the alarm fires over 5 min     |

**Notes.**

- **The dispatch decision is pure and lives in `@romp/core`; the Cloud Function is glue.**
  `planNotifications(event, content)` takes a stored event and the store's templates and returns the
  notification documents with their deterministic IDs — no Firestore, no clock beyond the event's own
  timestamp. The Firestore `onDocumentCreated` trigger decodes the snapshot, calls it, and writes the
  results. That seam is why the whole routing and interpolation surface is unit-tested without an
  emulator, and why the trigger has nothing left worth testing but the decode.
- **Deterministic IDs are the idempotency mechanism, not a retry counter.** A notification's ID is
  `${eventId}_${audience}_${recipient}`, so a redelivered trigger — which Firestore guarantees can
  happen — writes the same document again with `set`, and the customer sees one notification, not two.
  The alternative, an auto-ID per delivery, turns at-least-once delivery into duplicate inboxes.
- **The admin audience is one shared document with a `readBy` map, not a fan-out.** v1.0 seeds a small
  admin set, so `new_order` is a single document every admin reads, and each marks it read by writing
  their own uid into `readBy` — which the rules scope to the caller's own key, so one admin cannot mark
  a new order read for another. The `adminUids` parameter is carried as a seam for a future per-admin
  fan-out but is deliberately unused.
- **Backlog is measured by age, because a stalled dispatcher throws nothing.** An error-rate alarm
  cannot see a trigger that simply stopped firing. `measureDispatchBacklog` reads the recent events,
  skips the ones the routing table sends to nobody (a rejected review is not a backlog), and reports
  the age of the oldest event with no matching notification. The scheduled alarm escalates past five
  minutes. No dispatch cursor document is kept — the events and notifications already hold the state.
- **The client Firebase SDK is coverage-excluded because it aborts jsdom.** `firebase-client.ts` and the
  `useNotifications` hook import the client SDK, which crashes the jsdom worker on import even when
  mocked. So the pure part — day-grouping and badge formatting in `notifications-view.ts` — is tested
  directly, and the bell is tested with the hook mocked; the `onSnapshot` lifecycle is a standard
  effect-returns-unsubscribe idiom and is exercised end to end by the emulator dispatcher test.
- **The bell ships signed-out.** There is no client auth until Task 20, so `NotificationBell` renders a
  plain link to `/account` when it has no uid, and only opens a live subscription once given one. The
  affordance and its accessibility settle now; the wiring to a signed-in uid lands with client auth.
- **Template tokens are validated against the events that produce them.** A template is chosen by
  notification type, and the dispatcher interpolates only the tokens the source event supplies —
  so `{trackingNo}` on an `order_placed` template would render a blank the schema's `min(1)` cannot
  catch. `findTemplateTokenViolations` in `@romp/core` derives the allowed token set per notification
  type from the routing table, and the store-config suite holds every shipped store to it, turning that
  class of copy bug into a build failure.

---

## Phase 5 — Backoffice catalogue

### `[x]` Task 12 — Product CRUD, media pipeline, SEO tab

- [x] Create, edit, publish, unpublish, archive; a draft is invisible to the public and the
      status machine enforces the legal transitions (archived returns via draft, never
      straight to active)
- [x] Upload with **magic-byte type re-derivation on finalize** — the declared type is a
      claim; the finalize Function sniffs the bytes and quarantines a mismatch or a non-image
- [x] Resize Images extension configured; responsive variants; `next/image` integration via
      the storefront's existing image config
- [x] SEO tab: title/description overrides and the index directive; the slug is set on create
      (the OG image is the product's cover media, wired in Task 9's PDP metadata)
- [x] Revalidation triggered on publish and edit, through an injected seam the API calls so
      it need not import `next`

**Demo.**

| Claim                                        | How to see it                                                                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A product moves through its lifecycle        | `pnpm --filter @romp/infra test` — `api-products` creates a draft, is refused publish with no active variant, adds one, then publishes |
| The from-price tracks the variants           | `catalogue-write` (emulator) — adding a cheaper active variant moves `priceFromMinor` in one transaction                               |
| A lying upload is quarantined                | `@romp/core` `media-finalize` + `apps/api` `finalize` tests — a PNG declared as JPEG, or an SVG, is dropped and deleted                |
| The backoffice renders every status          | `apps/admin` — the product list shows draft, active and archived; the storefront shows only active                                     |
| The SEO tab controls the page's metadata     | An edit writes `products.seo`; the PDP's `generateMetadata` (Task 9) reads it for title/robots                                         |
| A second store's backoffice is its own brand | `STORE_ID=_template pnpm --filter @romp/admin build` — the admin builds with the template's brand and theme, no code change            |

**Notes.**

- **The write path is split the way the notification dispatcher was: pure decisions in
  `@romp/core`, Firestore plumbing in `@romp/data`.** `summariseVariants`, the status-transition
  rule, media-order normalisation and the magic-byte sniff are pure and unit-tested; the
  repository is the transaction around them. The one subtlety a real database forced:
  Firestore requires all transaction reads before any writes, so a variant write reads the
  product and every variant first, merges the pending change in memory, then writes both the
  variant and the refreshed summary. A `tx.get` after a `tx.set` throws.
- **The denormalised summary can never be recomputed lazily, so it is recomputed on every
  variant write.** The product's `variantSummary` and `priceFromMinor` are what a listing card
  reads; a summary that drifts is a card showing a price the customer is not charged. Each
  variant create or edit rewrites them in the same transaction, so the card and the variant
  cannot disagree.
- **The declared content type is treated as a claim, and the bytes are the fact.** The storage
  rules gate the upload on the declared type cheaply, but the authoritative check is the
  object-finalize Function: it reads the file's magic bytes, and if they are not one of the four
  allowed formats — or not the type the upload claimed — it drops the media entry and deletes
  the object. That is what stops an SVG-with-a-script masquerading as a PNG from reaching the
  admin origin. The sniff is pure and lives in `@romp/core`; the Function is thin glue with the
  Storage operations injected, so the accept/quarantine branching is unit-tested without a
  Functions runtime.
- **Media upload is a two-step dance that keeps the API off the bytes.** The API allocates an
  object path and records a pending 1×1 media entry; the browser uploads straight to that path
  with the client Storage SDK, gated by the rules; the finalize Function then confirms it with
  real dimensions or quarantines it. So a freshly uploaded image reads as "processing" until
  finalize runs, which is honest — the page never claims a size it has not measured.
- **Revalidation is an injected seam, because the API cannot import `next`.** A publish or edit
  computes the cache tags (`tagsForProduct`, now in `@romp/core` so the read side and the write
  side share one vocabulary) and hands them to `deps.revalidate`, which the deployment wires to
  the storefront. It is best-effort: a failed revalidation is logged, never fatal, and the
  storefront's hourly ISR floor is the backstop.
- **The backoffice is a new `apps/admin` App Hosting backend, and it is white-label like
  everything else.** It mirrors the storefront's scaffolding — the `storeArtefacts` marker, the
  token step, the eslint brand rule, the server-only Admin SDK layer — and reads as a **staff**
  caller, so it sees drafts and archived products the storefront cannot. Every label is config
  or a plain affordance; a second store's backoffice builds in its own brand and theme.
- **The admin reads server-side but writes through the API with an operator token.** Reads use
  the Admin SDK behind `server-only`; writes go through the API, which verifies the operator's
  role claim — the one place a mutation happens and where the audit will live. The client-auth
  that mints that token is Task 20, so the write controls render a signed-out affordance until
  then, the same deferral the notification bell uses.

### `[x]` Task 13 — Variants and inventory across seeded warehouses

- [x] Variant CRUD with per-variant pricing — built in Task 12's write path; this task adds the
      inventory the variants hold
- [x] Per-warehouse stock, iterating the seeded warehouse list dynamically — the admin editor
      renders a row per `listWarehouses` result, so a store with three warehouses gets three with
      no code change
- [x] `inventoryLedger` append-only; **adjustments are entries, never edits** — an adjustment
      writes the new balance and appends a ledger entry in **one transaction**, and a
      reconciliation is a compensating entry, not an overwrite
- [x] Reconciliation script referenced by [`RUNBOOKS.md`](RUNBOOKS.md) runbook 4 —
      `pnpm --filter @romp/data reconcile:variant` reports the per-warehouse ledger-vs-balance diff,
      read-only by default, correcting the balance with a `reconciliation` adjustment under `--fix`

**Demo.**

| Claim                                                   | How to see it                                                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An adjustment moves the balance and the ledger together | `pnpm --filter @romp/infra test` — `api-products` posts an adjustment, the on-hand balance and a ledger entry both appear in one transaction             |
| An adjustment that would oversell is refused            | Same suite — a negative delta larger than the on-hand count returns `409 INVALID_STATE_TRANSITION` and writes nothing                                    |
| Stock spans warehouses dynamically                      | `KDU-STK-NAT` seeds `blr` and `del`; adjusting `del` leaves `blr` untouched and the on-hand total is their sum                                           |
| The reconciliation runbook is runnable                  | `firebase emulators:exec --only firestore "pnpm seed && pnpm --filter @romp/data reconcile:variant --variant KDU-STK-NAT"` prints the per-warehouse diff |
| A reconciliation is an entry, not an edit               | `reconcile:variant … --fix --warehouse blr --count <n>` appends a `reconciliation` ledger row; the re-run shows the ledger sum now equals the balance    |
| The admin edits stock per warehouse                     | `apps/admin` `InventoryEditor` — the product edit page lists each warehouse's count with a signed-delta form; a manual adjustment requires a note        |

**Notes.**

- **The write path is split pure/transactional, the same shape as Task 12.** `applyStockDelta` in
  `@romp/core` is the pure arithmetic — it applies a signed delta to one warehouse, refuses a
  negative warehouse count or an oversell (on-hand below what is reserved), and drops a warehouse
  key that reaches zero rather than storing a zero. `adjustInventory` in `@romp/data` is the
  transaction around it: read the balance (an absent record is an empty balance, so a first
  adjustment creates it), apply the delta, and — only on success — write the new balance and
  append the ledger entry atomically. A refusal throws, having written nothing.
- **Adjustments are entries, never edits — enforced by the shape of the API, not a convention.**
  The only reasons an operator can select are `adjustment` and `reconciliation`; the system
  reasons (`order_committed`, `refund_restock`, …) are written by the flows that own them and are
  rejected at the wire. A correction to a wrong count is a `reconciliation` entry whose delta
  closes the gap, so what was believed and when survives — which is the only reason runbook 4's
  reconciliation can trust the ledger over the balance.
- **A refused adjustment is a `409`, not a `422`.** The request is well-formed; it conflicts with
  the resource's current state. So an oversell or a below-zero adjustment maps to
  `InvalidStateTransitionError` — the same 409 an illegal product-status transition returns —
  rather than a validation error. The dedicated `InsufficientStockError` is cart-shaped
  (`{sku, requested, available}`) and was the wrong fit for a warehouse adjustment.
- **The low-stock threshold comes from store config, read where it is needed.** A brand-new
  inventory record is seeded with `commerce.lowStockThreshold`, imported from the generated store
  config in the products route — the same number the storefront and the notification dispatcher
  read, rather than a new field threaded through the API bootstrap.
- **The reconciliation script is thin glue over the repositories, and safe on production by
  default.** Without `--fix` it only reads (`reconcileVariantStock`), so it can run against a live
  store while diagnosing. `--fix` computes the delta from the current stored count to the
  physically verified number and writes it as a `reconciliation` adjustment — an appended entry,
  not an overwrite — which the runbook now documents step by step.
- **`stockThresholdCrossing` is built but not yet wired to an event.** The pure helper that decides
  whether an adjustment crossed into `low_stock` or `out_of_stock` exists in `@romp/core`, but
  `adjustInventory` does not yet emit `inventory.low_stock` / `inventory.out_of_stock` events. The
  event spine and the dispatcher are in place (Task 11); emitting these belongs with the commerce
  flows that also move stock (reservation, commit, restock — Tasks 16–18), so the crossing logic
  lands now and the emission lands with the rest of the stock-moving paths, in one place, rather
  than only on manual adjustments.

### `[x]` Task 14 — Category management

- [x] Tree CRUD, ordering, activation — create, edit, reorder and a new `active` flag through the
      admin, all written through the API; the tree is one level deep and the server refuses a
      grandchild or a self-parent
- [x] `productCount` maintained by a Function — Firestore cannot facet-count — an
      `onDocumentWritten(products/{id})` trigger rolls the count up the ancestor chain via
      `FieldValue.increment`, with a `reconcile:categories` script as the drift-correction path
- [x] Slug uniqueness enforced server-side — the slug is the document ID, so a create-only write
      fails atomically on a duplicate (the same reservation trick as the identity index)

**Demo.**

| Claim                                                | How to see it                                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A category is created, edited, reordered and deleted | `pnpm --filter @romp/infra test` — `api-categories` runs the whole lifecycle through the operator API                                        |
| A duplicate slug is refused                          | Same suite — a second create on the same slug returns `409 IDENTIFIER_TAKEN` and writes nothing                                              |
| The tree stays one level deep                        | A create or edit naming a sub-category as a parent returns `409 INVALID_STATE_TRANSITION`; `@romp/core` `category-write` unit-tests the rule |
| A category in use cannot be deleted                  | `category-write` (emulator) — delete is refused while `productCount > 0` or a child exists, so a category never strands products             |
| `productCount` tracks active products up the tree    | `category-write` (emulator) — `applyProductCountDeltas` increments the leaf **and** its ancestor; archiving reverses both                    |
| The facet count can be reconciled                    | `pnpm --filter @romp/data reconcile:categories --project <id>` reports stored-vs-actual per category; `--fix` corrects drift                 |
| A second store's tree is its own                     | `STORE_ID=_template pnpm --filter @romp/admin build` — the admin builds with the template's categories, no code change                       |
| Staff manage the tree in the backoffice              | `apps/admin` `CategoryManager` — the `/categories` page lists the tree with per-row activate/delete/reorder and a create form                |

**Notes.**

- **`active` is a new field, distinct from the visibility flags.** `showInNav` and `showInFilters`
  decide _where_ a live category appears; `active` decides _whether_ it appears at all. A
  deactivated category drops out of every storefront surface and is not offered when categorising
  a product, without being deleted — which matters because deletion is refused while products
  still reference it. The flag defaults to `true` in the seed, so existing store configs did not
  have to change, and both shipped stores set it explicitly.
- **The pure/transactional split holds, the same as products and inventory.** The tree-legality
  rule (`validateCategoryParent`) and the count arithmetic (`planProductCountChanges`) are pure in
  `@romp/core` and unit-tested there; `@romp/data`'s `category-write` reads the current tree to
  feed them and is the Firestore plumbing. So "one level deep", "no self-parent", "roll the count
  to ancestors" are tested without an emulator, where a wrong tree is a category nobody can reach.
- **Slug uniqueness is the write itself, not a check-then-write.** The category document ID _is_
  the slug, so `create` fails atomically with `ALREADY_EXISTS` on a duplicate — the same
  reservation semantics the identity index uses, with no read-then-write race. The slug is fixed
  at create for the same reason products' are: it is the URL identity and the products'
  denormalised `categorySlug`, so a rename changes the name, never the link.
- **`productCount` has exactly one writer, and a reconciliation path because it is a counter.**
  Firestore cannot count query matches, so the sidebar's facet numbers are denormalised. The
  `categoryProductCounter` trigger is the single writer: on any product write it reduces the
  before/after to "which category, is it active" and applies `FieldValue.increment` up the tree —
  an increment, not a read-modify-write, so concurrent product writes cannot lose each other's
  count. `increment` is not idempotent under a retry, which is stated rather than hidden: that is
  exactly why `reconcileCategoryCount` and its script exist, recomputing the truth from the
  products and correcting drift, mirroring Task 13's inventory reconciliation.
- **Category collection reads are raw, deliberately not through the validating converter.** The
  tree read and the reconciliation only need `slug`, `parentId`, `categorySlug` and `status` — all
  plain strings — so they read raw. Decoding every document through the full schema would make one
  malformed or partially-migrated category (or product) break every create, edit and reconcile,
  a blast radius far larger than four fields warrant. It is also what lets the writes coexist with
  the rules-test fixtures in the shared emulator.
- **Inactive categories are filtered in memory, not in the query.** The storefront's nav and filter
  reads exclude inactive categories with a `.filter(c => c.active)` after the existing indexed
  query, rather than a `showInNav + active + sortOrder` composite index for a collection that holds
  a handful of documents — the same bounded-in-memory reasoning as the low-stock report.

---

## Phase 6 — Commerce

### `[x]` Task 15 — Cart

- [x] Cart written **through the API**, not by the client — a client-written cart lets the browser
      choose the price — every mutation goes through `POST/PATCH/DELETE /v1/cart*`, and the request
      never carries a price; the security rules still deny every client cart write
- [x] Availability and price refresh on read; quantity ceilings — every add/set resolves the live
      variant, refreshes the price snapshot, and caps the quantity at the lower of available stock
      and the configured `maxQtyPerLine`; a cart read re-checks `inStock` per line
- [x] Guest cart merged into the account on login — a guest cart lives under a signed cookie ID and
      `POST /v1/cart/merge` folds it into the account's, summing quantities capped at available, then
      deletes it and clears the cookie

**Demo.**

| Claim                                                    | How to see it                                                                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The browser cannot choose the price                      | `AddCartItemRequest` carries no price; `apps/api/src/routes/cart.test.ts` asserts a price key is stripped, and the rules test denies a client cart write |
| A guest cart survives across requests by a signed cookie | `pnpm --filter @romp/infra test` — `api-cart` adds a line, gets a signed `__cart_id` cookie, and the next request with it finds the same cart            |
| A quantity beyond stock is refused                       | Same suite — adding 5 of a variant with 2 available returns `409 INVALID_STATE_TRANSITION`; the price is refreshed on every add                          |
| The guest cart merges on sign-in                         | `api-cart` — a guest's 2 and the account's 1 become 3, the guest cart document is deleted, and the cookie is cleared                                     |
| The per-line ceiling is config, not hardcoded            | `commerce.maxQtyPerLine` (romp 20, `_template` 10); the pure `applyCartMutation` enforces it and `@romp/core` unit-tests it                              |
| Add to cart works from the product page                  | `apps/storefront` — the buy box's button POSTs one of the selected variant and routes to `/cart`; the header badge shows the count                       |
| The cart renders per-visitor, never cached               | `apps/storefront/src/app/cart/page.tsx` is `force-dynamic`; `CartClient` fetches through the API so the guest cookie or the uid resolves the right cart  |

**Notes.**

- **The cart is API-written for exactly one reason, and the contract makes it structural.** A line
  carries price/name/image snapshots for display continuity, but the `AddCartItemRequest` has no
  price field at all — the server resolves the variant, refreshes the snapshot, and decides the
  quantity. A client that could write `priceMinorSnapshot` and a checkout that trusted it would let
  the browser choose the price; here it cannot, and the security rules deny every client cart write
  so the API (Admin SDK) is the only writer. Every total the cart shows is display-only; the charged
  amount is the checkout quote's (Task 16).
- **Two ceilings, and the lower wins.** A line is capped at both available stock and a configured
  `maxQtyPerLine`. Stock alone is not enough — when a warehouse holds hundreds, a typo or a script
  could still park an absurd quantity that then reserves real stock at checkout — so the per-line
  ceiling exists independent of stock. The pure `applyCartMutation` in `@romp/core` checks the
  ceiling before stock and refuses with a typed reason the route maps to a 409.
- **The guest cart is a signed cookie, which is what lets it be server-only.** An anonymous cart is
  keyed by an opaque ID the browser holds in an `HttpOnly` cookie carrying an HMAC of the ID under a
  server secret. The ID alone would be a forgeable pointer; the signature, verified in constant
  time, means a client cannot reach a cart that is not theirs. Firebase anonymous auth is disabled,
  so no client can ever be the cart's owner — the API is the only party that can mint or validate the
  pointer, which is precisely why the rules can deny all client cart access and the cart still works
  for a guest. The signing secret is a per-environment deployment secret with a dev fallback.
- **Merge sums and caps, never trusts.** On sign-in the guest cart is folded into the account's:
  shared variants sum, everything is capped at the lower of live stock and the ceiling, and a line no
  checkout could fulfil is dropped. The user cart's snapshots win where both have a line; the guest
  quantity is what is added. Then the guest cart is deleted and its cookie cleared, so a second sign-in
  does not re-merge a cart that is already gone.
- **The write repo is the first customer-owned one, deliberately not staff-gated.** Unlike the
  catalogue/category/inventory writes, a cart belongs to whoever holds it — a signed-in customer by
  uid or a guest by cookie ID — so the repo takes a `CartRef` the route resolves, rather than a staff
  caller. It follows the now-familiar shape otherwise: pure decision in `@romp/core`, transactional
  read-modify-write in `@romp/data`, availability read straight from the inventory document because
  the server legitimately needs the count the customer-facing API hides.

### `[x]` Task 16 — Order placement, stock reservation, dynamic UPI QR

- [x] Server-recomputed totals; GST in basis points — placement and the quote both call the same pure
      `computeOrderTotals` over the **live** variant prices, so a tampered client value has nowhere to
      enter and the quote a customer saw cannot drift from the order they placed
- [x] Reservation in **one transaction** so concurrent checkouts serialise — every line's inventory
      document and the order-number counter are read and written in one Firestore transaction; the
      one-document-per-variant oversell invariant makes N parallel checkouts for a single remaining
      unit resolve to exactly one success (on-hand decrement is the payment commit, Task 17)
- [x] Sequential human-facing order number from `counters`, distinct from the random document ID —
      read-modify-write on `counters/orderHumanId` inside the same transaction (not `FieldValue.increment`,
      because the value has to be read to build the `humanId` string), so the sequence has no gaps
- [x] Per-order UPI QR encoding the **exact amount and order reference** — `buildUpiUri` mints the
      intent string with the exact total and the order number; the confirmation page renders it as a
      QR, which is what makes Task 17's manual verification a two-field match rather than a judgement call
- [x] Idempotency key honoured on placement — `POST /v1/orders` requires an `Idempotency-Key` and
      replays the original response for a repeated key, so a retry cannot double-reserve

**Demo.**

| Claim                                                        | How to see it                                                                                                                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Totals are recomputed server-side from live prices           | `apps/api/src/routes/checkout.ts` and `order-write.ts` both call `@romp/core`'s `computeOrderTotals`; the request carries no money. `packages/core` unit-tests the arithmetic |
| N parallel checkouts for one unit yield exactly one order    | `pnpm --filter @romp/infra test` — `order-write` fires 5 parallel placements for 1 unit; exactly 1 fulfils, 4 raise `INSUFFICIENT_STOCK`, and `reserved` ends at 1            |
| The whole placement commits together                         | Same suite — `api-orders` places an order and asserts the order, reservation, counter increment and cleared cart all landed                                                   |
| A retry does not double-reserve                              | `api-orders` — placing twice with the same `Idempotency-Key` returns the same `orderId` and leaves `reserved` at 1                                                            |
| The UPI QR carries the exact amount and order number         | `api-orders` asserts the returned `qrPayload` contains `cu=INR` and `tn={humanId}`; the storefront renders it with `qrcode.react` in `OrderConfirmation`                      |
| The human order number is sequential and not the document ID | `formatOrderNumber` mints `RMP-1001` from the counter; the document ID is random, so a guessed number cannot address an order                                                 |
| The GST rate is config, not hardcoded                        | `locale.gstRateBasisPoints` (romp 1800 = 18%) seeds `settings/checkout`; the order prefix is `brand.orderPrefix` (romp `RMP`, `_template` `EXA`)                              |
| Checkout is reachable from the cart                          | `apps/storefront` — the cart page links to `/checkout`, which quotes the bag, places the order, and routes to `/orders/{id}`                                                  |

**Notes.**

- **Totals are server-authoritative, and the quote and the order share one function.** The pure
  `computeOrderTotals` in `@romp/core` is called by the checkout-quote route and, again, inside the
  placement transaction — both over the live variant prices, never the cart's display snapshots. So
  the number a customer is quoted and the number the order records are computed the same way from the
  same source; a client value has nowhere to enter. GST is applied to the **full taxable value**
  (subtotal + gift wrap + shipping), the unambiguous invoice-value reading, since the spec does not
  single out a narrower base.
- **The transaction is the oversell control, not a check.** Placement reads every line's inventory
  document and the counter, decides reservation and allocation purely, then writes the order, its
  reservation, its audit event, the spine `order.created` event, the bumped `reserved`, the
  incremented counter and the emptied cart — all in one Firestore transaction. Concurrent checkouts
  serialise on the one-document-per-variant inventory record, so the emulator concurrency test's five
  parallel placements for a single unit resolve to exactly one success. A refusal — empty cart, a
  vanished variant, insufficient stock — throws having written nothing.
- **Reservation bumps `reserved`; it does not move on-hand.** A reservation raises `inventory.reserved`
  and leaves `onHandTotal` alone — the on-hand decrement is the payment commit (Task 17), because
  stock is not gone until the money is confirmed. The oversell invariant still holds during the hold:
  `available = onHandTotal − reserved`, checked in the transaction, is what blocks the second concurrent
  checkout. This resolves the reservation half of Task 7's carried-forward write-paths row; commit,
  release and restock remain Tasks 17–18.
- **Idempotency is in place; its production store is not, deliberately.** `POST /v1/orders` requires
  an `Idempotency-Key` and replays the original response for a repeated key through the
  `IdempotencyStore` interface. The default implementation is in-memory, which is correct for a single
  instance and for tests but misses across Cloud Functions instances; the Firestore-backed store the
  interface already supports is the production implementation, carried forward. The mechanism —
  reserve the key, run once, cache the response — is the same either way, so wiring the persisted store
  is additive.
- **The confirmation page renders the QR from the payload, which is the source of truth.** The server
  mints the UPI intent string with the exact total and the order number; the page draws a QR from
  _that string_, so the render is a view of the payload, not a second computation that could disagree.
  `qrcode.react` (`QRCodeSVG`) is a new storefront dependency — no QR library existed — pinned exactly
  and SVG-based so it renders without a canvas.
- **The checkout UI degrades to the states its upstream pieces leave it in.** Client auth (Task 20)
  and address creation do not exist yet, so the page reads the customer's saved addresses through the
  client SDK (a client-READ the rules already allow) and attaches the Firebase ID token to the API
  call; a signed-out visitor is asked to sign in and a customer with no saved address is asked to add
  one. These are the real not-yet-wired states, shown honestly, not error screens.

### `[x]` Task 17 — Payment proof submission and the reservation sweeper

- [x] UTR + proof submission — `POST /v1/orders/:id/payment-proof` records the reference and an
      optional already-uploaded proof path, moving the order into `pending_verification`. The proof
      image is uploaded by the client to its own `payment-proofs/{orderId}/{uid}/…` prefix (which the
      storage rules gate to the owner), and the API validates the submitted path against that prefix.
      _(nosniff/attachment serving of the stored proof is a carried-forward refinement — see below)_
- [x] `paymentRefGuards/{normalisedUtr}` created in the **same transaction** — the document ID is the
      normalised UTR, so the second order to quote it fails on `create` against an existing document,
      not on a query that could race. This is the whole of `DUPLICATE_PAYMENT_REFERENCE`.
- [x] Scheduled sweeper releasing expired reservations, idempotent — `reservationSweeper` runs every
      five minutes, lists the active-and-overdue reservations (index-backed) and releases each in its
      own transaction, returning `reserved` to available and expiring the order. Re-running is a
      no-op, so the scheduler's at-least-once delivery is safe.
- [x] Backlog-age alert on **non-execution** — the sweep measures the age of the oldest reservation
      still overdue after its pass and logs at `error` past the threshold; a sweeper that stops
      running stops emitting its healthy heartbeat, which a log-absence policy catches. Age, not error
      rate, because a stalled sweeper throws nothing.
- [x] Concurrency tests: two submissions of one UTR resolve to exactly one claim (and one
      `DUPLICATE_PAYMENT_REFERENCE`) with exactly one guard document; two checkouts against one unit
      of stock resolve to one order (Task 16's test, still green).

**Configuration (unchanged this task).** `commerce.reservationTtlMinutes` (romp `30`) sets how long a
reservation holds stock; the sweep runs `every 5 minutes` and alerts when a reservation is still
overdue-and-active more than ten minutes (two cycles) past expiry.

**Demo.**

| Claim                                                      | How to see it                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One UTR cannot be claimed twice                            | `pnpm --filter @romp/infra test` — `payment-write` fires two submissions of the same reference; exactly one succeeds, one raises `DUPLICATE_PAYMENT_REFERENCE`, and one `paymentRefGuards/{utr}` document exists |
| A submission moves the order into the verification queue   | `api-orders` — submitting a reference returns `pending_verification` and the order reads back with the normalised `upiRef`                                                                                       |
| The reference is normalised before it is stored or claimed | `UtrSchema` strips whitespace and uppercases; `payment-write` uses the normalised value as both the stored `upiRef` and the guard document ID                                                                    |
| The sweeper releases an expired hold and expires its order | `reservation-sweeper` — a past-expiry reservation is released: order `expired`, `reserved` returned to available, on-hand unchanged, an `order.expired` event appended                                           |
| The sweep is idempotent                                    | Same suite — a second pass over an already-released reservation is a no-op                                                                                                                                       |
| The sweeper only touches pre-payment holds                 | `reservation-write` unit test — an overdue reservation whose order moved to `pending_verification` is skipped, not expired                                                                                       |
| The customer can pay and submit from the order page        | `apps/storefront` — the confirmation page shows the UPI QR and a reference form while awaiting payment, an under-review message once submitted, and a rejection reason with a resubmit form when rejected        |

**Notes.**

- **The guard is the mechanism, not a check.** Global UTR uniqueness is a `create` against
  `paymentRefGuards/{normalisedUtr}` inside the submission transaction, so a duplicate fails on the
  document already existing rather than on a "is this reference taken?" query that two concurrent
  submissions could both pass. Normalisation is load-bearing: `1234 5678` and `12345678` are the same
  claim, so both the stored reference and the guard ID are the whitespace-stripped, uppercased form.
  The `isAlreadyExists` recogniser this relies on was triplicated (identity, category, payment) and is
  now one tested helper in `@romp/data`.
- **A release moves the hold, not on-hand, so it writes no inventory-ledger entry.** A reservation
  raised `inventory.reserved` and never touched on-hand (Task 16); releasing it lowers `reserved`
  back, returning units to _available_ without on-hand moving. The inventory ledger records on-hand
  movement and reconciles to `inventory.stock` (DATA_MODEL.md), so a ledger delta on a pure release
  would break that reconciliation — the on-hand decrement is the payment commit's `order_committed`
  entry (Task 18). The release is audited on the append-only event spine (`order.expired`) and the
  reservation's own `released`/`resolvedAt`, which is where a pre-payment expiry belongs. This resolves
  the release half of Task 7's carried-forward write-paths row; commit and restock remain Task 18.
- **The sweeper respects an order that moved under it.** Between listing an overdue reservation and
  releasing it, the customer may submit proof — moving the order to `pending_verification`, which is
  not a legal transition to `expired`. The release reads the order inside its transaction and skips
  (as a no-op) any order no longer in a pre-payment state, so a race between the sweeper and a
  last-second payment never expires an order a customer just paid for.
- **The non-execution alert is folded into the sweep, deliberately.** The dispatcher needs a separate
  scheduled watcher because it is trigger-driven; the sweeper _is_ the scheduled job, so it measures
  its own residual backlog each run and logs a heartbeat. A growing backlog means the pass could not
  keep up; a missing heartbeat means it stopped running. Both are age-of-oldest signals a policy
  watches, which is the only kind that catches a component that fails by going silent.
- **The submission is guarded like placement.** It requires a signed-in owner, a rate limit
  (`paymentProof`), and a required idempotency key, because a retry would otherwise double-claim a
  reference. A resubmission after a rejection clears the prior rejection fields so the record reads as
  a fresh claim awaiting verification, and the order-status machine allows `payment_rejected →
pending_verification` precisely so a mistyped UTR does not force a new order that would re-reserve
  stock the customer already holds.

### `[x]` Task 18 — Admin payment verification and refunds

- [x] Verification queue, oldest-first — `GET /v1/admin/orders` returns the `pending_verification`
      orders by `createdAt` ascending, so the order whose reservation is closest to expiring is seen
      first (`listVerificationQueue`, already index-backed).
- [x] Exact-amount comparison; a short payment never "close enough" — `verify-payment` carries the
      amount the admin read from the bank, compared to `order.amounts.totalMinor` to the paise. A
      mismatch is a `PAYMENT_AMOUNT_MISMATCH` carrying both figures; only an exact match reaches
      `paid` and commits stock. There is no `partially_paid` state to fall into by approximation.
- [x] Immutable `events` audit with the actor uid — every verify, reject and refund writes a per-order
      event **and** a spine event in the same transaction as the state change, each carrying the
      acting admin's uid (`order.payment_verified` / `order.payment_rejected` / `refund.issued`).
- [x] Refunds require the `owner` claim — `issueRefund` calls `requireOwnerRole`, so a staff operator
      is refused (as a 404, not a 403, so the action is not disclosed); verifying and rejecting are
      staff actions. The refund destination is the customer's contact on the order; the operator
      records the outward UPI reference of the transfer they make.
- [x] Adjustments recorded as entries so records reconcile with the bank — refunds are append-only
      (a wrong amount is corrected by a second, adjusting refund, never an edit), and the commit and
      restock write signed `inventoryLedger` entries (`order_committed` on verify, `refund_restock`
      on a restocking refund), so both the money trail and the stock ledger reconcile against the
      statement.

**Configuration (unchanged this task).** A new rate-limit key `adminOrderWrite` (60/minute) bounds the
money actions — tighter than the catalogue-write ceiling, because each one settles or moves money.

**Demo.**

| Claim                                                         | How to see it                                                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An exact-amount verify commits stock and marks the order paid | `pnpm --filter @romp/infra test` — `api-admin-orders`: verify with the exact total returns `paid`, on-hand falls 10→8, reserved 2→0, the reservation is `committed`      |
| A short payment is refused, never accepted                    | Same suite — verify with a lower amount returns `409 PAYMENT_AMOUNT_MISMATCH`; the order stays `pending_verification` and no stock moves                                 |
| Commit writes an `order_committed` ledger entry               | `verification-write` — a negative-delta `order_committed` entry per (variant, warehouse), so the ledger reconciles to `inventory.stock`                                  |
| A reject records the reason and keeps stock reserved          | `api-admin-orders` — reject returns `payment_rejected` with the reason; the reservation stays `active` so the customer can resubmit                                      |
| Refunds are owner-only                                        | `api-admin-orders` — an owner token issues a refund (200); a staff token is refused (404). `issueRefund` calls `requireOwnerRole` before any read                        |
| A refund raises the running total and restocks                | `refund-write` — a full refund moves the order to `refunded`, `refundedMinor` reaches the total, and a restocking refund writes a positive `refund_restock` ledger entry |
| Every settlement is attributable                              | `verification-write` / `refund-write` — the acting admin's uid is on the order event and the spine event; `events.test` enforces the audit-actor field on the schema     |

**Notes.**

- **Exact means exact, and it is the whole anti-fraud posture.** A manual UPI payment has no gateway
  to confirm the amount, so the admin reads the settled figure from the bank and the server compares
  it to `order.amounts.totalMinor` in integer paise (`Money` is integer paise precisely so this is
  exact, not floating). A mismatch — short or over — is a typed `PAYMENT_AMOUNT_MISMATCH` carrying
  both figures, so the admin acts on the real difference. **There is no `partially_paid` order state**
  and none was added: the status machine has no such node, and "route to a partial path, never close
  enough" (`SECURITY.md`) is enforced as "only an exact amount reaches `paid`". A short payment is
  handled by rejecting it (the customer tops up and resubmits); an overpayment, by verifying once the
  amounts match and refunding any excess as a separate `overpayment` refund.
- **Verify is the commit — where reserved stock finally leaves the shelf.** Placement raised
  `reserved`; the sweeper's release lowered it back; verify does the third thing — it lowers on-hand
  _and_ `reserved` together for the same units, writes the `order_committed` ledger entry that moves
  on-hand (the ledger reconciles to `inventory.stock`, DATA_MODEL.md), and resolves the reservation
  `active → committed`. The `applyStockDelta` oversell guard bounds on-hand against `reserved`, so the
  commit passes the _post-commit_ reserved as the bound — otherwise it would see the reservation still
  holding units it is in the middle of releasing and refuse a legitimate commit. This resolves the
  commit and restock halves of Task 7's carried-forward write-paths row; only the fulfilment-side
  transitions (pack/ship/deliver) remain, and those are Task 19.
- **Verify is idempotent through the state machine, not an idempotency key.** A double-click on
  verify finds the order already `paid`, and `pending_verification → paid` is the only legal edge, so
  the second call is refused by `assertTransition` rather than committing stock twice. That makes an
  idempotency key unnecessary here — the transition guard is the idempotency mechanism.
- **Refunds are owner-only and refused as a 404.** Moving money outward is the one action gated on the
  `owner` claim rather than `staff` (`SECURITY.md`): a careless staff account marking orders paid is
  bounded by per-order value, but one issuing refunds is not. `requireOwnerRole` refuses a staff
  caller with a 404 — the same non-disclosure posture as ownership checks — before any document is
  read. This is the first repository to consume `requireOwnerRole`, which existed and was tested but
  unused until now.
- **"Destination pre-filled from the payment record" is the customer's contact, not the inward UTR.**
  The order's `payment.upiRef` is the customer's _inward_ reference; there is no stored customer VPA
  and the QR encodes the merchant's. So a refund is reached through the customer's `contact` on the
  order, and the operator records the _outward_ reference of the transfer they make. The refund's
  `outwardUpiRef` is nullable because the record is created when the decision is made and the transfer
  follows.

### `[x]` Task 19 — Admin orders, fulfilment, dashboard

- [x] Order list with filters and search — `GET /v1/admin/orders` is now a filterable, cursor-paged
      read (`listOrders`): newest first, filterable by payment status **or** fulfilment status, or
      searched by the customer-facing `humanId`. The two filters are alternatives, not a matrix, so
      every query stays index-backed; a `humanId` short-circuits to the one matching order.
- [x] Fulfilment state machine, enforced in the repository — `advanceFulfilment` (pack / ship /
      deliver / hold / take-off-hold) asserts every move against `fulfilmentStatusMachine`, which is
      **independent of payment status**. The one cross-machine rule the fulfilment machine cannot
      express — "an order cannot be packed until it is paid" — is a guard in the handler.
- [x] Customer-safe event subset on the order timeline — pack, ship and deliver each append a
      per-order event **and** a spine event (`order.packed` / `order.shipped` / `order.delivered`),
      which the dispatcher projects into a customer notification; `on_hold` is internal and announces
      nothing. `order.shipped` carries the carrier and tracking number the copy interpolates.
- [x] Order cancellation with the right stock undo — `cancelOrder` branches on how far the order got:
      a pre-payment cancel releases the reservation and lowers `reserved` (no ledger entry, on-hand
      never moved); a paid cancel optionally restocks on-hand with an `order_cancelled` ledger entry.
      Both move the order **and** its fulfilment to `cancelled`, and record a customer-facing reason.
- [x] Dashboard from `analytics/daily` rollups, not live aggregation — a scheduled `analyticsDailyRollup`
      Function rolls each store-local day into one `analytics/rollups/daily/{date}` document
      (`computeDailyRollup`); the dashboard reads a range of those (`listDailyAnalytics`), so its cost
      is the range, not the order volume.
- [x] Admin UI — an order list (filters, search, pagination), an order detail with the audit timeline
      and fulfilment/cancel controls, and a dashboard. Server-read screens with the write controls as
      inert client islands until operator sign-in (Task 20), the Task 12 precedent.

**Configuration.** The store's `locale.timezone` (`Asia/Kolkata` for ROMP) is what decides which
calendar day an order belongs to in the rollup — a late-evening Bengaluru sale rolls up to that date,
not the UTC one. The rollup Function is scheduled `30 0 * * *` **in that timezone**, so it runs just
after the store's own midnight and rolls up the day that just ended. The `adminOrderWrite` rate-limit
key (60/minute, from Task 18) is reused for the fulfilment and cancel writes.

**Demo.**

| Claim                                                | How to see it                                                                                                                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The order list filters, searches and pages           | `pnpm --filter @romp/infra test` — `admin-order-list`: a cursor walks the whole set newest-first with no gaps or repeats; a status filter narrows; a `humanId` returns one order |
| A paid order packs, ships and delivers               | `api-admin-orders` — pack → ship (with carrier + tracking) → deliver each return 200 and append the matching spine event                                                         |
| An unpaid order cannot be packed                     | `api-admin-orders` — packing a `pending_verification` order returns `409 INVALID_STATE_TRANSITION` (the cross-machine guard)                                                     |
| Cancel releases held stock, or restocks a paid order | `cancel-write` — a held cancel lowers `reserved` and releases the reservation with no ledger entry; a paid restocking cancel raises on-hand and writes `order_cancelled`         |
| A cancelled order is cancelled on both machines      | `api-admin-orders` — cancel returns an order whose `status` and `fulfilment.status` are both `cancelled`                                                                         |
| The rollup buckets by the store's day, not UTC       | `@romp/core` `rollup.test` — `2026-03-01` in `Asia/Kolkata` spans `2026-02-28T18:30Z`–`2026-03-01T18:30Z`; `analytics-write` proves a previous-local-day order is excluded       |
| The dashboard reads rollups, never scans orders      | `analytics-write` — `listDailyAnalytics` reads a date range of rollup documents; the live scan happens once, in the scheduled `computeDailyRollup`                               |
| The admin screens render real data                   | `pnpm --filter @romp/admin test` — the order list, detail timeline and dashboard render from fixtures; the fulfilment controls are offered only for legal moves                  |

**Notes.**

- **Payment and fulfilment are two machines, and the one rule that spans them is a handler guard.**
  A paid order can be packed, shipped, held, or cancelled; a delivered order can still be refunded.
  Collapsing the two into one status enum would invent composite states like
  `paid_but_on_hold_and_partially_refunded`. So `advanceFulfilment` asserts against
  `fulfilmentStatusMachine` alone — and the only thing that machine cannot know, "is the money in",
  is checked once, explicitly, at the point the two meet: packing requires `order.status === 'paid'`.
  The plan's phrase "enforced in `@romp/core`" is where the machines _live_ (`@romp/contracts/domain`);
  the _enforcement_ is `assertTransition` (`@romp/observability`) called inside the `@romp/data`
  repositories, which is where every other write in the platform enforces its transitions.
- **Cancellation is two different undos, and conflating them corrupts stock.** Before payment, the
  order only ever _reserved_ stock, so cancelling lowers `reserved` and releases the reservation, and
  writes **no** inventory-ledger entry — the ledger records on-hand movement and there was none, the
  exact reasoning the sweeper's release follows. After payment, verify already committed the stock
  (on-hand fell), so cancelling _restocks_ — raising on-hand and writing an `order_cancelled` ledger
  entry, the mirror of the commit's `order_committed` — but only if the goods came back sellable, so
  `restock` is the operator's call. Either way both machines move to `cancelled`, because a cancelled
  order is neither awaiting anything nor going to ship. Refunding the money is the separate,
  owner-only `issueRefund`; a cancel does not move money.
- **The dashboard never scans `orders`, and a "day" is the store's day.** A busy store's order
  collection is the last thing to aggregate on every dashboard load, so the numbers are a scheduled
  rollup and the dashboard reads a bounded range of small documents. The window is the store-local
  day, not a UTC day (`zonedDayWindow`, via the runtime's own tz database so India's +05:30 half-hour
  offset needs no table), and it is half-open so a midnight order is counted once. The rollup document
  is keyed by its date, so a re-run — which the scheduler will, at least once — overwrites rather than
  duplicates: it is a materialised view, safe to recompute.
- **The order-list filters are deliberately exclusive, for index safety.** `status` and
  `fulfilmentStatus` are offered as alternatives rather than a combinable matrix, because combining
  them would need a composite index the query plan does not carry. The repository applies at most one
  (payment status wins if both arrive), and the list orders by `createdAt` **and** the document ID —
  the ID tiebreaker is what makes `startAfter` take the two values Firestore's cursor needs and keeps
  paging total, so two orders at the same instant cannot straddle a page boundary.
- **The admin write controls are built and inert, exactly as Task 12 established.** The fulfilment,
  cancel and refund controls render and offer only the legal moves, but every write goes through the
  API client, whose `operatorToken()` returns null until client auth lands — so a click surfaces
  "Sign in as a staff member" rather than silently doing nothing. The screens are exercisable
  end-to-end after Task 20 wires operator sign-in; the read side is fully live today.

---

## Phase 7 — Account and social

### `[ ]` Task 20 — Customer account and WhatsApp support

- [ ] Profile, addresses, order history and tracking, wishlist
- [ ] Password and address changes notified to the account's own feed, so a takeover is visible
- [ ] WhatsApp deep link prefilled with order context, number from store config

### `[ ]` Task 21 — Reviews with moderation

- [ ] Verified-purchase reviews; pending by default
- [ ] Author sees own pending review; public sees approved only
- [ ] Text stored raw, **escaped at render**, never `dangerouslySetInnerHTML`
- [ ] Rating aggregates maintained by a Function

---

## Phase 8 — Hardening and launch

### `[ ]` Task 22 — Performance, SEO, and accessibility pass

- [ ] Lighthouse CI budgets as a **gate**: LCP < 2.5 s, CLS < 0.1, TBT < 200 ms
- [ ] Bundle analysis; route-level code splitting
- [ ] Config-driven sitemap and robots; canonicals; JSON-LD verified
- [ ] axe clean at component and page level; purchase path completable by keyboard alone
- [ ] Reduced-motion honoured throughout

### `[ ]` Task 23 — Security hardening and the Cloudflare/GoDaddy cutover

- [ ] Strict CSP enforced after one report-only release
- [ ] HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` on admin
- [ ] CORS restricted per environment — no wildcard, including in dev
- [ ] Rate limits verified under load
- [ ] **Verify the Firebase domain grey-clouded first, then proxy with SSL Full (strict)** — reversing
      this order breaks certificate issuance ([ADR-0003](adr/0003-cloudflare-fronting-firebase.md))
- [ ] `admin.<domain>` subdomain live
- [ ] CI check for secrets in the built client bundle

### `[ ]` Task 24 — Observability, backups, second-store clone, launch

- [ ] Alert policies from the [`RUNBOOKS.md`](RUNBOOKS.md) alert inventory, with agreed thresholds
- [ ] Sentry across all three surfaces with release tagging
- [ ] Daily backups **and a rehearsed restore** — an untested backup is a hypothesis
- [ ] Second-store clone test: a new store deploys with zero changes under `apps/` or `packages/`
- [ ] Runbook `TBD` placeholders resolved
- [ ] Launch checklist against the [`V1_SCOPE.md`](V1_SCOPE.md) launch gate

---

## Carried forward

Work discovered mid-build that belongs to a later task. Empty is a good sign; a long list means tasks
are being called done early.

| Item                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Raised in | Belongs to       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---------------- |
| Resolve remaining `TBD (Task N)` placeholders in `RUNBOOKS.md` (Task 13's reconciliation TBD resolved; Task 11's replay entry hands to 24)                                                                                                                                                                                                                                                                                                                   | Task 1    | 17, 23, 24       |
| Wire the alert inventory with real thresholds                                                                                                                                                                                                                                                                                                                                                                                                                | Task 1    | 24               |
| Automate PII deletion (manual procedure in v1.0)                                                                                                                                                                                                                                                                                                                                                                                                             | Task 1    | Roadmap          |
| CI grep for secrets in the built client bundle                                                                                                                                                                                                                                                                                                                                                                                                               | Task 1    | 23               |
| ~~Add Functions + Pub/Sub emulators to `firebase.json`~~ — done in Task 10                                                                                                                                                                                                                                                                                                                                                                                   | Task 2    | ✓ 10             |
| Add `apphosting` and `functions` to the deploy targets                                                                                                                                                                                                                                                                                                                                                                                                       | Task 2    | 5, 10            |
| CI check for docs link/anchor regressions (done once by hand in Task 1)                                                                                                                                                                                                                                                                                                                                                                                      | Task 2    | 22               |
| Sentry adapters for the `ErrorReporter` port (port and no-op exist)                                                                                                                                                                                                                                                                                                                                                                                          | Task 3    | 5, 10            |
| ~~Emit `openapi.json` as an artefact and add the CI staleness check~~ — done in Task 10                                                                                                                                                                                                                                                                                                                                                                      | Task 3    | ✓ 10             |
| Apply `createAppConfig({ brandNames })` to each app's ESLint config                                                                                                                                                                                                                                                                                                                                                                                          | Task 4    | 5                |
| Replace the placeholder OG fallback artwork with real 1200x630 images                                                                                                                                                                                                                                                                                                                                                                                        | Task 4    | 22               |
| Create the App Hosting backends and run the first dev deploy                                                                                                                                                                                                                                                                                                                                                                                                 | Task 5    | Owner action     |
| ~~Admin app shell (`apps/admin`), reusing `@romp/ui`~~ — built in Task 12                                                                                                                                                                                                                                                                                                                                                                                    | Task 5    | ✓ 12             |
| ~~Wire the notification bell to live data~~ — bell + hook built in Task 11; ~~cart count~~ — header `CartBadge` reads the cart count in Task 15                                                                                                                                                                                                                                                                                                              | Task 5    | ✓ 11, ✓ 15       |
| Give the notification bell a signed-in uid (it renders signed-out until client auth exists)                                                                                                                                                                                                                                                                                                                                                                  | Task 11   | 20               |
| WhatsApp send step reading the notification documents (the in-app write ships; the send is a roadmap seam)                                                                                                                                                                                                                                                                                                                                                   | Task 11   | Roadmap          |
| Lighthouse CI budgets against a deployed preview                                                                                                                                                                                                                                                                                                                                                                                                             | Task 5    | 22               |
| Deploy the indexes and TTL policies to a real project (`fieldOverrides` with `ttl: true` is a no-op on the emulator)                                                                                                                                                                                                                                                                                                                                         | Task 6    | Owner action     |
| Denormalise `inStock` to a top-level product field, so the in-stock filter stops running in memory. **Reviewed in Task 13, kept deferred:** `variantSummary[].inStock` is already maintained on variant writes and the in-memory filter is correct if occasionally short; a top-level boolean means every inventory transaction touches the product doc too. Lands with the perf pass unless the filter's short-page behaviour becomes a real problem first. | Task 7    | 22               |
| Denormalise `isLowStock`, so the low-stock report stops scanning a bounded window. **Reviewed in Task 13, kept deferred:** `listLowStock` scans a bounded window ordered by `onHandTotal`, which is predictable and cheap at v1.0 catalogue sizes; the boolean would add a write to every stock movement. Revisit when the report matters more than the extra write.                                                                                         | Task 7    | 24               |
| ~~Write paths — transactions for reservation, commit, release and restock~~ — reservation (`reserveAndPlaceOrder`, Task 16), release (`releaseReservation`/sweeper, Task 17), commit (`verifyPayment`, Task 18) and restock (`issueRefund`, Task 18) all built                                                                                                                                                                                               | Task 7    | ✓ 16, ✓ 17, ✓ 18 |
| ~~Reconciliation runbook 4 can now call `reconcileVariantStock`; the runbook still says `TBD (Task 13)`~~ — `reconcile:variant` script built and runbook 4 rewritten in Task 13                                                                                                                                                                                                                                                                              | Task 7    | ✓ 13             |
| ~~`apps/api` must pass `allowedDataImports: ['firebase-admin/auth']`~~ — done in Task 10                                                                                                                                                                                                                                                                                                                                                                     | Task 7    | ✓ 10             |
| ~~Product media upload pipeline~~ — upload + magic-byte finalize + quarantine built in Task 12                                                                                                                                                                                                                                                                                                                                                               | Task 6    | ✓ 12             |
| ~~`pnpm seed:admins` for seeded owner and staff accounts~~ — done in Task 10                                                                                                                                                                                                                                                                                                                                                                                 | Task 6    | ✓ 10             |
| ~~Maintain `categories.productCount` on product writes — the seed computes it once, nothing keeps it current yet~~ — the `categoryProductCounter` trigger maintains it (Task 14), with `reconcile:categories` as the drift path                                                                                                                                                                                                                              | Task 6    | ✓ 14             |
| ~~Ledger-to-stock reconciliation script; the invariant is asserted in tests but there is no operational tool~~ — `pnpm --filter @romp/data reconcile:variant` built in Task 13                                                                                                                                                                                                                                                                               | Task 6    | ✓ 13             |
| Point per-page canonical URLs at the deploy origin, plus a sitemap                                                                                                                                                                                                                                                                                                                                                                                           | Task 8    | 22               |
| Cover `firebase.ts` credential paths against the emulator, so it is not coverage-excluded forever                                                                                                                                                                                                                                                                                                                                                            | Task 8    | 24               |
| A search box wired to `suggest()` (the read exists; there is no input yet)                                                                                                                                                                                                                                                                                                                                                                                   | Task 8    | 22               |
| Per-variant `Offer` in the PDP JSON-LD (v1.0 emits one product-level offer at the "from" price)                                                                                                                                                                                                                                                                                                                                                              | Task 9    | Roadmap          |
| Real per-product OG images once the media pipeline produces them (the layout OG fallback applies until then)                                                                                                                                                                                                                                                                                                                                                 | Task 9    | 12, 22           |
| Wire add-to-cart on the PDP to the cart API (the button and its states ship now; the behaviour is Task 15)                                                                                                                                                                                                                                                                                                                                                   | Task 9    | 15               |
| Firestore-backed idempotency store. **Task 16 wired order placement to the `IdempotencyStore` interface** but kept the in-memory default; the persisted store (needed for cross-instance replay on Cloud Functions) is still to build and wire in `bootstrap.ts`                                                                                                                                                                                             | Task 10   | 17               |
| Server-side current-password verification via the Identity Toolkit REST endpoint (needs the store Web API key)                                                                                                                                                                                                                                                                                                                                               | Task 10   | 20               |
| Wire the admin's write controls to a signed-in operator token (they render signed-out until client auth exists)                                                                                                                                                                                                                                                                                                                                              | Task 12   | 20               |
| Wire `deps.revalidate` in the API bootstrap to the storefront's revalidation endpoint (unset in v1.0; the hourly ISR floor is the backstop)                                                                                                                                                                                                                                                                                                                  | Task 12   | Owner action     |
| Variant edit/deactivate and media reorder/delete in the admin UI (create + list ship; edit-in-place is a refinement)                                                                                                                                                                                                                                                                                                                                         | Task 12   | Roadmap          |
| Backfill the Resize extension's derivative dimensions onto the media entry, so `blurhash`/exact size come from the pipeline rather than staying a 1×1 placeholder                                                                                                                                                                                                                                                                                            | Task 12   | Roadmap          |
| Enable the `functions` deploy target + finalise the deployable `package.json` `main` (first API deploy)                                                                                                                                                                                                                                                                                                                                                      | Task 10   | Owner action     |
| Serve payment proofs with `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` (documented in `storage.rules`; the submission + owner-gated storage path ship in Task 17, the hardened serving route does not)                                                                                                                                                                                                                              | Task 17   | 18               |
| Magic-byte finalize/quarantine for uploaded payment proofs (product media has one via `mediaFinalizer`; `parseProductMediaPath` ignores the `payment-proofs/…` prefix, so a proof's declared type is not yet re-derived from its bytes)                                                                                                                                                                                                                      | Task 17   | 18               |
| Wire the screenshot upload in the storefront proof form to the client Storage SDK (`payment-proofs/{orderId}/{uid}/…`); the contract + API accept a `screenshotPath`, but the UI submits UTR-only in v1.0                                                                                                                                                                                                                                                    | Task 17   | 20               |

## Deviations from the plan

| Date       | Task | Deviation                                                                                                              | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ---- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-09 | 2    | `firebase.json` and `.firebaserc` at the repo root, not `infra/`                                                       | The Firebase CLI treats the directory containing `firebase.json` as the project root, and the Functions `source` field cannot point outside it. With the config in `infra/`, `apps/api` would be unreachable in Task 10. Rules and index files still live in `infra/`; the root config references them by path.                                                                                                                                                                                                                                                                                                                                                           |
| 2026-09-09 | 2    | `@romp/config` coverage policy moved from `src/index.ts` to a plain-ESM `policy.mjs`                                   | Each package's `vitest.config.ts` reaches the shared preset across a package boundary, where Node loads it natively rather than letting Vite bundle it — and Node 20, our floor, cannot load TypeScript at all. The preset and the data it reads therefore have to be real JavaScript. `src/index.ts` remains the typed, tested API over it, so the numbers are still stated exactly once, and JSDoc plus `checkJs` keeps the published types verified, not asserted.                                                                                                                                                                                                     |
| 2026-09-09 | 2    | Vitest 2 → 5, Vite 5 → 8                                                                                               | Not a preference. Vitest 2.1.9 carries a critical advisory (`GHSA-5xrq-8626-4rwp`) and pulled a Vite with a high one; the new audit gate failed on both immediately. Required dropping `coverage.all`, which Vitest 4 folded into `include`.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-09-09 | 2    | Firestore emulator on port 8181, not 8080                                                                              | 8080 was held by Docker on the first machine it ran on, and is the most contended port in local development. Every other emulator keeps its default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-09-09 | 3    | OpenAPI generated with Zod 4's built-in `toJSONSchema` against a registry we own, not `@asteasolutions/zod-to-openapi` | That library works by patching `ZodType.prototype` with `.openapi()`, which requires every schema and the generator to share one Zod module instance. Under Vite they do not: the patch was visible to the generator and invisible to the schemas it was generating from, so `registry.register` threw. Owning the registry object removes the dependency on bundler dedupe, and drops a dependency and a global side effect with it. `docs/API.md` updated to match.                                                                                                                                                                                                     |
| 2026-09-09 | 3    | Money arithmetic and `formatMoney` live in `@romp/contracts`, not `@romp/core`                                         | ADR-0004 placed arithmetic in `@romp/core`, which does not exist yet. More importantly, `Money` can only be constructed through validated helpers, so splitting the type from its operations would mean a package that owns a type nobody can safely produce a value of. `formatMoney` sits there too so the API, which renders customer-facing copy, does not need a second copy of it.                                                                                                                                                                                                                                                                                  |
| 2026-09-09 | 3    | Sentry replaced by an `ErrorReporter` port with no-op and logging implementations                                      | `@sentry/nextjs` needs Next as a peer and `apps/*` do not exist yet. Defining the port now means call sites are written once and the adapter is additive — the same shape as `SearchPort` in ADR-0002.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-09-09 | 3    | Firestore document schemas deferred to Task 6                                                                          | Task 3 delivers primitives, enums, state machines, the event catalogue and the error contract. Per-collection document schemas belong with the converters that use them, which is Task 6's deliverable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-09-09 | 4    | CSS custom-property namespace is `--store-`, not `--romp-`                                                             | Caught by the new `no-hardcoded-brand` rule on its first run: naming tokens after the brand puts the first store's name in every other store's stylesheet, which is the exact leak the white-label contract exists to prevent. It also made the rule fire on every legitimate token reference, which would have forced an exemption broad enough to hide real violations.                                                                                                                                                                                                                                                                                                 |
| 2026-09-09 | 4    | `stores/_template` is a fully valid light-themed store, not a stub of `TODO`s                                          | Two reasons. A new store should render on the first `pnpm dev` so the author rebrands against something visible; and a second _genuinely different_ config is what makes the zero-code-change contract testable, so the template doubles as the CI fixture `WHITE_LABEL.md` called for.                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-09-09 | 4    | `jiti` added as a devDependency of `@romp/store-config`                                                                | The generator and scaffolder import TypeScript, and Node 20 — our floor — cannot load it. `jiti` is already in the tree as Vite's own TS loader; depending on it explicitly is better than reaching for a transitive binary that a Vite upgrade could move.                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-09-09 | 4    | `@types/estree` added to `@romp/config`                                                                                | The lint rule is JSDoc-typed under `checkJs`, and ESLint's own types are built on ESTree's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-09-09 | 5    | Tailwind 4's CSS-first `@theme` block replaces the JS theme-extension artefact from Task 4                             | Tailwind 4 is configured in CSS, not JavaScript, so `tailwindThemeExtension`/`tailwind-theme.json` had no consumer. `renderTailwindThemeCss` emits `@theme inline` instead — `inline` matters, because without it utilities bake the resolved value in at build time and the `:root` override is ignored, which would make a store switch a rebuild rather than a different stylesheet.                                                                                                                                                                                                                                                                                   |
| 2026-09-09 | 5    | A generated fonts module, rather than reading fonts from config at runtime                                             | `next/font` is statically analysed and has no runtime API, so a family name cannot come from a config object at request time. Generating the module is what keeps typography in store config. The stylesheet then references `var(--font-store-display, <literal family>, <fallbacks>)`, which is correct whether the webfont loaded, the family is installed locally, or neither.                                                                                                                                                                                                                                                                                        |
| 2026-09-09 | 5    | Motion is CSS transitions driven by tokens, not an animation library                                                   | This is a performance-budgeted storefront with an LCP gate. An animation library would add a runtime to the critical path for behaviour that token-driven transitions already provide, and reduced motion is handled at the token level so it cannot be forgotten. Revisit if a genuinely gesture-driven interaction appears.                                                                                                                                                                                                                                                                                                                                             |
| 2026-09-09 | 5    | `theme` added to `publicRuntimeConfig`                                                                                 | The `no-hardcoded-brand` rule flagged a hardcoded `themeColor` hex, correctly. The theme is already public — every value is in the stylesheet the browser downloads — so exposing it as data lets the few places needing a colour in JavaScript read it from config.                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-09-09 | 5    | `next/font/google` stubbed by aliasing the app-local generated module, not the `node_modules` import                   | Vitest externalises `node_modules`, so Vite's alias never sees `next/font/google`; two attempts to intercept it there failed. Aliasing `@/generated/fonts` is deterministic, and what the stub replaces is asserted directly against `renderFontsModule` in `@romp/store-config`.                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-09-09 | 8    | The storefront reads Firestore through a `server-only` module, not directly                                            | ADR-0001 says public reads render server-side against Firestore; this is where that lands. `src/server/catalogue.ts` is the only place the app holds the Admin SDK, guarded by `import 'server-only'` (a browser-bundle wall) and by `no-restricted-imports` everywhere else. Pages call it; they never build a query.                                                                                                                                                                                                                                                                                                                                                    |
| 2026-09-09 | 8    | Catalogue reads short-circuit to empty when no datastore is reachable                                                  | `next build` has no project in CI or locally, and every catalogue page reads Firestore. Rather than fail the build or force the pages dynamic, `catalogueAvailable()` returns false at build and reads return empty, so the page prerenders a shell and ISR fills it on first request. The emulator sets a project var, so a build or test against the emulator renders real data.                                                                                                                                                                                                                                                                                        |
| 2026-09-09 | 8    | `FeaturedRail` and `NavCategoryRails` extracted from the home page into `HomeRails.tsx`                                | An async server component cannot be mounted synchronously in a test, so it is called and its resolved element rendered. Exporting the rails as their own components makes that clean, and leaves the page a declarative shell of Suspense boundaries.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-09-09 | 8    | `firebase.ts` and the `loading.tsx` files are excluded from the coverage denominator                                   | `firebase.ts` is Admin SDK bootstrapping — credential resolution and connection pooling that only runs correctly against a real runtime or the emulator, where `infra/tests` covers it end to end; unit-testing it would test mocks of the SDK. The `loading.tsx` files are three-line skeleton wrappers Next renders, not the app; `ProductGridSkeleton`, the part with a shape worth asserting, is tested directly. Same reasoning as `@romp/infra`'s `coverage: false`.                                                                                                                                                                                                |
| 2026-09-09 | 8    | `NEXT_PUBLIC_MEDIA_BASE_URL` added as a deploy env var                                                                 | Product media is a Storage object path, and the storefront needs a public base to join it onto for `next/image`. It is deployment configuration (a per-environment host), not brand configuration, so it lives in `apphosting.yaml` beside `NEXT_PUBLIC_SITE_URL`, not in `store.config.ts`. `NEXT_PUBLIC_` because the browser builds the srcset; it is a hostname, not a secret.                                                                                                                                                                                                                                                                                        |
| 2026-09-09 | 9    | A new `content.product` block in store config for every word the PDP renders                                           | The plan named the PDP's features, not its copy. Everything customer-facing on the page — breadcrumb label, buy-box labels, section headings, safety notices — has to be configuration or the `no-hardcoded-brand` rule catches nothing and a second store cannot rebrand. `_template` carries genuinely different copy, so the config-driven contract stays testable rather than assumed.                                                                                                                                                                                                                                                                                |
| 2026-09-09 | 9    | The PDP does not implement `generateStaticParams`                                                                      | Pre-rendering every product at build couples the build to a populated database — which CI does not have, by Task 8's degradation design — and does not scale with the catalogue. On-demand ISR yields the same cached HTML: the first visitor to a product pays one render, and `product:{slug}` busts it on edit. Revisit only if a specific product set must be warm at deploy.                                                                                                                                                                                                                                                                                         |
| 2026-09-09 | 7    | `StoreContext` carries `db` and `clock`, not `locale`/`currency`/`timezone`                                            | ADR-0005 sketched the ambient-value set. Nothing in the data layer formats anything, so those three would have been unused fields every caller had to assemble — and unused fields drift from the config that actually drives rendering. `db` and `clock` are the seams that turned out to matter: a module-level Firestore instance cannot be pointed at the emulator without a global mutation, and the sweeper's `expiresAt <= now` boundary is untestable without an injectable clock.                                                                                                                                                                                |
| 2026-09-09 | 7    | Caller identity is a separate parameter, not a field on `StoreContext`                                                 | ADR-0005's sketch had it third on `findById` and **absent** from `listForCustomer`, which is the shape to avoid: a list method with no caller either reads one from ambient state or does not filter at all. Every user-scoped method now takes a `Caller` explicitly, as a discriminated union so an anonymous owner is unrepresentable.                                                                                                                                                                                                                                                                                                                                 |
| 2026-09-09 | 7    | `in`-cap enforcement lives in the query schema **and** in the adapter                                                  | Duplicated on purpose. The schema catches it at the boundary with a field path; the adapter's own check means it can never be the component that silently truncates, even if a caller bypasses the schema.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-09-09 | 7    | Cursors encode the sort they were issued for                                                                           | Not in any ADR, and the failure it prevents is invisible: a cursor reused across a sort change makes Firestore compare a price against `ratingAvg` and return a plausible page in no meaningful order with items missing. A sort dropdown that keeps the `cursor` parameter produces exactly that by default.                                                                                                                                                                                                                                                                                                                                                             |
| 2026-09-09 | 7    | The in-stock filter runs in memory, so a filtered page can come back short                                             | `inStock` lives inside the `variantSummary` array and Firestore cannot filter on a field of an array element. The alternatives are a denormalised top-level boolean every variant transaction must maintain plus another index, or looping until the page fills — which turns one query into an unbounded number for a filter most visitors never apply. Carried forward to Task 12.                                                                                                                                                                                                                                                                                      |
| 2026-09-09 | 7    | A `no-restricted-imports` rule now enforces the port, rather than review discipline                                    | ADR-0002 said a lint rule was "the real control" and left it unbuilt. `createAppConfig` now restricts `firebase-admin`, `firebase-admin/firestore`, `firebase-admin/auth` and `@google-cloud/firestore`, with a per-app `allowedDataImports` escape hatch. The message names what a direct read would bypass.                                                                                                                                                                                                                                                                                                                                                             |
| 2026-09-09 | 7    | Shared ESLint ignores narrowed from `**/lib/**` to `lib/**`                                                            | The recursive form silently excluded `apps/storefront/src/lib/` — real source — from linting since Task 5. An ignored file reports no errors, which is indistinguishable from a clean one, so nothing surfaced it. Found while probing whether the new import restriction actually fired.                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-09-09 | 7    | `test-support/**` and `test-*.ts` excluded from the coverage denominator                                               | A test double is exercised by every test that uses it, so counting its lines measures nothing — and leaving it in the denominator creates pressure to write tests _for the harness_, which is effort spent on the one piece of code that ships to nobody.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-09-09 | 10   | The admin `role` claim carries `owner` / `staff`, not a single `admin`                                                 | `IDENTITY.md` sketched one `admin` role for v1.0, but `@romp/data`'s `Caller` and the security rules already model `staff` and `owner` (only an owner may refund or change settings). Minting a single `admin` claim would leave that distinction unreachable from the API. The claim matches the `Role` the role guard reads, so authorisation is consistent from the token to the repository.                                                                                                                                                                                                                                                                           |
| 2026-09-09 | 10   | `identityIndex` is reserved with a `create`, not a read-then-write transaction                                         | A transaction whose callback throws is **retried** by the Firestore SDK — it cannot tell a deliberate abort from write contention — and eventually surfaces an opaque error, which became a 500 on a duplicate. A `create` fails atomically with `ALREADY_EXISTS` if the document is present, which is exactly the reservation semantics, mapped to the 409 that does not echo the identifier.                                                                                                                                                                                                                                                                            |
| 2026-09-09 | 10   | Registration creates the Auth user first, and maps Auth's own uniqueness error to `IDENTIFIER_TAKEN`                   | The uid is needed for both the index entry and the profile, so the Auth user comes first. The login email is derived one-to-one from the identifier, so Auth's uniqueness on it is a second dedup gate: `email-already-exists` (and `phone-number-already-exists`) mean the identifier is taken. Both map to the same 409, and any later failure deletes the created user, so no orphan remains.                                                                                                                                                                                                                                                                          |
| 2026-09-09 | 10   | `currentPassword` is validated for shape but not verified server-side in v1.0                                          | Verifying the current password server-side needs the store's Web API key against the Identity Toolkit REST endpoint — a deployment secret not otherwise required. The possession proof is the valid, unrevoked session token the auth middleware already checked (with `checkRevoked`), and the change revokes every other session. The field is accepted now so adding verification later is not a breaking contract change.                                                                                                                                                                                                                                             |
| 2026-09-09 | 10   | The API is bundled with esbuild into a single `lib/index.js` for Cloud Functions                                       | A monorepo Function cannot ship its `node_modules` — the workspace `@romp/*` packages are symlinks. esbuild bundles the whole graph into one file, with `firebase-functions` and `firebase-admin` external because the runtime provides them. The deploy uploads a self-contained artefact, independent of the workspace layout surviving the upload.                                                                                                                                                                                                                                                                                                                     |
| 2026-09-09 | 6    | Seeded documents use **natural keys** (slug, SKU, warehouse code) instead of Firestore auto-IDs                        | An auto-ID makes the seed non-idempotent: a second run cannot tell which stored document corresponds to which entry in the file, so it duplicates everything. Nothing depends on `productId == slug` — the slug can be edited afterwards and the ID simply stops matching, because IDs are opaque everywhere they are used. Products created through admin still get auto-IDs.                                                                                                                                                                                                                                                                                            |
| 2026-09-09 | 6    | `analytics/daily/{date}` became `analytics/rollups/daily/{date}`                                                       | The documented path has three segments, which addresses a _collection_, not a document — a rollup could not have been written to it at all. Making the granularity the subcollection also lets weekly and monthly rollups sit beside the daily ones without a second top-level collection.                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-09-09 | 6    | `categories` is publicly readable in full, not gated on `isActive`                                                     | `SECURITY.md` gated the row on a field the data model does not define. Category names and the tree are on every page of the storefront, so there is nothing sensitive to gate; visibility is `showInNav` and `showInFilters`, which decide _where_ a category appears rather than whether it may be read.                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-09-09 | 6    | Read matrix status values corrected: products `active` not `published`, reviews `published` not `approved`             | The contracts are the source of truth and the docs had drifted from them. Both are now exported constants (`PUBLIC_PRODUCT_STATUS`, `PUBLIC_REVIEW_STATUS`) that the rules test asserts appear verbatim in the rules file, so the two cannot drift again silently.                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-09-09 | 6    | The client notification write surface is **two** rules, not one                                                        | `SECURITY.md` allowed `readAt` only and `NOTIFICATIONS.md` allowed both fields. Per-admin read state genuinely needs `readBy`, and a single rule permitting both would let a customer write the admin field and an admin write a shared one. Two rules, one per audience, with the staff rule scoped by a nested key diff to the caller's own uid — otherwise one admin can hide a new order from another.                                                                                                                                                                                                                                                                |
| 2026-09-09 | 6    | `refunds` carries a denormalised `userId`                                                                              | "A customer may read their own refunds" otherwise needs a `get()` on the order for every refund in the list — a read per document, which also fails closed if the order is unreadable for an unrelated reason. The order is immutable in the fields that matter here, so the copy cannot go stale.                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-09-09 | 6    | `products.seo` has no `slug`                                                                                           | `products.slug` already **is** the URL identity. A second slug is a field that can disagree with the first, and when it does every reader picks a different winner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-09-09 | 6    | `commerce.standardShippingFeeMinor` added to store config                                                              | `settings/checkout` needs a shipping charge to sit below the free-shipping threshold, and there was nowhere for it to come from — the threshold was advertising a benefit with nothing behind it. A refinement now rejects a non-zero threshold with a zero fee.                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-09-09 | 6    | Emulator test files run sequentially (`fileParallelism: false`)                                                        | They share one Firestore instance, and `clearFirestore()` in one file's `beforeEach` deleted fixtures another was asserting on. It failed only when the files ran together, which is the shape of flake that gets a suite retried rather than fixed.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-09-09 | 5    | `prelint`/`pretypecheck`/`pretest` removed from the storefront                                                         | Turbo already orders `tokens` before those tasks, and running the generator three times concurrently raced on the `public/brand` directory it clears and rewrites — an intermittent failure that appeared once in `pnpm verify`. `predev` and `prebuild` remain, for running those directly.                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-09-09 | 2    | `SECURITY.md` dependency claim corrected                                                                               | Task 1 stated "exact versions, no ranges, in every `package.json`". The repo uses caret ranges with a committed lockfile and `--frozen-lockfile` in CI. Corrected the document to describe the control that exists, rather than changing 18 manifests to satisfy a sentence.                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-09-09 | 11   | The dispatch decision is pure in `@romp/core`; the Cloud Function is thin glue                                         | The plan put a `notificationDispatcher` "in `@romp/core`". Making the whole trigger live there would drag Firebase into a package that must run in the browser. Instead `planNotifications` is pure — event plus templates in, notification documents out — and the `onDocumentCreated` trigger in `apps/api` decodes the snapshot and writes the results. The routing table and every interpolation rule are then unit-tested with no emulator, and the trigger has nothing left worth testing but the decode.                                                                                                                                                           |
| 2026-09-09 | 11   | The admin audience is one shared document with a `readBy` map, not a per-admin fan-out                                 | v1.0 seeds a small admin set, so `new_order` is a single document every admin reads and marks read by writing their own uid into `readBy` — scoped by the rules to the caller's own key so one admin cannot mark an order read for another. A fan-out would multiply every admin event by the admin count for no benefit at this scale. `adminUids` is carried on the dispatch input as a seam for a future fan-out but is deliberately unused.                                                                                                                                                                                                                           |
| 2026-09-09 | 11   | Dispatcher backlog is measured by the age of the oldest undispatched event, not a cursor document                      | A stalled dispatcher throws nothing, so error-rate alerting is blind to it. `measureDispatchBacklog` reads the recent events, skips the ones the routing table sends to nobody, and reports the age of the oldest one with no matching notification. A dispatch cursor document would be a second piece of state that can itself drift; the events and notifications already hold everything the metric needs.                                                                                                                                                                                                                                                            |
| 2026-09-09 | 11   | `firebase-client.ts` and the `useNotifications` hook are excluded from the coverage denominator                        | The client Firebase SDK aborts the jsdom worker on import (SIGABRT) even when mocked, so the hook cannot be unit-tested in the storefront's environment. The pure part — day-grouping and badge formatting in `notifications-view.ts` — is tested directly, the bell is tested with the hook mocked, and the `onSnapshot` lifecycle (a standard effect-returns-unsubscribe idiom) is exercised end to end by the emulator dispatcher test. Same reasoning as the Admin SDK bootstrap exclusions.                                                                                                                                                                          |
| 2026-09-09 | 11   | The notification bell ships rendering signed-out                                                                       | There is no client auth until Task 20, so `NotificationBell` renders a plain link to `/account` with no subscription when it has no uid, and only opens a live `onSnapshot` once given one. Shipping the affordance now settles its layout and accessibility; the wiring to a signed-in uid is carried forward to Task 20.                                                                                                                                                                                                                                                                                                                                                |
| 2026-09-09 | 11   | The template-token rule lives in `@romp/core`, and `@romp/store-config` gained `@romp/core` as a dependency            | A notification template may interpolate only the tokens its source event supplies; the rule that enforces this is derived from the routing table, which lives in `@romp/core`, so the derivation belongs there beside it. The store-config suite applies it to the real shipped configs, which is why store-config now depends on core. The direction is clean — both packages depend only on `@romp/contracts`, so there is no cycle — and core stays filesystem-free by not depending on store-config.                                                                                                                                                                  |
| 2026-09-09 | 11   | The `no-hardcoded-brand` rule now exempts `vi.mock`/`doMock`/`unmock`/`doUnmock` targets                               | The rule flagged `vi.mock('@romp/data')` as containing the brand string. A mock target is a module specifier, not user-facing copy, so it belongs with the existing import-specifier exemption rather than forcing an inline disable in every test that mocks a workspace package. Two valid cases were added to the rule's own suite.                                                                                                                                                                                                                                                                                                                                    |
| 2026-09-09 | 11   | `NEXT_PUBLIC_FIREBASE_{API_KEY,AUTH_DOMAIN,PROJECT_ID,APP_ID}` added as deploy env vars                                | The navbar bell subscribes with the client Firebase SDK, which needs the project's public web config. These are public by design — the client SDK ships them to the browser — so they are deployment configuration in `apphosting.yaml` beside the other `NEXT_PUBLIC_` values, not secrets and not brand config. Absent them, `firebase-client.ts` returns null and the bell renders its signed-out link, which is the honest state before the project is configured.                                                                                                                                                                                                    |
| 2026-09-09 | 11   | `@romp/storefront#tokens` now depends on `@romp/store-config#tokens` in `turbo.json`                                   | The clean-install rehearsal surfaced the last of the token-generator race the Task 5 deviation began fixing. The storefront's `tokens` script just delegates to store-config's generator, so turbo saw two independent `tokens` nodes and ran them concurrently — both writing `public/brand` and `src/generated`. With artefacts already present the write is idempotent and it passed; on a genuinely cold clone the two collided. A task-scoped `dependsOn` serialises them, so the generator never runs against itself. Caught only because the rehearsal wipes generated output first.                                                                               |
| 2026-09-09 | 12   | The product-write path is split pure/`@romp/core` and transactional/`@romp/data`, the same as the dispatcher           | The denormalisation (variant summary, from-prices), the status-transition rule and the magic-byte sniff are pure and unit-tested in `@romp/core`; `@romp/data` is the transaction around them. It keeps the money-critical decisions testable without an emulator, and mirrors the Task 11 shape so the codebase has one way of doing this rather than two.                                                                                                                                                                                                                                                                                                               |
| 2026-09-09 | 12   | A variant write reads all documents before writing any, merging the pending change in memory                           | Firestore forbids a `tx.get` after a `tx.set`, and the product summary depends on the full variant set. So `createVariant`/`updateVariant` read the product and every variant first, apply the pending change to the in-memory list, then write both the variant and the refreshed summary. The alternative — a lazy repair — is what lets a card show a price the customer is not charged.                                                                                                                                                                                                                                                                               |
| 2026-09-09 | 12   | The image dimension reader was dropped from `@romp/core`; only the magic-byte sniff stays there                        | The sniff is security-critical (it is what makes the declared content type stop mattering) and worth the shared, dependency-free home. Header-parsing dimensions for four formats is not security-critical and exploded the branch surface with byte-guard fallbacks; it belongs beside the Function, where the Resize extension is the real dimension source. v1.0 keeps the 1×1 placeholder until the extension produces the derivative sizes.                                                                                                                                                                                                                          |
| 2026-09-09 | 12   | Revalidation is an injected `deps.revalidate` seam, not a direct `revalidateTag`                                       | The API is a Fastify service and cannot import `next`. A publish computes the tags (`tagsForProduct`) and hands them to the seam the deployment wires to the storefront. Best-effort by design — a failed revalidation is logged, never fatal, and the storefront's hourly ISR floor is the backstop. Unset in v1.0 bootstrap; carried forward to wire to the storefront's endpoint.                                                                                                                                                                                                                                                                                      |
| 2026-09-09 | 12   | The cache-tag vocabulary moved from the storefront into `@romp/core`                                                   | It was `apps/storefront/src/server/tags.ts`, but Task 12's write side (the API) needs the same tags and cannot import a Next app. Moving it to `@romp/core` — pure, no `next`, no Firebase — gives the read side and the write side one source, so a read tagging `product:{slug}` and a write revalidating it cannot drift. The storefront file is now a thin re-export.                                                                                                                                                                                                                                                                                                 |
| 2026-09-09 | 12   | Media upload is a client-direct Storage write, not an API proxy                                                        | The storage rules already gate a `products/` write on the operator's token, size and declared type, so proxying the bytes through the API would add a hop and a memory cost for no security gain. The API allocates the object path and records a pending entry; the browser uploads to it; the finalize Function does the authoritative byte check. The API never touches the file.                                                                                                                                                                                                                                                                                      |
| 2026-09-09 | 12   | The backoffice is a new `apps/admin` App Hosting backend that reads server-side but writes through the API             | Reads use the Admin SDK behind `server-only` as a staff caller (so drafts are visible); writes go through the API, which verifies the role claim and owns the audit. The admin is white-label like the storefront — the `storeArtefacts` marker, the token step, the brand-name lint rule — and `turbo.json` gained an `@romp/admin#tokens` dependency to avoid the generator race, matching the storefront.                                                                                                                                                                                                                                                              |
| 2026-09-09 | 12   | The admin's write controls render signed-out until Task 20's client auth exists                                        | The write path needs an operator ID token, which the login flow mints — that is Task 20. Rather than block the whole backoffice, `operatorToken()` returns null and the controls disable with a "sign in" affordance, the same deferral the notification bell uses. The read layer works today as a staff caller, so the lists and forms render; only the writes wait.                                                                                                                                                                                                                                                                                                    |
| 2026-09-09 | 12   | `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` added as admin deploy env vars                    | The admin calls the API (base URL) and uploads to Storage (bucket) from the browser. Both are per-environment deployment configuration, not brand config, and public by nature — the API is CORS-gated and Storage is rules-gated, so neither is a secret. Absent them the admin renders but the write and upload controls report they are not configured.                                                                                                                                                                                                                                                                                                                |
| 2026-09-09 | 12   | The token generator copies brand assets with `readFileSync`/`writeFileSync`, not `cpSync`                              | With a second `storeArtefacts` app (admin), two `next build` prebuild hooks run the generator concurrently, and both rewrite each app's `public/brand`. `cpSync` performs an internal `equivalent(source, target)` check that throws when a sibling run has the target mid-flight — the concurrent both-app build failed on it. A read-then-write copy has no such check: two runs write identical bytes to the same path, last write wins. App Hosting still needs the `prebuild` hook (it builds one backend in isolation, not through turbo), so the fix is to make the copy concurrency-safe rather than remove the hook. Found by the both-store build of both apps. |
| 2026-09-09 | 13   | A refused adjustment maps to `InvalidStateTransitionError` (409), not the dedicated `InsufficientStockError`           | An oversell or below-zero adjustment is a conflict with the resource's state, the same category as an illegal product-status transition, so it reuses that 409. `InsufficientStockError`'s constructor is cart-shaped (`{sku, requested, available}`) — it exists to mark an offending cart line — and would have forced a fake `sku`/`requested`/`available` onto a warehouse adjustment that has none of them. The conflict category, not the stock category, was the honest fit.                                                                                                                                                                                       |
| 2026-09-09 | 13   | Only `adjustment` and `reconciliation` cross the inventory-adjust wire; the system reasons are rejected at the schema  | The `InventoryLedgerReason` enum has reasons the system owns — `order_committed`, `refund_restock`, `reservation_released`, the seed. Letting an operator pick one by hand would write a ledger row that lies about what happened. The request schema restricts `reason` to the two operator-selectable values, so the wire itself enforces that an operator can only ever record a manual adjustment or a reconciliation.                                                                                                                                                                                                                                                |
| 2026-09-09 | 13   | `commerce.lowStockThreshold` is read from the generated store config in the route, not threaded through `ApiConfig`    | A first adjustment creates the inventory record and must seed its low-stock threshold. The bootstrap `ApiConfig` exposes only brand and locale, and adding a commerce field there would thread a value through the whole app just to reach one route. Importing `@romp/store-config/generated/store-config.json` in the products route mirrors how the notification dispatcher reads its content, and uses the same number the storefront reads.                                                                                                                                                                                                                          |
| 2026-09-09 | 13   | `stockThresholdCrossing` is built now but the low-stock/out-of-stock events are emitted later                          | The pure crossing helper lives in `@romp/core` this task, but `adjustInventory` does not yet emit `inventory.low_stock` / `inventory.out_of_stock`. Stock also moves on reservation, commit and restock (Tasks 16–18); emitting the events only on manual adjustment would fire them for the least common path and miss the common ones. So the decision logic lands now and the emission lands with the commerce flows, in one place, rather than being retrofitted across four call sites.                                                                                                                                                                              |
| 2026-09-09 | 13   | The reconciliation `--fix` writes a `reconciliation` adjustment, it does not overwrite the balance                     | Runbook 4's "set the available quantity to the physically verified number" reads like an edit, but the ledger is the source of truth and edits are not entries. `--fix` computes `delta = verified − currentStored` and applies it through `adjustInventory`, so the correction is an appended, auditable row whose delta closes the gap — after which the ledger sum equals the physical count equals the balance, which is exactly the runbook's verify step.                                                                                                                                                                                                           |
| 2026-09-09 | 13   | `inStock` and `isLowStock` denormalisation, carried since Task 7, reviewed here and kept deferred                      | Both were tentatively assigned to Task 13 because availability is owned by the inventory transaction. On review the transaction already maintains `variantSummary[].inStock` on variant writes, and `listLowStock` scans a bounded, ordered window that is cheap at v1.0 sizes. A top-level `inStock` boolean and an `isLowStock` boolean would each add a write to every stock movement to optimise a filter/report that is correct today. Moved to the performance pass (22) and the alerting task (24) respectively, rather than paying the write cost now.                                                                                                            |
| 2026-09-09 | 14   | `active` added to `CategoryDoc` as a new field, distinct from the visibility flags                                     | The plan said "activation" but the data model had no `active` field — the Task 6 deviation had already noted `SECURITY.md` gated on a non-existent one. Rather than overload `showInNav`/`showInFilters` (which answer _where_, not _whether_), a dedicated `active` boolean was added. It defaults to `true` in the seed schema so no existing store config broke, and both shipped stores set it explicitly. Deactivation hides a category everywhere without deleting it, which pairs with the delete-refusal while products reference it.                                                                                                                             |
| 2026-09-09 | 14   | The category slug is immutable after create; a rename edits the name only                                              | The slug is the document ID and the products' denormalised `categorySlug`, so editing it would break every link and every product reference. Products (Task 12) already fixed the slug at create for the same reason. The `UpdateCategoryRequest` contract therefore has no slug field at all, and uniqueness is the create-only write's `ALREADY_EXISTS` rather than a separate index.                                                                                                                                                                                                                                                                                   |
| 2026-09-09 | 14   | A duplicate-slug conflict reuses the `IDENTIFIER_TAKEN` (409) error, not a category-specific code                      | A slug is an identifier and a duplicate is the same "already claimed" conflict as a taken login, so the existing `IdentifierTakenError` fits — with its detail overridden to name the category. Minting a new error code for an identical semantic would be contract sprawl. The illegal-parent and delete-blocked conflicts map to `INVALID_STATE_TRANSITION`, the same 409 category as an illegal product-status change.                                                                                                                                                                                                                                                |
| 2026-09-09 | 14   | Category collection reads are raw, bypassing the validating converter                                                  | `readTree` and `reconcileCategoryCount` need only `slug`/`parentId` (and `categorySlug`/`status` for products) — all plain strings. Reading through the strict converter would let one malformed or partially-migrated document break every category create, edit and reconcile. Raw reads scope the failure to the field actually consumed, are more resilient to a rolling migration, and are what let the writes coexist with the rules-test fixtures in the shared emulator (which seed intentionally partial category and product documents).                                                                                                                        |
| 2026-09-09 | 14   | `productCount` is maintained by increments with a reconciliation script, not a recomputation on every write            | Recomputing a category's count from all products on every product write is O(catalogue) per write; an increment up the ancestor chain is O(tree-depth). The trade is that `increment` is not idempotent under a Function retry, so the count can drift — accepted because a wrong facet number is cosmetic (Sev 3) and `reconcile:categories` rebuilds the truth on demand. This mirrors Task 13's inventory-ledger reconciliation: denormalised counters get a correction path rather than a guarantee.                                                                                                                                                                  |
| 2026-09-09 | 14   | Inactive categories are filtered in memory in the storefront reads, not by a new composite index                       | Excluding inactive categories from the nav and filter lists via `.filter(c => c.active)` avoids a `showInNav + active + sortOrder` (and `showInFilters + active + sortOrder`) composite index for a collection that holds single-digit documents. The existing indexes still order and narrow; the in-memory filter over a handful of results is the same bounded reasoning as the low-stock report.                                                                                                                                                                                                                                                                      |
| 2026-09-09 | 15   | A `maxQtyPerLine` config field was added; the quantity ceiling is not stock alone                                      | The plan said "quantity ceilings", which available stock already provides. But stock is not a real ceiling — a variant with hundreds in a warehouse would let a typo or a script park an absurd quantity that then reserves real stock at checkout. So a per-line maximum independent of stock was added to `commerce` (romp 20, `_template` 10) and projected to the public config for the cart's quantity control. A line is capped at the lower of the two.                                                                                                                                                                                                            |
| 2026-09-09 | 15   | The guest cart is a hand-rolled HMAC-signed cookie, not `@fastify/cookie` or a session store                           | The mechanism `API.md` specifies ("signed cart cookie") needs only sign/verify of one opaque ID, so a small pure `node:crypto` helper is less surface than a cookie plugin and a session dependency — and keeps the sign/verify logic unit-testable in isolation. The cookie is `HttpOnly`/`Secure`/`SameSite=Lax`; the API reads the `Cookie` header and sets `Set-Cookie` directly. CORS already sends credentials, so the cross-origin cookie works with no further change.                                                                                                                                                                                            |
| 2026-09-09 | 15   | The cart cookie name is brand-neutral (`__cart_id`), not prefixed with the store name                                  | A `romp_`-prefixed name tripped the `no-hardcoded-brand` lint, correctly: a cookie name baked with one store's brand ships in every other store's responses. The cookie is a technical identifier, not user-facing copy, so a neutral name is right — a second store ships the same cookie with no leak.                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-09-09 | 15   | The cart write repo is customer-owned (a `CartRef`), the first repo not gated on `requireStaff`                        | Catalogue/category/inventory writes are staff-only; a cart belongs to whoever holds it — a signed-in customer by uid or a guest by cookie ID. So the repo takes a `CartRef` the route resolves rather than a staff caller, and a guest cart (which has no caller at all) is written by resolving its ID, exactly as the existing `findCart` read comment anticipated. The pure/transactional split and the availability-via-inventory-doc read otherwise match the earlier write repos.                                                                                                                                                                                   |
| 2026-09-09 | 15   | The `/cart` page reads the cart client-side through the API, not server-side                                           | The storefront's server read layer is anonymous by design and never reads a customer's own data; a guest cart is reached by a cookie a server render has no session for in v1.0. So the cart page is a `force-dynamic` shell around a client island that fetches through the API with `credentials: 'include'`. Client auth (Task 20) will let a signed-in cart also render server-side, but the API read is the correct path for the guest case today, and the cart is never cached regardless.                                                                                                                                                                          |
| 2026-09-09 | 16   | GST is applied to the full taxable value (subtotal + gift wrap + shipping), not a narrower base                        | The spec does not single out which components GST applies to. The full invoice value is the unambiguous, defensible reading — a narrower base (subtotal only, or subtotal + gift wrap) would be a choice the docs do not support and would under-collect against the invoice total. `computeOrderTotals` applies the basis-point rate to the sum of the three taxable lines, and the `OrderAmounts` invariant (`total = subtotal + giftWrap + shipping + tax`) holds by construction.                                                                                                                                                                                     |
| 2026-09-09 | 16   | A reservation bumps `inventory.reserved` only; it does not decrement `onHandTotal`                                     | Stock is not gone until the money is confirmed, so placement raises `reserved` and leaves `onHandTotal` for the payment commit (Task 17). Serialisation still holds: the oversell invariant `onHandTotal − reserved ≥ 0` on the one-document-per-variant record is what blocks the second concurrent checkout, proven by the emulator concurrency test. Decrementing on-hand at placement would double-count against the ledger the commit writes.                                                                                                                                                                                                                        |
| 2026-09-09 | 16   | Order placement kept the in-memory idempotency store; the Firestore-backed one is deferred                             | `POST /v1/orders` was wired to the existing `IdempotencyStore` interface and the required `Idempotency-Key`, but the default remains in-memory. A cross-instance persisted store is real work with no behaviour difference at v1.0's single-instance scale, and the interface makes wiring it additive. Carried forward to Task 17 rather than built speculatively here. The in-process and emulator tests both exercise the replay path against the in-memory store.                                                                                                                                                                                                     |
| 2026-09-09 | 16   | `qrcode.react@4.2.0` added to the storefront to render the UPI QR                                                      | No QR-rendering library existed in any package, and the confirmation page must draw the per-order UPI intent string as a scannable code. `qrcode.react` (`QRCodeSVG`) renders as SVG — no canvas, so it is SSR-safe and needs no browser API — declares React 19 as a peer, and is pinned exactly. The QR is a view of the server-minted payload; the payload, not the render, is the source of truth.                                                                                                                                                                                                                                                                    |
| 2026-09-09 | 16   | The checkout page reads addresses via the client SDK and gets the ID token from `firebase/auth`                        | Order placement requires a bearer ID token, and the address picker needs the customer's saved addresses — but client auth (Task 20) and an address-create API do not exist yet. The page reads `users/{uid}/addresses` through the client SDK (a client-READ the rules already permit, as the account pages do) and attaches the current user's ID token to the API call, degrading to a "sign in" / "add an address" state otherwise. These are honest not-yet-wired states, not error screens, and the API read remains the write path for the order itself.                                                                                                            |     | 2026-09-09 | 17  | A reservation release writes no inventory-ledger entry                       | The plan item said the sweeper is "ledger-writing". But a reservation only ever raised `inventory.reserved` (Task 16) — it never moved on-hand — so releasing it lowers `reserved` back and on-hand does not change. The inventory ledger records on-hand movement and reconciles to `inventory.stock` (DATA_MODEL.md), so a ledger delta on a pure release would break that reconciliation. The on-hand decrement is the payment-commit's `order_committed` entry (Task 18); the release is recorded on the append-only event spine (`order.expired`) and the reservation's own `released`/`resolvedAt`, the correct audit for a pre-payment expiry. |
| 2026-09-09 | 17   | The sweeper's non-execution alert is folded into the sweep run, not a separate scheduled alarm                         | The dispatcher's backlog alarm is separate because the dispatcher is trigger-driven and needs a scheduled watcher. The sweeper _is_ the scheduled job, so it measures its own residual backlog each pass and logs a heartbeat; a growing age means it could not keep up, and a missing heartbeat means it stopped — both are age-of-oldest signals a log policy watches, the only kind that catches a component failing by going silent. One fewer deployable, and the measure lives beside the sweep it describes.                                                                                                                                                       |
| 2026-09-09 | 17   | The payment-proof route accepts a client-uploaded `screenshotPath`; there is no upload slot or magic-byte finalize     | The `payment-proofs/{orderId}/{uid}/…` storage path is already gated to the owner by the storage rules, so the client can upload directly and submit the path, which the API re-validates against that prefix. A registration/slot endpoint would duplicate what the rules already enforce. The magic-byte finalize/quarantine that product media has, and the storefront wiring of the upload itself, are carried forward — the v1.0 UI submits the UTR alone, the field the admin actually matches.                                                                                                                                                                     |     | 2026-09-09 | 18  | Short payment routes to exact-match-only, not a `partially_paid` order state | The plan and `SECURITY.md` say "route to a partial path, never close enough", but the order status machine has no `partially_paid` node and adding one would ripple through every consumer. Instead, only an exact `paidAmountMinor === totalMinor` reaches `paid`+commit; any mismatch is a typed `PAYMENT_AMOUNT_MISMATCH` carrying both figures. A short payment is handled by rejecting it (the customer tops up and resubmits via the existing `payment_rejected` edge); an overpayment, by verifying once matched and refunding the excess. This enforces the principle with the existing states rather than inventing one.                     |
| 2026-09-09 | 18   | Verify-payment relies on the state machine for idempotency instead of an `Idempotency-Key`                             | API.md marks verify-payment "idempotent". Rather than wire the idempotency store, the `pending_verification → paid` transition guard provides it: a second verify finds the order already `paid` and `assertTransition` refuses, so stock cannot be committed twice. The guard is the mechanism, and it needs no key or store on a staff-only route.                                                                                                                                                                                                                                                                                                                      |
| 2026-09-09 | 18   | A refund's destination is the customer's order contact, not the payment record's UTR                                   | The plan says "destination pre-filled from the order's payment record", but the only reference there (`payment.upiRef`) is the customer's _inward_ UTR — the wrong direction for a payout — and no customer VPA is stored. So a refund is reached through the order's `contact`, and the operator records the _outward_ UPI reference of the transfer they make (`RefundDoc.outwardUpiRef`, nullable until paid). Capturing a payer VPA at proof time is a roadmap item if a true pre-fill is wanted.                                                                                                                                                                     |
| 2026-09-09 | 19   | "Enforced in `@romp/core`" reads as the machines living in contracts, asserted in the data repos                       | The plan phrased fulfilment enforcement as "in `@romp/core`". The state machines live in `@romp/contracts/domain`, `assertTransition` lives in `@romp/observability`, and enforcement is the `@romp/data` repository calling it inside the write transaction — the same layering every other transition uses. `@romp/core` holds only the pure analytics arithmetic (`aggregateDailyOrders`, `zonedDayWindow`). No behaviour changed; the layering follows the existing seam rather than the plan's shorthand.                                                                                                                                                            |
| 2026-09-09 | 19   | The paid-before-pack rule is a handler guard, not a machine edge                                                       | Payment and fulfilment are separate machines, so `fulfilmentStatusMachine` cannot know whether the money arrived — "you cannot pack an unpaid order" is not a transition it can express. It is enforced once, explicitly, in `advanceFulfilment`: packing requires `order.status === 'paid'`, refused as `INVALID_STATE_TRANSITION` otherwise. Putting it in the machine would have coupled the two machines the design deliberately keeps apart.                                                                                                                                                                                                                         |
| 2026-09-09 | 19   | Order cancellation branches on prior status; a held cancel writes no ledger entry                                      | `cancelOrder` is one action with two undos. A pre-payment cancel (holding statuses) lowers `reserved` and releases the reservation with **no** inventory-ledger entry — on-hand never moved, and the ledger records on-hand movement (the sweeper's release reasoning). A paid cancel optionally restocks on-hand with an `order_cancelled` entry, the mirror of the commit. Both move order and fulfilment status to `cancelled`. Refunding money is the separate owner-only `issueRefund`.                                                                                                                                                                              |
| 2026-09-09 | 19   | The order list applies at most one of status / fulfilment status, for index safety                                     | The backoffice offers payment-status and fulfilment-status filters as alternatives, not a matrix, because a combined filter would need a composite index the query plan does not carry. `listOrders` applies whichever is set (payment status wins if both arrive), keeping every query index-backed with the existing single-dimension indexes. A humanId search short-circuits both.                                                                                                                                                                                                                                                                                    |
| 2026-09-09 | 19   | The analytics dashboard reads pre-computed rollups; a "day" is the store-local day                                     | The dashboard must never aggregate `orders` on read (`DATA_MODEL.md`), so a scheduled Function writes one rollup document per store-local day and the dashboard reads a range. The day window is computed in the store's timezone (`zonedDayWindow`, half-open, via the runtime tz database), so an 11pm Bengaluru sale rolls up to that date, not the UTC one. The rollup is keyed by its date, so a re-run overwrites rather than duplicates — a materialised view.                                                                                                                                                                                                     |
| 2026-09-09 | 19   | The admin order/fulfilment/dashboard screens are server-read with inert write controls                                 | Following Task 12's precedent, the screens read live data server-side as a staff caller, but the fulfilment, cancel and refund controls route through the API client whose `operatorToken()` is null until client auth (Task 20). A click surfaces "Sign in as a staff member" rather than doing nothing. The read side is fully live; the writes are exercisable end-to-end once Task 20 wires operator sign-in.                                                                                                                                                                                                                                                         |

## Decision log

Architectural decisions live in [`docs/adr/`](adr/). This table is the index with dates so the
chronology is visible.

| ADR                                               | Decision                                             | Status   |
| ------------------------------------------------- | ---------------------------------------------------- | -------- |
| [0001](adr/0001-hybrid-backend.md)                | Hybrid backend: Next.js reads, Functions writes      | Accepted |
| [0002](adr/0002-firestore-search-port.md)         | Firestore search behind a swappable `SearchPort`     | Accepted |
| [0003](adr/0003-cloudflare-fronting-firebase.md)  | Cloudflare proxies Firebase App Hosting              | Accepted |
| [0004](adr/0004-money-in-minor-units.md)          | All money is integer minor units                     | Accepted |
| [0005](adr/0005-single-tenant-white-label.md)     | Single-tenant, config-per-deployment white-labelling | Accepted |
| [0006](adr/0006-password-identity-without-otp.md) | Email-or-mobile password identity without OTP        | Accepted |
| [0007](adr/0007-notifications-not-email.md)       | In-app notifications and WhatsApp instead of email   | Accepted |
