# Local E2E

How to run the whole ROMP stack on one machine and click through it end to end — the
storefront, the backoffice, the API and the Firebase emulators, seeded with the demo
catalogue, plus a Playwright suite that drives the customer and admin happy paths.

There is one command for the common case:

```bash
pnpm e2e start        # bring the stack up, seeded and healthy
pnpm e2e test         # confirm every service is up and functional
pnpm e2e stop         # tear it down
```

---

## Prerequisites

Same as the main quickstart, plus a browser for Playwright:

- Node `>=20.11`, pnpm 9 (`corepack enable`)
- **A JDK 11+** — the Firestore and Storage emulators are Java processes. `pnpm e2e start`
  checks for it and stops with install instructions if it is missing.
  - macOS: `brew install --cask temurin`
  - Linux: `sudo apt-get install default-jdk`
- Playwright's Chromium, once: `pnpm --filter @romp/e2e install:browsers`

```bash
pnpm install
```

---

## The two profiles

The stack runs in one of two profiles, selected with `--profile`:

| Profile              | What it is                                                             | When to use                          |
| -------------------- | ---------------------------------------------------------------------- | ------------------------------------ |
| `emulator` (default) | Fully offline against the Firebase emulators. No real project, no keys | Day-to-day local testing, Playwright |
| `firebase`           | Real Firebase project; web config from your env/`.env.local`           | Verifying against a live backend     |

The **emulator profile is the important one** and needs no configuration — the orchestrator
injects everything (see [`.env.e2e.example`](../.env.e2e.example)). It works because the
browser Firebase SDK is emulator-aware behind a flag: `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true`
routes the client `getAuth`/`getFirestore`/`getStorage` to the local emulators via
`connect*Emulator`, so customer login, the notification bell's realtime listener, and the
backoffice's image upload all run offline. The flag is off by default, so production is never
affected.

To override any emulator-profile value locally, copy `.env.e2e.example` to `.env.e2e` — the
orchestrator layers your overrides on top of the defaults.

---

## The orchestrator: `pnpm e2e`

One command manages the four long-lived services. They run detached, logging to `.e2e/logs/`,
with pids in `.e2e/pids/`, so `start` returns your shell and `stop` finds them again.

| Command                   | What it does                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm e2e start`          | Java preflight → emulators → seed catalogue + admins → API, storefront, admin, each waited on until healthy |
| `pnpm e2e stop`           | Stop every service, clean pid files                                                                         |
| `pnpm e2e restart`        | Stop then start                                                                                             |
| `pnpm e2e status`         | Per-service liveness table; exits non-zero if anything is down                                              |
| `pnpm e2e test`           | Quick smoke: liveness of all four **plus** a functional pass (see below)                                    |
| `pnpm e2e logs <service>` | Print a service log; add `--follow` to tail. Service is one of `emulators`, `api`, `storefront`, `admin`    |

`--profile firebase` on `start`/`restart` runs against a real project and skips the emulators
and seeding.

### What `pnpm e2e test` checks

Two layers, because "the port answers" is not "the service works":

1. **Liveness** — emulator Hub (`:4400`), API `/v1/health` (`:8787`), storefront (`:3000`),
   admin (`:3001`).
2. **Functional** — the API's public cart endpoint returns `200` (proving the API is wired to
   the Firestore emulator), and the storefront home HTML contains a seeded product name
   (proving SSR read the seeded catalogue, not an empty shell).

It exits non-zero and names the failing check, so it is usable as a pre-flight before the
Playwright run.

### Ports

Mirror `firebase.json`: Auth `9099`, Firestore `8181` (not the default `8080`, which collides
with Docker), Storage `9199`, Functions `5001`, Pub/Sub `8085`, Emulator UI `4000`, Hub `4400`.
API `8787`, storefront `3000`, admin `3001`.

Useful URLs once up:

- Storefront — <http://localhost:3000>
- Backoffice — <http://localhost:3001>
- Emulator UI — <http://localhost:4000>

---

## The Playwright suite

Lives in `apps/e2e`. It runs against the **live emulator stack** — start it first.

```bash
pnpm e2e start
pnpm --filter @romp/e2e install:browsers    # once
pnpm --filter @romp/e2e test:e2e
```

Three projects:

- **smoke** — the storefront home renders the seeded catalogue. The cheapest signal the whole
  plumbing works.
- **customer** — register → sign in → browse → add to bag → checkout → place order → submit the
  UPI reference → see the order in account history. A real browser against the real API and the
  emulators.
- **admin** — verify the payment on the order the customer placed, then advance fulfilment, and
  confirm the backoffice order detail shows paid + packed.

The customer flow hands the placed order's id to the admin flow through a file
(`apps/e2e/.e2e-state/`), so they run in order (`admin` depends on `customer`) with a single
worker.

`global-setup` verifies the stack is up before any spec and fails fast with the exact command
to run if it is not — so a down stack reads as "run `pnpm e2e start`", not a 60-second timeout.

Other commands: `test:e2e:ui` (the Playwright UI), `test:e2e:headed` (watch it drive a real
browser), `report` (open the last HTML report).

### A note on admin authentication

The backoffice is login-gated. Against the emulator profile the seeded owner is
`owner@example.com` with password `ADMIN_SEED_PASSWORD` (default `e2e-admin-password-01`,
honoured only when the Auth emulator is the target — see `apps/api/scripts/seed-admins.ts`).

Sign-in in the browser uses the client Firebase SDK pointed at the Auth emulator
(`NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true`). If DevTools shows `identitytoolkit.googleapis.com`
on a Google host rather than `127.0.0.1:9099`, the client bundle did not inline the emulator
flag — that is the failure mode `firebase-emulator.ts` exists to prevent.

Writes that have no UI control yet (payment verification, fulfilment) still go through the
admin API with a role-claimed ID token. The Playwright admin spec signs in through the real
login form, then asserts the backoffice **read** UI.

---

## Running a single app by hand

If you would rather not use the orchestrator, each app reads a standard env file. Copy the
example and run the app:

```bash
cp apps/api/.env.example apps/api/.env.local
cp apps/storefront/.env.example apps/storefront/.env.local
cp apps/admin/.env.example apps/admin/.env.local
```

Then, in separate terminals, with the emulators running (`pnpm emulators`) and seeded
(`pnpm seed --project demo-romp` and `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 pnpm seed:admins`):

```bash
pnpm --filter @romp/api dev
pnpm --filter @romp/storefront dev
pnpm --filter @romp/admin dev
```

The example files document both profiles inline.

---

## Troubleshooting

**"require a Java runtime" on `start`.** No JDK on the PATH. Install one (above), or set
`JAVA_HOME` and add `$JAVA_HOME/bin` to the PATH.

**A port is already in use.** Something else is on `3000`/`3001`/`8787` or an emulator port.
`pnpm e2e status` shows what is up; stop the stray process, or `pnpm e2e stop` if it is a
previous run that did not clean up.

**Browser login "not available" / reads fail.** The client SDK is not in emulator mode. Confirm
`NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true` is set for the storefront/admin process (the orchestrator
sets it; a hand-run app needs it in `.env.local`).

**API calls from the browser are blocked (CORS).** The storefront/admin origin must be in the
API's `CORS_ORIGINS`. The emulator profile sets `http://localhost:3000,http://localhost:3001`.

**Admin API calls 401/403 right after seeding.** Custom claims propagate on the next token
refresh. Sign out and in (or force-refresh the token). The Playwright admin flow mints a fresh
token each run, so it is unaffected.

**Playwright fails immediately with "stack is not ready".** Run `pnpm e2e start` (and
`pnpm e2e test` to confirm green) before `test:e2e`.
