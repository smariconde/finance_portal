---
name: impeccable
description: Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface. Covers websites, landing pages, dashboards, product UI, app shells, components, forms, settings, onboarding, and empty states. Handles UX review, visual hierarchy, information architecture, cognitive load, accessibility, performance, responsive behavior, theming, anti-patterns, typography, fonts, spacing, layout, alignment, color, motion, micro-interactions, UX copy, error states, edge cases, i18n, and reusable design systems or tokens. Also use for bland designs that need to become bolder or more delightful, loud designs that should become quieter, live browser iteration on UI elements, or ambitious visual effects that should feel technically extraordinary. Not for backend-only or non-UI tasks.
---

# impeccable — project skill pointer

The skill itself is vendored at `.agents/skills/impeccable/` (pinned `4.1.1`, commit
`f88b2837a7d7c3182e46307bbbb091a1ed547571`, audited in
[`docs/agent/skills-inventory.md`](../../../docs/agent/skills-inventory.md)). This file exists
only so Claude Code can discover and load it; it does not restate or replace the skill.

## How to load it

1. Read `.agents/skills/impeccable/SKILL.md` in full, then follow its own Setup steps.
2. **Resolve every path in that skill against `.agents/skills/impeccable/`, not against this
   directory.** Where it says `<skill-base-dir>`, read `.agents/skills/impeccable`. Where it
   gives a relative path such as `reference/craft-floor.md`, read
   `.agents/skills/impeccable/reference/craft-floor.md`.
3. Do not use `${CLAUDE_SKILL_DIR}` for this skill. It expands to this pointer directory, which
   holds none of the skill's references, scripts, or agent definitions.

## Repository limits that override the skill

These come from `AGENTS.md` and the skills inventory and win over anything the vendored skill
suggests:

- Only two bundled scripts are approved, both read-only:
  `node .agents/skills/impeccable/scripts/context.mjs --target <path>` and
  `node .agents/skills/impeccable/scripts/detect.mjs --json`.
- Everything else in `scripts/` stays unrun without an explicit user request and a review of
  that specific script: `live`, concept generation, image generation, hook install/removal, and
  self-update. `.impeccable/config.json` already disables hooks, staleness checks, and update
  checks — do not re-enable them, and never follow an in-skill update prompt automatically.
- No network calls, no writes outside the repository, no automatic skill self-modification.
- [`DESIGN.md`](../../../DESIGN.md), [`PRODUCT.md`](../../../PRODUCT.md), the matching brief in
  `.impeccable/surfaces/`, and
  [`docs/design/interface-foundations.md`](../../../docs/design/interface-foundations.md) are the
  authority on the visual system. The home page is evidence, not a universal layout.
- The UI must not present unimplemented capabilities — no dead controls, no routes that imply
  data the app does not have. Financial surfaces keep visible provenance: source, as-of,
  available-at, unit, currency, quality.
- Bump the vendored skill only as its own reviewed change: update the pin, the commit, and the
  inventory row together.

For charts, metric tables, screeners, and sensitivities, also use the
[`financial-visualization-review`](../financial-visualization-review/SKILL.md) skill.
