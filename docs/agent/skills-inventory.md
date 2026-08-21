# Skills inventory

Project-local skills are pinned, reviewed, and committed with the repository. Installing a skill does not authorize its scripts, network calls, hooks, external writes, or automatic updates.

## Approved skills

| Skill        | Purpose                                                                                                                                           | Source                                              | Version/ref                                          | License    | Installed  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- | ---------- | ---------- |
| `impeccable` | Create and review distinctive production-grade web interfaces; typography, layout, responsive behavior, accessibility and anti-pattern detection. | `pbakaus/impeccable` at `.agents/skills/impeccable` | `4.1.1` / `f88b2837a7d7c3182e46307bbbb091a1ed547571` | Apache-2.0 | 2026-08-21 |

## Audit notes: `impeccable`

- Source reviewed: official repository `https://github.com/pbakaus/impeccable`.
- Installation scope: project-local `.agents/skills/impeccable/`; no global installation.
- Installation method: official Codex skill-installer helper, pinned to the exact commit above.
- No bundled script was executed during installation or audit.
- The core `SKILL.md` is appropriate for pages, dashboards and product UI and explicitly targets generic AI aesthetics, weak hierarchy and unconsidered visual defaults.
- The package also contains optional scripts with filesystem writes, local servers, process execution and network access. Examples include update checks, concept rolls, image generation, hooks and live editing.
- `.impeccable/config.json` disables update checks, staleness checks and hooks by default.
- `live`, concept generation, image generation, hook management and self-update commands require a new review and explicit user request before execution.
- Updates are manual, pinned and reviewed in a separate change. Never follow an in-skill update prompt automatically.

## Activation policy

Use `impeccable` for any visual implementation or review, including pages, components, app shells, dashboards, financial tables, charts, empty/loading/error states, responsive behavior, themes, typography, layout, interaction and UX copy.

The product brief remains authoritative. The skill supplies design process and quality controls; it does not override financial correctness, roadmap scope, accessibility requirements, provider restrictions or the `personal | demo` boundary.
