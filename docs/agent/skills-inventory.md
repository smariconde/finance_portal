# Skills inventory

Project-local skills are pinned, reviewed, and committed with the repository. Installing a skill does not authorize its scripts, network calls, hooks, external writes, or automatic updates.

This inventory covers dependencies committed in `.agents/skills/`. Skills supplied by
the Codex environment or an installed plugin are session capabilities, not project
dependencies, and must not be presented as available to every contributor.

## Approved skills

| Skill        | Purpose                                                                                                                                           | Source                                              | Version/ref                                          | License    | Installed  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- | ---------- | ---------- |
| `impeccable` | Create and review distinctive production-grade web interfaces; typography, layout, responsive behavior, accessibility and anti-pattern detection. | `pbakaus/impeccable` at `.agents/skills/impeccable` | `4.1.1` / `f88b2837a7d7c3182e46307bbbb091a1ed547571` | Apache-2.0 | 2026-08-21 |

## Audit notes: `impeccable`

- Source reviewed: official repository `https://github.com/pbakaus/impeccable`.
- Installation scope: project-local `.agents/skills/impeccable/`; no global installation.
- Installation method: official Codex skill-installer helper, pinned to the exact commit above.
- No bundled script was executed during installation. On 2026-08-21, Fase 0B.6
  reviewed and ran only the local, read-only context collector and detector:
  `context.mjs --target src/app/page.tsx` and `detect.mjs --json` over the home,
  layout and stylesheet. Their result is recorded in
  [`../design/interface-foundations.md`](../design/interface-foundations.md).
- The core `SKILL.md` is appropriate for pages, dashboards and product UI and explicitly targets generic AI aesthetics, weak hierarchy and unconsidered visual defaults.
- The package also contains optional scripts with filesystem writes, local servers, process execution and network access. Examples include update checks, concept rolls, image generation, hooks and live editing.
- `.impeccable/config.json` disables update checks, staleness checks and hooks by default.
- `live`, concept generation, image generation, hook management and self-update commands require a new review and explicit user request before execution.
- Updates are manual, pinned and reviewed in a separate change. Never follow an in-skill update prompt automatically.

## Deferred candidates

Nothing in this table is installed or approved by being listed. Installation requires
a concrete slice, source/license review, exact ref, diff review and lock evidence.

| Candidate                                                     | Earliest trigger                                               | Status / reason                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `next-best-practices` from `vercel-labs/next-skills`          | Fase 1, before broadening App Router usage                     | deferred; inspect overlap with repository rules and Next.js 16 first              |
| `vercel-react-best-practices` from `vercel-labs/agent-skills` | Fase 1 UI composition                                          | deferred; install only if it adds checks not covered by Impeccable and lint       |
| `web-design-guidelines` from `vercel-labs/agent-skills`       | first multi-route accessibility review                         | deferred; likely overlaps Impeccable, so duplication must be justified            |
| `ai-sdk` from `vercel/ai`                                     | Fase 7                                                         | deferred; no AI dependency or endpoint exists                                     |
| `damodaran-valuation-engine` local                            | first valuation-engine change                                  | not created; methodology remains authoritative until a repetitive workflow exists |
| `financial-data-provenance` local                             | first provider/parser change                                   | not created; source registry and contracts currently cover the inactive surface   |
| `financial-visualization-review` local                        | first financial chart/table                                    | not created; no financial visualization is implemented                            |
| `release-quality-gate` local                                  | first phase/release gate that exceeds current command contract | not created; Fase 0 uses repository commands and roadmap evidence directly        |

The four local skills described by the masterplan remain design candidates, not missing
runtime features. When one is created, use the available `skill-creator` workflow,
validate its trigger and add its exact files/version to the approved table.

## Session-provided capabilities

Codex may expose system skills, connected-app skills or recommended plugins in a given
session. They are used only when their trigger matches and their instructions are read,
but they are not copied into this inventory. Recommended plugins are not installed or
authorized automatically; Fase 0B.6 required no external plugin.

## Activation policy

Use `impeccable` for any visual implementation or review, including pages, components, app shells, dashboards, financial tables, charts, empty/loading/error states, responsive behavior, themes, typography, layout, interaction and UX copy.

The product brief remains authoritative. The skill supplies design process and quality controls; it does not override financial correctness, roadmap scope, accessibility requirements, provider restrictions or the `personal | demo` boundary.
