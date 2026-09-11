# ROMP — white-label toy-commerce platform

A production-grade, India-first commerce platform for toy retail. It ships as **ROMP**, but the
brand, palette, typography, copy, locale, feature set, warehouses and catalogue are all
configuration — a second store is a config directory and a deploy, not a fork.

- **Storefront** — public, SEO-critical, image-heavy, animated, responsive.
- **Backoffice** — internal operations: catalogue, inventory, orders, payment verification.
- **API** — all writes and async work, on Cloud Functions.

Payments are **UPI-only with manual verification**: the customer pays against a per-order QR that
encodes the exact amount and order reference, submits the UTR, and an admin verifies it. There is no
payment gateway and no COD. Customer communication is **in-app notifications plus WhatsApp** — the
platform sends no email.

---

## Documentation

Start here, in this order:

| Document                                         | What it covers                                                  |
| ------------------------------------------------ | --------------------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)   | Request topology, read/write split, caching, deployment         |
| [`docs/V1_SCOPE.md`](docs/V1_SCOPE.md)           | Exactly what v1.0 includes, screen by screen                    |
| [`docs/FEATURES.md`](docs/FEATURES.md)           | Full feature inventory: v1.0 / excluded / roadmap               |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)             | v1.1+ backlog with sequencing and rationale                     |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)       | Every collection, field, index and invariant                    |
| [`docs/API.md`](docs/API.md)                     | Endpoint inventory and OpenAPI generation                       |
| [`docs/WHITE_LABEL.md`](docs/WHITE_LABEL.md)     | Every config knob and how to create a new store                 |
| [`docs/IDENTITY.md`](docs/IDENTITY.md)           | Email/mobile login, admin seeding, password reset               |
| [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md) | Event → notification routing, audiences                         |
| [`docs/SECURITY.md`](docs/SECURITY.md)           | Rules model, PII map, threat notes                              |
| [`docs/RUNBOOKS.md`](docs/RUNBOOKS.md)           | Operational procedures for when things break                    |
| [`docs/LOCAL_E2E.md`](docs/LOCAL_E2E.md)         | Run the whole stack locally and drive the Playwright E2E suite  |
| [`docs/PROGRESS.md`](docs/PROGRESS.md)           | Living build checklist                                          |
| [`docs/adr/`](docs/adr/)                         | Architecture Decision Records — why things are the way they are |

---

## Quickstart

Requires Node `>=20.11` (see `.nvmrc`), pnpm 9, and a **JDK 11+** — the Firestore and Storage
emulators are Java processes, and the security-rules suite is part of `pnpm verify`.

```bash
nvm use                          # or install Node 20.11+
corepack enable                  # provides the pinned pnpm
brew install --cask temurin      # JDK; apt-get install default-jdk on Linux
pnpm install
pnpm verify                      # lint + typecheck + test across the workspace
```

`pnpm verify` is the gate CI runs. If it is green locally, CI should be green.

Working on the emulators directly:

```bash
pnpm emulators      # long-running suite; UI at http://127.0.0.1:4000
pnpm test:rules     # start emulators, run the rules suite, shut down
pnpm seed:emulator  # start Firestore, seed demo-romp, shut down
```

Firestore is on port **8181** rather than the Firebase default 8080, which collides with Docker and
most local API servers. Everything else is on its default port.

Running the whole stack for end-to-end testing:

```bash
pnpm e2e start                        # emulators + seed + api + storefront + admin, all healthy
pnpm e2e test                         # confirm every service is up and functional
pnpm --filter @romp/e2e test:e2e      # the Playwright customer + admin happy paths
pnpm e2e stop                         # tear it down
```

One command brings the full stack up, seeded and health-checked, against the Firebase emulators —
fully offline, no real project. See [`docs/LOCAL_E2E.md`](docs/LOCAL_E2E.md) for the profiles,
the orchestrator commands, and troubleshooting.

---

## Workspace map

```
romp/
├── apps/
│   ├── storefront/        Next.js — example.com          (SSR/ISR public reads)
│   ├── admin/             Next.js — admin.example.com    (client-heavy, no SEO)
│   ├── api/               Fastify on Cloud Functions v2 — api.example.com
│   └── e2e/               Playwright — customer + admin happy paths (local only)
├── packages/
│   ├── contracts/         Zod schemas → shared types, OpenAPI source of truth
│   ├── core/              Domain logic: pricing, state machines, routing. Zero I/O.
│   ├── data/              Firestore repositories, converters, SearchPort
│   ├── store-config/      White-label config schema, loader, token emitter
│   ├── ui/                Design system, motion primitives, a11y components
│   ├── observability/     Logger, AppError taxonomy, correlation IDs
│   └── config/            ESLint / TypeScript / Vitest / Prettier presets
├── stores/
│   ├── romp/              store.config.ts, assets/, fonts/
│   └── _template/         Scaffold for `pnpm store:new`
├── infra/                 Rules, indexes, emulator tests, provisioning scripts
├── docs/                  Architecture, scope, roadmap, runbooks, ADRs
├── firebase.json          Must be at the root: the Firebase CLI resolves the
├── .firebaserc            Functions `source` path relative to this file
└── .github/workflows/     CI: PR gate, dev deploy, tagged prod deploy
```

**`packages/core` imports no Firebase.** That constraint is what keeps the domain unit-testable in
milliseconds and lets the search backend be swapped without touching business logic.

---

## Common commands

| Command                              | Purpose                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| `pnpm verify`                        | Lint, typecheck and test everything — the CI gate             |
| `pnpm dev`                           | Run all dev servers                                           |
| `pnpm lint` / `pnpm lint:fix`        | ESLint across the workspace                                   |
| `pnpm typecheck`                     | `tsc --noEmit` per package                                    |
| `pnpm test`                          | Vitest, unit + emulator integration                           |
| `pnpm test:coverage`                 | Enforce the coverage floor (see `packages/config/policy.mjs`) |
| `pnpm test:rules`                    | Security-rules suite against the emulators                    |
| `pnpm emulators`                     | Long-running emulator suite, UI on :4000                      |
| `pnpm store:tokens`                  | Validate the active store, emit theme + config artefacts      |
| `pnpm store:new <id>`                | Scaffold a new store from `stores/_template`                  |
| `pnpm seed --dry-run`                | Print the documents a seed would write, and write nothing     |
| `pnpm seed --project <id>`           | Seed warehouses, categories, settings and the catalogue       |
| `pnpm seed:emulator`                 | Start Firestore, seed `demo-romp`, shut down                  |
| `pnpm --filter @romp/storefront dev` | Storefront on :3000 (regenerates tokens first)                |
| `pnpm e2e start` / `stop` / `status` | Run the full local stack for E2E — see `docs/LOCAL_E2E.md`    |
| `pnpm e2e test`                      | Quick health + functional check of a running stack            |
| `pnpm --filter @romp/e2e test:e2e`   | Playwright customer + admin happy-path suite                  |
| `pnpm format`                        | Prettier write                                                |
| `pnpm clean`                         | Remove build and cache output                                 |

Scoping to one package: `pnpm --filter @romp/data test`.

Every command respects `STORE_ID`, which selects the store config and defaults to `romp`:
`STORE_ID=toybox pnpm store:tokens`.

Commands added in later phases: `pnpm seed`, `pnpm seed:admins`.

---

## Environments

|             | Project     | Deploys when                      |
| ----------- | ----------- | --------------------------------- |
| Development | `romp-dev`  | Every merge to `main`             |
| Production  | `romp-prod` | A `v*` tag, after manual approval |

Both are in `asia-south1`, with **Email/Password as the only enabled auth provider** — mobile login is
built on top of it via a deterministic internal alias, so no SMS OTP is required
([ADR-0006](docs/adr/0006-password-identity-without-otp.md)).

CI authenticates to Google Cloud with Workload Identity Federation; there is no service-account JSON
in the repository or in GitHub secrets. Provisioning an environment is two idempotent scripts — see
[`infra/README.md`](infra/README.md).

---

## Engineering standards

These are enforced, not aspirational:

- **Money is integer paise.** Never a float, never a formatted string, in any field ending `Minor`.
  Enforced by the `Money` type in `@romp/contracts`.
- **Structured logging only.** `no-console` is an error; use the `@romp/observability` logger so
  every line carries the request ID.
- **Unawaited promises are build failures.** `no-floating-promises` is an error — a dropped `await`
  on a Firestore write is a lost order.
- **Zod at every boundary** — HTTP bodies, query strings, Firestore converter output, environment
  variables.
- **Typed errors.** One `AppError` base; the Fastify handler maps codes to RFC 7807 problem+json.
  Internal details never reach a client.
- **Coverage floors by tier** — domain logic 95%, I/O packages 80%, UI 70%.
- **Conventional Commits** with workspace-matching scopes, enforced by commitlint.
- **No branding in app code.** Colours, fonts, names and copy come from `stores/<id>/store.config.ts`;
  a lint rule fails raw hex literals under `apps/`.

---

## Contributing

1. Branch from `main`.
2. Commit as `type(scope): subject` — e.g. `feat(api): add payment-proof endpoint`. Valid scopes are
   listed in `commitlint.config.mjs`.
3. `pnpm verify` must pass. Pre-commit hooks run lint-staged; commit-msg runs commitlint.
4. Update `docs/PROGRESS.md` and add an ADR under `docs/adr/` for any architectural decision.
