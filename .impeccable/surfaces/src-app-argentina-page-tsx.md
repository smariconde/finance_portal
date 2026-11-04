---
version: 2
slug: "src-app-argentina-page-tsx"
primary_target: "src/app/argentina/page.tsx"
related_targets:
  [
    "src/app/argentina/_components/summary-cards.tsx",
    "src/app/argentina/_components/sections.tsx",
    "src/app/argentina/_components/block.tsx",
    "src/app/argentina/_components/timeline-chart.tsx",
    "src/app/argentina/_components/government-chart.tsx",
    "src/app/argentina/_components/chart-kit.tsx",
    "src/app/argentina/_components/chart-views.tsx",
    "src/app/argentina/_components/sector-heatmap.tsx",
    "src/app/argentina/_components/format.ts",
    "src/app/argentina/_components/argentina-refresh.tsx",
    "src/app/argentina/actions.ts",
    "src/modules/argentina-dashboard/domain/argentina-dashboard.ts",
  ]
---

# Tablero argentino

- Scope: `/argentina` (`F9-06`), una sola página con lo que guardaron los comandos de la Fase 9: actividad del INDEC, dólar oficial y CCL implícito, inflación y reservas del BCRA, resultado fiscal sobre PIB y comercio exterior. Decisiones del owner del 2026-11-03: todo en una página y la pregunta «¿Cómo viene la economía argentina?» primero.
- Visitor mode: Operate, con lectura en frases.
- Audience: el owner, que quiere saber en un vistazo cómo viene la economía para decisiones de inversión y de la vida real, y bajar a los números con su fuente.
- Job: cinco tarjetas de lectura rápida (actividad, brecha, inflación, primario/PIB, saldo comercial), cada una con su cifra, su fecha y un enlace a su sección; después, una sección por bloque con la pregunta, la lectura en una frase, la fuente y la última fecha a la vista, el gráfico, la tabla equivalente plegada y la metodología plegada.
- Content: actividad (EMAE desestacionalizado y tendencia-ciclo de 60 meses; mapa de los 16 sectores en variación interanual de 12 meses, del último mes al más viejo, ordenado por el último); dólar (mayorista, CCL implícito y bandas, dos años; brecha aparte); monetario (inflación mensual de 24 meses, reservas en miles de millones de US$, base monetaria real en billones de pesos del mes base); fiscal (primario e intereses netos sobre PIB por año completo desde 2016, el año en curso sólo en pesos y en palabras); externo (exportaciones, importaciones y saldo de 36 meses, suma de 12 meses sólo con los 12 presentes).
- Direction: workspace financiero estándar. Cards con ring, `<details>` nativo para datos y metodología. Desde `F9-13` cada gráfico se recorre (ver DESIGN.md → Time-series blocks): una franja de lectura arriba del gráfico, rangos hasta toda la historia, escala log, comparación A→B, gobiernos y regímenes, y en cada bloque una vista «Por gobierno».
- Encoding: ninguna señal por color solo. Líneas sólidas y punteadas con leyenda que repite el trazo; barras con leyenda cuadrada; el signo va en la cifra; el mapa de sectores es una tabla con la cifra escrita y un tinte que sólo la refuerza (`--chart-2` arriba de cero, `--chart-5` abajo, 6/11/16/22 % por magnitud).
- Voice: describe lo que pasó, nunca por qué ni lo que viene; sin «bien», «mal», flechas ni señales de compra o venta. Un resultado del año en curso se escribe «superávit» o «déficit» con su monto en palabras.
- Constraints: el render lee la base personal a un solo corte y no descarga nada; cada serie conserva su fecha; un punto sin dato corta la línea y en la tabla dice «Sin dato» o su motivo; sin base, «Base personal no disponible»; runtime trabado, `RuntimeLockedNotice`. Las capturas del gate no muestran datos del owner (ADR 0006).
- Evidence (2026-11-03, build servido contra Production en sólo lectura): 1440 y 390 px, claro y oscuro: axe 0 serious/critical, 0 px de desborde horizontal, ningún `NaN`, `undefined` ni `null` en el texto. Lecturas: EMAE +0,1 % mensual y −1,7 % interanual (agosto), brecha +7,1 % (2 de noviembre), inflación 1,9 % mensual y 33,4 % interanual (septiembre), primario +1,4 % del PIB en 2025, saldo de US$ +2.187 M en agosto.
- Unresolved: el tiempo de respuesta desde el host local contra Neon es de 12 a 17 s por latencia de red (unas 25 consultas a ~450 ms); en Production la función corre en `iad1` junto a la base.
- Refresh (2026-11-03, `F9-12`, ADR 0070): al abrir, si algo pasó su cadencia, una línea de estado arriba de las tarjetas dice «Buscando datos nuevos…», «Actualizando BCRA, INDEC…» con barra de progreso que no retrocede, «Datos al día.» o la fuente que falló con «Reintentar»; sólo el título es región viva. Los bloques muestran lo guardado y la página se relee sola al terminar. Medido en réplica vacía: 98 s la primera visita, sin línea la segunda.
- Charts (2026-11-03, `F9-13`): pedido del owner antes de la soja. Ventanas iniciales iguales a las de `F9-06` (dólar, reservas e inflación 2A; EMAE y base 5A; comercio 3A; interanual 10A) y Máx hasta la historia guardada. Vistas: actividad (EMAE desestacionalizado), dólar (mayorista o CCL, base 100), inflación (mensual, interanual, precios acumulados por gobierno), reservas (diferencia en US$ M) y comercio (saldo acumulado). Comercio pasó a líneas de exportaciones e importaciones sobre barras de saldo; fiscal conserva su tabla con motivos. Revisado sobre una página temporal con datos sintéticos que pasan por los mismos builders: 1440 px claro y 390 px oscuro, 0 px de desborde y axe sin serious ni critical. Falta revisarlo con datos reales y medir el payload.
