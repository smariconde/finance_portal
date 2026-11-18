# ADR 0083: consenso de analistas desde Alpha Vantage, P/E forward NTM y PEG a un año

- Estado: aceptada
- Fecha: 2026-11-18
- Alcance: `F6-29`.
- Relacionadas: [ADR 0009](0009-egress-boundary.md) (puerta de salida),
  [ADR 0020](0020-source-daily-budget-kill-switch.md) (cuota diaria y kill
  switch), [ADR 0030](0030-sector-prices-on-open.md) (actualización al abrir),
  [ADR 0033](0033-ai-layer-industry-resolution.md) (credencial que agrega la
  puerta), [ADR 0065](0065-bcra-monetary-catalog-vintages.md) (disponibilidad
  como observación y cadenas de revisiones).

## Contexto

El owner pidió el 2026-10-29 el P/E forward: en tecnológicas disruptivas es la
lectura habitual («una FANG a 12× forward está atractiva»). El portal no lo
tiene: la SEC publica lo reportado y de Yahoo sólo se guardan cierres. Hace
falta una fuente de consenso con derechos, y decidir qué EPS y qué crecimiento
se usan.

Lo medido el 2026-11-18, sin guardar ningún payload en el repositorio:

- **Fuente.** `EARNINGS_ESTIMATES` de Alpha Vantage, un `GET` por ticker con la
  clave como parámetro `apikey` de la URL (no acepta header). Respondió 200 con
  ~42 kB para AAPL, MSFT, AMZN, JNJ y CAT.
- **Forma.** Un objeto `{symbol, estimates[]}` con 42 filas: **dos** de
  `horizon = "fiscal year"` (el ejercicio en curso y el siguiente) y 40 de
  `"fiscal quarter"` que llegan a 2017. Cada fila trae `date`, promedio, alto y
  bajo del EPS, cantidad de analistas, el promedio de hace 7, 30, 60 y 90 días,
  revisiones hacia arriba y hacia abajo a 7 y 30 días y el consenso de ventas
  con su rango y su cantidad. Todos los números vienen como texto con cuatro o
  dos decimales (`"24.0000"`); las revisiones hacia abajo vinieron `null` en
  las cinco empresas.
- **Fechas.** `date` es el fin del **mes calendario** del período: AAPL dice
  `2027-09-30` aunque cierra el último sábado de septiembre. Ninguna fila trae
  fecha de publicación ni de corte.
- **Base del EPS.** No es el EPS diluido GAAP de la SEC: JNJ figura en 11,12
  (su EPS ajustado) y AMZN tiene el FY2027 (10,68) por debajo del FY2026
  (12,80), seguramente por ganancias no operativas de 2026. El P/E forward no
  se compara sin aviso con el P/E trailing GAAP de la ficha.
- **Horizonte.** Hay dos ejercicios y sólo dos trimestres hacia adelante: no
  alcanza para sumar cuatro trimestres futuros.
- **Términos.** Licencia «personal, non-commercial», que incluye de forma
  explícita «investment analysis, research, testing, monitoring, and any other
  activities that are private and individual in nature». No prohíben guardar
  lo que se lee. El plan gratis tiene 25 pedidos por día.

## Decisión 1 — la fuente es Alpha Vantage (decisión del owner)

Fuente `alpha-vantage`, dataset `alpha-vantage.earnings-estimates`, un solo
recurso: `GET https://www.alphavantage.co/query` con
`function=EARNINGS_ESTIMATES&symbol=<ticker>`. Financial Modeling Prep no
confirmó que su plan gratis incluya las estimaciones, y Yahoo exige una sesión
con cookie y crumb, que no se automatiza.

Derechos: uso personal, acceso automatizado y valores normalizados y derivados
`allowed` (los términos los cubren); payload crudo `restricted` (no se guarda),
exhibición pública y export `restricted` (la licencia es personal), IA
`restricted` y asistente del owner `owner_accepted`, como el resto de las
fuentes (ADR 0078), porque es el mismo uso privado.
La fila queda `approved_personal`. Se cita «Alpha Vantage». Fixtures
sintéticas. Revisión de derechos a los tres meses.

## Decisión 2 — la puerta agrega la clave como parámetro de la URL

Un tipo de credencial nuevo, `env_query`: la allowlist nombra la variable
(`ALPHA_VANTAGE_API_KEY`) y el parámetro (`apikey`), y la puerta lo agrega a la
URL **después** de autorizar el destino, igual que un header. El adaptador
nunca ve la clave. Una URL que ya trae ese parámetro se rechaza
(`credential_in_url`), la fuente no sigue redirects y lo único que llega a un
log es origen y path (`describeEgressTarget`), nunca la query.

Cuota diaria declarada: 25 pedidos, la del plan gratis.

## Decisión 3 — se guardan los dos ejercicios como cadenas de revisiones

Sólo las filas `fiscal year`. Los trimestres se cuentan en la corrida y no se
guardan: los futuros no alcanzan para cuatro trimestres y los pasados no tienen
fecha, así que no sirven como historia point-in-time.

Cada ejercicio de cada security es una cadena de revisiones
(`consensus_estimates`, como `macro_series_observations`): una revisión nueva
sólo cuando cambia algún número, `available_at` es la **captura** (la
respuesta no fecha nada) y un ejercicio que deja de venir se retira
(`withdrawn`), que es lo que pasa cuando la empresa lo reporta. No hay historia
hacia atrás: el P/E forward histórico empieza en la primera captura. El parser
`av-earnings-estimates-1.0.0` cierra el sobre y las claves de cada
fila, lee cada número del texto (nunca por `number`), exige `symbol` igual al
pedido, exige alto ≥ promedio ≥ bajo y rechaza la corrida por nombre ante un
error de la API (`Note`, `Information`, `Error Message`, que llegan con 200).

## Decisión 4 — P/E forward con el EPS de los próximos doce meses (decisión del owner)

Es lo que cita el mercado (el «forward 12-month P/E» de FactSet, el «1BF» de
Bloomberg) y deja comparables un cierre de septiembre y uno de diciembre.
`forward-pe-1.0.0`:

- **FY1** es el ejercicio vigente con fin posterior a la fecha del cierre;
  **FY2**, el siguiente. Un ejercicio ya terminado y todavía sin reportar no es
  FY1: se usan los dos siguientes y, si no los hay, el P/E es `null`
  (`insufficient_horizons`).
- **EPS NTM** = `w · EPS(FY1) + (1 − w) · EPS(FY2)`, con
  `w = días desde el cierre hasta el fin de FY1 / días del ejercicio`. Los
  fines son los que publica la fuente (fin de mes).
- **P/E forward** = cierre / EPS NTM, con el cierre del mismo día del corte.
  Al lado se muestran el P/E de FY1 y el de FY2.
- Nulos con motivo: `no_consensus`, `stale_consensus` (la última captura tiene
  más de 7 días), `non_positive_eps`, `insufficient_horizons`, `no_close`,
  `currency_mismatch`.

## Decisión 5 — PEG con el crecimiento del consenso de FY1 a FY2 (decisión del owner)

Damodaran y Lynch piden el crecimiento esperado en la misma base que el EPS
del P/E. El estándar es el crecimiento a cinco años del consenso, que la fuente
no publica. `peg-1.0.0`: PEG = P/E forward / (EPS(FY2) / EPS(FY1) − 1) × 100,
rotulado «crecimiento a 1 año». Con un crecimiento ≤ 0 es `null`
(`non_positive_growth`): AMZN hoy.

## Decisión 6 — se actualiza al abrir la valuación

Abrir `/valuacion/[ticker]` pide el consenso que falta, como la matriz pide
precios (ADR 0030): un job durable de un item (`alpha_vantage_consensus_refresh`)
con lease, cuota y kill switch propios. Un security está al día si tiene una
captura del día de Nueva York, o si un job lo revisó ese día y falló: una falla
no se replanea sola, se ofrece «Reintentar». El render sólo lee.

## Decisión 7 — el umbral es del owner y se dibuja, nunca se califica

El umbral de P/E forward lo declara el owner por empresa, con fecha y motivo,
como revisión append-only. Se dibuja como una línea «tu umbral: 12×» sobre la
historia del P/E forward y la banda trailing de `F6-25`. Nunca se rotula
«barata» ni «atractiva» (PRODUCT.md: sin señales de compra o venta).

## Consecuencias

- La ficha muestra el P/E forward NTM, el de FY1 y FY2, el PEG, la cantidad de
  analistas, el rango alto–bajo y el cambio del consenso a 90 días, siempre con
  su fecha de captura, la fuente y el aviso de que el EPS del consenso puede
  ser ajustado y no el GAAP.
- El P/E forward no entra al snapshot de la corrida ni a sus hashes: es una
  lectura de mercado, como la comparación con el precio (ADR 0048).
- Con 25 pedidos por día alcanza para unas veinte empresas abiertas por día y
  algunas corridas a mano.
- Si Alpha Vantage cambia el formato, la corrida se rechaza por nombre y la
  página sigue con lo guardado.
