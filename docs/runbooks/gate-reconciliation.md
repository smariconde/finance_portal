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

Un residuo de magnitud menor al 1 % es `ok`: el patrimonio sin participaciones
no controlantes y la EPS con su numerador ajustado dejan restos legítimos. El
residuo lleva **signo**, porque el signo dice qué ajuste domina y tomar el valor
absoluto borraría la distinción. Un ancla ausente deja el chequeo
`not_evaluable`, nunca `ok`.

## Evidencia registrada

Tanda 1, doce empresas cubriendo los diez arquetipos, sobre el PostgreSQL
personal del 2026-09-21.

### Primera corrida, con `sec-core-concepts-2.0.0`

- **10 de 12 balances cierran en 0,0000 %**, incluidos un banco, una
  aseguradora, un REIT, un holding y una empresa en distress;
- **5 anclas de 84 no reportadas**, todas decisiones del filer;
- **4 residuos de EPS**, con signo: Duke −1,31 %, JPMorgan −2,31 %,
  Prologis +2,35 % y Carnival +2,61 %.

Los cuatro residuos no eran de la ingesta: **la EPS diluida no se calcula sobre
`NetIncomeLoss`** sino sobre un numerador que el filer reporta aparte, y la
selección no lo traía. El signo distinguía dos ajustes opuestos —por debajo del
resultado en Duke y JPMorgan, por encima en Prologis y Carnival—, que es la razón
por la que el residuo lleva signo.

### Segunda corrida, con `sec-core-concepts-3.0.0`

La selección sumó `NetIncomeLossAvailableToCommonStockholders{Basic,Diluted}` y
el puente de dividendos preferidos, y el chequeo pasó a usar ese numerador cuando
el emisor lo publica. Reingerir los doce costó **53 requests**, y las cifras
cierran el caso:

| Empresa  | Residuo con 2.0.0 | Residuo con 3.0.0 |
| -------- | ----------------- | ----------------- |
| Duke     | −1,3110 %         | −0,1859 %         |
| JPMorgan | −2,3059 %         | **+0,0083 %**     |
| Prologis | +2,3463 %         | +0,0646 %         |
| Carnival | +2,6101 %         | +0,0367 %         |

**Cero chequeos con residuo** sobre las doce. Las cinco empresas que no publican
el numerador —Apple, NVIDIA, Moderna, ExxonMobil y Berkshire— son justamente las
de estructura de capital simple, que ya cuadraban contra `NetIncomeLoss`: el
informe dice `numerador net_income` en esas y `net_income_to_common` en el resto.

Quedan cuatro chequeos `not_evaluable`, todos por anclas que el filer no publica:
Duke y Carnival no publican `us-gaap:Liabilities`, ExxonMobil no publica acciones
diluidas y Berkshire no publica ni EPS diluida ni acciones diluidas. Eso no se
arregla con una selección: son decisiones de quien presenta.
