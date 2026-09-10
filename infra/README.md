# `@romp/infra`

Firebase security rules, Firestore indexes, environment provisioning scripts, and the emulator-backed
tests that prove the rules do what [`../docs/SECURITY.md`](../docs/SECURITY.md) says they do.

This package ships no JavaScript. Its artefacts are `.rules` files and index definitions, so it has no
coverage gate — correctness is asserted behaviourally, with an allow case and a deny case per rule,
rather than by counting lines.

## Layout

```
infra/
├── firestore.rules           the read/write matrices from docs/SECURITY.md
├── firestore.indexes.json    composite indexes, index exemptions, TTL policies
├── storage.rules             product media, payment proofs, store assets
├── tests/
│   ├── emulator-smoke.test.ts   emulators up, Admin SDK works, rules file loaded
│   ├── seed.test.ts             `pnpm seed` against a real Firestore, twice
│   ├── repositories.test.ts     @romp/data repositories and the SearchPort, real queries
│   ├── indexes.test.ts          every query shape the code builds has a declared index
│   ├── storage-rules.test.ts    the storage matrix
│   ├── rules/
│   │   ├── catalogue.test.ts            public reads: products, variants, categories, reviews, settings
│   │   ├── user-scoped.test.ts          users, addresses, wishlist, carts, orders, refunds
│   │   ├── notifications.test.ts        the entire client write surface
│   │   ├── staff-and-server-only.test.ts inventory, warehouses, ledger, events, guards, counters
│   │   └── coverage.test.ts             the rules file agrees with @romp/data and @romp/contracts
│   └── helpers/
│       ├── emulator.ts          endpoints and rules-file loading
│       └── rules-env.ts         the six callers and a fixture writer
└── scripts/
    ├── run-emulator-tests.mjs   test runner (starts emulators, preflights Java)
    ├── setup-projects.sh        provision a Firebase environment
    └── setup-wif.sh             wire GitHub Actions auth without a service-account key
```

`firebase.json` and `.firebaserc` live at the **repo root**, not here. The Firebase CLI treats the
directory containing `firebase.json` as the project root, and the Functions `source` field cannot
point outside it — so with the config in `infra/`, `apps/api` would be unreachable. The rules and
index files stay here and the root config references them by path.

## Prerequisites

**A JDK (11 or newer).** The Firestore and Storage emulators are Java processes. Without one,
`pnpm test` fails with an actionable message rather than a stack trace.

```bash
brew install --cask temurin      # macOS
sudo apt-get install default-jdk # Debian/Ubuntu
```

CI installs it with `actions/setup-java` — see `.github/actions/setup/action.yml`.

## Commands

| Command                          | What it does                                          |
| -------------------------------- | ----------------------------------------------------- |
| `pnpm --filter @romp/infra test` | Starts the emulators, runs the suite, shuts them down |
| `pnpm test:rules`                | Same thing, from the repo root                        |
| `pnpm emulators`                 | Long-running emulator suite for local development     |
| `pnpm verify`                    | Includes the above as part of the workspace gate      |

The suite runs against project `demo-romp`. The `demo-` prefix is meaningful to the emulators: it
forces fully offline operation, so the tests cannot reach a real project even if credentials happen to
be present in the environment.

## Ports

| Emulator    | Port     |                                                                                                  |
| ----------- | -------- | ------------------------------------------------------------------------------------------------ |
| Firestore   | **8181** | Not the Firebase default of 8080, which collides with Docker, Spring, and most local API servers |
| Auth        | 9099     | default                                                                                          |
| Storage     | 9199     | default                                                                                          |
| Emulator UI | 4000     | default — http://127.0.0.1:4000                                                                  |
| Hub         | 4400     | default                                                                                          |
| Logging     | 4500     | default                                                                                          |

Functions and Pub/Sub emulators join the suite in Task 10, alongside `apps/api`. They are absent
rather than declared-and-idle so that `firebase emulators:start` does not report configuration for
something that does not exist.

## Provisioning an environment

Requires `gcloud` and `firebase` authenticated, and a billing account. Both scripts are idempotent —
re-running after a partial failure is the intended recovery path.

```bash
cd infra/scripts

# 1. Create and configure the project: APIs, Firestore in asia-south1,
#    Email/Password-only auth, deny-all rules deployed.
./setup-projects.sh romp-dev asia-south1

# 2. Let GitHub Actions deploy to it, with no service-account key.
./setup-wif.sh romp-dev <owner>/<repo> development
```

Then the same pair for `romp-prod` with `production`.

Three things the scripts cannot do, and will tell you about:

1. **Linking a billing account.** Blaze is required for Functions, App Hosting, and any outbound HTTP
   call.
2. **Choosing the Firestore location.** It is permanent. A wrong choice means a new project, not a
   migration.
3. **Setting required reviewers on the GitHub `production` environment.** `environment: production` in
   the workflow pauses for approval only because the environment says to. Until a reviewer is added,
   `deploy-prod.yml` deploys straight through — the approval gate does not exist.

## Writing rules

Two constraints, from [ADR-0001](../docs/adr/0001-hybrid-backend.md):

- **Rules are a firewall, not a validator.** They enforce _who_ and _shape_. Business invariants —
  stock, pricing, state transitions — live in Cloud Functions transactions, because rules cannot
  transactionally read another document.
- **The Admin SDK bypasses rules entirely.** Server-side reads in Next.js and Cloud Functions are not
  protected by anything in this directory. They must filter by the authenticated `uid` themselves.
  There is no second line of defence, which is why ownership is an explicit repository parameter
  rather than ambient state.

Every row of the read/write matrices in [`../docs/SECURITY.md`](../docs/SECURITY.md) has at least one
allow-case and one deny-case test. An untested rule is an assumption.

### The rules file cannot import TypeScript

Security rules are their own language, so every collection name and every status literal in
`firestore.rules` is a hand-copied string. A rename on the TypeScript side leaves the rules file
pointing at a collection that no longer exists — and that does not error. It denies access to a
collection nobody uses while leaving the real one covered only by the catch-all.

`tests/rules/coverage.test.ts` is what stands between a rename and that outcome. It reads the rules
file as text and asserts:

- every entry in `COLLECTIONS` and `SUBCOLLECTIONS` from `@romp/data` has a `match` block;
- `PUBLIC_PRODUCT_STATUS`, `PUBLIC_REVIEW_STATUS` and `CHECKOUT_SETTINGS_ID` from `@romp/contracts`
  appear verbatim;
- there are exactly **two** `allow update` statements in the whole file, both on notifications, which
  is what keeps the client-write-surface claim in the docs true;
- every `allow create` and `allow delete` is `if false`;
- the role is read from `request.auth.token`, and no rule calls `get()` on a `users` document.

Textual assertions are unusual, and they are the point: the rules file is text, and text is what has to
be checked.

### The emulator creates indexes; production does not

Worth knowing before trusting a green integration test. The Firestore emulator builds whatever
composite index a query needs, on demand. Production rejects the query with `FAILED_PRECONDITION` and
a console link instead.

So `tests/repositories.test.ts` passing tells you a query is well-formed and returns the right
documents — it tells you **nothing** about whether the query can run in production.
`tests/indexes.test.ts` closes that gap statically: it drives the real search adapter through a
recorder, reads back the clauses it built, and matches them against `firestore.indexes.json`. It also
asserts the negative — that the matcher rejects an index missing a field, one whose ordering fields are
not trailing, and one for a different collection — because a coverage check that cannot fail is a green
light on an empty index file.

### Tests run one file at a time

`fileParallelism: false` in `vitest.config.ts`. Every suite here talks to the same Firestore emulator
instance and clears the database between tests; in parallel, one file's `clearFirestore()` deletes the
fixtures another is midway through asserting on. The symptom is a test that fails only when run
alongside its neighbours, which is the kind of flake that gets a suite retried rather than fixed.
