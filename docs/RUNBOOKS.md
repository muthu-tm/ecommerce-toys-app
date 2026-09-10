# Runbooks

Operational procedures for when things break. Each runbook states the **symptom** first, because that
is what you have at 2 a.m. — not a diagnosis.

Status of this document: the structure and decision logic are final; commands and dashboard links are
filled in as the corresponding phase ships. Placeholders are marked `TBD (Task N)` so nothing reads as
complete when it isn't.

---

## How to use these

Every runbook follows the same shape:

1. **Symptom** — what you observed or what alerted.
2. **Impact** — who is affected and how badly. This decides whether you fix it now or at 9 a.m.
3. **Diagnose** — narrowing steps, cheapest first.
4. **Mitigate** — stop the bleeding. Often not the same as fixing it.
5. **Fix** — the actual repair.
6. **Verify** — how you know it worked.
7. **Follow up** — what to write down, what to change so it does not recur.

Two standing rules:

- **Mitigate before you diagnose** when customers are losing money or orders. Understanding can wait;
  a broken checkout cannot.
- **Never edit Firestore by hand in production** unless the runbook says to. A manual write skips the
  transaction that maintains the ledger and the event spine, so the fix silently creates a second
  inconsistency. Use the documented script or the admin UI.

### Severity

| Sev | Meaning                                       | Response                           |
| --- | --------------------------------------------- | ---------------------------------- |
| 1   | Customers cannot order, or money is at risk   | Immediate, page whoever is on call |
| 2   | A major flow is degraded; a workaround exists | Same day                           |
| 3   | Internal or cosmetic; no customer impact      | Next working day                   |

---

## 1. Payment verification backlog

**Symptom.** The pending-verification queue depth alert fired, or the admin dashboard shows orders
awaiting verification older than the SLA.

**Impact.** Sev 2 rising to Sev 1. Customers have paid and are waiting. Reservations expire on a timer
— if verification does not happen before expiry, paid orders start auto-cancelling and releasing
stock, which turns a delay into a refund queue.

**Diagnose.**

1. Is it volume or is it absence? Check the count of verifications completed in the last hour. Zero
   completions with a rising queue means nobody is working it; steady completions with a rising queue
   means a genuine spike.
2. Check whether proof submissions are also spiking — a bot submitting garbage proofs looks identical
   to a sales spike in queue depth. Group pending proofs by account; one account with many is abuse.
3. Confirm the reservation TTL and how much headroom remains on the oldest pending order.

**Mitigate.**

- Extend the reservation TTL for pending-verification orders so nothing auto-cancels while you catch
  up. This is a `settings/checkout` change, not a code deploy. `TBD (Task 17)` — exact field and
  bounds.
- If the cause is abuse, tighten the per-account proof-submission rate limit and block the offending
  accounts.

**Fix.** Staff the queue. Verification is ordered oldest-first by design so the SLA breach shrinks
rather than being ignored.

**Verify.** Queue depth trending down; oldest pending age below the alert threshold; no order
auto-cancelled while paid.

**Follow up.** If a genuine volume spike caused this, the answer is not more heroics — it is either
more verification staff or the payment gateway that closes this whole class of problem
([`ROADMAP.md`](ROADMAP.md)).

---

## 2. Reservation sweeper is not running

**Symptom.** The **sweeper backlog age** alert fired: the oldest expired-but-unreleased reservation is
older than it should be. Note that the alert is on non-execution, not on errors — a sweeper that has
stopped throws nothing, which is exactly why error-rate alerting would miss this.

**Impact.** Sev 1. Expired reservations hold stock that no order will ever claim. Products show as
out of stock while inventory sits on the shelf. Revenue loss is silent and compounding.

**Diagnose.**

1. Did the scheduled Function execute on schedule? Check the last successful invocation timestamp.
   `TBD (Task 17)` — log query.
2. If it executed, did it error, or did it run and release nothing? A clean run with zero releases and
   a non-zero backlog means the query is not matching the documents it should — usually a timestamp
   type or timezone mistake.
3. If it did not execute, check the Cloud Scheduler job state (paused? deleted? failing to
   authenticate?).

**Mitigate.** Trigger the sweeper manually. It is idempotent by construction — it releases only
reservations already past expiry, and it writes the ledger entry and the release in one transaction,
so a second run is a no-op. `TBD (Task 17)` — invocation command.

**Fix.** Depends on the diagnosis: re-enable or recreate the scheduler job, or fix and deploy the
query.

**Verify.** Backlog age returns to near zero. Then run the oversell reconciliation below — while the
sweeper was down, available-stock figures were wrong, and something may have been sold that should
not have been.

**Follow up.** Confirm the alert fired at the right time. If the backlog grew for hours before
alerting, the threshold is too loose.

---

## 3. Notification dispatcher has stalled

**Symptom.** Dispatcher backlog-age alert: undispatched `events` documents are accumulating. Or a
customer reports that their order status changed but the bell never updated.

**Impact.** Sev 2. With no email, in-app notifications are the only push channel — a stalled
dispatcher means customers are not being told their payment was verified or their order shipped. Order
state itself is still correct and visible on the account page, which bounds the damage: this is a
communication outage, not a data outage. Say that plainly if customers ask.

**Diagnose.**

1. Last successful dispatcher invocation. Is this non-execution or failure?
2. If failing, is it failing on **every** event or on one poisonous document? A single malformed event
   blocking the queue behind it is the common case.
3. Check whether the failure is in notification creation (Firestore write) or in the WhatsApp send
   step. They fail independently and only one is customer-visible in the bell.

**Mitigate.** For a poison event, mark it as skipped with the reason recorded so the queue drains,
then handle it separately. Do not delete it — the `events` collection is the append-only audit spine
and deleting an entry destroys the ability to replay.

**Fix.** Deploy the fix, then **replay** the affected events. Replay is safe: notification IDs are
derived deterministically from `(eventId, audience, recipient)`, so re-processing an event overwrites
the same document instead of creating duplicates. That determinism exists precisely so this runbook can
say "just replay it".

Replay re-runs the dispatch logic directly rather than re-writing the event — the trigger is
`onDocumentCreated`, which fires on creation only, so touching an existing `events` document would not
re-fire it (and must not, since the append-only spine is never rewritten). The replay path is therefore
to call the dispatch decision itself over the affected events: `dispatchStoredEvent`
(`apps/api/src/notifications/dispatcher.ts`) is the pure step the trigger wraps, and re-running it for
an event writes the same deterministic notification IDs with `set`, so a re-dispatch is an overwrite,
never a duplicate.

`measureDispatchBacklog` (`apps/api/src/notifications/backlog.ts`) identifies the events to replay: it
returns the oldest undispatched event's age and the undispatched count, skipping the events the routing
table sends to nobody. Until the admin surface exists to expose replay as an audited action, this is a
one-off script run against the target project that reads the undispatched events and calls
`dispatchStoredEvent` for each. `TBD (Task 24)` — wire replay as a callable/admin action with the alert
policies, so it is not an ad-hoc script.

**Verify.** Backlog age at zero. Spot-check one affected customer's notification feed for the missing
entries, and confirm no customer received the same notification twice.

**Follow up.** If the cause was a malformed event, the producer needs validation at write time, not
just the consumer.

---

## 4. Oversell reconciliation

**Symptom.** Physical stock is lower than the system says, or a warehouse reports being unable to
fulfil a confirmed order, or you are running this after a sweeper outage.

**Impact.** Sev 1 if orders are unfulfillable. Sev 2 if the discrepancy is only on paper.

**Diagnose.**

1. Reconstruct expected stock from `inventoryLedger` for the affected variant. The ledger is the
   source of truth for movement; `inventory` is a materialised balance. If they disagree, the ledger
   wins and the balance is wrong.
2. Sum active reservations for the variant. Confirm each maps to an order in a state that should still
   be holding stock.
3. Identify the divergence point in time. Compare against the sweeper outage window, a deploy, or a
   manual inventory edit. Run the reconciliation script to see the per-warehouse ledger-vs-balance
   diff in one place:

   ```sh
   pnpm --filter @romp/data reconcile:variant --variant <SKU> --project <projectId>
   ```

   It sums the ledger per warehouse, compares it to the stored balance, and prints the divergence.
   It is read-only without `--fix`, so it is safe to run against production while you diagnose.

**Mitigate.** Set the variant's available quantity to the physically verified number immediately so no
further orders are accepted against phantom stock. Take this figure from the warehouse, not from the
ledger — the point is to stop selling what you do not have.

**Fix.**

- Correct the balance with a `reconciliation` adjustment, not an edit. The script's `--fix` flow does
  exactly this — it writes a ledger entry whose delta moves the warehouse to the physical count, in
  one transaction with the balance:

  ```sh
  pnpm --filter @romp/data reconcile:variant --variant <SKU> --project <projectId> \
    --fix --warehouse <id> --count <physically verified number> --note "<incident ref>"
  ```

  An operator can do the same from the admin inventory editor by entering the signed delta with
  reason `reconciliation`. Either way it is an entry, never an edit — the ledger is append-only.

- Release orphaned reservations individually, each with a ledger entry.
- For orders already confirmed that cannot be fulfilled: contact the customer over WhatsApp, then
  cancel and refund via the admin UI. Do not simply cancel — a paid order that vanishes without
  contact is worse than the oversell.

**Verify.** Ledger sum equals the physical count equals the `inventory` balance. No active reservation
lacks a corresponding live order.

**Follow up.** Every oversell traces to a specific mechanism. Name it in the incident note. If it was
a manual inventory edit, that path needs a guard.

---

## 4b. Category facet-count drift

**Symptom.** A category's product count in the storefront sidebar looks wrong — more or fewer than the
products actually listed under it, or a stale number after a bulk catalogue change.

**Impact.** Sev 3, cosmetic. The count is a denormalised facet number, not a gate on anything; a wrong
count misleads a browsing customer but blocks no purchase and corrupts no order.

**Diagnose.** `categories.productCount` is maintained by the `categoryProductCounter` Function on every
product write. Because it is applied as an increment, a Function retry or a manual product edit can
make it drift. Run the reconciliation, which recomputes each count from the `active` products actually
filed under the category and its children:

```sh
pnpm --filter @romp/data reconcile:categories --project <projectId>
```

It is read-only without `--fix`, so it is safe to run against production. A single category can be
checked with `--slug <slug>`.

**Fix.** Re-run with `--fix` to write the corrected numbers:

```sh
pnpm --filter @romp/data reconcile:categories --project <projectId> --fix
```

**Verify.** A second read-only run reports every category balanced (stored equals actual).

**Follow up.** Persistent drift points at a Function that is retrying and double-counting; check its
logs for `category.count.failed` and the invocation retry pattern before assuming the counter logic
is wrong.

---

## 5. Refund gone wrong

**Symptom.** A refund was issued to the wrong account, for the wrong amount, twice, or was marked
complete without money actually moving. Refunds are manual UPI transfers, so all four are possible.

**Impact.** Sev 1. Direct financial loss or a customer out of pocket.

**Diagnose.**

1. Read the `refunds` document and the order's event history. Every refund records the actor,
   the amount, the destination, and the reference.
2. Compare against the bank statement. The system's record of a refund is an assertion by an admin;
   the statement is the fact.
3. Determine the class: **not sent** (marked complete, no transfer), **sent twice**, **wrong amount**,
   or **wrong recipient**.

**Mitigate.** Suspend further refund processing for the affected order so a second admin does not
compound it.

**Fix.**

| Class           | Action                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not sent        | Send the transfer, then record the real reference against the existing refund record. Do not create a second refund record                                                             |
| Sent twice      | Record the duplicate as a separate entry with reason `duplicate_refund`. Recovery is a commercial conversation with the customer; the accounting must reflect what happened either way |
| Wrong amount    | Record an adjustment entry for the difference, in the correct direction. Never edit the original amount                                                                                |
| Wrong recipient | Treat as loss pending recovery. Issue the correct refund to the customer — they should not wait on your bank's recovery process                                                        |

Recording an adjustment rather than editing history is not bureaucracy: an edited refund amount means
the ledger no longer reconciles with the bank statement, and the next person cannot tell whether the
discrepancy is a bug or a correction.

**Verify.** Refund records for the order sum to the amount that actually left the bank account. Order
state is terminal and correct. Customer notified.

**Follow up.** Refunds require the `owner` claim for exactly this reason. If a wrong-recipient refund
happened because the destination was typed by hand, the UI should be pre-filling it from the order's
payment record.

---

## 6. Password reset for a mobile-only account

**Symptom.** A customer who registered with a mobile number cannot log in and has no email on file, so
Firebase's own reset email is not available to them. This is a known, accepted gap
([ADR-0006](adr/0006-password-identity-without-otp.md)).

**Impact.** Sev 3 individually. Sev 2 if several arrive at once, which usually indicates a login bug
rather than forgetfulness — check that before treating it as a support task.

**Diagnose.** Confirm it is genuinely this case and not a normalisation bug: verify the account exists
for the E.164 form of the number they gave. A customer entering `9845021174` and
`+91 98450 21174` must reach the same account; if they do not, this is a Sev 2 bug in
`normalizePhone()`, not a reset request.

**Procedure.** This is a social-engineering target, so the steps are constraints, not suggestions.

1. **Verify identity out of band.** Ask for a recent order number _and_ one detail from it that is not
   on the order confirmation the attacker might have — the delivery landmark, or the last four digits
   of the UTR they paid with. Never accept the mobile number itself as proof of identity; the whole
   scenario is that someone is claiming to own it.
2. Generate a single-use, short-TTL reset link from the admin UI. `TBD (Task 10)`.
3. The link is sent by WhatsApp **to the number on file**. It is never sent to a number supplied in the
   request, read aloud, or pasted into a chat with the requester. This single constraint carries most
   of the security of the flow: the attacker must already control the registered number.
4. The action is audited with the acting admin's uid and rate-limited per account.

**Verify.** Customer can log in. The audit event exists with the correct actor. The link is expired or
consumed.

**Follow up.** Count these. Volume is the business case for WhatsApp Business API OTP in v1.1, which
removes the human from the loop entirely.

---

## 7. Deploy rollback

**Symptom.** Error rate, latency or Core Web Vitals degraded after a deploy; or a functional
regression was reported.

**Impact.** Assume Sev 1 until measured.

**Decide first: roll back or roll forward?** Roll back by default. Roll forward only when the fix is
understood, one line, and already written — "I know what it is" is not the same as having the fix
tested.

**Procedure.**

1. **Frontends** (storefront, admin — Firebase App Hosting): App Hosting keeps previous builds, so
   this is a traffic re-point rather than a rebuild.

   ```bash
   # What is deployed now, and what came before it
   pnpm firebase apphosting:rollouts:list --project romp-prod --backend storefront

   # Re-point at a known-good build
   pnpm firebase apphosting:rollouts:create --project romp-prod \
       --backend storefront --build <BUILD_ID>
   ```

   The backends are created in Task 5; until then there is no frontend to roll back. If the console
   is faster under pressure, use it — App Hosting > backend > Rollouts > redeploy. Nothing here
   depends on using the CLI.

2. **Functions**: redeploy from the previous release tag. Functions have no traffic-splitting
   rollback, so this is a real deploy and takes minutes, not seconds. Plan for that gap.

   ```bash
   git checkout <previous-tag>
   pnpm install --frozen-lockfile
   pnpm firebase deploy --project romp-prod --only functions
   ```

3. **Firestore rules and indexes**: rules roll back with a redeploy from the tag.

   ```bash
   pnpm firebase deploy --project romp-prod --only firestore,storage
   ```

   **Index deletions do not roll back cheaply** — a rebuilt index takes as long as the data requires.
   Treat index changes as forward-only and additive.

4. **Data migrations**: if the bad release migrated data, rolling back code does not roll back data.
   Every migration ships with its reverse, and the reverse is run before the code rollback. A
   migration without a tested reverse should not have been deployed.

**Verify.** Error rate and latency back to baseline. Reproduce the original report and confirm it is
gone. Confirm no half-migrated documents remain.

**Follow up.** Why did the PR gate not catch it? The answer is a test, in the tier that would have
caught it.

---

## 8. Cloudflare or DNS incident

**Symptom.** The site is unreachable, serving certificate errors, or Cloudflare is returning 5xx while
the origin is healthy.

**Impact.** Sev 1.

**Diagnose.** Determine whether the origin is healthy independently of the edge. If the origin serves
correctly on its Firebase-provided hostname, the problem is at the edge or in DNS, and origin
debugging is wasted time.

**Mitigate.** Grey-cloud the affected record — DNS-only, bypassing the proxy. The site loses edge
caching and WAF but comes back. That trade is correct during an outage.

**Watch out.** Certificate ordering matters and is not reversible for free. The domain must be
verified with Firebase **grey-clouded first**, then proxied with SSL mode **Full (strict)**. Enabling
the proxy before verification completes breaks certificate issuance, and recovering means waiting out
propagation and re-verification. [ADR-0003](adr/0003-cloudflare-fronting-firebase.md) explains why
this order exists. `TBD (Task 23)` — cutover checklist with the exact record set.

**Verify.** Both apex and admin hostnames resolve, serve a valid certificate, and return 200. Cache
headers are as expected once re-proxied.

---

## 9. Suspected credential compromise

**Symptom.** Anomalous login pattern, a customer reporting activity they did not perform, or a leaked
credential list.

**Impact.** Sev 1 for an admin account. Sev 2 for a customer account.

**Procedure.**

1. **Admin account** — clear the role claim **and** call `revokeRefreshTokens(uid)`. Clearing the
   claim alone is insufficient: an already-issued ID token carries the old claim for up to an hour.
   Admin routes verify revocation on every request specifically so this step takes effect immediately.
2. **Customer account** — revoke refresh tokens and force a password reset.
3. Review the actor's `events` entries for the compromise window. Verifications, refunds, price
   changes and inventory adjustments all carry the actor uid, so the blast radius is enumerable rather
   than guessed.
4. Reverse unauthorised state changes through normal flows, each producing its own audit entry.

**Verify.** Sessions terminated. No further activity from the actor. Reversals recorded.

**Follow up.** With no MFA in v1.0, prevention here is limited to password strength and revocation
speed. A repeat incident is the trigger to pull admin MFA forward from the roadmap.

---

## 10. Restore from backup

**Symptom.** Data loss or corruption at a scale that reconciliation cannot fix.

**Impact.** Sev 1.

**Before anything else: stop the writes.** Restoring while the corrupting process is still running
produces a second, worse corruption. Disable the offending Function or put the app in a read-only mode
first.

**Procedure.**

1. Identify the last known-good point in time.
2. Restore to a **separate** Firestore database or project and inspect it there. Never restore over
   live data as the first move — you cannot un-restore.
3. Determine the delta: writes between the restore point and now that are legitimate and must be
   preserved. Orders placed in that window are real money; they cannot be discarded silently.
4. Merge forward deliberately, collection by collection, with the ledger and event spine as the
   reference for what actually happened.

`TBD (Task 24)` — backup schedule, retention, and the exact export/import commands, plus the restore
drill result. **A backup that has never been restored is a hypothesis.** The drill is part of Task 24,
not optional.

---

## 11. Data deletion request

**Symptom.** A customer requests deletion of their personal data.

**Impact.** Sev 3, but time-bound — respond within a stated window.

**Procedure.**

1. Verify identity as in runbook 6. Deletion is destructive and irreversible; identity verification
   matters more here, not less.
2. Delete the Firebase Auth user and the `identityIndex` entry.
3. Redact `users/{uid}` to `{ deletedAt, deletionReason }`.
4. Delete payment-proof files from Storage.
5. **Do not delete orders.** Statutory retention wins. Redact the address snapshot on each order and
   replace the customer name with `Deleted customer`. Amounts, UTRs and verification decisions remain
   — they are financial records, not personal preference.
6. Record the request and the completion.

**Verify.** The identifier can no longer log in and can be re-registered as new. No personal fields
remain outside the retained order records. See [`SECURITY.md § PII map`](SECURITY.md#6-pii-map) for the
field-by-field list.

Manual in v1.0 by design; automation is a roadmap item.

---

## 12. Seeding or reseeding a store

**Symptom.** A new project needs its warehouses, categories, settings and starting catalogue; or a
store config change needs pushing into Firestore.

**Impact.** Sev 3 on a dev project. **Potentially Sev 1 on production** — read the guards below before
running anything with `--reset`.

**Procedure.**

1. Dry-run first, always. It prints exactly the document set that will be written and touches nothing:

   ```
   pnpm seed --store romp --project romp-dev --dry-run
   ```

   The plan printed is the same object the writer consumes, so this is the outcome rather than an
   approximation of it.

2. Apply it:

   ```
   pnpm seed --store romp --project romp-dev
   ```

   Re-running is safe. Every seeded document ID is a natural key
   ([`DATA_MODEL.md § seeded document IDs`](DATA_MODEL.md#seeded-document-ids)), so a second run
   updates the same documents instead of creating a second catalogue. `settings/checkout` and
   `counters/orderHumanId` are skipped if they exist — the run reports how many it left alone.

3. Against the emulators, `pnpm seed:emulator` starts Firestore, seeds `demo-romp`, and shuts down.

**Guards you will hit, and what they mean.**

- **"Refusing to seed: N inventory documents have reserved stock."** Live orders exist. Seeding writes
  `reserved: 0`, which would release units without releasing the orders holding them, so two customers
  could buy the same one. Cancel or fulfil the outstanding orders first, or seed a fresh project. The
  run aborts having written nothing.
- **"Refusing to --reset."** `--reset` deletes every document in `products`, `categories`,
  `warehouses`, `inventory` and `inventoryLedger`. It is permitted only against the emulators, a
  `demo-` project, or a project whose ID ends in `-dev`. There is no override flag, deliberately: if
  production genuinely needs clearing, that is a restore from backup (runbook 10), not a seed flag.
- **A validation failure naming a field path.** A document failed its schema before anything was
  written. The message names the collection, the document and the field.
- **"references things the store config does not have."** A product in `seed.catalogue.ts` points at a
  category, age band or warehouse code the config does not define. Every mismatch is reported in one
  pass with the valid values listed.

**Verify.** The storefront lists products, a product page renders with a price and a variant selector,
and the admin inventory screen shows stock per warehouse. `settings/checkout` still holds whatever fee
values were in effect before the run, and `counters/orderHumanId` is unchanged.

**Never** run a seed as a way to fix a data problem in production. It writes the repo's view of the
world over whatever is there, and for anything other than the seed-owned collections that view is
already stale.

---

## Alert inventory

The alerts these runbooks respond to. Wired up in Task 24; listed here so the runbooks are not
referencing alerts nobody agreed to build.

| Alert                     | Condition                                                    | Runbook | Why this signal                                                 |
| ------------------------- | ------------------------------------------------------------ | ------- | --------------------------------------------------------------- |
| Verification queue depth  | Pending verifications above threshold, or oldest exceeds SLA | 1       | Ops capacity, not system health                                 |
| Sweeper backlog age       | Oldest expired-unreleased reservation exceeds threshold      | 2       | **Non-execution** is the failure mode; error rate would be zero |
| Dispatcher backlog age    | Oldest undispatched event exceeds threshold                  | 3       | Same reasoning: a stalled dispatcher throws nothing             |
| API error rate            | 5xx rate above baseline                                      | 7       |                                                                 |
| API latency               | p95 above threshold                                          | 7       |                                                                 |
| Function crash loop       | Repeated invocation failures                                 | 3, 7    |                                                                 |
| Storage upload rejections | Spike in magic-byte mismatches                               | —       | Probe for the upload path                                       |
| Auth failure rate         | Spike in failed logins per identifier                        | 9       | Credential stuffing                                             |
| Budget                    | Spend above monthly threshold                                | —       | Runaway reads are usually a missing index or a loop             |

`TBD (Task 24)` — thresholds and notification channels.
