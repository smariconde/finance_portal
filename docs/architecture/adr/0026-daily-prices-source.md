# ADR 0026: precios diarios — fuente, derechos y base de ajuste

- Estado: propuesto
- Fecha: 2026-09-22
- Alcance: resuelve `F7-01`. Elige la fuente de precios diarios, declara sus
  derechos sin maquillarlos, decide **en qué base se guarda una serie de precios**
  y qué guarda la fila. No decide los parámetros del Sortino (`F7-04`, que sigue
  siendo una decisión del owner) ni la matriz (`F7-05`).
- Decisiones relacionadas: [ADR 0004](0004-personal-first-runtime.md) (no hay
  superficie pública), [ADR 0009](0009-egress-boundary.md) (la única puerta de
  salida), [ADR 0012](0012-stock-splits-share-basis.md) (ajuste por splits como
  política de lectura), [ADR 0016](0016-analysis-scope-sector-matrices.md) (dejó
  la fuente abierta), [ADR 0020](0020-source-daily-budget-kill-switch.md) (cuota
  diaria), [ADR 0025](0025-declared-sector-classification.md) (la población del
  sector que estas series van a poblar)

## Contexto

La [ADR 0016](0016-analysis-scope-sector-matrices.md) §7 dejó la fuente de
precios explícitamente abierta con dos candidatas y una tensión sin resolver: el
owner aprobó Yahoo para uso personal el 2026-08-25, y el masterplan advierte
contra depender de endpoints no contractuales.

Al preparar el slice se revisaron los términos de las candidatas antes de
escribir esta ADR, y el resultado reordenó la Fase 7 —`F7-02` se entregó
primero—. Lo medido entonces, que queda registrado en la
[matriz de uso](../../data/provider-use-matrix.md):

- **Tiingo** era la mejor candidata por contrato y por payload, hasta leer el
  §1.6(a) de sus ToU: el plan gratuito **prohíbe persistir el dato en una base**,
  nombrando `databases` entre los sistemas alcanzados. Es exactamente lo que este
  slice construye. Su plan pago (USD 30/mes) sí lo permite;
- **Alpaca** sigue en `blocked_rights` por la misma razón desde la Fase 0;
- **Yahoo** funciona sin credencial pero no concede nada por contrato.

El owner decidió el 2026-09-22, sobre esa evidencia, **usar Yahoo** en vez de
pagar un plan o incumplir un contrato aceptado. El razonamiento que se registra
porque importa para la condición de revisión: entre una fuente con un contrato
que se firmaría para después incumplirlo y una fuente sin contrato ninguno, la
segunda expone menos —no hay cuenta que cancelar, ni cláusula que romper, ni
interruptor del lado del proveedor—.

## Decisión 1 — la fuente es Yahoo Finance, declarada como lo que es

`yahoo-finance`, endpoint `query1.finance.yahoo.com/v8/finance/chart/<symbol>`,
sin credencial, una request por security para cinco años de cierres diarios más
splits y dividendos fechados.

**Lo que se declara, sin maquillar:** no hay concesión contractual de ninguna
clase. El endpoint no está documentado como API pública, los términos de Yahoo no
autorizan la extracción automatizada, y nada de esto se vuelve permiso porque el
endpoint responda `200`. La regla de decisión de la matriz de uso ya dice que
«una página pública, un botón de descarga o un endpoint funcional no convierten
`desconocido` en `confirmado`», y esta ADR no la deroga: la respeta y **declara
que la decisión se toma igual**, que es otra cosa que decir que hay derecho.

### La tensión del masterplan, resuelta

`00_MASTER_PROMPT.md` dice «no uses `yfinance` ni endpoints privados de Yahoo como
dependencia productiva» y `03_DATA_AND_PROVENANCE.md` «no construir el producto
sobre datos gratis de Yahoo obtenidos por endpoints no contractuales». Las dos
frases se escribieron cuando el producto se imaginaba con una superficie pública
y un gate de redistribución. La [ADR 0004](0004-personal-first-runtime.md) eliminó
la superficie pública y la [ADR 0007](0007-ticker-driven-valuation-pivot.md)
degradó el gate de derechos a procedencia informativa para uso personal.

Lo que **sigue siendo cierto** de esa advertencia es la fragilidad, y esta ADR la
responde con tres propiedades concretas en vez de con una promesa:

1. los precios no son fuente de verdad de ninguna identidad: no constituyen
   universo, no resuelven emisores y no alimentan corporate actions. Son una
   serie derivada que alimenta matrices;
2. la ingesta es **idempotente y re-corrible**: si el endpoint se rompe, lo que ya
   está guardado sigue valiendo y la matriz envejece en vez de corromperse;
3. el adaptador queda detrás de un puerto, así que cambiar de fuente es un
   adaptador nuevo, no un rediseño. La condición de revisión de abajo lo prevé.

## Decisión 2 — el vocabulario de derechos gana `owner_accepted`

Este es el punto que más se va a agradecer, y el que casi se resuelve mal.

El gate de ingesta exige que `personalUse` y `automatedAccess` valgan exactamente
`allowed`. Yahoo no concede ninguno. Había dos salidas y una es una trampa:

- **marcar `allowed`** y explicarlo en `ownerNotes`. Haría correr el slice hoy y
  **corrompería el gate para siempre**: `allowed` significa «una fuente primaria
  vigente cubre este uso», que es lo que hace que el `allowed` de `sec-edgar`
  —donde la SEC efectivamente autoriza copia y redistribución con cita— signifique
  algo. Si el mismo valor también quiere decir «nadie lo autorizó pero seguimos»,
  deja de distinguir los dos casos y el gate se vuelve decorativo;
- **agregar un valor que diga la verdad**, que es lo que se hace.

`rightsDecisionSchema` pasa a ser `unknown | allowed | owner_accepted | restricted`.
`owner_accepted` significa exactamente: **ninguna fuente primaria concede este
uso; el owner decidió proceder igual, y la decisión está fechada y con motivo.**

El gate acepta `allowed` **u** `owner_accepted` para habilitar una corrida, con
una excepción que no se mueve: `approved_public_demo` sigue exigiendo
`publicDisplay === "allowed"`. Una decisión del owner puede asumir un riesgo
propio; no puede fabricar un derecho frente a terceros en una superficie pública.

El valor es visible donde se leen los derechos —`pnpm ingestion:sources` y el
registro—, así que la decisión queda a la vista en vez de lavada dentro de un
`allowed` falso. Es la misma disciplina de la
[ADR 0023](0023-frozen-sec-extracts-rights.md): los derechos se declaran, no se
infieren de que el dato esté disponible.

La fila de `yahoo-finance` queda entonces: `personalUse` y `automatedAccess` en
`owner_accepted`; `normalizedStorage` en `owner_accepted`; `rawStorage`,
`publicDisplay` y `aiTransfer` en `restricted`; `export` en `owner_accepted`
(export personal). `approved_personal`, nunca `approved_public_demo`.

## Decisión 3 — se ingiere la serie **cruda**, des-ajustada con los splits de la propia fuente

Es la decisión técnica central, y sale de una medición que cambió el diseño.

**La serie que Yahoo devuelve no es point-in-time: se reescribe hacia atrás en
cada split.** Medido el 2026-09-22 sobre NVDA: el cierre del 2024-06-05 se
devuelve hoy como **122,44**, cuando lo que se vio ese día fueron **1.224,40** —
la serie está dividida por el 10:1 del 2024-06-10—. Guardar eso tal cual metería
en la base exactamente el look-ahead que todo el contrato point-in-time existe
para impedir, y además la fila **cambiaría sola** con el próximo split: una fila
guardada hoy dejaría de coincidir con la misma fila re-descargada mañana, y la
ingesta perdería la idempotencia.

La salida es que la misma respuesta trae los splits fechados con su ratio, así que
el des-ajuste es determinista:

```text
raw(t) = close(t) × Π  ratio(s)
                  s: fecha(s) > t
```

Verificado sobre NVDA: `122,44 × 10 = 1.224,40`, el cierre real de ese día, al
centavo.

Por eso **se guarda `raw`**, con tres consecuencias que son justamente lo que se
busca:

1. **la fila es inmutable.** Un split futuro no la toca, porque el crudo es lo que
   pasó. Es la misma propiedad que la [ADR 0012](0012-stock-splits-share-basis.md)
   le dio a los valores por acción: no se reescriben filas, se re-expresa al leer;
2. **la re-descarga es idempotente**, que es lo que permite que el refresh sea
   barato y que una corrida repetida no publique nada;
3. **el ajuste vuelve a ser una decisión de lectura con base declarada.** Quien
   pida la serie dice en qué base la quiere, como ya hace `latest_adjusted`.

Los **dividendos no se aplican nunca en la ingesta**: se guardan fechados y como
eventos. Que la base de retorno de las matrices sea con dividendos reinvertidos o
sólo precio es un parámetro abierto de `F7-04`, y resolverlo en la ingesta lo
dejaría decidido a espaldas de quien lo tiene que decidir.

**Límite declarado, y hay que decirlo:** el des-ajuste usa los splits que **Yahoo**
publica, no los verificados por regla contra la SEC de la ADR 0012. Para los 31
filers ya ingeridos las dos listas se pueden cruzar, y ese cruce es un test de
reconciliación real; para los otros ~470 no hay con qué contrastar hoy. Un split
que Yahoo no publique produce una serie mal des-ajustada, y eso se ve como un
salto de precio sin evento que lo explique.

## Decisión 4 — la fila guarda un cierre, no un OHLCV

La tabla guarda `security_id`, fecha de mercado, **cierre crudo**, moneda y
procedencia. No guarda apertura, máximo, mínimo ni volumen.

El criterio es el de la [ADR 0018](0018-lighter-observation-rows.md): se guarda lo
que no se puede reconstruir **y se usa**. Lo que la Fase 7 y la Fase 8 piden de
una serie de precios es retorno por período (cierre contra cierre), la referencia
del índice en la misma base, y el market cap a una fecha. Ninguno necesita OHLC, y
no hay screener que justifique el volumen —la [ADR 0016](0016-analysis-scope-sector-matrices.md)
lo eliminó del alcance—. Guardar cinco columnas más «por si acaso» quintuplicaría
la tabla más grande del proyecto para alimentar una función que no existe.

Los precios **no van a `observations`**: con ~945 bytes por fila ocuparían unos
600 MB. La estimación de la ADR 0016 para una tabla liviana era 60–80 MB para
~630.000 barras, y el tamaño real se mide con un prototipo **antes** de ingerir el
universo, como manda esa ADR.

Si algún slice futuro necesita OHLC o volumen, es una ingesta nueva con su propia
medición, no una columna agregada en silencio.

## Límites declarados

1. **No hay concesión contractual.** Ver la decisión 1. La fila del registro lo
   dice y `owner_accepted` lo hace visible en cada lectura de derechos.
2. **El endpoint puede romperse sin aviso**, y no habrá comunicado que lo anuncie.
   Es un riesgo operativo asumido, no mitigado.
3. **El des-ajuste depende de los splits de Yahoo**, no de los verificados contra
   la SEC. Ver la decisión 3.
4. **Sin OHLC, sin volumen, sin intradía.** Ver la decisión 4.
5. **Nada de esto se muestra en una superficie pública**, y `publicDisplay` queda
   `restricted` para que el gate lo impida aunque alguien lo intente.
6. **El dividendo se guarda pero no se aplica.** La base de retorno la decide
   `F7-04`.

## Condición de revisión

- **el endpoint deja de responder o cambia de forma.** El adaptador está detrás de
  un puerto justamente para que la respuesta sea un adaptador nuevo;
- **aparece una fuente gratuita que conceda por escrito lo que esto necesita.**
  Sería estrictamente mejor y el cambio es un adaptador;
- **el proyecto deja de ser personal.** Cualquier superficie no privada invalida
  esta ADR entera, no sólo un punto;
- **la reconciliación de splits contra la SEC encuentra divergencias** en los
  filers donde se puede cruzar.

## Consecuencias

- `yahoo-finance` entra en la allowlist de egress con un solo host y un solo
  prefijo de path, y en `SOURCE_DAILY_REQUEST_BUDGETS` con un tope diario.
- El vocabulario de derechos gana `owner_accepted`, y el gate lo acepta salvo para
  `approved_public_demo`. Las filas existentes no cambian de significado.
- La matriz de uso registra la fila de Yahoo y el hallazgo de Tiingo.
- `F7-01` puede entregarse; `F7-03` a `F7-07` quedan desbloqueados detrás.

## Alternativas descartadas

- **Tiingo gratis incumpliendo sus ToU.** Aceptar un contrato para después violar
  una cláusula concreta expone más que no tener contrato: hay cuenta, identidad y
  una key que cortan sin aviso, y el incumplimiento quedaría documentado en un
  repositorio público. Da lo mismo que Yahoo con un contrato roto encima.
- **Tiingo Power, USD 30/mes.** Es la opción correcta el día que el presupuesto
  deje de ser cero, y concede por escrito exactamente esto. El owner decidió no
  pagarla hoy.
- **Guardar la serie ajustada tal como la devuelve Yahoo.** Mete look-ahead en la
  base y rompe la idempotencia. Ver la decisión 3.
- **Guardar OHLCV completo.** Quintuplica la tabla más grande del proyecto para
  alimentar funciones que el alcance no tiene.
- **Marcar los derechos como `allowed`.** Corrompe el gate para siempre. Ver la
  decisión 2.
