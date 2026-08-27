# Repository Guidelines

## Project Structure & Module Organization

This repository contains an active Next.js application plus its masterplan. Read `docs/finance-portal-masterplan/` in numeric order before implementation and update its `README.md` when adding or renaming documents.

The target is a single-owner portal with a public codebase and private data. Do not add application auth, accounts, multi-tenancy, or BYOK unless scope changes explicitly. The runtime is personal-first: `personal` serves real data from a private runtime and `locked` refuses to serve anything. There is no public demo deployment and no fallback dataset ([ADR 0004](docs/architecture/adr/0004-personal-first-runtime.md)).

Generated code uses `src/app/` for routes, `src/modules/<domain>/` for domains, `src/server/` for infrastructure, `tests/` for tests, and `drizzle/` for migrations. Domain code must not import frameworks or provider SDKs.

## Development and Validation Commands

The current application command contract is:

- `pnpm dev`: start local Next.js development.
- `pnpm lint && pnpm typecheck`: run static checks.
- `pnpm test`: run unit and property tests without network access.
- `pnpm test:integration`: run PostgreSQL integration tests with a dedicated `DATABASE_TEST_URL`.
- `pnpm test:e2e`: build once, then serve that artifact under a personal and a locked environment and run the Playwright and `axe-core` gate. No network, no PostgreSQL.
- `pnpm build`: verify the production build.
- `pnpm db:generate`: generate reviewed SQL migrations from the Drizzle schema.
- `pnpm db:migrate`: apply migrations through the direct administrative connection.
- `pnpm db:test:up`: start the dedicated local PostgreSQL integration database.
- `pnpm db:test:down`: stop the local PostgreSQL integration database without deleting its volume.

Review documentation changes with `pnpm format:check`, `git diff --check`, and searches for stale references.

## Incremental Delivery

Before implementation, read `06_PHASED_ROADMAP.md` and `docs/backlog/README.md`. The roadmap authorizes the phase; the backlog supplies issue order, dependencies, acceptance criteria, and `TM-*`/`UI-*` traceability. Work only on its next authorized slice. At handoff, update status, evidence, blockers, and the session log. Partial work is not `done` until its gate passes.

## Writing, Coding, and Naming Conventions

Use concise Markdown, ATX headings, fenced code blocks with language tags, and repository-relative paths. Preserve the numbered, uppercase document pattern. In planned TypeScript, use two-space indentation, `camelCase` for values/functions, `PascalCase` for types/components, and kebab-case module directories. Zod schemas are the runtime source of truth. Keep calculations deterministic and versioned; never convert missing financial values to zero.

## Financial Identity & Time

Before changing identity, mappings, observations, corporate actions, or historical queries, read `docs/data/identity-model.md` and `docs/data/point-in-time-contract.md`.

Keep `legal_entity -> security -> listing -> listing_symbol` separate. Depositary programs connect a depositary security to an underlying security through versioned ratios; they do not merge both instruments. Tickers are time-bound lookup values, never stable foreign keys.

Every historical read must declare effective time, knowledge cutoff, revision policy, and corporate-action adjustment basis. Preserve `available_at`, `recorded_at`, vintages, restatements, and source lineage. A later filing or mapping must never leak into an earlier `as_known` result.

## UI Art Direction

Every task that creates, redesigns, or materially changes a page, component, dashboard, chart, table, empty state, theme, or responsive layout must use the project-local `impeccable` skill before editing UI code. Establish a clear visual concept and interaction mode, then apply the skill's craft floor and bounded desktop/mobile review.

Avoid generic AI-interface defaults: decorative purple/blue gradients, gratuitous glass blur, interchangeable rounded cards, icon tiles above every heading, excessive pill controls, timid typography, and empty marketing copy. Favor a deliberate financial-product hierarchy, legible numeric density, visible provenance, restrained motion, and aesthetic decisions tied to the owner's workflow. Familiar patterns are welcome when they improve scanability; novelty must earn its place.

Persist approved visual decisions in `DESIGN.md` when that system is established. Do not enable Impeccable hooks, live editing, concept network calls, image generation, or automatic updates unless the user explicitly requests that workflow and its scripts have been reviewed for the action.

Skills are vendored once in `.agents/skills/` and registered per agent runtime. Codex reads `.agents/skills/` directly; Claude Code loads the pointer skills in `.claude/skills/`, which forward to the same vendored directory and carry the repository limits. Registering a skill for a new runtime adds a pointer and an inventory note; it never forks or duplicates the vendored skill.

## Testing, Data, and Security

Every formula change requires unit tests plus edge cases for nulls, zero, negatives, currency mismatch, and non-finite results. Provider changes require recorded fixtures, provenance, schema validation, and failure-path contract tests; unit and contract tests never open the network, so every provider needs a fixture. That contract is enforced by `tests/setup/no-network.ts`, which fails any `fetch`, `http`, `https`, or raw TCP call from the unit suite — do not weaken it to let a test reach a real service. Keep secrets server-only, never use `NEXT_PUBLIC_` for keys, and never commit real credentials or captured payloads to this public repository.

Before adding a Route Handler, Server Action, provider, export, job, or AI capability,
read `docs/security/threat-model.md` and close the controls assigned to that surface.
Before reusing or expanding the visual system, read
`docs/design/interface-foundations.md`; the home is evidence, not a universal layout.

## Commits & Pull Requests

History follows Conventional Commits with a short imperative subject and an optional scope, for example `docs(architecture): clarify provider boundary` or `feat: implement PostgreSQL dataset snapshot repository`. Match that pattern. Pull requests should summarize changes, link issues or ADRs, state validation, and include screenshots only for UI changes.
