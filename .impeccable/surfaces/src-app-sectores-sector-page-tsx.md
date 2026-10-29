---
version: 2
slug: "src-app-sectores-sector-page-tsx"
primary_target: "src/app/sectores/[sector]/page.tsx"
related_targets:
  [
    "src/app/sectores/page.tsx",
    "src/app/sectores/[sector]/_components/sector-risk-workspace.tsx",
    "src/app/sectores/[sector]/_components/matrix-chart.tsx",
    "src/app/sectores/[sector]/_components/matrix-layout.ts",
    "src/app/sectores/[sector]/_components/sector-price-refresh.tsx",
    "src/app/sectores/[sector]/_components/sector-risk-export.tsx",
    "src/app/_components/data-unavailable-notice.tsx",
  ]
---

# Matriz de riesgo sectorial

- Scope: índice `/sectores` con la cobertura de precios de los once sectores, y `/sectores/[sector]` con la matriz Sortino 2 años contra 5 años a hoy (`F7-05`, ADR 0029), que al abrirse descarga sólo los precios que le faltan (`F7-08`, ADR 0030).
- Visitor mode: Operate.
- Audience: el owner, que quiere ver qué empresas de un sector compensaron mejor su riesgo a la baja, cuáles superaron al S&P 500 en las dos ventanas y a cuáles accede por CEDEAR.
- Job: responder la pregunta del título en un vistazo y bajar a los valores exactos de cualquier punto con teclado, click o desde la tabla.
- Content: título en forma de pregunta; botón «Descargar CSV» sobre la matriz, con estado de error en línea y reintento sin perder el contexto; línea de estado de la descarga, visible sólo cuando hay algo que decir (revisando, actualizando la referencia, descargando con barra de progreso «12 de 40», esperando otra descarga, cuota agotada o fuente frenada con su motivo, fallos con «Reintentar», «Precios al día.»); el `as_of` es siempre el último cierre guardado de la referencia, sin selector de fecha (decisión del owner del 2026-10-01); provenance junto al resultado (cierre, fórmula `sortino-1.0.0`, base total return, referencia `^SP500TR`, fuente y sesgo de supervivencia); scatter; panel del punto seleccionado con extracto literal en inglés del Item 1 del 10-K cuando está revisado, fecha y enlace SEC, o ausencia explícita y enlace Finviz; panel «Sin valor» con el motivo de cada `null`; tabla equivalente ordenable con la referencia fijada arriba.
- Direction: workspace financiero estándar. Recharts pone ejes, grilla, cruce de la referencia y recta; los puntos son una capa propia con las escalas del gráfico, porque cada punto es un control.
- Encoding, ninguna señal sólo por color: círculo hueco sin CEDEAR, cuadrado relleno `--chart-1` con CEDEAR, rombo para la referencia más su rótulo, recta `--chart-4` nombrada «Ajuste lineal del sector» con su `n` en la leyenda, chevron hacia afuera en un punto recortado, anillo `--primary` en el seleccionado.
- Labels: elegidas por el owner, todas visibles sin superponerse. Los puntos que se tapan forman un grupo («GOOG · GOOGL»); cada grupo prueba ocho lados; sin lugar, se suma al grupo más cercano («NFLX +2») y se vuelve a ubicar con su texto nuevo. El ancho se mide con `measureText` en la fuente de la página.
- Axes: dominio robusto elegido por el owner, mediana ± 4 rangos intercuartiles y siempre con la referencia adentro, redondeado a un paso limpio con 4 a 8 marcas.
- Memorable moment: enfocar un punto con Tab llena el panel con sus valores exactos y su lectura respecto de la referencia, y la fila de la tabla queda marcada.
- Constraints: el render lee la base personal y no escribe ni sale a la red; la descarga la dispara el cliente con la Server Action y corre como job durable; sólo el título de la línea de estado es región viva, el conteo no se anuncia; sin base, la negativa «Base personal no disponible»; runtime trabado, `RuntimeLockedNotice`; un código fuera de la taxonomía es la página de ruta inexistente. Las capturas del gate no muestran datos del owner (ADR 0006).
- Evidence (2026-09-30, base personal, Communication Services): axe 0 serious/critical y sin overflow horizontal en 1440 y 390 px, claro y oscuro; 23 puntos enfocables; 0 rótulos superpuestos medidos en el DOM a 1440, 1024 y 360 px.
- Evidence (2026-10-01, `F7-06`, dev server con datos reales): descarga Energy con referencia y 21 securities; axe 0 serious/critical y sin overflow a 1440 y 390 px; error 503 en línea y reintento exitoso.
- Evidence (2026-10-01, `F7-08`, dev server con datos reales): axe 0 serious/critical en 1440 oscuro y 390 claro, descargando y al día; sin overflow horizontal en los estados finales.
- Evidence (2026-10-01, `F7-07`, build con Energy real): calidad operativa y cinco componentes visibles; 1440 oscuro y 390 claro sin overflow y con axe 0 serious/critical. El acuerdo entre fuentes queda no evaluable.
- Evidence (2026-10-28, `F6-27`): Information Technology con 71 puntos medidos; 62 logos a 1440 y 29 a 390, el resto como puntos con logo al seleccionarlos. El S&P 500 lleva rombo ampliado y placa sólida por encima de las marcas. A 1440 claro/oscuro, 1024 claro y 390 claro/oscuro: 0 logos con solape superior a 30 %, 0 rótulos cruzados o sobre logos, 0 overflow, área de toque mínima de 24 px y axe 0 serious/critical. La geometría se revisó con monogramas locales; `F6-26` midió las imágenes y la caché de logo.dev.
- Evidence (2026-10-29, `F7-09` en progreso): AAPL seleccionado con cita literal del 10-K en PostgreSQL personal, revisado a 1440 y 390 px sin desborde horizontal y con axe 0 violaciones WCAG en ambas anchuras. La cita se publica sólo si el comando comprueba que aparece en Item 1; las demás empresas muestran ausencia explícita mientras se revisan.
- Unresolved: un overflow de 10 a 16 px a 1440 visto dos veces recién abierta la página durante una descarga, no reproducido en 31 muestras posteriores; un choque residual de rótulos a 390 px en un corte (27/09/2026) cuando un grupo fusionado no encuentra lado libre; el símbolo BYMA del CEDEAR, que el grafo no tiene; un gate visual con datos sintéticos sembrados en PostgreSQL.
