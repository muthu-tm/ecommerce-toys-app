# ADR-0001 — Hybrid backend: Next.js reads, Cloud Functions writes

- **Status** — Accepted
- **Date** — 2026-09-09
- **Deciders** — Platform
- **Supersedes** — none

## Context

ROMP has three kinds of work with genuinely different constraints, and one backend shape has to serve
all three.

1. **Public catalogue reads** — home, listing, product detail. These are the SEO surface and the
   revenue surface. They must render server-side with real HTML, be cacheable, and be fast on a 4G
   phone in India. Every millisecond here is measurable in conversion.
2. **Writes that carry invariants** — place an order, reserve stock, verify a payment, issue a refund.
   These must be transactional, audited, idempotent, and impossible to reach from a browser except
   through validated code.
3. **Asynchronous work** — the reservation sweeper, the notification dispatcher, analytics rollups,
   image post-processing. These are scheduled or event-triggered and belong to nobody's request.

The stack is fixed: Next.js for both frontends, Firebase for infrastructure, Firestore for data. The
open question was where server logic lives.

A further constraint shapes this: payments are manually verified UPI transfers, so the write path is
not "call a gateway and trust the webhook". It is our own transaction maintaining our own invariants —
stock, reservations, a UTR uniqueness guard, an append-only ledger, and an audit spine. That logic has
to live somewhere with real transactional access and an audit trail.

## Decision

**Reads are served by the Next.js server. Writes are owned by Cloud Functions. The client Firestore
SDK is used for realtime reads only, under security rules.**

Concretely:

| Concern                                       | Where it runs                            | Access                                  |
| --------------------------------------------- | ---------------------------------------- | --------------------------------------- |
| Public catalogue pages                        | Next.js server components on App Hosting | Firebase Admin SDK, direct to Firestore |
| Realtime UI (notification bell, order status) | Browser                                  | Client Firestore SDK, under rules       |
| All mutations                                 | Fastify app on Cloud Functions v2        | Admin SDK, in transactions              |
| Scheduled and triggered work                  | Cloud Functions                          | Admin SDK                               |

Three supporting rules make this safe rather than merely convenient:

1. **The client write surface is one row long** — a client may set `readAt` on a notification addressed
   to it. Nothing else. Carts, addresses and wishlists are _read_ by clients but _written_ through the
   API.
2. **The Admin SDK bypasses security rules**, so every server-side read of user-scoped data filters by
   the authenticated `uid` explicitly. Repository methods take an explicit caller identity rather than
   reading it from ambient state, which makes the ownership filter a parameter you cannot forget to
   pass.
3. **Domain logic lives in `@romp/core`, which imports no Firebase.** Both the Next.js server and the
   Functions runtime call the same pricing, state-machine and routing code. Without this, "two runtimes"
   would mean two implementations of the order state machine, and they would drift.

## Alternatives considered

### A. Next.js only — route handlers and server actions for everything

Fewest moving parts, one deploy target, no cross-service auth.

Rejected because there is **no home for asynchronous work**. The reservation sweeper must run on a
schedule whether or not a user is browsing; the notification dispatcher must react to writes. Neither
is a request. We would have needed Cloud Functions anyway, at which point the "one runtime" benefit is
gone and we are left with business logic split across two places by accident instead of by design.

Secondary reason: a future mobile app or a partner integration would have no API to call. Server
actions are not an API surface — they are an implementation detail of a React tree.

### B. Separate API only — Next.js is a thin client, all data via HTTP

Clean separation, one obvious place for logic, easy to reason about.

Rejected because it puts an **HTTP hop on the SEO-critical path**. A product page render would be
Next.js → Functions → Firestore instead of Next.js → Firestore, adding a cold-start-prone network round
trip to the exact pages where LCP matters most. That is a permanent tax on every catalogue page in
exchange for architectural tidiness. Caching in front of the API does not remove it — it moves it, and
adds a second cache to reason about.

### C. Client-side Firestore for everything, rules as the only backend

Fastest to build, realtime everywhere, no server to operate.

Rejected outright. Security rules cannot express our invariants: they cannot transactionally read
inventory and reservations to decide whether stock is available, cannot recompute a total, cannot
enforce global UTR uniqueness, and cannot write an audit entry. A client-authored order is a
browser-chosen price. Also fails the SEO requirement — an empty HTML shell hydrating into a product
page is not indexable content.

### D. Chosen: hybrid — server reads in Next.js, writes and async in Functions

Accepts two runtimes in exchange for the right performance profile on reads and the right correctness
profile on writes.

## Consequences

### Good

- Catalogue pages reach Firestore in one hop. No API cold start on the revenue path.
- Every mutation goes through one middleware chain — correlation ID, rate limit, auth, Zod, idempotency,
  handler, error mapping — because there is exactly one door.
- Async work has a natural home, and the sweeper and dispatcher are ordinary Functions rather than
  cron-shaped hacks.
- There is a real HTTP API from day one, so a mobile client in the roadmap is an addition, not a
  rewrite.
- Realtime UI is free: the bell and order status subscribe directly to Firestore under rules, with no
  websocket infrastructure of ours.

### Bad, and accepted

- **Two runtimes to deploy, monitor and keep in dependency sync.** Mitigated by the shared
  `@romp/core` and `@romp/contracts` packages and a single CI pipeline that builds both.
- **Rules are not a safety net for server code.** The Admin SDK ignores them, so a missing ownership
  filter in a repository is a data leak with no second line of defence. This is the sharpest edge of the
  decision. Mitigated by: ownership as an explicit parameter, repository unit tests asserting a foreign
  `uid` yields not-found, and a 404-not-403 convention so even a leak of existence is avoided.
- **Two places where auth is interpreted.** Next.js verifies a session for page-level gating; Functions
  verify ID tokens per request. The verification helpers are shared, but the call sites differ.
- **Rules must still be written and tested thoroughly** even though most traffic does not go through
  them, because the realtime read path does. A rules suite with allow and deny cases per collection is
  a release gate.
- Debugging a flow can mean reading logs from two services. Correlation IDs propagate across the
  boundary so a single request is traceable end to end.

### Follow-ups this creates

- `@romp/core` must never gain a Firebase import. Worth a lint rule in the package boundary config.
- The rules test suite is not optional work to be deferred — it is the only control on the realtime read
  path.

## Related

- [`ARCHITECTURE.md § read/write split`](../ARCHITECTURE.md#2-readwrite-split)
- [`SECURITY.md § trust boundaries`](../SECURITY.md#1-trust-boundaries)
- [ADR-0005](0005-single-tenant-white-label.md) — repository signatures carry `StoreContext`, which is
  also where the ownership parameter lives
