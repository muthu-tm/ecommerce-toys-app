# Architecture Decision Records

Why things are the way they are. Each record captures the context at the time of the decision, the
alternatives that were genuinely considered, and the consequences we accepted — including the bad ones.

An ADR is **immutable once accepted**. If a decision changes, write a new record that supersedes the old
one and update the old one's status. Editing history to match current opinion destroys the only value
these have: telling a future reader what was known and what was traded away.

| ADR                                           | Decision                                                                 | Status   | Date       |
| --------------------------------------------- | ------------------------------------------------------------------------ | -------- | ---------- |
| [0001](0001-hybrid-backend.md)                | Hybrid backend: Next.js serves reads, Cloud Functions own writes         | Accepted | 2026-09-09 |
| [0002](0002-firestore-search-port.md)         | Firestore search behind a swappable `SearchPort`; Typesense in v1.1      | Accepted | 2026-09-09 |
| [0003](0003-cloudflare-fronting-firebase.md)  | Cloudflare proxies Firebase App Hosting; media stays in Firebase Storage | Accepted | 2026-09-09 |
| [0004](0004-money-in-minor-units.md)          | All money is integer minor units; tax rates in basis points              | Accepted | 2026-09-09 |
| [0005](0005-single-tenant-white-label.md)     | Single-tenant white-labelling with a prepared multi-tenant seam          | Accepted | 2026-09-09 |
| [0006](0006-password-identity-without-otp.md) | Email-or-mobile identity with a password, and no OTP                     | Accepted | 2026-09-09 |
| [0007](0007-notifications-not-email.md)       | In-app notifications from an event spine, plus WhatsApp. No email        | Accepted | 2026-09-09 |

## Writing a new one

Copy the shape of an existing record:

1. **Context** — the forces in play. What is true that makes this a decision rather than an obvious call?
2. **Decision** — what we are doing, stated so someone can act on it.
3. **Alternatives considered** — each one described fairly, with the actual reason it lost. "It was worse"
   is not a reason. If an option was close, say so.
4. **Consequences** — good and bad, with the bad marked as accepted rather than omitted. A record with no
   downsides listed is a record nobody thought hard about.
5. **Related** — links to the docs and tasks this decision governs.

Number sequentially. Add the row to the table above and to the decision log in
[`../PROGRESS.md`](../PROGRESS.md).
