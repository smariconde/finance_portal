# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Portal Financiero: a single-owner Next.js 16 portal for researching global companies, CEDEAR access, fundamentals comparison, and reproducible valuations with visible provenance. Spanish-language UI and documentation; English code identifiers and `AGENTS.md`.

The application is early: shell, config health, security headers, and the PostgreSQL/Drizzle persistence base exist. Financial data, screener, valuations, the Argentina dashboard, and AI features are **not** implemented and must not be presented in the UI as if they were.

`AGENTS.md` holds the full contributor contract and takes precedence over this file where they overlap.

## Commands

```bash
pnpm dev                 # local dev server
pnpm build               # production build (Cache Components enabled)
pnpm lint                # eslint, --max-warnings=0
pnpm typecheck           # tsc --noEmit
pnpm test                # vitest run, src/**/*.test.ts
pnpm test:watch
pnpm test:integration    # tests/integration/**, requires DATABASE_TEST_URL
pnpm format:check
```

Run a single unit test file or case:

```bash
pnpm vitest run src/modules/configuration/domain/config-health.test.ts
pnpm vitest run -t "partial name of the test"
```

Before handing off a change, run the same sequence CI runs (`.github/workflows/quality.yml`):
`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

`test:e2e` does not exist yet — do not claim it.

### Database

```bash
pnpm db:generate     # emit versioned SQL from src/server/db/schema.ts; never drizzle-kit push
pnpm db:test:up      # local PostgreSQL 17 on 127.0.0.1:55432 (needs .env.docker.local)
pnpm db:test:down
pnpm db:migrate      # controlled job; reads DATABASE_DIRECT_URL only
```

Integration tests need a dedicated disposable database; `tests/integration/setup.ts` throws without `DATABASE_TEST_URL`. Full workflow, rollback procedure, and safe-failure cases: [docs/runbooks/database-migrations.md](docs/runbooks/database-migrations.md).

Node `>=22.11.0 <27`, pnpm `10.33.2` via corepack. Windows dev host — prefer PowerShell syntax for env-var examples in docs.

## Architecture

Modular monolith. Dependencies point inward; the domain never imports React, Next.js, Drizzle, or provider SDKs.

```
src/app/                          routes, layout, _components (shell, sidebar)
src/components/ui/                shadcn/Base UI primitives, added only when used
src/modules/<domain>/
  domain/                         pure, testable, framework-free (Zod schemas + logic)
  application/                    ports, repository interfaces, mode selection
  infrastructure/                 demo fixture implementations
src/server/
  config/                         server-only environment reads
  db/                             Drizzle schema, pooled runtime client, PG repositories
  persistence/                    composition root per effective mode
  security/                       security headers used by next.config.ts
drizzle/                          versioned SQL + rollback/ pairs
tests/integration/                PostgreSQL-backed tests
```

Server Components call application services directly — no internal HTTP fetch. Pages read persisted snapshots; they never call providers during render. Everything touching secrets, the DB, providers, or AI imports `"server-only"` (aliased to a stub in both vitest configs).

### Modes are a security boundary, not a feature flag

`getConfigHealth()` in [src/modules/configuration/domain/config-health.ts](src/modules/configuration/domain/config-health.ts) resolves the **effective** mode from `APP_MODE` × `APP_RUNTIME_ACCESS` × Vercel env, and falls back to `demo` whenever a `personal` request is not provably safe. Everything downstream keys off that resolved mode, not off the raw env var:

- `demo` → fixtures only, no DB connection, live configuration ignored. The only mode valid for a public anonymous URL, including Vercel Production.
- `personal` → requires `local` (outside Vercel) or `protected` (Vercel Preview) access plus a pooled `DATABASE_URL`.

`getDatasetSnapshotRepository()` ([src/server/persistence/](src/server/persistence/get-dataset-snapshot-repository.ts)) is the composition root that picks `demo-fixture` vs `personal-postgres`. Cache identities include the mode so demo and personal data can never share a cache entry. Setting a key in `.env.local` does not enable an unimplemented integration.

`DATABASE_URL` is pooled runtime; `DATABASE_DIRECT_URL` is migration-job only and is never read at runtime.

## Non-negotiable domain rules

Read [docs/data/identity-model.md](docs/data/identity-model.md) and [docs/data/point-in-time-contract.md](docs/data/point-in-time-contract.md) before touching identity, mappings, observations, corporate actions, or historical queries.

- Keep `legal_entity → security → listing → listing_symbol` separate. Depositary programs link a depositary security to an underlying via versioned ratios; they never merge the two instruments. Tickers are time-bound lookup values, never stable foreign keys.
- Every historical read declares effective time, knowledge cutoff, revision policy, and corporate-action adjustment basis. Preserve `available_at`, `recorded_at`, vintages, restatements, and lineage. A later filing must never leak into an earlier `as_known` result — see the temporal columns and check constraints on `dataset_snapshots` in [src/server/db/schema.ts](src/server/db/schema.ts).
- Missing values stay `null`. Never coerce a missing financial value to zero.
- Financial formulas are pure, deterministic, versioned, and require unit tests plus edge cases for null, zero, negative, currency mismatch, and non-finite results.
- Zod schemas are the runtime source of truth at boundaries; DB check constraints mirror the schema invariants (e.g. manifest present iff `manifest_status = 'stored'`).

Before adding a Route Handler, Server Action, provider, export, job, or AI capability, read [docs/security/threat-model.md](docs/security/threat-model.md) and close the `TM-*` controls assigned to that surface.

Scope guardrails: no application auth, accounts, roles, multi-tenancy, or BYOK. Real providers run only in personal mode. Never reuse live-captured data as public demo fixtures. Never put secrets in `NEXT_PUBLIC_*`.

## Working rhythm

Work one authorized slice at a time. [docs/finance-portal-masterplan/06_PHASED_ROADMAP.md](docs/finance-portal-masterplan/06_PHASED_ROADMAP.md) authorizes the phase; [docs/backlog/README.md](docs/backlog/README.md) decides which issue is next, with acceptance criteria and `TM-*`/`UI-*` traceability. Only one issue may be `in_progress`. An issue is `done` only when its acceptance criteria and evidence are recorded.

Closing a slice means updating the backlog tracker **and** appending a row to the roadmap session log (date, phase/slice, result, status, evidence, next slice/blocker) in the same delivery. New structural dependencies or providers need an ADR in [docs/architecture/adr/](docs/architecture/adr/) first.

## UI work

Any task that creates or materially changes a page, component, dashboard, chart, table, empty state, theme, or responsive layout must invoke the `impeccable` skill before editing UI code, plus `financial-visualization-review` for charts, metric tables, screeners, and sensitivities.

Both skills are vendored once under `.agents/skills/` (Codex convention) and registered with Claude Code through pointer skills in [.claude/skills/](.claude/skills/). Invoke them by name; the pointer forwards to the vendored copy. **Resolve `<skill-base-dir>` and every relative reference path against `.agents/skills/<skill>/`** — `${CLAUDE_SKILL_DIR}` expands to the pointer directory and will not find the skill's references or scripts.

Only the read-only `context.mjs` and `detect.mjs` scripts are approved. Impeccable hooks, live editing, concept network calls, image generation, and self-update are disabled in [.impeccable/config.json](.impeccable/config.json) and require explicit user request plus review before running. Updating a vendored skill means updating its pin, its pointer, and its row in [docs/agent/skills-inventory.md](docs/agent/skills-inventory.md) in the same change.

Approved visual decisions live in [DESIGN.md](DESIGN.md) (tokens, typography) with per-surface briefs in `.impeccable/surfaces/`. shadcn is configured for Base UI + CSS variables ([components.json](components.json)); Recharts is the chart engine and ECharts is a measured escape hatch — do not add a second chart library without evidence. Read [docs/design/interface-foundations.md](docs/design/interface-foundations.md) before expanding the visual system; the home page is evidence, not a universal layout.

Avoid generic AI-interface defaults (decorative gradients, gratuitous glass blur, interchangeable rounded cards, icon tiles above every heading, timid typography). Favor financial-product hierarchy, legible numeric density, and visible provenance.

## Conventions

Two-space indent, `camelCase` values, `PascalCase` types/components, kebab-case files and module directories. Tests are colocated as `*.test.ts` next to the unit under test in `src/`; integration tests live in `tests/integration/`. Import via the `@/*` alias. Commits use short imperative subjects with a scope, e.g. `docs(architecture): clarify provider boundary`.
