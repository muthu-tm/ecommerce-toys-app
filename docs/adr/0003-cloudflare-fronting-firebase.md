# ADR-0003 — Cloudflare proxies Firebase App Hosting; media stays in Firebase Storage

- **Status** — Accepted
- **Date** — 2026-09-09
- **Deciders** — Platform
- **Supersedes** — none

## Context

The domain is registered at GoDaddy. Hosting is Firebase App Hosting in `asia-south1`, serving the
storefront at the apex and the backoffice at `admin.<domain>`.

This is an **image-heavy toy catalogue**: multiple photos per product, galleries on every product page,
category rails on the home page. Image delivery is the dominant cost in page weight, and page weight on
an Indian 4G connection is the dominant factor in conversion. So the media path matters as much as the
HTML path.

What we need beyond plain hosting:

- A WAF and bot mitigation in front of a public commerce site.
- Rate limiting at the edge, before requests cost us anything.
- Edge caching of static assets and cacheable HTML.
- Responsive image variants at sensible sizes, served with long-lived cache headers.
- DNS we can change quickly during an incident.

Firebase App Hosting includes a CDN, so this is not a question of whether there is any edge — it is
whether we add a controllable one in front of it, and where images live.

## Decision

**Two decisions, taken together because they interact.**

### 1. Cloudflare sits in front of Firebase App Hosting

- Nameservers move from GoDaddy to Cloudflare. GoDaddy remains the registrar only.
- Records for the apex and `admin` are proxied (orange-cloud) through Cloudflare to App Hosting.
- SSL/TLS mode is **Full (strict)** — Cloudflare validates the origin certificate rather than trusting
  it blindly.
- Cloudflare provides the WAF managed ruleset, rate limiting, bot fight mode, and edge caching.

### 2. Media stays in Firebase Storage, processed by the Resize Images extension, served through `next/image`

- Originals upload to Firebase Storage.
- The Resize Images extension generates responsive variants on finalize.
- `next/image` handles `srcset`, `sizes`, lazy loading and priority hints.
- Cloudflare caches the resulting URLs at the edge.

### The ordering constraint, which is the operationally important part

**Verify the custom domain with Firebase while the DNS record is grey-clouded (DNS-only). Only after
verification and certificate issuance complete, switch the record to proxied, then set SSL Full
(strict).**

Firebase verifies domain ownership and issues its certificate by reaching the origin over the public
DNS record. With Cloudflare proxying, that request terminates at Cloudflare, and issuance fails or
hangs. Recovering means grey-clouding again, waiting out propagation, and re-verifying — measured in
hours, on the day you are trying to launch.

This is written into the Task 23 cutover checklist and into
[`RUNBOOKS.md` runbook 8](../RUNBOOKS.md#8-cloudflare-or-dns-incident) because it is the kind of
detail that is obvious in hindsight and expensive in the moment.

## Alternatives considered

### A. Firebase App Hosting alone, no Cloudflare

Simplest topology. One vendor, one place to look, no proxy to misconfigure. App Hosting's CDN already
caches.

Rejected because it leaves **no WAF and no edge rate limiting**. Application-level rate limiting still
runs, but it runs after the request has reached our code and consumed a Function invocation and
Firestore reads — an attacker's traffic costs us money. For a commerce site handling payment references
and login, having a managed ruleset and bot mitigation in front is worth the added component. Cache
control is also coarser: no page rules, no cache purge granularity, no analytics on what the edge is
actually doing.

### B. Cloudflare Images or Cloudflare R2 for media

Excellent image resizing and delivery, tightly integrated with the edge we are already adding.

Rejected because it introduces a **second storage system**. Uploads happen from the admin app, which is
already authenticated against Firebase and already writes Firestore documents referencing the stored
object. Splitting storage means either the admin uploads to Cloudflare and we lose Firebase Storage
rules and the finalize trigger — which is where magic-byte type verification and quarantine happen — or
we upload to both and reconcile. Neither is worth the delivery improvement over
`Storage + Resize Images + next/image + Cloudflare cache`, which is already good.

Ownership and portability also argue for Firebase Storage: product media is our data, and keeping it in
the same project as the documents that reference it makes backup, deletion, and the data-deletion
procedure a single story rather than two.

### C. Cloudflare Pages or Workers for the frontends

Would remove App Hosting entirely and put rendering at the edge.

Rejected because the server-side read path uses the **Firebase Admin SDK against Firestore**
([ADR-0001](0001-hybrid-backend.md)). The Admin SDK is a Node.js library that does not run on Workers'
runtime, and the edge-compatible Firestore access paths are materially more limited. Also, running in
`asia-south1` next to Firestore keeps the server-to-database hop short — rendering at the edge in
Singapore while the data is in Mumbai would make server reads slower, not faster.

### D. GoDaddy DNS with Firebase hosting, no proxy

Fewest changes.

Rejected: GoDaddy's DNS management is slower to propagate and has no proxy, WAF, or rate limiting. If we
are going to have an incident-time lever, we want it on a platform with fast propagation and API
access.

### E. Chosen: Cloudflare in front, Firebase Storage for media

## Consequences

### Good

- WAF, bot mitigation and edge rate limiting in front of the origin, so abusive traffic is dropped
  before it costs us Function invocations or Firestore reads.
- Fast DNS changes, and a real incident lever: grey-clouding a record bypasses the proxy in seconds if
  Cloudflare itself is the problem.
- Edge caching we control, with purge, on top of App Hosting's own CDN.
- One storage system. Uploads keep Firebase Storage rules, and the finalize trigger keeps magic-byte
  type re-derivation and quarantine — the control that stops an "image" containing SVG script from being
  served on the admin origin.
- Media, documents and backups live in one project, so the data-deletion and restore procedures each
  describe one system.
- `next/image` plus pre-generated variants means correct `srcset` and `sizes` without a runtime image
  service in our request path.

### Bad, and accepted

- **Two caching layers.** A stale page can be stale at Cloudflare or at App Hosting, and diagnosing
  which requires knowing to check both. Cache headers are set deliberately in one place, and purge
  procedures name both layers.
- **The certificate ordering trap.** Getting the sequence wrong on cutover day costs hours. Mitigated
  only by documentation and a checklist — there is no technical guard.
- **A vendor in the critical path that is not Firebase.** A Cloudflare incident is our incident.
  Mitigated by the grey-cloud escape hatch, which is exactly why runbook 8 leads with it.
- **The registrar and the nameservers are now at different vendors.** Renewals at GoDaddy, DNS at
  Cloudflare. A forgotten renewal is still fatal, and the place you would naturally look for DNS is not
  the place that controls it. Worth a calendar reminder, not just a mental note.
- **Resize Images generates variants asynchronously.** For a brief window after upload, only the
  original exists, so an immediately-rendered product page can serve a large image. Acceptable because
  publishing is a deliberate admin action separate from upload.
- **Storage egress is billed by Google** even though Cloudflare caches it. Long cache lifetimes on
  immutable, content-hashed image URLs keep origin fetches rare, but the bill is not zero.

## Related

- [`ARCHITECTURE.md § deployment topology`](../ARCHITECTURE.md#7-deployment-topology)
- [`RUNBOOKS.md § Cloudflare or DNS incident`](../RUNBOOKS.md#8-cloudflare-or-dns-incident)
- [`SECURITY.md § storage rules`](../SECURITY.md#storage-rules) — magic-byte verification on finalize
- Task 23 — the cutover checklist that encodes the ordering constraint
