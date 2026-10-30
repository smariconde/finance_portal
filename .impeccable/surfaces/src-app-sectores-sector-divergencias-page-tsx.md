---
version: 1
slug: "src-app-sectores-sector-divergencias-page-tsx"
primary_target: "src/app/sectores/[sector]/divergencias/page.tsx"
related_targets:
  [
    "src/app/sectores/[sector]/divergencias/_components/divergence-workspace.tsx",
    "src/app/sectores/[sector]/divergencias/_components/divergence-layout.ts",
    "src/app/sectores/[sector]/_components/matrix-chart.tsx",
    "src/app/sectores/[sector]/_components/sector-matrix-nav.tsx",
  ]
---

# Matriz de divergencias sectorial

- Scope: `/sectores/[sector]/divergencias` (`F8-02`, ADR 0016 §5), ruta hermana de la matriz de riesgo con un selector «Riesgo · Divergencias» en las dos (decisión del owner del 2026-10-30).
- Visitor mode: Operate.
- Audience: el owner, que quiere ver en qué empresas de un sector las ganancias crecieron más o menos que el valor de mercado, y cuánto de esa brecha es recompra o dilución.
- Job: responder la pregunta del título en un vistazo y bajar al valor exacto y al puente de cualquier punto con teclado, click o desde la tabla. No es una señal de compra: la diagonal compara crecimientos.
- Content: título en forma de pregunta; frase del sesgo con la tolerancia de 2 pp; provenance (corte, fundamentales SEC, precio crudo en base de splits SEC, versiones `divergence-views-1.0.0` y `dilution-bridge-1.0.0`); aviso de cobertura SEC con el máximo de pedidos para bajar lo que falta y la cuota de hoy, sin botón (la descarga sigue siendo el comando); selectores de horizonte (2 o 5 años) y de vista (market cap vs EPS, vs net income, precio vs EPS); scatter; panel del punto con brecha = por acción + sesgo, base del market cap, puente del EPS y dilución potencial, y vínculo a su valuación; «Sin tasa comparable» por categoría; «Sin valor» con el motivo; tabla con las tres brechas, sesgo, acciones, base y puente.
- Encoding: el mismo lenguaje de riesgo (logo o monograma, anillo e insignia con CEDEAR, rótulos sin superposición, chevron en un recortado, anillo `--primary` en el seleccionado). Rombo relleno pegado a la marca para el sesgo mayor a 2 pp, sólo en la vista principal. Diagonal punteada `y = x`.
- Axes: un solo dominio para los dos ejes —el robusto de cada uno, unido, con el cero adentro— y gráfico cuadrado, para que la diagonal quede a 45°. `niceAxis` admite pasos de 20 a 100 para rangos de CAGR.
- Constraints: el render lee la base personal y no escribe ni sale a la red; sin base, «Base personal no disponible»; runtime trabado, `RuntimeLockedNotice`; los beneficios no positivos nunca son puntos.
- Evidence (2026-10-30, build con la base personal): Communication Services con 8 puntos comparables a 2 años y 3 marcas de sesgo; Energy con 2 puntos y el aviso de cobertura parcial. axe 0 serious/critical y sin overflow horizontal a 1440 claro y 390 oscuro; detector de Impeccable sin hallazgos; E2E sin base y trabado pasa.
- Unresolved: en mobile la tabla se desplaza dentro de su contenedor y sólo muestra ticker, brecha y sesgo sin desplazar; el dominio robusto con pocos puntos deja el grueso del sector apiñado cuando hay un extremo (DIS a +130 %); el botón de descarga con el control de cuota es un incremento aparte.
