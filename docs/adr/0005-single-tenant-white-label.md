# ADR-0005 — Single-tenant white-labelling: one deployment per store, with a prepared multi-tenant seam

- **Status** — Accepted
- **Date** — 2026-09-09
- **Deciders** — Platform
- **Supersedes** — none

## Context

The requirement, stated by the product owner: _"This is a generic toys ecommerce platform — which can be
customised for any number of stores; so it should be generic and easily customisable / configurable"_,
and _"design, colors, logo, font, product name — reused & fully configurable in the code — can be easily
changed to another store easily"_.

So the platform must support many stores. The question is what "support many stores" means
architecturally, and there are two very different answers:

- **Multi-tenant** — one deployment, one Firestore database, many stores separated by a `tenantId` on
  every document and in every query and security rule.
- **Single-tenant, multi-deployment** — one Firebase project and one deployment per store, with the
  store's identity, branding and feature set supplied by configuration.

The first store is ROMP. There is no second store contracted. The business model — whether this is a SaaS
with self-serve signup, or a small number of operator-run stores — is not yet decided, and that decision
is exactly what should drive the choice.

One more fact weighs heavily: this system moves money, holds payment references and bank-statement
screenshots, and has **manual payment verification by human admins**. A cross-tenant leak here is not a
UI embarrassment; it is one store's staff seeing another store's payment evidence.

## Decision

**Each store is a separate Firebase project and a separate deployment. Store identity lives in
configuration. Every repository method takes an explicit `StoreContext` as the seam that would carry a
`tenantId` if we ever go multi-tenant.**

### The deployment model

```
stores/
├── romp/
│   ├── store.config.ts      brand, palette, typography, copy, locale, currency,
│   │                        tax, warehouses, WhatsApp number, UPI VPA, feature flags
│   ├── assets/              logo, wordmark, favicon, OG images
│   └── fonts/
└── _template/               scaffold for `pnpm store:new <id>`
```

`STORE_ID` selects the config at build time, and it is a GitHub Actions workflow input, so the same
pipeline deploys any store to that store's project.

### Zero branding in `apps/` and `packages/`

This is the load-bearing constraint, and it is enforced rather than requested:

- Colours, fonts, radii, spacing and motion durations are emitted from config as CSS custom properties.
  A lint rule fails a raw hex literal under `apps/`.
- Store name, wordmark, tagline and support number come from config. No string literal `"ROMP"` in app
  code.
- Copy comes from config, including the WhatsApp message templates.
- The **config schema is Zod-validated at build time**, so a malformed store config fails the build
  rather than rendering a broken page in production.
- A contrast assertion in the test suite means a config cannot ship a palette that fails WCAG AA. A
  white-label system that lets a new store choose an inaccessible palette has moved the accessibility
  problem to the least-equipped person to solve it.

### The `StoreContext` seam

Every repository method's first parameter:

```ts
interface StoreContext {
  readonly storeId: StoreId;
  readonly locale: Locale;
  readonly currency: CurrencyCode;
  readonly timezone: string;
}

interface OrderRepository {
  findById(ctx: StoreContext, orderId: OrderId, caller: CallerIdentity): Promise<Order | null>;
  listForCustomer(ctx: StoreContext, uid: Uid, page: Cursor): Promise<Paged<Order>>;
}
```

In v1.0 `storeId` is not used in any Firestore query — the database contains exactly one store, so it
would be a constant filter on every document. Its purpose is different: **it makes the multi-tenant
migration mechanical instead of architectural.** If we go multi-tenant, `storeId` becomes a real
predicate inside the repository layer and a real check in security rules. No call site changes, because
every call site already passes it.

`ctx` also carries the ambient values that would otherwise be read from a global. Domain functions that
format or compute against a locale receive it as a parameter, which keeps a second store from
inheriting the first store's timezone through a module-level default.

### As built, in Task 7

The shape shipped is narrower than the sketch above, and the difference is worth recording.

```ts
interface StoreContext {
  readonly storeId: string;
  readonly db: Firestore;
  readonly clock: Clock;
}
```

**Locale, currency and timezone are not on it.** They belong to `publicRuntimeConfig`, which the
storefront already has at build time, and a repository has no use for them — nothing in the data layer
formats anything. Carrying them here would have meant every caller constructing a context assembling
four values to satisfy a signature that reads one, and the unused three would drift from the config
that actually drives rendering.

**`db` and `clock` are on it instead.** Both are seams the sketch did not anticipate needing. `db`
because a repository that reached for a module-level Firestore instance could not be pointed at the
emulator in a test without a global mutation. `clock` because the reservation sweeper's boundary is
`expiresAt <= now`, and a test that cannot choose `now` has to sleep.

**Caller identity is a separate parameter, not part of `ctx`.** The sketch has it third on
`findById` and absent from `listForCustomer`, which is the shape to avoid: a list method with no caller
either reads the caller from somewhere ambient or does not filter at all. As built, every user-scoped
method takes a `Caller` explicitly, and `Caller` is a discriminated union — so an anonymous caller with
an owner role is unrepresentable rather than merely unlikely.

The reason it is a required parameter rather than ambient state is worth stating plainly, because it is
the single most consequential decision in the data layer: **the Admin SDK bypasses security rules.**
`infra/firestore.rules` does not apply to anything in `@romp/data`. Ownership filtering there is not a
second line of defence, it is the only line — and ambient identity is how that fails, because a
repository method compiles and runs whether or not anyone remembered to set it.

`caller` is separate from `ctx` deliberately. Store scope and caller identity are different concerns:
one selects the tenant, the other authorises within it. Conflating them is how an ownership check gets
skipped.

## Alternatives considered

### A. Multi-tenant from day one — `tenantId` on every document

One deployment to operate, one project to pay for, and a genuinely self-serve SaaS is possible.

Rejected, and this was the decision with the most consequence. Reasons, in order of weight:

1. **Cross-tenant leakage becomes the permanent top risk.** Every query needs a `tenantId` predicate,
   every security rule needs a `tenantId` check, and every server-side read via the Admin SDK — which
   bypasses rules entirely ([ADR-0001](0001-hybrid-backend.md)) — needs it applied by hand. One missing
   predicate in one repository method exposes another store's orders and payment proofs. The failure is
   silent, and it is worst in exactly the data we most need to protect.
2. **The security surface roughly doubles.** Every rule gains a second dimension. The rules test suite,
   which already needs allow and deny cases per collection, needs cross-tenant deny cases per
   collection too.
3. **Noisy-neighbour and blast radius.** One store's traffic spike, one store's bad index, one store's
   accidental bulk write affects all of them. A restore-from-backup for one store means restoring a
   database containing every store's data.
4. **We would be building for a business model that does not exist yet.** Multi-tenancy is the right
   answer for self-serve SaaS with many small stores. It is the wrong answer for a handful of
   operator-run stores. Nobody has decided which this is. Building multi-tenancy now is committing to the
   harder architecture on a guess.

The counter-argument — "retrofitting multi-tenancy is expensive" — is real, and it is why the
`StoreContext` seam exists. It does not make the migration free, but it makes it a change inside
`@romp/data` and `infra/*.rules` rather than a change to every call site in three applications.

### B. Single Firebase project, multiple Firestore databases

Firestore supports multiple named databases per project. Data is isolated; one project to manage.

Rejected because isolation is partial. Auth is **per project**, so all stores share one user pool — a
customer registered at store A can authenticate against store B, and the `identityIndex` becomes a
cross-store enumeration surface. Storage buckets and Functions are also shared, so a deploy for one
store redeploys the code path for all of them. It has most of multi-tenancy's coupling with most of
single-tenancy's per-store deployment work.

### C. One deployment reading branding from a runtime config document

The app is deployed once; `settings/branding` in Firestore drives the theme, resolved by hostname.

Rejected on both correctness and performance. Correctness: a store's palette, fonts and feature flags
become mutable production data with no build-time validation, so a bad edit is a broken storefront with
no gate in between. Performance: fonts and CSS custom properties would resolve at request time rather
than build time, and `next/font` optimisation depends on knowing the font at build time. It also does not
solve data isolation at all — it only addresses branding, which is the easy half.

### D. Hard fork per store

Copy the repository, change the branding.

Rejected immediately. Every bug fix and every feature has to be applied N times, and the copies diverge
within weeks. This is the outcome the requirement explicitly asks us to avoid.

### E. Chosen: single-tenant deployment with a config layer and a prepared seam

## Consequences

### Good

- **Data isolation is a property of the infrastructure, not of our query discipline.** There is no
  `tenantId` to forget, because another store's data is in a different project. For a system holding
  payment evidence, this is the single strongest argument.
- **Blast radius is one store.** A bad deploy, a runaway query, a corrupted collection, a restore — all
  scoped to one customer.
- Per-store backup, restore and data-deletion procedures are simple because each database holds one
  store.
- Security rules stay readable. They express ownership and role, and nothing else.
- A store can be on a different release than another, which makes staged rollouts and per-store hotfixes
  possible.
- The `StoreContext` parameter pays off immediately even without multi-tenancy: it removes ambient
  globals for locale, currency and timezone, which is what lets `@romp/core` stay pure and testable.
- Adding a store is a config directory, a project, and a workflow run — validated by the second-store
  clone test in Task 24, which is what turns "configurable" from a claim into a test.

### Bad, and accepted

- **Operational cost scales with store count.** N projects, N sets of alerts, N deploys, N sets of
  quotas and budgets. At 3 stores this is fine. At 30 it is a platform-operations problem that needs
  tooling we have not built. The honest position: this decision is correct for a small number of stores
  and must be revisited before the count gets large.
- **Cross-store reporting is not possible** without an external warehouse. There is no query that
  answers "total revenue across all stores".
- **Shared infrastructure costs are duplicated** — each project has its own minimum footprint.
- **No self-serve store creation.** Creating a store requires provisioning a Firebase project, which is
  an operator action. If the business model turns out to be self-serve SaaS, this decision is wrong and
  we pay for the migration.
- **The seam is unexercised.** `storeId` is passed everywhere and used nowhere, which means it is
  untested as a tenancy control. When it becomes real, expect to find places where it was passed
  correctly but would not have filtered correctly. A parameter that is always the same value is a
  parameter nobody has validated.
- **`StoreContext` on every method is verbosity** in exchange for a migration that may never happen.
  Accepted because it earns its place today via locale, currency and timezone, so the multi-tenant
  option is close to free rather than a pure bet.
- **The zero-branding rule needs continuous enforcement.** The lint rule catches hex literals; it does
  not catch a hardcoded store name in a WhatsApp template, or `alt="ROMP logo"`. Review discipline is a
  dependency, and the second-store clone test is the real backstop — a hardcoded brand string shows up
  as ROMP appearing in the clone.

## Related

- [`WHITE_LABEL.md`](../WHITE_LABEL.md) — every config knob and the new-store procedure
- [`ARCHITECTURE.md § package boundaries`](../ARCHITECTURE.md#3-package-boundaries)
- [ADR-0001](0001-hybrid-backend.md) — the Admin SDK bypassing rules is why manual `tenantId` predicates
  would be the top risk under multi-tenancy
- Task 4 — config schema, theming engine, contrast assertion
- Task 24 — the second-store clone test
