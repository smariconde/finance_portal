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

## Dos trampas del anclaje

El ejercicio sale del **ancla que registró la ingesta** (`fp = FY`, ADR 0017), no
de buscar el período anual más reciente, y se busca a lo largo del **linaje**.
Las dos reglas las impuso un caso real cada una:

- un período de 365 días **no es** un ejercicio. Amazon publica cifras de doce
  meses móviles que terminan en cada cierre de trimestre; tomarlas por ejercicio
  pedía el balance a una fecha en la que no hay EPS publicada, y la hoja decía
  «no evaluable» sobre una empresa que sí tiene su ejercicio en la base;
- un **sucesor recién constituido** todavía no cerró un ejercicio. El de
  ExxonMobil se registró en julio de 2026 y su única presentación es un 10-Q, así
  que su ancla es un cierre de trimestre. El ejercicio del grupo está del lado
  del antecesor, y el ancla tiene que seguir al linaje igual que la historia
  (ADR 0011).

`selectFiscalYearEnd` toma el ancla más reciente del linaje en la que el linaje
efectivamente publicó anclas anuales. Sin ninguna devuelve `null`: no inventa una
fecha.

## Evidencia registrada

Las treinta empresas, sobre el PostgreSQL personal del 2026-09-21. La muestra se
bajó en dos tandas, con la selección corregida entre una y otra.

### Balance

**26 de 30 cierran**, y **24 en 0,0000 % exacto** — entre ellas tres bancos, tres
aseguradoras, tres REIT, dos holdings y dos empresas en distress. Los otros dos
quedan dentro de tolerancia (Charles River −0,5783 %, Deere −0,0481 %). Las
unidades, las escalas y los signos sobreviven a la ingesta en los diez
arquetipos.

Los 4 `not_evaluable` son filers que no publican `us-gaap:Liabilities` —Duke,
Amazon, Devon y Carnival—. No lo arregla ninguna selección: es una decisión de
quien presenta.

### EPS

**26 de 30 `ok`**, 15 de ellas contra el numerador propio de la EPS que trajo
`sec-core-concepts-3.0.0`. 3 `not_evaluable` —ExxonMobil no publica acciones
diluidas, Freeport no publica EPS diluida, Berkshire no publica ninguna de las
dos— y **1 residuo**: Norwegian Cruise Line, +3,8570 %.

El de Norwegian está explicado y no es nuestro: su EPS básica cuadra
(0,94 × 448.542.442 = 421,6 M contra 423,2 M, −0,37 %), pero la diluida usa
477.742.311 acciones —29 M más, de convertibles— y readiciona al numerador el
interés de esos convertibles. Norwegian no publica
`NetIncomeLossAvailableToCommonStockholdersDiluted`, así que el numerador
ajustado no está en la base. El chequeo lo marca para que alguien abra el filing,
que es exactamente su trabajo.

### Costo

|                                | requests         | base       |
| ------------------------------ | ---------------- | ---------- |
| Tanda 1, siete filers nuevos   | 39               | 14 → 16 MB |
| Reingesta de doce con la 3.0.0 | 53               | —          |
| Tanda 2, dieciocho filers      | 50               | 16 → 26 MB |
| **Total del día**              | **144 de 2.000** | **26 MB**  |

27.862 observaciones sobre 31 sujetos. El verificador del contrato pasa sobre
todas: 27.123 cadenas, 722 con restatement y 739 transiciones, sin una sola
falla.
