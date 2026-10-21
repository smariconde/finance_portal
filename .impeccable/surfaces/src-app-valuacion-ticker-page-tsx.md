---
version: 1
slug: "src-app-valuacion-ticker-page-tsx"
primary_target: "src/app/valuacion/[ticker]/page.tsx"
related_targets:
  [
    "src/app/valuacion/[ticker]/_components/rigor-panel.tsx",
    "src/app/valuacion/[ticker]/_components/qualitative-decisions.tsx",
    "src/app/valuacion/[ticker]/_components/cost-of-capital-table.tsx",
    "src/app/valuacion/[ticker]/_components/derivation-summary.tsx",
    "src/app/valuacion/_components/run/",
    "src/app/valuacion/_components/valuation-history.tsx",
  ]
---

# Resultado de la valuación

- Scope: la última corrida registrada de un ticker sobre una empresa real (`F6-03`). Una URL por ticker, canónica en mayúsculas.
- Visitor mode: Operate.
- Audience: el owner, que pidió el ticker en `/valuacion` y quiere leer el valor y poder defenderlo.
- Job: leer el valor por acción con su nivel de rigor y, sin salir de la página, distinguir qué es hecho reportado, dato de referencia, derivado por regla, propuesta de IA, declaración del owner o ausencia declarada.
- Content, en este orden: encabezado (empresa, ticker, fecha de valuación, rigor, listing, CIK, registro), aviso si un pedido más nuevo no registró corrida, aviso de revisión, resultado y contrato point-in-time, rigor y método con las nueve comprobaciones, leyenda del origen de los datos, hechos con freshness y ausencias, decisiones cualitativas (industria, mix, opciones de empleados) con su base, costo de capital por release, regla de supuestos y libro de ajustes, supuestos y proyección, puente, sensibilidad, controles, historial y límites.
- Direction: la misma cadena de evidencia de la corrida de referencia, leída de arriba hacia abajo; comparte sus componentes (`_components/run/`). Sin gráficos nuevos: todo es tabla semántica o lista de definición.
- Decisions del owner (2026-10-21): última corrida, sin selector de corridas anteriores; sin precio de mercado ni upside; una corrida que pide revisión muestra el valor con el aviso arriba.
- Constraints: el render sólo lee (sin red, modelo, encolado ni recálculo); un runtime trabado niega; sin base, `DataUnavailableNotice`; un segmento inválido es 404 y no se repite; sin UUIDs en el HTML; WCAG 2.2 AA, teclado y reflow a 390 px.
- States: `not_requested`, `no_run` con el hueco del último pedido, `unsupported_run` (otro motor), `run` con o sin pedido más nuevo fallido.
- Unresolved: acceso CEDEAR (`F6-04`) e ingesta bajo demanda (`F6-05`) se nombran en los límites, no como controles.
