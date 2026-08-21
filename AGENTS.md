# Repository Guidelines

## Project Structure & Module Organization

This repository contains a masterplan, not application code. Read `docs/finance-portal-masterplan/` in numeric order and update its `README.md` when adding or renaming documents.

The target is a single-owner portal with a public codebase. Do not add application auth, accounts, multi-tenancy, or BYOK unless scope changes explicitly. Real providers run only in personal mode; anonymous demo mode uses deterministic fixtures.

Generated code uses `src/app/` for routes, `src/modules/<domain>/` for domains, `src/server/` for infrastructure, `tests/` for tests, and `drizzle/` for migrations. Domain code must not import frameworks or provider SDKs.

## Development and Validation Commands

There is no local build for this documentation kit. Review changes with `git diff --check` and search for stale references with commands such as `rg "02_ARCHITECTURE"`.

The future application command contract is:

- `pnpm dev`: start local Next.js development.
- `pnpm lint && pnpm typecheck`: run static checks.
- `pnpm test`: run unit and property tests without network access.
- `pnpm test:integration`: test repositories, migrations, and provider contracts.
- `pnpm test:e2e`: run Playwright user flows.
- `pnpm build`: verify the production build.

Do not claim they pass before the scripts exist.

## Incremental Delivery

Before implementation, read `06_PHASED_ROADMAP.md`. Work only on its next authorized slice. At handoff, update status, evidence, blockers, and the session log. Partial work is not `done` until its gate passes.

## Writing, Coding, and Naming Conventions

Use concise Markdown, ATX headings, fenced code blocks with language tags, and repository-relative paths. Preserve the numbered, uppercase document pattern. In planned TypeScript, use two-space indentation, `camelCase` for values/functions, `PascalCase` for types/components, and kebab-case module directories. Zod schemas are the runtime source of truth. Keep calculations deterministic and versioned; never convert missing financial values to zero.

## UI Art Direction

Every task that creates, redesigns, or materially changes a page, component, dashboard, chart, table, empty state, theme, or responsive layout must use the project-local `impeccable` skill before editing UI code. Establish a clear visual concept and interaction mode, then apply the skill's craft floor and bounded desktop/mobile review.

Avoid generic AI-interface defaults: decorative purple/blue gradients, gratuitous glass blur, interchangeable rounded cards, icon tiles above every heading, excessive pill controls, timid typography, and empty marketing copy. Favor a deliberate financial-product hierarchy, legible numeric density, visible provenance, restrained motion, and aesthetic decisions tied to the owner's workflow. Familiar patterns are welcome when they improve scanability; novelty must earn its place.

Persist approved visual decisions in `DESIGN.md` when that system is established. Do not enable Impeccable hooks, live editing, concept network calls, image generation, or automatic updates unless the user explicitly requests that workflow and its scripts have been reviewed for the action.

## Testing, Data, and Security

Every formula change requires unit tests plus edge cases for nulls, zero, negatives, currency mismatch, and non-finite results. Provider changes require sanitized fixtures, provenance, license review, schema validation, and failure-path contract tests. Keep secrets server-only, never use `NEXT_PUBLIC_` for keys, and never commit real credentials or licensed payloads.

## Commits & Pull Requests

Git history is unavailable, so use short imperative subjects, for example `docs(architecture): clarify provider boundary`. Pull requests should summarize changes, link issues or ADRs, state validation, and include screenshots only for UI changes.
