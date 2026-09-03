# Validated repository patterns

These rules are scoped to Portal Financiero. Add a rule only through the bounded
improvement loop in `SKILL.md`.

## Standard financial workspace

- Rule: ordinary financial charts inherit shadcn semantic tokens and component
  spacing; a chart does not introduce a separate visual theme.
- Evidence: confirmed product direction on 2026-08-21 and the repository UI
  contract.
- Scope: all Portal Financiero routes.
- Counterexample: an exported report may define a print-specific palette while
  preserving semantic roles and accessibility.

## Renderer escalation

- Rule: Recharts is the initial renderer; ECharts/Canvas requires a documented
  feature gap or production-profile failure on representative data.
- Evidence: accepted stack decision and official renderer guidance reviewed on
  2026-08-21.
- Scope: browser visualizations in Portal Financiero.
- Counterexample: a future visualization whose core interaction is unsupported
  by Recharts may select ECharts before load testing if the gap is demonstrated.
