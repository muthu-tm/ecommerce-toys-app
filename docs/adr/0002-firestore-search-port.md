# ADR-0002 — Firestore search behind a swappable `SearchPort`

- **Status** — Accepted
- **Date** — 2026-09-09
- **Deciders** — Platform
- **Supersedes** — none

## Context

The storefront needs catalogue discovery: browse by category and age band, filter by price, brand and
availability, sort by price or recency, and a search box. A toy catalogue at launch is hundreds of
products, not hundreds of thousands.

Firestore is the primary datastore ([ADR-0001](0001-hybrid-backend.md)), and it has hard, well-known
limits on querying:

- **One range or inequality field per query.** You cannot filter by price range _and_ rating range in
  the same query.
- **`in` and `array-contains-any` cap at 10 values.**
- **No facet counts.** Firestore cannot tell you "37 products in this category" without reading 37
  documents.
- **No full-text search.** No stemming, no relevance ranking, no typo tolerance. Prefix matching on a
  tokenised array is the ceiling.
- Every filter combination that includes a range needs a **composite index**, and the index matrix grows
  combinatorially with the number of filterable fields.

A dedicated search engine — Typesense, Algolia, Meilisearch — solves all of it. It also introduces a
second datastore that must be kept in sync, a second thing to operate or pay for, a second failure mode
where the catalogue looks empty because sync broke, and reindex logic that has to be correct before the
first product is browsable.

The real question is not "which is better" — it is **when**. Search quality only starts to matter when
there is enough catalogue for a customer to fail to find something.

## Decision

**v1.0 uses Firestore for all catalogue queries, reached exclusively through a `SearchPort` interface.
Typesense arrives in v1.1 as a second adapter behind the same interface.**

```ts
interface SearchPort {
  searchProducts(ctx: StoreContext, q: ProductQuery): Promise<Paged<ProductSummary>>;
  suggest(ctx: StoreContext, prefix: string): Promise<Suggestion[]>;
  facets(ctx: StoreContext, q: ProductQuery): Promise<FacetCounts>;
}
```

The interface is designed against the **target** capability, not the current one. `facets()` exists in
v1.0 and is served from `categories.productCount`, a field maintained by a Function. It returns counts
for the dimensions we can afford and omits the rest — but the signature does not change when Typesense
lands, so no caller changes either.

Three commitments make the port real rather than decorative:

1. **No `firestore` import outside the adapter.** Route handlers, server components and domain code see
   `SearchPort` only. If a page reaches around the port to build a query, the swap stops being contained
   and the port has failed.
2. **Documented limits raise typed errors instead of degrading silently.** An `in` filter with 11
   category IDs throws `TooManyFilterValuesError`, it does not quietly return results for the first 10.
   A silent truncation is a wrong-results bug that nobody reports because nobody can see it.
3. **The query object is engine-neutral.** `ProductQuery` describes intent — category, age band, price
   band, sort, cursor — not a Firestore query builder. Cursors are opaque strings, so pagination can
   change from a document snapshot to an offset without touching the URL contract.

### What v1.0 actually supports

| Capability                          | v1.0         | How                                   |
| ----------------------------------- | ------------ | ------------------------------------- |
| Browse by category / age band       | ✅           | Equality filter + composite index     |
| Price range                         | ✅           | The single range field                |
| Sort by price, recency              | ✅           | Index-backed                          |
| In-stock filter                     | ✅           | Denormalised boolean on the variant   |
| Search box                          | Prefix match | Lowercased token array on the product |
| Typo tolerance, relevance ranking   | ❌           | v1.1                                  |
| Multi-dimensional facet counts      | ❌           | Category counts only                  |
| Price range + rating range together | ❌           | Firestore permits one range           |

The search box is the honest weak point. A customer typing `helicoptor` finds nothing in v1.0 —
asserted as a test in `infra/tests/repositories.test.ts`, so the limitation is visible in the suite
rather than discovered by a customer.

### What Task 7 added beyond the interface

Three things the ADR implied and did not specify.

**A price filter forces a price sort.** Firestore requires the first `orderBy` to name the range
field, so `price + rating_desc` is refused by the query schema and `price + newest` by the adapter,
both as `UNSUPPORTED_QUERY` (a 400). The error type is separate from `VALIDATION_FAILED` on purpose:
the set of unsupported queries _shrinks_ when Typesense lands, and folding them into ordinary bad
input would make it impossible to tell what the migration fixed.

**Cursors are bound to their sort.** A cursor encodes the sort it was issued for and is refused
against any other. Without that, a sort dropdown that keeps the `cursor` parameter — the normal way a
UI is built — makes Firestore compare a price against `ratingAvg` and return a plausible page in no
meaningful order with items missing. Nobody reports that, because nobody can see it.

**The in-stock filter runs in memory, and a filtered page can come back short.** `inStock` lives
inside the `variantSummary` array and Firestore cannot filter on a field of an array element. The
alternative is a denormalised top-level boolean that every variant transaction has to maintain plus
another index; the alternative to _that_ is looping until the page fills, which turns one query into
an unbounded number of them for a filter most visitors never apply. The short page is the accepted
cost, and it is stated at the call site rather than left to be discovered.

## Alternatives considered

### A. Typesense (or Algolia) from day one

Better search on launch day; the filter matrix stops being an index-planning exercise.

Rejected on **cost and sequencing**. It means building and validating a sync pipeline — initial index,
incremental updates on every product and inventory write, reindex-on-schema-change, drift detection —
before there is a catalogue large enough for anyone to notice the difference. That is meaningful work,
plus an operational surface and a monthly bill, spent on a problem we do not yet have. Algolia
additionally prices per search operation, which is a variable cost attached to browsing rather than to
buying.

The decisive argument: if we build the port properly, adopting Typesense later costs one adapter plus
the sync pipeline. Adopting it now costs the same adapter and sync pipeline, just earlier and with less
information about what the query patterns actually are.

### B. Firestore forever, no abstraction

Least code. Query Firestore where you need data.

Rejected because the migration then touches every listing page, every filter component, and the
pagination contract. Firestore's limits are not a maybe — no full-text search and no facet counts are
permanent properties. Committing to a datastore we already know we will outgrow, with no seam, is
choosing a rewrite later to save an interface now.

### C. Firestore plus a self-hosted Meilisearch on Cloud Run

Cheaper than Algolia, good relevance.

Rejected because it means operating a stateful service — persistent disk, backups, upgrades, memory
sizing — for a capability we can defer. It is the day-one option's costs plus infrastructure ownership.

### D. Client-side filtering over a fully downloaded catalogue

Genuinely viable at a few hundred products, and instant once loaded.

Rejected: it does not survive catalogue growth, the initial payload harms LCP on the pages that matter
most, and it makes the SEO-critical listing pages client-rendered. It optimises for a catalogue size we
intend to exceed.

### E. Chosen: Firestore now, port to make the swap contained

## Consequences

### Good

- No second datastore, no sync pipeline, no drift-detection job in v1.0. The catalogue cannot be
  "empty because the index broke".
- Reads inside the Firestore free tier and inside the transactional consistency of the primary store —
  a product published is a product findable, immediately, with no propagation lag.
- The Typesense adoption in v1.1 is one adapter plus a sync Function. Pages, components and URLs do not
  change. `ROADMAP.md` can state that with confidence.
- The port is a natural test seam: an in-memory adapter makes listing-page tests fast and
  deterministic, with no emulator.
- Forcing every query through one interface makes the index requirements enumerable. We know exactly
  which composite indexes exist and why, because there is one file that builds queries.

### Bad, and accepted

- **Search is weak on launch.** Prefix matching only. No typo tolerance, no relevance ranking, no
  synonyms. A misspelling returns nothing. This is the cost we are consciously paying, and it is
  visible to customers.
- **No facet counts** beyond category. Filter UI shows options without "(12)" beside them, which is a
  small conversion loss and a slightly less confident-feeling UI.
- **The filter matrix is capped by the one-range rule.** Any future filter request that needs a second
  range is a "wait for v1.1" answer, not a small ticket.
- **`categories.productCount` is a denormalised counter**, so it can drift from reality if the
  maintaining Function fails. It needs a reconciliation path.
- **The port has an ongoing enforcement cost.** It only holds if nobody bypasses it under deadline
  pressure, and review discipline decays. **Resolved in Task 7**: `createAppConfig` now sets
  `no-restricted-imports` on `firebase-admin`, `firebase-admin/firestore`,
  `firebase-admin/auth` and `@google-cloud/firestore` for every app, with an
  `allowedDataImports` escape hatch that has to be spelled out per app. A page that reaches around
  the port fails lint with a message naming what it bypasses. That is the control; the ADR no longer
  depends on remembering.
- Designing `facets()` against a capability we do not yet have means part of the interface is
  deliberately underserved in v1.0. That is a small honesty cost in the code: the signature promises
  more than the adapter delivers.

## Related

- `packages/data/src/search/port.ts` — the interface
- `packages/data/src/search/firestore.ts` — the only file that builds a Firestore catalogue query
- `infra/tests/indexes.test.ts` — drives the adapter and checks every shape it builds against
  `firestore.indexes.json`, because the **emulator creates indexes on demand and production does not**
- [`DATA_MODEL.md § documented query constraints`](../DATA_MODEL.md#documented-query-constraints)
- [`ROADMAP.md`](../ROADMAP.md) — Typesense sequencing in v1.1
- [ADR-0001](0001-hybrid-backend.md) — why the read path is server-side and can therefore hold a port
