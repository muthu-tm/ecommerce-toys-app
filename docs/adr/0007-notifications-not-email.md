# ADR-0007 — In-app notifications derived from an event spine, plus WhatsApp. No email.

- **Status** — Accepted
- **Date** — 2026-09-09
- **Deciders** — Platform / Product
- **Supersedes** — none

## Context

The product owner's instruction was explicit:

> _"No email communication to the customer — or for any; for support user can directly w'app store and
> get the details. In future we shall add the chat feature between the customer and backoffice admin."_
>
> _"We should have the notifications in the top navbar to the customer and admin — this should work for
> all notifications and better updates."_

So: no transactional email, no order confirmation email, no shipping email, no admin alert email.
Customer-initiated support goes to WhatsApp. Both the storefront and the backoffice carry a notification
bell that must cover **all** notifications, not a subset.

This matters more here than in a typical commerce build, because of what the order flow requires the
customer to do. Payments are manual UPI transfers: the customer pays against a QR, submits a UTR, and
then **waits for a human to verify it**. That wait is the moment a customer most wants to be told
something. There is no gateway webhook flipping the order to paid in seconds. If we do not tell them
their payment was verified, the notification bell is the only place they will find out — and if the
bell is empty, the customer's next action is a WhatsApp message to support.

There are also genuinely two audiences with different needs. Customers need order lifecycle updates.
Admins need to know a payment proof arrived, stock is low, a review needs moderation. A design that
serves one and bolts on the other produces two half-systems.

## Decision

**Every notification is derived from an append-only `events` collection by a single dispatcher, using a
declarative routing table. Notification IDs are deterministic, so replay is idempotent. In-app
notifications are the primary channel; WhatsApp is a secondary push for high-value events; there is no
email.**

### The pipeline

```
Write (order placed, payment verified, shipped, …)
   │  same transaction as the state change
   ▼
events/{eventId}          append-only, immutable, the audit spine
   │  Firestore onCreate trigger
   ▼
notificationDispatcher    reads the routing table in @romp/core
   │
   ├──▶ notifications/{deterministicId}   per audience, per recipient → the bell
   └──▶ WhatsApp send (independent, may fail without affecting the above)
```

### The event spine is the source of truth, not the notification

`events` is written **in the same transaction as the state change it describes**. An order cannot become
`paid` without an event recording it. Notifications are a _projection_ of that spine.

This inversion is the whole design. If notifications were written directly at each call site, we would
have notification logic scattered across every handler, no audit trail independent of the UI, and no way
to regenerate a notification that failed to write. With the spine: the audit trail exists whether or not
notification succeeded, the routing rules live in one testable table, and a dispatcher bug is repairable
after the fact.

`events` also serves the security audit requirement independently — every verification, refund and price
change carries its actor uid ([`SECURITY.md`](../SECURITY.md)). One append-only collection satisfies both
needs, and neither is a bolt-on to the other.

### Deterministic IDs make replay safe

```
notificationId = hash(eventId, audience, recipient)
```

Re-processing an event **overwrites the same documents** instead of creating duplicates. This is not a
micro-optimisation; it is what makes the operational story possible. A dispatcher bug can be fixed and
the affected events replayed, with no deduplication logic, no "have I already sent this" bookkeeping,
and no risk of a customer receiving the same notification five times because someone ran the backfill
twice. [`RUNBOOKS.md` runbook 3](../RUNBOOKS.md#3-notification-dispatcher-has-stalled) can say "just
replay it" only because of this property.

### The routing table is declarative and lives in `@romp/core`

```ts
const routes: NotificationRoute[] = [
  { event: 'order.placed', audiences: ['customer', 'staff'], whatsapp: false },
  { event: 'order.payment_submitted', audiences: ['staff'], whatsapp: false },
  { event: 'order.payment_verified', audiences: ['customer'], whatsapp: true },
  { event: 'order.shipped', audiences: ['customer'], whatsapp: true },
  // …
];
```

Data, not code. Adding a notification is a table row plus a copy template, unit-testable without
Firestore. Because it is in `@romp/core`, which imports no Firebase, the routing rules are tested in
milliseconds.

### Client write surface: `readAt`, and nothing else

The **entire** client write surface of the platform is one operation — a customer marking a notification
addressed to them as read. Rules assert the caller is the addressee, that only `readAt` changed, that the
value is a server timestamp, and that it was previously null (no un-reading, no backdating).

### The one email exception

Firebase's built-in **password-reset email** for accounts that have an email address. This is an
authentication primitive the user triggers, not a channel we use to talk to customers. Naming the
exception explicitly is better than an absolute rule that gets quietly broken
([ADR-0006](0006-password-identity-without-otp.md)).

### Alert on backlog age, not error rate

The dispatcher's dangerous failure is **not running** — a paused scheduler, a disabled trigger, a
crash-looping deploy. In all three, the error rate is zero and every dashboard is green while customers
silently stop being told anything. The alert is therefore on the age of the oldest undispatched event.

The same reasoning applies to the reservation sweeper, and it is the single most transferable idea in
this ADR: **for background work, monitor evidence of execution, not evidence of failure.** A component
that has stopped throws nothing.

## Alternatives considered

### A. Transactional email — SendGrid, Resend, Firebase Trigger Email

The industry default. Reaches customers who are not on the site. Free-tier viable.

Rejected: **explicitly out of scope by product decision.** Worth recording the arguments that were on
the table, because this is the constraint with the widest consequences. In favour of email: it reaches a
customer who has closed the tab, it produces a durable record the customer keeps, and deliverability is
a solved problem. Against, and the reasons the decision stands: Indian consumer email engagement is
low relative to WhatsApp, transactional email requires domain reputation work (SPF, DKIM, DMARC,
warm-up) that has its own failure modes, and the customer is already being asked to return to the site
to complete a manual payment flow — so the site is where they are, and the bell is where they will look.

### B. WhatsApp as the primary channel, no in-app bell

Where the customers already are, and support is already going there.

Rejected: the requirement asks for a bell for both audiences, and WhatsApp cannot serve the admin side —
staff need a queue view in the tool they are working in, not messages on a phone. Business-initiated
WhatsApp messages also require approved templates, carry per-message cost, and are subject to
rate limits and policy changes on Meta's side. Making a customer-facing guarantee depend on a
third-party template approval is fragile. WhatsApp is the right _secondary_ channel and the right
support channel.

### C. Web push notifications (FCM)

Reaches a customer who has left the site, no per-message cost, no email.

Rejected for v1.0, and it is the strongest deferred option. Reasons: it requires a permission prompt,
and asking for push permission before a customer has bought anything has poor grant rates and harms
trust; iOS Safari support requires the site to be installed to the home screen; and it needs token
lifecycle management (registration, refresh, cleanup of dead tokens). It also does not remove the need
for the bell — a dismissed push must still be findable. Roadmap item, layered onto the same routing
table as one more audience-channel column.

### D. Notifications written directly at each call site

Fewer moving parts. When you verify a payment, write the notification.

Rejected. No audit trail independent of the notification, notification logic scattered across every
handler, no replay when a write fails, and duplicate-suppression logic at every call site. It also
couples the write transaction to notification success: either notification failure rolls back the
payment verification, which is absurd, or it is fire-and-forget, which means silent loss.

### E. A third-party notification service — Knock, Courier, Novu

Purpose-built, multi-channel, template management included.

Rejected as disproportionate. The routing table is a dozen rows and the channels are two. A vendor with
its own data model, latency and bill, for logic that fits on one screen and needs to be testable inside
our own unit tests, is not a trade worth making at this size.

### F. Chosen: event spine → dispatcher → in-app bell, with WhatsApp for high-value events

## Consequences

### Good

- Notifications and the security audit trail come from **one** append-only source, so they cannot
  disagree about what happened.
- Adding a notification type is a routing-table row and a copy template — a small, testable change with
  no infrastructure work.
- Idempotent replay means dispatcher bugs are recoverable. Fix, replay, done. No dedupe logic, no
  double-notify risk.
- No email infrastructure: no domain reputation, no SPF/DKIM/DMARC, no bounce handling, no spam-folder
  support tickets, no per-message bill.
- WhatsApp for support matches actual customer behaviour in the target market and gives a real human
  channel without building chat.
- The bell serves both audiences with the same mechanism, so the admin queue and the customer feed cannot
  drift in behaviour.
- The routing table is pure data in a Firebase-free package, so notification correctness is verified in
  unit tests rather than end-to-end.

### Bad, and accepted

- **A customer who is not on the site cannot be reached** for anything other than the events we push to
  WhatsApp. For a manual-verification flow this is the sharpest cost: the "your payment was verified"
  moment is the one they are waiting for. Mitigated by putting that event on WhatsApp, and by order status
  always being readable on the account page — so a missed notification is a delay, not a dead end.
- **The dispatcher is a single point of failure for all customer communication.** Mitigated by
  backlog-age alerting, idempotent replay, and the fact that order state is independently readable. But
  when it stalls, customers are uninformed, and they will notice before we do unless the alert threshold
  is tight.
- **No durable record for the customer.** No email in their inbox to search for six months later. The
  account page is the only history, which means account access is a harder dependency than it would
  otherwise be — and account access has its own gap for mobile-only users
  ([ADR-0006](0006-password-identity-without-otp.md)).
- **WhatsApp sends depend on Meta.** Template approval, per-message cost, rate limits, and policy that
  can change. The send step is deliberately independent of notification creation so a WhatsApp failure
  degrades rather than breaks — the bell still updates.
- **Eventual consistency between state and notification.** The order is `paid` a moment before the
  notification exists. Almost always sub-second, but a customer refreshing fast can see a status change
  with no notification. Acceptable; the alternative couples the transaction to the notification.
- **`events` grows without bound.** It is the audit spine, so it cannot be trimmed casually — statutory
  retention applies to the order-related entries. Needs an archival strategy before it becomes a cost or
  a query-performance problem.
- **A malformed event can poison the queue**, blocking every event behind it. Handled in the runbook by
  marking it skipped with a reason rather than deleting it — deletion would destroy replay — but the real
  fix is validation at write time, on the producer.

## Related

- [`NOTIFICATIONS.md`](../NOTIFICATIONS.md) — event catalogue, routing table, copy templates
- [`DATA_MODEL.md`](../DATA_MODEL.md) — `events`, `notifications`
- [`RUNBOOKS.md § dispatcher has stalled`](../RUNBOOKS.md#3-notification-dispatcher-has-stalled)
- [ADR-0006](0006-password-identity-without-otp.md) — no email is what creates the password-reset gap
- [`ROADMAP.md`](../ROADMAP.md) — web push, customer/admin chat
