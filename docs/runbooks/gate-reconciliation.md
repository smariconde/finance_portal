# Reconciliar la muestra del gate contra los filings

- Slice: `F2-07`, incremento 2
- Muestra declarada: [`declared-gate-sample.ts`](../../src/modules/fundamentals/application/declared-gate-sample.ts)
- Runtime: personal local o protegido, con PostgreSQL. No sale a la red y no
  escribe nada.

El gate de la Fase 2 pide treinta empresas de arquetipos distintos reconciliadas
contra su filing. Este comando arma la hoja que se pone al lado del filing, y
decide solo lo único que se puede decidir sin abrirlo: que los números cierren
entre sí.

## Por qué el arquetipo se declara

Nada en la base puede decir de qué arquetipo es una empresa: no hay columna de
sector, industria ni SIC, y la clasificación versionada es `F7-02`, que el
roadmap ejecuta después de esta fase. El dato existe gratis —el `submissions`
que ya se baja en cada ingesta trae `sic` y `sicDescription`— pero persistirlo es
esa otra decisión, no ésta.

Así que el arquetipo se declara, como las sucesiones y los eventos corporativos:
configuración revisada, un diff que se lee, con el motivo de cada elección al
lado. `assertGateSample` se niega a arrancar si la muestra repite una empresa,
deja un arquetipo sin representante, o si la primera tanda no llega a los diez.

## Procedimiento

```sh
pnpm gate:reconcile                 # la tanda 1
pnpm gate:reconcile --batch 2
pnpm gate:reconcile --ticker JPM
pnpm gate:reconcile --json          # la hoja como evidencia
```

La lectura pasa por `readLineageObservations`, el mismo camino que usa la
aplicación, con `latest_restated`: se reconcilia contra la presentación más
reciente que enmendó cada número.

Todas las anclas se piden al **cierre del último ejercicio publicado**, también
las de balance. Mezclar el balance del último trimestre con el resultado del
ejercicio obligaría a abrir dos presentaciones para reconciliar una sola hoja.

## Las anclas

Siete: ingresos, resultado, activo, pasivo, patrimonio, EPS diluida y acciones
diluidas. Cada una declara **conceptos alternativos en orden**, y la salida dice
cuál dio el número. Eso es lo contrario de una sustitución silenciosa: la
alternativa está escrita, revisada y nombrada.

Hizo falta porque los arquetipos no reportan lo mismo, y se midió antes de
escribirlo: Apple no publica `us-gaap:Revenues` sino
`RevenueFromContractWithCustomerExcludingAssessedTax`, Duke usa la variante
`IncludingAssessedTax`, Caterpillar publica el patrimonio con participaciones no
controlantes y JPMorgan publica `Revenues` siete veces contra cuarenta de
Progressive.

Un ancla sin ninguna de sus alternativas queda **no reportada**, que es un
resultado y no un cero.

## Los dos chequeos

| Chequeo              | Qué compara                                         |
| -------------------- | --------------------------------------------------- |
| `balance_sheet`      | Activo contra pasivo más patrimonio.                |
| `earnings_per_share` | Resultado contra EPS diluida por acciones diluidas. |

No prueban que el número sea el del filing —para eso hay que abrirlo, y por eso
la hoja trae la URL de cada presentación—. Prueban que la unidad, la escala y el
signo hayan sobrevivido a la ingesta, que es un error de órdenes de magnitud y
no de puntos porcentuales.

Un residuo por debajo del 1 % es `ok`: el patrimonio sin participaciones no
controlantes y la EPS con dividendos preferidos dejan restos legítimos. Un ancla
ausente deja el chequeo `not_evaluable`, nunca `ok`.

## Evidencia registrada

Tanda 1, doce empresas cubriendo los diez arquetipos, sobre el PostgreSQL
personal del 2026-09-21:

- **10 de 12 balances cierran en 0,0000 %**, incluidos un banco, una
  aseguradora, un REIT, un holding y una empresa en distress. Las unidades, las
  escalas y los signos sobreviven a la ingesta en todos los arquetipos;
- **5 anclas de 84 no reportadas**, todas decisiones del filer: Duke Energy y
  Carnival no publican `us-gaap:Liabilities`, ExxonMobil no publica acciones
  diluidas, y Berkshire no publica ni EPS diluida ni acciones diluidas;
- **4 residuos de EPS**: Duke 1,31 %, JPMorgan 2,31 %, Prologis 2,35 % y
  Carnival 2,61 %.

### El hallazgo

Los cuatro residuos tienen la misma causa, y es un agujero de la selección de
conceptos, no de la ingesta: **`sec-core-concepts-2.0.0` no incluye
`us-gaap:NetIncomeLossAvailableToCommonStockholdersDiluted`**, que es el
numerador del que la EPS sale. Para un emisor con dividendos preferidos o
participaciones no controlantes, `NetIncomeLoss` no es lo que se divide por las
acciones diluidas, así que el residuo no se puede explicar con lo que hay
guardado.

No se corrigió acá a propósito: cambiar la selección es subirle la versión y
volver a ingerir los trece filers, y eso es un slice con su propia medición. El
gate existe para que esto se vea, y queda escrito.
