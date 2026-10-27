---
version: 3
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
- Job: saber si el precio está por encima o por debajo de lo que vale la empresa según el modelo, entender por qué y aprender a leerlo; y, sin salir de la página, auditar qué es hecho reportado, dato de referencia, derivado por regla, propuesta de IA, declaración del owner o ausencia declarada.
- Content (`F6-17`, ADR 0058), en este orden: encabezado (empresa, ticker, fecha, método en palabras, rigor), avisos, índice, precio contra valor (frase, barra de rango y significado de la zona), qué tendría que pasar para pagar el precio (exigencias en palabras, con la tabla técnica y las citas del 10-K a demanda), cómo viene la empresa (seis gráficos chicos reportados al corte y su tabla), por qué el modelo da ese valor (seis pasos), escenarios y sensibilidad, CEDEAR, auditoría en nueve `<details>` plegados, historial y límites. El orden anterior a `F6-17` era: encabezado (empresa, ticker, fecha de valuación, rigor, listing, CIK, registro), aviso si un pedido más nuevo no registró corrida, aviso de revisión, resultado y contrato point-in-time, rigor y método con las nueve comprobaciones, acceso por CEDEAR (desde `F6-04`), leyenda del origen de los datos, hechos con freshness y ausencias, decisiones cualitativas (industria, mix, opciones de empleados) con su base, costo de capital por release, regla de supuestos y libro de ajustes, supuestos y proyección, puente, sensibilidad, controles, historial y límites.
- Direction: de la decisión a la auditoría. Explicaciones breves siempre visibles y conceptos en `<details>` nativos («¿Qué es…?»). Los gráficos son barras chicas desde cero sin tooltip, con la cifra escrita y una tabla equivalente; la barra de rango es un dibujo `aria-hidden` que repite lo escrito. Montos grandes en palabras (escala larga); las cifras exactas, en la auditoría. La auditoría conserva los componentes de la corrida de referencia (`_components/run/`).
- Decisions del owner (2026-10-21): última corrida, sin selector de corridas anteriores; una corrida que pide revisión muestra el valor con el aviso arriba. El mismo día revirtió «sin precio de mercado»: desde `F6-09` el resultado va seguido de «Precio de mercado y lo que exige» (ADR 0048), sin la palabra upside ni colores de compra o venta.
- Precio (`F6-09`): cierre crudo al `as_of` como dato de referencia, valor de la corrida y precio ÷ valor como derivado por regla; un cierre posterior se nombra aparte sin compararlo. La tabla «Lo que exige el precio» pone por driver lo supuesto, lo exigido y lo que mostró la empresa. Desde `F6-11` suma «Lo que sostiene el 10-K» (veredicto en texto, nunca sólo color) y una sección marcada como propuesta de IA con las señales citadas, sus secciones del 10-K y los riesgos.
- Constraints: el render sólo lee (sin red, modelo, encolado ni recálculo); un runtime trabado niega; sin base, `DataUnavailableNotice`; un segmento inválido es 404 y no se repite; sin UUIDs en el HTML; WCAG 2.2 AA, teclado y reflow a 390 px.
- Flujo (`F6-12`): el encabezado lleva «Valuar TICKER» o «Volver a valuar». Al abrir, la página retoma un pedido abierto; el estado se anuncia en línea (`role="status"`) y, al registrarse la corrida, la página se relee en el lugar. Debajo del encabezado, un índice de anclas: Precio contra valor, Qué tendría que pasar, Cómo viene la empresa, Por qué vale eso, Escenarios, CEDEAR, Auditoría, Historial. Un ancla a un bloque de la auditoría lo abre.
- States: `not_requested`, `no_run` con el hueco del último pedido, `unsupported_run` (otro motor), `run` con o sin pedido más nuevo fallido.
- CEDEAR (`F6-04`, `F6-08`): por programa, depositario y símbolo BYMA como datos de referencia y, al lado, el valor por CEDEAR en USD. Debajo, cierre crudo en ARS, CCL implícito (ARS/USD) y valor por CEDEAR en pesos, con fecha y Yahoo Finance como fuente. Se distinguen precio y valor, y referencia de derivación. El CCL usa cierres del mismo día que la corrida y ratio conocido al corte; moneda incompatible, split, ratio posterior o dato ausente dejan un motivo explícito. Se declara que los cierres pueden no ser simultáneos, que no es un cambio ejecutable y que la conversión conserva la relación valor/precio de la acción. Sin programa, la ausencia con su motivo.
- Ingesta (`F6-05`, `F6-08`): «Volver a valuar» solicita los datos faltantes mediante jobs durables; el render sólo lee. El CEDEAR conserva su identidad y el símbolo local no se infiere del subyacente.
