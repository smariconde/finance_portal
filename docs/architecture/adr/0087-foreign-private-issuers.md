# ADR 0087: emisores extranjeros que presentan 20-F

- Estado: aceptado (decisiones del owner del 2026-11-25); la implementación sale
  en slices propios
- Fecha: 2026-11-25
- Alcance: `F6-54`, sólo medición y decisión. Amplía la
  [ADR 0084](0084-followed-filers-outside-sp500.md), que negaba los 20-F y 40-F
  como `foreign_private_issuer`.
- Decisiones relacionadas: [ADR 0026](0026-daily-prices-source.md) (precios de
  Yahoo, `owner_accepted`), [ADR 0032](0032-damodaran-reference-datasets.md)
  (las releases de Damodaran), [ADR 0033](0033-ai-layer-industry-resolution.md)
  (secciones para la IA), [ADR 0081](0081-ttm-base-period.md) (base TTM),
  [ADR 0082](0082-captive-finance-split.md) (el instance XBRL del filing).

## Contexto

TSM, ASML, NVO, SPOT y NU se pidieron desde `/valuacion` y se negaron por
presentar 20-F. Medido el 2026-11-25 con el egress del proyecto, 21 pedidos a la
SEC: la tabla de tickers; `submissions` y `companyfacts` de los cinco; el instance
XBRL y el documento principal de su 20-F de 2025. Nada se guardó en el
repositorio.

| Ticker | CIK        | Domicilio    | Normas  | Moneda | Último 20-F | `companyfacts` 2025 | Cotiza como      |
| ------ | ---------- | ------------ | ------- | ------ | ----------- | ------------------- | ---------------- |
| TSM    | 0001046179 | Taiwán       | IFRS    | TWD    | 2026-04-16  | 2 hechos            | ADS = 5 acciones |
| ASML   | 0000937966 | Países Bajos | US GAAP | EUR    | 2026-02-25  | 696 hechos          | acción NY 1:1    |
| NVO    | 0000353278 | Dinamarca    | IFRS    | DKK    | 2026-02-04  | 460 hechos          | ADS = 1 acción B |
| SPOT   | 0001639920 | Luxemburgo   | IFRS    | EUR    | 2026-02-10  | 492 hechos          | acción ordinaria |
| NU     | 0001691493 | Islas Caimán | IFRS    | USD    | 2026-04-08  | ninguno             | acción clase A   |

Lo que la medición enseñó:

- **Conceptos.** NVO y SPOT publican en `ifrs-full` todo lo que el FCFF lee:
  ingresos (`Revenue`), resultado operativo
  (`ProfitLossFromOperatingActivities`), resultado antes de impuestos, impuesto,
  efectivo, préstamos (`Borrowings`), arrendamientos (`LeaseLiabilities`),
  costos financieros, I+D, capex, patrimonio de la controlante, EPS diluido y
  acciones ajustadas. A SPOT le falta la depreciación agregada. ASML publica en
  `us-gaap` pero en EUR, con los conceptos de hoy salvo resultado antes de
  impuestos, intereses y arrendamientos.
- **`companyfacts` no siempre tiene el último 20-F.** El de TSM aportó dos
  hechos y el de NU ninguno, presentados en abril de 2026; los de febrero sí
  están. El instance del 20-F (`<documento>_htm.xml`) sí trae los conceptos (TSM:
  406 conceptos `ifrs-full`, taxonomía 2025-03-27, la misma que SPOT), así que el
  último ejercicio se lee del instance cuando `companyfacts` no lo integró.
- **Sin interinos.** Ningún 6-K trae XBRL desde 2021 (TSM y NVO lo hacían antes).
  La base es anual: no hay TTM (ADR 0081) para un 20-F.
- **Ratio del ADS.** No está en la carátula XBRL: TSM declara «Common Shares» en
  `dei:Security12bTitle` y el texto dice «each ADS represents five (5) common
  shares»; NVO no lo dice en el 20-F. SPOT, ASML y NU cotizan la acción misma.
- **Secciones para la IA.** El 20-F ordena por ítems: Item 4 (información sobre
  la compañía, con 4.B «Business Overview») ocupa el lugar del Item 1 del 10-K, e
  Item 5 («Operating and Financial Review and Prospects») el del MD&A. TSM, NVO,
  SPOT y NU los tienen como encabezados; el de ASML es un informe anual integrado
  con un índice de referencias cruzadas y sin encabezados de ítem.
- **NU** es financiera (SIC 6199, sin perfil) y publica casi todo en su propia
  extensión (3.225 hechos `nu:` contra 995 `ifrs-full`).

## Decisión 1 del owner — se valúa en la moneda de reporte

La proyección, el costo de capital y el valor por acción van en la moneda de los
estados (TWD, DKK, EUR), con una tasa libre de riesgo **de esa moneda**; sólo el
valor por acción se convierte a dólares al tipo de cambio del día de la
valuación, para compararlo con el precio del ADS dividido por su ratio. Convertir
la historia a dólares haría leer una devaluación como una caída de ventas.

Queda por medir en el primer slice de implementación, antes de codificar, de
dónde sale la tasa libre de riesgo en DKK, EUR y TWD: Damodaran publica tasas por
moneda; si no alcanza, el diferencial de inflación sobre la tasa en dólares. Las
primas de riesgo país siguen saliendo de Damodaran por domicilio (Taiwán,
Dinamarca, Luxemburgo); el mix de operaciones de la ADR 0034 aplica igual.

## Decisión 2 del owner — el tipo de cambio sale de Yahoo

Pares de Yahoo (`EURUSD=X`, `DKKUSD=X`, `TWDUSD=X`) con la misma ingesta y los
mismos derechos `owner_accepted` que los precios: el cierre del mismo día que el
precio del ADS, nunca el de otro día. La serie se guarda cruda y fechada, como
`^SP500TR` (fuera del grafo de identidad). La Fed H.10 se descartó porque se
publica con hasta una semana de atraso.

## Decisión 3 del owner — primero SPOT, NVO y TSM

- **Primer slice:** los tres IFRS no financieros. Admitir el 20-F en
  `followed-filer-eligibility` sólo para ellos (declarados por CIK), leer
  `ifrs-full` con su propia selección de conceptos, completar el último ejercicio
  desde el instance del 20-F cuando `companyfacts` no lo tiene (TSM), base anual,
  ratio del ADS declarado por el owner con la cita del 20-F cuando existe, y las
  tareas de IA sobre Item 4 e Item 5.
- **Después:** ASML (US GAAP en EUR; su informe integrado necesita leer el índice
  de referencias cruzadas para las secciones).
- **Fuera:** NU, hasta que haya un perfil para financieras como la 6199 y una
  lectura de sus conceptos de extensión.

## Consecuencias

- Un ticker sigue sin 20-F hasta que su CIK esté declarado: nada se constituye a
  partir de una lista ajena (ADR 0084).
- La comparación precio/valor depende del cierre del ADS, del ratio declarado y
  del tipo de cambio del mismo día; si falta uno, la comparación se nombra y no se
  muestra, como en `market-price-comparison-1.0.0`.
- Las corridas de 20-F no tienen TTM ni consenso garantizado (Alpha Vantage cubre
  los ADS en USD, que no es la moneda de valuación): el camino de crecimiento de
  años 1 y 2 sigue siendo la tendencia histórica cuando el consenso no está en la
  moneda de reporte.
