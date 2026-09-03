---
name: financial-visualization-review
description: Review or design financial charts, metric tables, screeners, sensitivities, and dashboard visualizations for semantic correctness, provenance, accessibility, responsive behavior, and measured rendering performance. Use for new or changed financial visualizations and their chart-engine decisions; do not use for general page styling without a financial data display.
---

# Financial Visualization Review

Protect the meaning of the data before polishing its presentation. Preserve the
user's selected UI system and the repository's active design contract.

## Workflow

1. Identify the financial question, comparison population, time basis, unit,
   currency, revision policy, and point-in-time cutoff.
2. Read [references/decision-rules.md](references/decision-rules.md) and the
   repository contracts it routes to. If the visualization is historical,
   confirm `as_of`, `available_at`, restatement policy, and adjustment basis.
3. Review the data contract before the component. Missing, non-comparable, and
   unsupported values remain explicit; never turn them into zero or a drawable
   percentage.
4. Choose the smallest adequate renderer. In this repository use shadcn chart
   composition with Recharts for ordinary charts. Introduce ECharts or Canvas
   only after a named visualization exceeds a measured budget or needs a feature
   Recharts cannot provide. Keep the alternate engine route-local and lazy.
5. Verify title, axes, units, legend, tooltip, selection, outliers, loading,
   empty, error, and degraded states. Require keyboard/click access and a
   semantic table or equivalent text summary.
6. Return findings ordered by financial correctness, accessibility, task
   completion, performance, and visual consistency. Name the affected artifact
   and a concrete acceptance check for each material finding.

## Bounded improvement loop

This skill is improvement-ready, not autonomously self-modifying.

- At the end of a real review, compare the result with
  [references/validated-patterns.md](references/validated-patterns.md).
- When a user correction, failed gate, or repeated artifact exposes a reusable
  gap, emit a short `Skill improvement candidate` containing evidence, scope,
  proposed rule, and a counterexample where it should not apply.
- Do not edit this skill during an ordinary visualization task. Update it only
  when the user authorizes skill maintenance or the active task explicitly
  includes improving the skill.
- Promote a candidate into `validated-patterns.md` only with two independent
  repository examples or one authoritative specification plus one repository
  example. Keep the rule scoped; remove or narrow it when later evidence
  contradicts it.
- After every skill edit, run the Skill Creator validator, review the diff, and
  update `docs/agent/skills-inventory.md`. Never fetch rules, enable hooks, or
  execute network calls as part of learning.

The repository's product truth, roadmap, financial contracts, and explicit user
direction always outrank a learned pattern.
