# ADR 0064: REIT de propiedades desde el XBRL y NAV opcional

- Estado: aceptado; `F6-22`
- Fecha: 2026-10-30
- Alcance: `F6-22`. Reemplaza en parte la [ADR 0044](0044-reit-affo-nav.md):
  la receta AFFO, el descuento y los controles siguen; cambian de dónde salen
  los componentes y si el NAV es obligatorio.
- Depende de: ADR 0040, 0044, 0055 y 0061

## Contexto

El job tenía que valuar REIT de propiedades sin intervención del owner. El
camino de la ADR 0044 no llegaba a ningún valor por dos motivos:

- **AFFO por IA desde el 10-K.** El 10-K 2025 de PLD trae 40 menciones a FFO y
  ninguna conciliación AFFO. Su suplemento suma partidas que la receta no
  representa. La transcripción terminaba siempre en negativa.
- **NAV obligatorio.** El NAV necesita un NOI forward y un cap rate fechados, con
  derechos registrados y de la misma cartera. JLL, CBRE y las tasas de
  operaciones del emisor no cumplen esas condiciones. Así, ninguna corrida podía
  armarse.

Medido el 2026-10-29 sobre el companyfacts de ocho REIT del índice (PLD, O, PSA,
EQR, AVB, SPG, WELL, EXR), con 8 requests SEC y sin IA:

| Componente                                                          | REIT que lo etiquetan |
| ------------------------------------------------------------------- | --------------------- |
| Resultado común (`NetIncomeLossAvailableToCommonStockholdersBasic`) | 8 de 8                |
| Depreciación (D&A, DDA o `Depreciation`)                            | 8 de 8                |
| Ganancia por venta de inmuebles                                     | 4 de 8                |
| Deterioro inmobiliario                                              | 4 de 8                |
| Capex de mantenimiento o leasing                                    | 4 de 8                |
| Renta lineal (`StraightLineRent`)                                   | 2 de 8                |
| Ajuste de JV a FFO                                                  | 0 de 8                |

Ninguno etiqueta los siete componentes. Con la regla «ausente nunca es cero»,
la receta de la ADR 0044 aplicada al XBRL rechazaba a los ocho.

## Decisión

### AFFO desde el XBRL (`affo-nav-1.1.0`, `reit-equity-1.1.0`)

`sec-core-concepts-10.0.0` y `annual-fundamentals-1.6.0` suman los conceptos.
Cada componente es una partida con alternativas en orden:

- depreciación: D&A, DDA y luego `Depreciation`. FFO también suma la
  amortización de intangibles de alquiler;
- ganancias: `GainsLossesOnSalesOfInvestmentRealEstate` y luego
  `GainLossOnSaleOfProperties`;
- deterioro: `ImpairmentOfRealEstate` y luego `AssetImpairmentCharges`;
- capex: `PaymentsForCapitalImprovements` y luego
  `PaymentsForLeasingCostsCommissionsAndTenantImprovements`;
- renta lineal: `StraightLineRent`;
- inmuebles netos: `RealEstateInvestmentPropertyNet`.

El resultado común y la depreciación son obligatorios: sin ellos el job nombra
`reit_affo_anchor_unavailable`. Un componente opcional que el filer no etiqueta
queda **no ajustado**: el motor no lo aplica, lo lista en
`reconciliation.notAdjusted` y `reit_affo_not_adjusted` deja la corrida en
revisión. Es el mismo patrón que las opciones no restadas de la ADR 0055. La
diferencia es que acá el sesgo puede ir en cualquier sentido, y el texto de la
página lo dice. El ajuste de JV no tiene concepto XBRL, así que siempre queda no
ajustado.

`derivedReit.affoBasis` congela el concepto que aportó cada componente. Si un
hecho y su concepto no coinciden, la corrida se rechaza.

### Base de propiedades medida

`propertyBasis = equity_property` se decide cuando los inmuebles netos son al
menos la mitad del activo total al cierre base. Por debajo, o sin el dato, el
job nombra `reit_property_basis_unavailable`. Esto reemplaza la declaración por
CIK de `F6-22`. Los ocho medidos dan entre 73 % y 93 %.

### Supuestos (`derived-reit-1.0.0`)

- **Crecimiento.** El crecimiento inicial del AFFO es la tendencia log-lineal de
  las ventas, con piso 0. Su techo es `0,3 × AFFO / patrimonio común`. Se
  sostiene cinco años y converge al risk-free en el décimo.
  - El techo de retención de 0,3 es una **decisión del proyecto**. Un REIT debe
    distribuir al menos el 90 % de su resultado imponible, y el payout sobre AFFO
    suele estar entre 70 % y 80 %. Crecer más de lo que retiene exigiría emitir,
    y el modelo no modela emisiones (ADR 0044).
- **Retorno sobre equity nuevo.** Arranca en AFFO ÷ patrimonio común y converge
  al costo de equity terminal: a perpetuidad, crecer no crea valor.
  - El patrimonio común es el etiquetado como común. Si no lo hay, el total menos
    el preferente. Sin preferente etiquetado, el total, y la base lo dice.
- **Beta.** Es la publicada de la industria en Damodaran
  (`derived-financial-risk-1.0.0`, sin Hamada) y converge a 1 en diez años.
  - El SIC 6798 es ambiguo entre `r-e-i-t` y `retail-reits`: el job le pide a la
    IA sólo la industria, con la tarea de la ADR 0033. Nada más se le pregunta.
- **Sin escenarios ni sensibilidad.** La sensibilidad de cap rate no tiene NAV
  sobre el que operar.

`reit_assumptions_derived_recomputed` reconstruye la participación inmobiliaria,
la base del AFFO y los supuestos desde lo congelado, y rechaza cualquier
diferencia.

### NAV opcional

Bajo `affo-nav-1.1.0`, `nav` y `assumptions.nav` pueden ser `null`, y entonces
lo son en todos lados: sin escenarios ni cap rates. `reit_nav_declared_absent`
deja la corrida en revisión y la página lo dice. El NAV no se estima con un cap
rate de mercado ni de operaciones puntuales.

### Opciones, fechas y job

- **Opciones de empleados.** Transcripción aceptada; si no, XBRL del mismo 10-K;
  si no, `not_subtracted` (ADR 0055).
- **Fechas.** Las acciones de la carátula y el corte siguen la regla de
  `excess-return-1.1.0`: anteriores o iguales al `as_of`, no idénticas. El
  ejercicio base no puede tener más de 380 días.
- **Job.** El job ya no llama a la transcripción AFFO. El servicio, sus tablas
  (`0042`–`0045`) y sus negativas registradas se conservan como historia.
  `0046` admite `affo_nav` entre los métodos que un job registra.

## Consecuencias

- Medido sobre una réplica de la base personal el 2026-10-30:
  - O: 52,39 contra 57,20 (P/V 1,09).
  - PSA: 326,06 contra 317,06 (0,97).
  - EXR: 112,06 contra 149,90 (1,34).
  - WELL: 30,00 contra 233,17 (7,77). En WELL, `PaymentsForCapitalImprovements`
    (USD 1.050 M) incluye redesarrollo, y su AFFO ÷ patrimonio (4,4 %) queda
    debajo del costo del equity. La corrida pide revisión y no se corrige a mano.
  - PLD y SPG se detienen en `shares_outstanding_unavailable`. Presentan dos
    registrantes, así que su carátula tiene dimensiones y companyfacts no trae
    `dei:EntityCommonStockSharesOutstanding`. La ADR 0040 prohíbe el conteo del
    balance como sustituto.
  - AVB y EQR no resuelven el ticker en el grafo.
- Las corridas `affo-nav-1.0.0` conservan su contrato, su resultado y sus
  hashes. `notAdjusted` es opcional y sólo existe en `1.1.0`.
- Es un screening: rigor `screening`, siempre `requires_review`.

## Alternativas

- **Declaración del owner por CIK** (NOI, cap rate y base). Es manual, y el
  owner pidió lo más automático posible.
- **Nueva receta que admita las partidas del suplemento.** Necesita IA por
  emisor y aun así no llega al NAV.
- **Rechazar todo componente ausente.** Con 0 de 8 completos, no valúa a nadie.
