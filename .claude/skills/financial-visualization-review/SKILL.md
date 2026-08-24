---
name: financial-visualization-review
description: Review or design financial charts, metric tables, screeners, sensitivities, and dashboard visualizations for semantic correctness, provenance, accessibility, responsive behavior, and measured rendering performance. Use for new or changed financial visualizations and their chart-engine decisions; do not use for general page styling without a financial data display.
---

# financial-visualization-review — project skill pointer

The skill itself lives at `.agents/skills/financial-visualization-review/` and is audited in
[`docs/agent/skills-inventory.md`](../../../docs/agent/skills-inventory.md). This file exists only
so Claude Code can discover and load it.

## How to load it

1. Read `.agents/skills/financial-visualization-review/SKILL.md` in full and follow its workflow.
2. **Resolve its relative paths against `.agents/skills/financial-visualization-review/`.** Its
   `references/decision-rules.md` and `references/validated-patterns.md` mean
   `.agents/skills/financial-visualization-review/references/...`, not this directory.
3. Do not use `${CLAUDE_SKILL_DIR}` for this skill; it expands to this pointer directory.

## Repository limits that override the skill

- The skill reviews and recommends. It never edits itself: a change to the skill needs explicit
  maintenance scope, supporting evidence from a real review, validation, and an inventory update
  in the same delivery. No hooks, no rule downloads, no network calls.
- shadcn chart composition with Recharts is the default engine. ECharts or Canvas require a
  measured budget failure or a named feature gap, stay route-local and lazy, and do not get
  installed without that evidence.
- Missing, non-comparable, or unsupported values stay explicit. Never render a missing financial
  value as zero or as a drawable percentage.
- Historical visualizations declare `as_of`, `available_at`, revision policy, and
  corporate-action adjustment basis, per
  [`docs/data/point-in-time-contract.md`](../../../docs/data/point-in-time-contract.md).

For the surrounding page, layout, and visual system, use the
[`impeccable`](../impeccable/SKILL.md) skill.
