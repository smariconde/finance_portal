# ADR 0041: exceso de retorno sobre equity para bancos y aseguradoras

- Estado: aceptado; modelo `experimental`
- Fecha: 2026-10-20
- Alcance: `F4-06`, primer slice (4.1)
- Depende de: [ADR 0003](0003-decimal-arithmetic-valuation-engine.md),
  [ADR 0031](0031-on-demand-company-assessment.md),
  [ADR 0039](0039-coherent-valuation-scenarios.md) y
  [ADR 0040](0040-failure-probability-employee-options.md)

## Contexto

El selector identifica bancos y aseguradoras, pero hasta este slice devuelve
`method_not_implemented`. Un depósito o una reserva de seguros no es una deuda
industrial que se reste del enterprise value. La valuación necesita un contrato
de equity independiente: patrimonio común, ROE, distribución y costo de equity.

El [roadmap](../../finance-portal-masterplan/06_PHASED_ROADMAP.md) autoriza los
arquetipos de a uno, con fórmulas, fixtures independientes, diagnóstico, estado
del modelo y contraste con la planilla pública correspondiente.

## Decisión

Se implementa `excess_return`, motor `excess-return-1.0.0`, metodología
`financial-equity-1.0.0`, en dominio puro con la política decimal compartida.
`ExcessReturnInput` y `ExcessReturnRun` son contratos propios. La persistencia
acepta la unión cerrada de los dos métodos en `valuation_runs`, sin migración.
El repositorio y `valuation:replay` despachan por método; un resultado financiero
no tiene los campos de una proyección FCFF.

### Fórmulas y convenciones

Para cada año explícito:

```text
NI[t] = common_book[t-1] × ROE[t]
distributions[t] = NI[t] × payout[t]
retained[t] = NI[t] - distributions[t]
common_book[t] = common_book[t-1] + retained[t]
Ke[t] = risk_free + equity_beta[t] × mature_ERP + CRP
excess[t] = NI[t] - Ke[t] × common_book[t-1]
discount[t] = 1 / product(1 + Ke[1..t])
```

El primer patrimonio terminal es el cierre del último año explícito, sin
aplicarle `g` otra vez. En estado estable, `retention = g / ROE`,
`payout = 1 - retention` y `TV_excess = book[N] × (ROE - Ke) / (Ke - g)`.
El valor de equity es el patrimonio inicial más los valores presentes de los
excesos y del terminal. Un retorno excedente negativo se conserva.

Se restan una sola vez las opciones que recalcula `employee-equity-claim-1.0.0`
con la libre de riesgo del snapshot, y se divide por acciones en circulación
más unidades no consolidadas. No se restan depósitos, reservas, deuda o caja
como si este resultado fuera enterprise value. La probabilidad de fracaso
del rating sintético de no financieras no se aplica a este equity.

### Admisión y tiempo

- Sólo evidencia visible de `bank` o `insurer`; el preflight financiero no usa
  la completitud FCFF. La selección financiera pasa a
  `method-selection-0.3.0`; las demás decisiones conservan `0.2.0`.
- Patrimonio común positivo y acciones medidos al `asOf`; el patrimonio excluye
  preferentes y participaciones no controlantes. El motor no los presume cero.
- Libre de riesgo, ERP y CRP son hechos fechados, con moneda y procedencia;
  las betas de equity son supuestos explícitos. No se usa Hamada con depósitos.
- Ningún hecho o clasificación posterior al cutoff decide un `as_known`.
  La aceptación de la nota de opciones se declara aparte del registro accionario.
- Este contrato no tiene `recordedAt` por hecho: rechaza la base
  `system_recorded`, en vez de afirmar una consulta que no puede demostrar.
- ROE explícito no negativo, payout en `[0,1]`, beta no negativa y Ke positivo.
  Terminal con ROE positivo, `0 <= g <= ROE`, `g <= risk_free` y
  `Ke > g + 0.005`. Patrimonio negativo, recapitalizaciones, distribuciones
  extraordinarias y transición desde pérdidas requieren otro incremento.

### Incertidumbre y estado

Bear y bull son pronósticos completos con motivo, mismo horizonte y cambio
económico comprobable; se recalculan y pasan los mismos checks. Un rechazo
en un escenario rechaza la corrida; un orden invertido pide revisión.
La sensibilidad varía **beta terminal y g**, dejando fija la trayectoria
explícita y los hechos de riesgo. Publica el Ke terminal derivado en cada fila;
máximo 11 × 11, con celdas inválidas nombradas.

El modelo es `experimental`, rigor `screening` y siempre `requires_review`.
Capital regulatorio, calidad de préstamos o suficiencia de reservas y clean
surplus tienen diagnósticos propios cuando falta una revisión. Una explicación
escrita por el owner no certifica esos controles ni eleva el rigor. CRP por
domicilio conserva su aproximación visible. La automatización del snapshot
desde filings y la superficie por ticker son incrementos posteriores; no se
declara cobertura productiva de los bancos reales por tener fórmulas.

### Operación

`pnpm valuation:financial --file <snapshot-privado.json>` calcula sin red ni
escrituras. `--apply` exige runtime personal y registra la corrida, incluido
un rechazo. El archivo es un snapshot explícito del owner, no un endpoint,
un proveedor ni una propuesta IA nueva. No hay claves ni payloads del owner
versionados. Los checks de estructura fallan antes de abrir la base.

## Alternativas

- **DDM como motor principal:** válido, pero el exceso de retorno hace visible
  si la franquicia crea valor por encima del patrimonio. El DDM se usa como
  cálculo alternativo en tests bajo clean surplus.
- **Extender el input FCFF con campos opcionales:** exigiría datos irrelevantes
  o ausencias ficticias de EBIT, caja y deuda, y facilitaría mezclar WACC/Ke.
- **Elegir parámetros por defecto y habilitar full:** los estados consolidados
  no prueban patrimonio común, suficiencia de reservas ni capital distribuible.
  Se conserva el estado experimental y se nombran los límites.

## Verificación y consecuencias

La [comparación independiente](../../valuation/financial-equity-oracle.md)
reproduce los diez años y el terminal no nulo de `eqexret.xls`. Otra fixture
reconcilia contra DDM y el caso ROE = Ke vale exactamente el patrimonio.
Tests cubren nulos, cero, negativos, no finitos, moneda, cutoff, payout,
reinversión terminal, opciones, escenarios, sensibilidad y monotonía.
PostgreSQL verifica lectura exacta, idempotencia, convivencia de métodos y
rechazos; el replay usa sólo el JSON congelado.

No cambia `fcff-1.6.0`, su metodología, sus números ni sus hashes. No hay
migración, proveedor, dependencia, endpoint o llamada a un modelo nueva.
Rollback: revertir el código sólo si no existen corridas financieras; si ya
existen, conservar su lector y motor para poder reproducirlas. No borrarlas.

Revisar esta decisión al automatizar patrimonio común y capital regulatorio,
admitir pérdidas o recapitalizaciones, o elevar el estado del modelo.

## Fuentes primarias

- [Damodaran, Valuing Financial Service Firms](https://pages.stern.nyu.edu/~adamodar/pdfiles/papers/finfirm09.pdf), modelo de equity y clean surplus.
- [Catálogo de planillas de Damodaran](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/eqspread.htm), `eqexret.xls`.
- [Planilla pública eqexret.xls](https://www.stern.nyu.edu/~adamodar/pc/eqexret.xls), fórmulas y referencia numérica verificadas el 2026-10-20.
