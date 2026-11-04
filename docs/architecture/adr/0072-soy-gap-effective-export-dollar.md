# ADR 0072: brecha de la soja al dólar del exportador y fechas de la soja

- Estado: aceptada
- Fecha: 2026-11-04
- Alcance: `F9-15`, después de `F9-05` y `F9-14`.
- Relacionadas: [ADR 0068](0068-implied-ccl-adr-pairs.md) (CCL implícito,
  siempre al lado del oficial), [ADR 0071](0071-soy-basis-sources.md) (pizarra,
  BNA y Chicago).

## Contexto

El owner vio en la brecha Rosario–Chicago un pico de +37,6 % el 2023-11-24 y
preguntó si era un dato roto. No lo es: la pizarra en pesos subió 25 % en una
semana después del balotaje, y `soy-basis-1.0.0` la divide por el BNA
comprador, que ese día era 356,60. El exportador no cobraba a ese dólar: entre
2022 y 2025 hubo tres «dólar soja» con tasa fija, un Programa de Incremento
Exportador que dejaba liquidar una parte al contado con liquidación y el
«dólar blend». La ADR 0071 ya lo decía en la metodología, pero el gráfico no lo
mostraba. El owner también pidió marcar fechas del mercado de la soja
—retenciones, cosecha— para decidir cuándo vender.

## Medición (2026-11-04)

Con los datos de Production, el CCL implícito de `ccl-implied-1.0.0` y los
tramos declarados abajo, mediana de la brecha por tramo:

| Tramo                     | Días | Al BNA oficial | Al dólar del exportador |
| ------------------------- | ---: | -------------: | ----------------------: |
| Dólar soja I ($ 200)      |   18 |        −11,6 % |                 −37,4 % |
| Dólar soja II ($ 230)     |   21 |         +1,7 % |                 −23,6 % |
| Dólar soja III ($ 300)    |   28 |        −13,9 % |                 −34,2 % |
| 75/25 CCL                 |   23 |         −3,8 % |                 −25,7 % |
| 70/30 CCL                 |    6 |         +6,1 % |                 −26,9 % |
| 50/50 CCL                 |   10 |        +24,4 % |                 −29,0 % |
| Blend 80/20               |  311 |        −23,2 % |                 −25,9 % |
| Sin régimen (2021 a 2026) |  590 |  −20,5 a −29,4 |                 iguales |

Un solo día mezclado no tuvo CCL. Fuera de los tramos quedan lecturas de −6 a
−11 % entre octubre de 2025 y enero de 2026, sin régimen cambiario y con la
retención bajando al 24 % el 2025-12-12: la página las muestra con sus marcas
y no las explica.

Las fechas y alícuotas se verificaron contra el texto de cada norma o su
reproducción profesional (Boletín Oficial, estudios jurídicos, BCR) el mismo
día. Una corrección respecto de lo dicho al owner: el Decreto 549/2023 fue
70/30, no 50/50; el 50/50 llegó con el 597/2023.

## Decisión

1. **Tramos declarados del dólar exportador** (`soy-export-fx-regimes-1.0.0`,
   `soy-export-fx.ts`), de inicio inclusivo y fin exclusivo, cada uno con su
   norma: Dólar soja I ($ 200, Decreto 576/2022), II ($ 230, 787/2022), III
   ($ 300, 194/2023, el capítulo de la soja hasta el 31/5/2023), 75/25 CCL
   (443/2023 y 492/2023), 70/30 CCL (549/2023), 50/50 CCL (597/2023) y Blend
   80/20 (DNU 28/2023 hasta el DNU 269/2025, vigente el 14/4/2025). El dólar de
   $ 340 del Decreto 378/2023 fue para economías regionales y no entra.
2. **Brecha al dólar del exportador** (`soy-effective-basis-1.0.0`): la tasa del
   programa, o la parte declarada del BNA comprador —el dólar con que convierte
   la pizarra— más el resto al CCL implícito **del mismo día**. Un día mezclado
   sin CCL es `missing_ccl`, nunca el CCL de otro día. Fuera de los tramos es la
   brecha oficial. Va **al lado** de la oficial, como el CCL junto al
   mayorista (ADR 0068), nunca en su lugar.
3. **Retenciones al poroto** (`soy-market-events-1.0.0`,
   `soy-market-events.ts`): cada cambio desde el Decreto 37/2019 con su
   alícuota y su norma, incluidos los escalones de la baja temporal de 2020,
   el 0 % del Decreto 682/2025 hasta su cupo y el cronograma del 423/2026. Antes
   de diciembre de 2019 no hay alícuota declarada: una lectura de esa época no
   tiene una adivinada.
4. **Cosecha**: abril a junio de cada año, sombreado como convención del
   proyecto, dicho así en la página; no es un calendario medido.
5. **Superficie**: el gráfico de la soja dibuja estas fechas en lugar de los
   regímenes generales (`ChartContext` de `TimelineChart`), conserva las
   presidencias, y la franja y la etiqueta dicen el tramo y la retención del
   día. «Basis» pasa a «Brecha Rosario–Chicago» en la página (pedido del
   owner); la metodología conserva el término del mercado.

## Consecuencias

- La lectura es `argentina-dashboard-2.2.0`; el CCL ya se leía para el bloque
  del dólar y no suma consultas.
- Un tramo o una retención nueva es un cambio de código revisable con su
  norma, como un régimen de `argentina-timeline-1.0.0`.
- La brecha sigue sin descomponerse en retención, prima FOB y fobbing; eso y la
  decisión de vender o guardar (curva de futuros, costo de almacenaje) piden
  fuentes que todavía no se midieron.
