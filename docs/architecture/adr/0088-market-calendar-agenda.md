# ADR 0088: calendario de mercado y agenda de publicaciones

- Estado: aceptada (2026-11-26)
- Fecha: 2026-11-26
- Alcance: Fase 12, `F12-01` a `F12-05`.
- Relacionadas: [ADR 0009](0009-egress-boundary.md) (puerta de salida),
  [ADR 0020](0020-source-daily-budget-kill-switch.md) (cuota diaria y kill
  switch), [ADR 0030](0030-sector-prices-on-open.md) y
  [ADR 0070](0070-argentina-refresh-on-open.md) (actualización al abrir),
  [ADR 0065](0065-bcra-monetary-catalog-vintages.md) (disponibilidad como
  observación y cadenas de revisiones),
  [ADR 0076](0076-schwab-read-only-account-trading-journal.md) (cuenta Schwab
  de sólo lectura), [ADR 0079](0079-new-data-since-last-visit.md) (lo nuevo
  desde la visita anterior),
  [ADR 0083](0083-consensus-estimates-forward-pe.md) (Alpha Vantage y la clave
  en la URL).

## Contexto

El 2026-11-26 el owner abrió el portal sin saber que la bolsa de Nueva York
estaba cerrada (Thanksgiving) y notó que «a veces cambia el horario de operar».
Pidió un lugar donde ver qué días opera el mercado, con qué horario, cuándo
publican resultados las empresas que sigue y cuándo salen los datos económicos
de Estados Unidos y de la Argentina.

Hoy el portal no tiene calendario. Tres lugares lo dicen en su código:

- `trading-session-ny-1.0.0` fecha la sesión por el reloj de Nueva York «sin
  calendario de feriados».
- `sector-price-freshness-1.0.0` y `ticker-price-freshness-1.0.0` dan por
  asentada una sesión a las 22:00 UTC de cada día hábil y esquivan los
  feriados con «un job lo revisó después».
- `argentina-refresh-freshness-1.0.0` decide por chequeos porque ninguna
  fuente fecha sus publicaciones.

El cambio de horario es el horario de verano de Estados Unidos: la Argentina
no lo usa, así que la apertura de las 9:30 de Nueva York cae a las 10:30 de
Buenos Aires entre el segundo domingo de marzo y el primero de noviembre, y a
las 11:30 el resto del año.

### Cómo se resuelve en otros lados

- **Sesiones.** `exchange_calendars`, `pandas_market_calendars` (Python) y
  `scmhub/calendar` (Go) no consultan una API: declaran en código las reglas
  de feriados de cada bolsa y una lista de excepciones (cierres por duelo
  nacional, huracanes). Es el patrón `declared-*` de este repositorio.
- **Agenda económica.** Los calendarios comerciales (Investing, ForexFactory,
  Trading Economics, el económico de Finnhub y el de FMP) son pagos o prohíben
  el acceso automatizado. OpenBB los agrega como proveedores pagos. Lo gratuito
  y estable son los cronogramas oficiales de cada organismo.
- **Resultados.** Un proveedor estima la fecha y la hora (antes de la apertura
  o después del cierre); la SEC confirma después con el 8-K ítem 2.02.

### Lo medido el 2026-11-26

Pedidos sueltos con `curl`, sin la clave del owner, sin cuota del proyecto y
sin guardar ningún payload en el repositorio:

- **NYSE.** `nyse.com/markets/hours-calendars` responde 200 (~150 kB) con la
  tabla 2026–2028 embebida como JSON en el HTML. El anuncio del 2025-12-23
  publica los tres años: diez feriados por año y cierres a las 13:00 el día
  después de Thanksgiving, el 24 de diciembre y, en 2028, el 3 de julio.
- **Schwab.** `GET /marketdata/v1/markets` ya está en la allowlist de
  `schwab-marketdata` desde `F11-03`. Según los clientes de terceros devuelve,
  por mercado y fecha, `isOpen` y `sessionHours` (`preMarket`,
  `regularMarket`, `postMarket`) y acepta `date` hasta un año adelante. No se
  midió con la cuenta del owner.
- **Feriados argentinos.** `datos.gob.ar` publica el dataset
  `feriados-nacionales1` (CC BY 4.0) de la Jefatura de Gabinete. El recurso de
  2026 es un JSON de `argentina.gob.ar` (~22 kB) con 35 fechas tipadas: 14
  `inamovible`, 4 `trasladable`, 3 `turistico`, 12 `no_laborable` (festividades
  religiosas opcionales) y 2 `especial` (la visita del Papa, feriado sólo en
  CABA y en la Provincia de Buenos Aires el 10 y el 11 de noviembre). El
  recurso de 2027 todavía no existe (404).
- **Alpha Vantage `EARNINGS_CALENDAR`.** Con la clave `demo` respondió 200 con
  un CSV de 634 filas entre el 2026-11-26 y el 2027-02-24, columnas `symbol`,
  `name`, `reportDate`, `fiscalDateEnding`, `estimate`, `currency` y
  `timeOfTheDay`. `timeOfTheDay` vino vacío en 491 filas (77 %), `pre-market`
  en 70 y `post-market` en 73. La clave `demo` puede recortar: el tamaño real
  se mide con la del owner.
- **FRED.** `fred/releases/dates` exige `api_key` (400 sin ella). La clave es
  gratuita con registro. Las fechas no traen hora.
- **BLS.** El calendario `.ics` respondió 403 a un `User-Agent` sin contacto.
- **BEA.** `bea.gov/news/schedule/full` responde 200 (~128 kB), renderizado en
  el servidor, con fecha, hora («8:30 AM») y nombre de cada publicación.
- **Fed.** `fomccalendars.htm` responde 200 con las reuniones de 2021 a 2027,
  renderizadas en el servidor. La Fed revisó el calendario de 2027 el
  2026-11-12: un cambio así es lo que este diseño tiene que absorber.
- **BCRA.** `bcra.gob.ar/calendario-de-informes/` responde 200 (~91 kB),
  renderizado en el servidor, como lista de «publicación – fecha» del año (REM,
  Informe Monetario Mensual, IEF, Boletín Estadístico…). La página aclara que
  las fechas se confirman o reprograman.
- **INDEC.** El calendario semestral es un PDF a dos columnas; la página web
  `Calendario-Fecha-0` carga los datos desde `Calendario/FiltrosCalendario`,
  sin medir todavía.

## Decisión 1 — un calendario de eventos con su fuente y su estado

El calendario tiene tres clases de evento: **sesión de mercado**, **resultados
de una empresa** y **publicación económica**. Cada evento dice de qué fuente
sale, cuándo se observó y si es `scheduled` (programado), `changed` (la fuente
lo movió: se guarda como revisión, nunca se pisa), `cancelled` o `past`. Una
fecha estimada nunca se muestra como confirmada, y un evento sin hora es «hora
sin informar», nunca una hora inventada.

Lo que surja después —un cierre por duelo nacional, un dato postergado por un
cierre del gobierno de Estados Unidos, un feriado decretado con una semana de
aviso— entra como excepción declarada o como revisión de la fuente, con su
motivo, y la diferencia queda a la vista.

## Decisión 2 — las sesiones de Nueva York se declaran y Schwab las corrobora

`declared-market-sessions.ts` declara los feriados y los cierres tempranos de
NYSE y Nasdaq de 2026 a 2028 tal como los publica la NYSE, con la fecha del
anuncio. `market-sessions-1.0.0` responde, para una fecha y una bolsa, si
opera, con qué horario regular y extendido, y lo expresa en la hora de Nueva
York y en la de Buenos Aires. El horario de verano no se codifica: sale de la
base de zonas horarias (`Intl`, `America/New_York` y
`America/Argentina/Buenos_Aires`), y el calendario marca el día en que cambia
la diferencia entre las dos ciudades.

Al abrir `/cuenta` o `/calendario`, el portal pregunta a Schwab por hoy y la
próxima sesión (`GET /marketdata/v1/markets`, la allowlist ya lo admite) y
compara. Si no coinciden, la página lo dice y para hoy vale la respuesta del
broker, porque es donde se opera. La respuesta de Schwab no se guarda, como el
resto de la cuenta en vivo (ADR 0076). Sin Schwab conectado se lee sólo lo
declarado, nombrando que no se corroboró.

Lo declarado es código del repositorio: se puede leer en cualquier modo, como
las lecciones de `F11-10`.

## Decisión 3 — BYMA y los feriados argentinos quedan afuera (decisión del owner)

El owner vive en la Argentina y conoce sus feriados; el calendario no los
agrega. No entra la fuente `argentina-feriados` ni una regla de sesiones de
BYMA, y la franja habla sólo de Nueva York. Lo medido (el JSON tipado de
`argentina.gob.ar`, los días `no_laborable` optativos y los `especial` de una
jurisdicción) queda como insumo si el owner lo reabre.

## Decisión 4 — las fechas de resultados salen de Alpha Vantage

La fuente es `EARNINGS_CALENDAR` de Alpha Vantage, con la clave que el owner
ya tiene (`alpha-vantage`, `approved_personal`, ADR 0083): **un pedido trae
todo el mercado a tres meses**, así que alcanza uno por día de Nueva York de
los 25 que da el plan gratuito. `av-earnings-calendar-1.0.0` cierra el
encabezado del CSV y lee cada fecha y cada estimación desde su texto.

Se guarda el calendario entero, no sólo las empresas seguidas, porque el
conjunto seguido vive en dos bases (las valuaciones y los CEDEAR en la de
análisis; las posiciones y la watchlist en la de trading) y la de trading no
puede importar la de análisis. Cada fila se guarda por el símbolo que publica
la fuente, como cadena de revisiones que sólo crece cuando la fecha, la hora o
la estimación se mueven; el símbolo se resuelve a un security del grafo al
leer, a la fecha de la lectura, nunca como clave. La lectura de las páginas de
trading pasa sus tickers a una acción sobre la base de análisis, como
`position-context-1.0.0`.

La SEC no entra en este slice: confirmar con el 8-K ítem 2.02 pide un
`submissions` por empresa y queda como candidato.

## Decisión 5 — la agenda de Estados Unidos sale de FRED y de la Fed

FRED es una fuente nueva (`fred`, clave gratuita del owner en
`FRED_API_KEY`, agregada por la puerta como parámetro `api_key` con el mismo
mecanismo `env_query` de la ADR 0083). `fred/releases/dates` devuelve en pocos
pedidos las fechas de todas las publicaciones; se guardan sólo las de
`declared-macro-releases.ts`, cada una con su `release_id` de FRED, su nombre,
su organismo, su hora habitual declarada (FRED no da hora) y una importancia
que decide el owner. La lista aceptada por el owner es CPI, Employment Situation, PPI,
GDP, Personal Income and Outlays (PCE), Retail Sales, JOLTS y los pedidos
iniciales de desempleo.

En `F12-03` la primera consulta autenticada agotó los 15 segundos. El
pedido acotado de siete días atrás a 98 días adelante, con
`include_release_dates_with_no_data=true`, completó en dos páginas sobre
la misma cuota. El parser comprueba el rango devuelto, el orden y el total
antes de publicar. Las fechas anteriores quedan conservadas como
revisiones si FRED mueve una publicación identificable en su cadencia.

Las reuniones del FOMC se declaran desde la página de la Fed con su fecha de
consulta, como las sesiones de la NYSE: son ocho por año, se publican con un
año de anticipación y cambian rara vez (el 2026-11-12 cambiaron las de 2027).

El BLS queda afuera como fuente directa (su `.ics` pide un `User-Agent` con
contacto y FRED ya trae sus fechas); el BEA queda como corroboración de la
hora si FRED y la hora declarada discrepan.

## Decisión 6 — la agenda argentina sale del BCRA y del INDEC

- **BCRA.** La página del calendario de informes es una fuente nueva
  (`bcra-calendario-informes`, misma fila de derechos que las APIs del BCRA:
  uso no comercial citando al BCRA), leída una vez por día de Buenos Aires con
  `bcra-report-calendar-1.0.0`, que verifica el título de la lista antes de
  leer una fila.
- **INDEC.** Primero se mide `Calendario/FiltrosCalendario`. Si responde datos
  estructurados, se lee como el BCRA; si no, el calendario semestral se
  transcribe a `declared-indec-calendar.ts` con el semestre y la fecha del PDF.
- **Licitaciones del Tesoro.** Se mide el cronograma de la Secretaría de
  Finanzas antes de decidir.

Cuando la agenda dice que hoy sale un dato que `/argentina` lee, la marca de
la ADR 0079 se completa: «esperado hoy» hasta que llega el período, y
«Nuevo» cuando llega. Se cuelga de los grupos de frescura de
`argentina-freshness-1.0.0` (`F9-22`, enmienda del 2026-11-26 de la
[ADR 0070](0070-argentina-refresh-on-open.md): `FRESHNESS_GROUP_SOURCES` y
`BLOCK_FRESHNESS_GROUP`), con los que cada tarjeta y bloque ya dice si está
verificado.

## Decisión 7 — una página, una franja y dos lecturas de los resultados

- `/calendario` es un ítem propio de la navegación, al lado de Inicio
  (decisión del owner). Muestra la semana (y el mes en pantallas anchas) con
  las tres clases de evento, filtrables por «mis empresas» y por importancia,
  con su tabla equivalente. Es visual: sin párrafos, la explicación en
  `InfoTip`.
- Una franja «Hoy · Mañana» en Inicio, `/cuenta` y `/plan` dice si opera
  Nueva York, su horario en hora de Buenos Aires, las publicaciones de
  importancia alta y las empresas seguidas que reportan.

Una fecha de resultados se lee de dos maneras, según el libro de
`trading-book-1.0.0` (decisión del owner):

- **Swing: un riesgo.** `earnings-exposure-1.0.0` marca una posición swing
  abierta, o una idea swing de `/plan`, cuyo próximo reporte cae dentro de las
  próximas **5 sesiones** de Nueva York, contando la de hoy. En `/cuenta` la
  fila de la posición lleva un chip ámbar («Resultados · jue 3/12 · post-cierre
  · en 3 sesiones») y la fila swing de la tarjeta de riesgo suma una alerta
  `warning` de `trading-rules`, que no bloquea nada. En `/plan` el chip va en
  la idea, y el planner dice en un `InfoTip` que el stop no protege de un gap
  de apertura: el riesgo real puede ser mayor que el calculado.
- **Day: una oportunidad.** No es una alerta: es una marca neutra «Reporta
  hoy» para las empresas seguidas cuyo reporte mueve la sesión de hoy —el de
  anoche después del cierre o el de hoy antes de la apertura—, en la franja y
  en `/plan`. Para el resto del mercado, la franja ofrece dos links al
  screener de Finviz armados con `finviz-screener-url-1.0.0`
  (`earningsdate_yesterdayafter` y `earningsdate_todaybefore`), porque Finviz
  es el filtro de mercado del owner (ADR 0016) y el portal no le baja nada.

Un reporte sin hora informada lleva «hora s/i» y nunca se ubica antes o
después de la sesión por suposición: en swing cuenta como dentro de la
ventana; en day no se marca «Reporta hoy» hasta saber la hora.

No hay notificaciones fuera del portal: las marcas se ven al abrir la página,
como las de la ADR 0079.

## Decisión 8 — las reglas de frescura usan el calendario

Una vez que existe `market-sessions-1.0.0`, las reglas de frescura de precios
y la sesión de trading pasan a nuevas versiones que saben qué días opera
Nueva York, sin tocar lo que ya fecharon. Es el último slice de la fase.

**Implementada el 2026-11-26 (`F12-05`).** `sector-price-freshness-2.0.0` y
`ticker-price-freshness-2.0.0` toman la última sesión asentada de
`market-sessions-1.0.0`: un feriado de la NYSE no es sesión y no pide precios,
y una sesión se asienta 60 minutos después de su cierre regular —la misma
espera de `settled-session-1.0.0`—, así que el cierre temprano de las 13:00 se
asienta a las 14:00 de Nueva York y no a las 22:00 UTC. Una fecha fuera de lo
declarado vuelve a la regla `1.1.0` (día hábil a las 22:00 UTC) y lo nombra
(`undeclared_weekday`); un job abierto planeado con `1.1.0` termina con el
código nuevo, porque la versión decide qué se planea y no cómo se baja.
`trading-session-ny-2.0.0` es la sesión que prepara un instante —hoy antes de
su cierre regular, si no la próxima declarada— y la usa el vínculo de las ideas
del pre-market con el trade: un plan del domingo, de la noche anterior o del
feriado es de la próxima rueda. Las ejecuciones siguen fechadas por `1.0.0`
(siempre caen en una sesión) y los vínculos guardados no se recalculan. La
curva del BCE y el consenso conservan su regla de 22:00 UTC: no operan con la
NYSE o ya fecharon lo que muestran.

## Fuera de alcance

- Notificaciones fuera del portal (correo, push, Google Calendar). Una
  suscripción `.ics` privada queda como candidata con su propia decisión.
- Otras bolsas, vencimientos de opciones, rebalanceos de índices y fechas ex
  dividendo como eventos: candidatos, no slices.
- Pronósticos del dato («se espera 0,3 %»): el portal no tiene una fuente de
  consenso macro gratuita con derechos.

## Decisiones del owner (2026-11-26)

1. `/calendario` es un ítem propio al lado de Inicio.
2. La ventana de resultados es de 5 sesiones para swing, como riesgo; en day
   trading el reporte del día es una oportunidad de volatilidad y se marca sin
   alerta.
3. La lista propuesta de publicaciones se acepta: CPI, Employment Situation,
   PPI, GDP, PCE, Retail Sales, JOLTS, pedidos iniciales de desempleo y FOMC en
   Estados Unidos; IPC, EMAE, comercio exterior, REM y resultado fiscal en la
   Argentina.
4. Los feriados argentinos y las sesiones de BYMA quedan afuera: el owner los
   conoce.

## Consecuencias

- El portal sabe qué días opera Nueva York y lo muestra en la hora del owner,
  con el cambio de horario marcado.
- Dos fuentes nuevas (`fred` y `bcra-calendario-informes`), cada una con su
  fila de derechos, su entrada en la allowlist y su cuota diaria antes del
  primer pedido; Alpha Vantage gasta uno de sus 25 pedidos diarios más.
- Las sesiones de 2029 en adelante exigen declarar el anuncio de la NYSE
  cuando salga (el de 2026–2028 salió en diciembre de 2025): `/calendario`
  avisa cuando falta menos de un año para el final de lo declarado, y fuera de
  lo declarado una fecha es «sin calendario», nunca un día hábil supuesto.
- Si una fuente cambia de forma, su corrida se rechaza por nombre y la página
  sigue con lo guardado, diciendo de cuándo es.
