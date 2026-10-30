# Divergencias fundamentales: fórmulas, límites y golden dataset

Estado del golden: `pending_owner`. Lo propuso el agente y falta la revisión del
owner, caso por caso, contra la columna «Cuenta a mano». Hasta entonces la
corrección del dataset es provisoria, como la de los evals de la IA (ADR 0035).

Documento de referencia de la matriz de divergencias (`F8-01` a `F8-04`, ADR 0016
§5). Las pruebas están en
[`divergence-golden.test.ts`](../../src/modules/divergences/domain/divergence-golden.test.ts)
y [`divergence-properties.test.ts`](../../src/modules/divergences/domain/divergence-properties.test.ts).

## Fórmulas

| Versión                            | Qué calcula                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fiscal-endpoints-1.4.0`           | Dos cierres fiscales a 2 o 5 años (±45 días), el precio del cierre o de los siete días corridos anteriores, EPS diluido, net income, acciones al cierre y diluidas promedio, todo visible al corte `as_known`.                                    |
| `fiscal-split-basis-1.2.0`         | Lleva precio crudo, EPS y acciones a la última base de split que la SEC confirmó antes del corte. Un split de mercado sin su acción SEC con el mismo ratio y orden de publicación deja la punta sin base (`split_evidence_missing_or_ambiguous`). |
| `divergence-views-1.1.0`           | `años = días / 365,2425`; `CAGR = ((final / inicial)^(1 / años) − 1) × 100`, sólo entre dos puntas estrictamente positivas.                                                                                                                       |
| Vista principal                    | `brecha = CAGR(EPS diluido) − CAGR(market cap)`.                                                                                                                                                                                                  |
| Sesgo por acciones                 | `share_count_bias_pp = CAGR(precio) − CAGR(market cap)`; marcado si `\|sesgo\| > 2 pp` (decisión del owner).                                                                                                                                      |
| Brecha por acción                  | `CAGR(EPS) − CAGR(precio) = brecha − sesgo`.                                                                                                                                                                                                      |
| Brecha agregada                    | `CAGR(net income) − CAGR(market cap)`.                                                                                                                                                                                                            |
| Market cap                         | Precio × acciones al cierre en las dos puntas; si falta alguna, precio × diluidas promedio en las dos (decisión del owner). Nunca mezcla bases y siempre nombra la que usó.                                                                       |
| `dilution-bridge-1.0.0`            | Por punta: dilución potencial `diluidas / básicas − 1` y acciones implícitas `numerador / EPS` contra las diluidas, dentro del redondeo impreso. Entre vistas: `agregada − por acción = efecto en beneficios − efecto en valor`.                  |
| `sector-divergence-download-1.0.0` | Qué baja el botón: SEC de los filers sin corrida anclada y siete años de precios (`fiscal-price-history-1.0.0`) donde falta un cierre fiscal (ADR 0064).                                                                                          |

## Límites declarados

- **No es una señal.** Arriba de la diagonal, las ganancias crecieron más que el
  valor de mercado; eso no dice que la acción esté barata. La página lo escribe
  junto al gráfico y nunca muestra una brecha sola como recomendación.
- **Beneficios no positivos.** Una punta con EPS o net income cero o negativo no
  tiene tasa: se nombra como «Pasó a ganancia», «Pasó a pérdida» o «Pérdida en
  ambas», nunca como un porcentaje ni un cero.
- **Clases múltiples.** Con varias clases sin reconciliar no hay market cap ni
  respaldo con diluidas (GOOGL, FOXA, NWSA).
- **EPS de operaciones continuas.** Si el emisor sólo publica el EPS de
  operaciones continuas, el puente no concilia contra el net income total y se
  nombra (`reconciled: false`).
- **Precio.** Yahoo Finance, crudo y desajustado con sus splits fechados; sin
  derecho contractual (`owner_accepted`). Si no hay cierre en los siete días
  anteriores al cierre fiscal, la vista no tiene valor.
- **Cobertura.** Sólo lo bajado: un sector sin fundamentales muestra cuánto
  costaría bajarlos, nunca puntos inventados.
- **Outliers.** El gráfico recorta al dominio robusto y marca el punto con una
  flecha; la tabla conserva el valor exacto con la misma marca.

## Golden dataset

Filers sintéticos, porque los precios de Yahoo no se pueden congelar en el
repositorio (ADR 0026). Cada valor esperado se calculó fuera del código con
Python `Decimal` a 50 dígitos y se compara a ocho decimales. Ejercicios al 31 de
diciembre; corte `as_known` el 2026-03-01.

| Caso                    | Entradas (inicial → final)                                                                                                  | Cuenta a mano                                                       | Esperado                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| G1 recompras            | 2023 → 2025: precio 100 → 121; acciones 1.000 → 900; NI 5.000 → 5.400; EPS 5 → 6                                            | años = 731 / 365,2425 = 2,00141002; MC 100.000 → 108.900            | MC +4,35202869 %; EPS +9,53747633 %; brecha +5,18544764; sesgo +5,64058534 (marcado); puente concilia |
| G2 dilución             | precio 100 → 100; acciones 1.000 → 1.100; NI 5.000 → 6.050; EPS 5 → 5,5                                                     | precio sin cambio: el sesgo es −CAGR(MC)                            | MC +4,87736364 %; brecha 0; sesgo −4,87736364 (marcado); agregada +5,11525040                         |
| G3 split 4:1            | 2020 → 2025 (5 años): crudo 200 × 250 acc., EPS 8; split de mercado 2022-01-10 y de la SEC 2022-02-28 → 60 × 1.000, EPS 3,2 | base nueva: 50 × 1.000, EPS 2; años = 1.826 / 365,2425 = 4,99941819 | MC +3,71416905 %; EPS +9,85725609 %; brecha +6,14308704; sesgo 0                                      |
| G4 outlier              | EPS 0,1 → 5; precio 20 → 30                                                                                                 | (50)^(1/2,00141002) − 1                                             | EPS +606,13303212 %; brecha +583,67603651; sin recorte en el dato                                     |
| G5 respaldo             | sin acciones al cierre; diluidas 1.050 → 1.000; precio 40 → 44; EPS 4 → 4,6                                                 | MC con diluidas: 42.000 → 44.000                                    | MC +2,35158589 %; brecha +4,88118762; sesgo +2,52577774 (marcado)                                     |
| G6 pérdidas             | EPS −1 → 2, 1 → −2, −1 → −2, 0 → 2                                                                                          | una punta ≤ 0 no tiene CAGR                                         | categorías; brecha `null`; el MC conserva su tasa                                                     |
| G7 tolerancia de precio | cierre 7 y 8 días antes del 2025-12-31                                                                                      | `FISCAL_PRICE_MAX_LAG_DAYS = 7`                                     | 7 días: igual que G1; 8 días: sin valor (`price_near_fiscal_close`)                                   |
| G8 restatement          | EPS 2025 revisado a 6,6, aceptado el 2026-04-15 o el 2026-02-20                                                             | la revisión entra sólo si se aceptó antes del corte                 | después: EPS 6 y brecha de G1; antes: EPS 6,6                                                         |
| G9 sin look-ahead       | corte 2025-06-30                                                                                                            | el 10-K de 2025 todavía no existe                                   | último cierre 2023, sin par a 2 años (`no_comparable_year`)                                           |

## Propiedades

Generador con semilla fija y 150 casos por propiedad, sin dependencia nueva:

1. Las identidades son exactas: brecha = CAGR(y) − CAGR(x), brecha = por acción +
   sesgo, y diferencia entre vistas = efecto en beneficios − efecto en valor.
2. Un split confirmado por la SEC entre las puntas no mueve ninguna tasa (ratios
   2, 3, 4, 5, 10 y 20).
3. Un split sin confirmación de la SEC antes del corte no se ajusta: no hay tasa
   por acción.
4. Escalar los beneficios no mueve sus tasas.
5. Un beneficio no positivo nunca da una tasa ni un cero, y el lado del mercado
   no depende de él.
6. Una revisión aceptada después del corte nunca cambia el resultado.
7. Las tasas extremas (razones de 10⁻⁶ a 10⁶) son finitas, canónicas, mayores que
   −100 % y del signo de su razón.
