# Financial visualization decision rules

## Required context

Read only the documents relevant to the change:

- Historical identity or mappings: `docs/data/identity-model.md` and
  `docs/data/point-in-time-contract.md`.
- Valuation outputs: `docs/valuation/methodology.md`.
- Provider-derived data: `docs/data/source-registry.md` and
  `docs/data/provider-use-matrix.md`.
- UI composition: `DESIGN.md` and the route surface brief.

## Semantic checks

- State the question the chart answers in its title or immediate description.
- Expose unit, currency, period, frequency, source, freshness, and transformation
  close to the result.
- Separate aggregate from per-share comparisons and reported from adjusted data.
- CAGR requires strictly positive endpoints. Classify non-positive transitions
  instead of plotting an invented comparable rate.
- Keep raw outlier values available when display domains are clipped.
- Do not use color alone for sign, quality, state, or CEDEAR membership.
- Treat missing, stale, estimated, restated, and non-comparable as different
  states.

## Renderer selection

- Prefer shadcn/Recharts for ordinary line, area, bar, composed, and small scatter
  charts because it shares tokens and interaction conventions with the app.
- Profile production builds with representative data before optimizing.
- Consider route-local ECharts/Canvas when point count, dense heatmaps, zoom,
  linked brushing, or interaction latency fails an explicit budget. Record the
  dataset size, device class, interaction, and measured failure.
- Keep tables server-paginated for data that is too large to load. Add TanStack
  Virtual only when DOM size is the measured bottleneck.
- Never add a second renderer merely for visual variety.

## Accessible completion

- Provide a programmatic title and description.
- Enable keyboard or click access to the information otherwise available on
  hover.
- Provide a semantic table or a purpose-equivalent textual summary for every
  material visualization.
- Preserve visible focus, 200% zoom, mobile reflow, reduced motion, and contrast.
- Test empty, partial, loading, error, stale, and permission/mode-disabled states.
