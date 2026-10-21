---
version: 2
slug: "src-app-valuacion-ticker-page-tsx"
primary_target: "src/app/valuacion/[ticker]/page.tsx"
related_targets:
  [
    "src/app/valuacion/[ticker]/_components/rigor-panel.tsx",
    "src/app/valuacion/[ticker]/_components/qualitative-decisions.tsx",
    "src/app/valuacion/[ticker]/_components/cost-of-capital-table.tsx",
    "src/app/valuacion/[ticker]/_components/derivation-summary.tsx",
    "src/app/valuacion/[ticker]/_components/cedear-access.tsx",
    "src/app/valuacion/_components/run/",
    "src/app/valuacion/_components/valuation-history.tsx",
  ]
---

# Resultado de la valuación

- Scope: la última corrida registrada de un ticker sobre una empresa real (`F6-03`). Una URL por ticker, canónica en mayúsculas.
- Visitor mode: Operate.
- Audience: el owner, que pidió el ticker en `/valuacion` y quiere leer el valor y poder defenderlo.
- Job: leer el valor por acción con su nivel de rigor y, sin salir de la página, distinguir qué es hecho reportado, dato de referencia, derivado por regla, propuesta de IA, declaración del owner o ausencia declarada.
- Content, en este orden: encabezado (empresa, ticker, fecha de valuación, rigor, listing, CIK, registro), aviso si un pedido más nuevo no registró corrida, aviso de revisión, resultado y contrato point-in-time, rigor y método con las nueve comprobaciones, acceso por CEDEAR (desde `F6-04`), leyenda del origen de los datos, hechos con freshness y ausencias, decisiones cualitativas (industria, mix, opciones de empleados) con su base, costo de capital por release, regla de supuestos y libro de ajustes, supuestos y proyección, puente, sensibilidad, controles, historial y límites.
- Direction: la misma cadena de evidencia de la corrida de referencia, leída de arriba hacia abajo; comparte sus componentes (`_components/run/`). Sin gráficos nuevos: todo es tabla semántica o lista de definición.
- Decisions del owner (2026-10-21): última corrida, sin selector de corridas anteriores; una corrida que pide revisión muestra el valor con el aviso arriba. El mismo día revirtió «sin precio de mercado»: desde `F6-09` el resultado va seguido de «Precio de mercado y lo que exige» (ADR 0048), sin la palabra upside ni colores de compra o venta.
- Precio (`F6-09`): cierre crudo al `as_of` como dato de referencia, valor de la corrida y precio ÷ valor como derivado por regla; un cierre posterior se nombra aparte sin compararlo. La tabla «Lo que exige el precio» pone por driver lo supuesto, lo exigido y lo que mostró la empresa. Desde `F6-11` suma «Lo que sostiene el 10-K» (veredicto en texto, nunca sólo color) y una sección marcada como propuesta de IA con las señales citadas, sus secciones del 10-K y los riesgos.
- Constraints: el render sólo lee (sin red, modelo, encolado ni recálculo); un runtime trabado niega; sin base, `DataUnavailableNotice`; un segmento inválido es 404 y no se repite; sin UUIDs en el HTML; WCAG 2.2 AA, teclado y reflow a 390 px.
- States: `not_requested`, `no_run` con el hueco del último pedido, `unsupported_run` (otro motor), `run` con o sin pedido más nuevo fallido.
- CEDEAR (`F6-04`): por programa, depositario como dato de referencia y, al lado, el valor por CEDEAR en USD como derivado por regla, diciendo que no es un precio. Sin programa, la ausencia con su motivo.
- Unresolved: precio BYMA y pesos (`F6-08`) e ingesta bajo demanda (`F6-05`) se nombran en los límites, no como controles.
