# ADR 0036: el reloj de las aceptaciones de `submissions` se lee por archivo

- Estado: aceptado
- Fecha: 2026-10-19
- Alcance: transversal. Corrige el hallazgo que dejó abierto `F5-07`: el mismo
  10-K de NCLH y GOOGL guardado con aceptaciones separadas por 5 horas entre
  dos corridas.
- Decisiones relacionadas: [ADR 0010](0010-sec-xbrl-ingestion.md) (la
  aceptación es la disponibilidad, y el `Z` es UTC real),
  [ADR 0022](0022-companyfacts-refresh-probe.md) (marca de agua del refresh),
  [ADR 0033](0033-ai-layer-industry-resolution.md) (localizador del 10-K)

## Contexto

La ADR 0010 midió el 2026-09-14 que el `Z` de `acceptanceDateTime` es verdad:
sobre mil presentaciones de Apple, leídas como UTC, 998 caen dentro del horario
de EDGAR (6:00 a 22:00 de Nueva York). Todo el contrato point-in-time de la SEC
se apoya en ese instante.

El 2026-10-15 la tarea de industria guardó el 10-K de GOOGL con su aceptación
de siempre, y el 16 la tarea del mix guardó el mismo 10-K cinco horas más tarde.
Cruzando la evidencia de las dos tareas contra `source_documents`, que guardó
la ingesta de septiembre, no eran dos casos sino quince accessions: siempre más
tarde, cuatro horas en las fechas de horario de verano y cinco en las de
invierno. Tres testigos, medidos el 2026-10-19:

| Accession              | `source_documents` (sep.) | `submissions` (hoy)    | Página índice («Accepted», Nueva York) |
| ---------------------- | ------------------------- | ---------------------- | -------------------------------------- |
| `0001018724-26-000004` | `2026-02-05T23:44:31Z`    | `2026-02-06T04:44:31Z` | 2026-02-05 18:44:31                    |
| `0001652044-26-000018` | `2026-02-05T02:56:03Z`    | `2026-02-05T07:56:03Z` | 2026-02-04 21:56:03                    |

La página índice coincide con lo guardado, y el corpus dorado congelado el
2026-09-18 también (las 97 presentaciones de GOOGL que conserva, todas corridas
hoy exactamente 4 o 5 horas). Lo publicado hoy deja el 10-K de Amazon a las
23:44 de Nueva York, con EDGAR cerrado.

El error es de la SEC y tiene forma precisa: los dígitos UTC se leyeron como
hora de Nueva York y se volvieron a convertir, `P = U − offset(P)`. Restando el
offset de Nueva York **en el instante publicado**, los archivos corridos vuelven
al horario de EDGAR (1000/1001 en Amazon, 1000/1000 en Alphabet, 1002/1003 en
Norwegian), mientras que restarlo a ExxonMobil, que no lo tiene, saca 141 de 1001.

No es por fila ni por filer: es por **archivo regenerado**. De 25 filers
sondeados, los 19 que presentaron algo desde ~2026-10-05 están corridos (el
`recent` y sus históricos, como el de Alphabet de 2015–2023), y los seis cuya
última presentación es anterior al 2026-10-02 —XOM, DE, O, CCL, FCX, NEM—
siguen en UTC. Cada presentación nueva regenera el archivo de su filer, así que
en semanas va a ser todo el universo, salvo que la SEC lo arregle.

Lo que rompía, sin este cambio:

- **La ingesta.** Cada hecho de un filer corrido se publicaría 4–5 horas tarde;
  contra lo ya guardado, la misma accession con otra aceptación es un conflicto
  de `source_documents` (inmutable) y cada observación cambiaría de hash.
- **El refresh.** La presentación de la marca de agua se lee más tarde que la
  marca, así que cada filer corrido dispara `new_filing` y una descarga.
- **Las tareas de IA.** El localizador del 10-K compara la aceptación contra el
  corte; corrida, un corte entre la verdad y lo publicado no ve el 10-K. Y la
  evidencia guarda el instante equivocado.

Nada de la SEC entró a la base personal desde el 2026-10-01: el daño se limita a
la evidencia de las dos tareas de IA (16 filas de industria y 14 del mix).

## Decisión 1 — el reloj se lee por archivo, con el horario de EDGAR

`sec-acceptance-clock-1.0.0` (`fundamentals/domain/sec-acceptance-clock.ts`)
lee todas las aceptaciones válidas de un bloque de columnas —el `recent` o un
histórico— y cuenta cuántas caen fuera de 6:00–22:00 de Nueva York de dos
maneras: como se publican, y restando el offset de Nueva York del instante
publicado. Una fila sola no dice en qué reloj está; mil sí.

| Lectura                         | Cuándo                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `new_york_offset_applied_twice` | la corregida encaja (≤ máx(2, 1 %) afuera) **y** la publicada tiene ≥ 2·c + 5     |
| `published_utc`                 | si no, la publicada encaja                                                        |
| `undetermined`                  | ninguna encaja: el bloque se rechaza con nombre (`acceptance_clock_undetermined`) |
| `no_acceptances`                | no hay aceptaciones que leer                                                      |

El margen absorbe los avisos que la propia SEC emite fuera de horario (`EFFECT`:
dos de mil en ExxonMobil).

## Decisión 2 — los dos errores no pesan igual

Corregir un archivo que estaba bien adelanta cada aceptación 4–5 horas: es
look-ahead, lo único que el contrato no tolera. No corregir uno corrido la deja
tarde: es conservador. Por eso corregir exige evidencia decisiva —la lectura
publicada claramente contradicha—, mientras que conservar lo publicado sólo
exige que encaje. Un filer chico que presenta siempre a media tarde encaja de
las dos maneras y se lee como se publica: el sucesor de ExxonMobil
(`0002115436`, 29 presentaciones en el corpus) no tiene evidencia en ningún
sentido, y rechazarlo habría frenado su ingesta sin motivo.

El residuo declarado: un archivo corrido sin ninguna presentación de mañana
temprano ni de noche se lee 4–5 horas tarde. Nunca temprano.

## Decisión 3 — la versión del parser no cambia

`sec-submissions-1.0.0` aplica la regla y no sube de versión, y tampoco la del
pipeline de companyfacts. Con la regla, la aceptación que sale es **la misma**
que el parser leía cuando la SEC publicaba en UTC: medido sobre los 28 archivos
reales de hoy, 650 de 650 accessions coinciden exactamente con lo que guardó la
ingesta de septiembre. Subir la versión del pipeline habría cambiado el hash de
cada observación y convertido la próxima reingesta de cada filer en una revisión
espuria de todos sus hechos; subir la del parser habría movido la versión de la
taxonomía `sec-sic`, que la reutiliza. Una reingesta sobre un archivo corrido es
`duplicate`, y un test lo fija.

Lo que sí registra la regla:

- cada documento de `submissions` de una corrida lleva su lectura
  (`acceptanceClock`) en el resultado del comando;
- una corrida que leyó al menos un archivo corregido lleva la bandera
  `acceptance_clock_corrected` en `quality_flags`, porque el dato publicado no
  puede decirlo;
- un archivo indeterminado cuarentena la ingesta y el sondeo del refresh con
  `submissions_acceptance_clock_undetermined` (o `submissions_history_…`), sin
  mover la marca de agua ni publicar nada.

El localizador del 10-K tiene su propia lectura de columnas y aplica la misma
regla: `sec-annual-report-locator-1.1.0`. Con un reloj indeterminado no localiza
nada (`acceptance_clock_undetermined`). Los lectores de eventos corporativos
pasan por `parseSecSubmissions` y heredan la corrección; un rechazo les llega
como `payload_schema_invalid` con el código en el detalle.

## Decisión 4 — la evidencia ya guardada se repara contra `source_documents`

Las 30 filas de evidencia de las tareas de IA con el instante corrido se
corrigen contra `source_documents`, que tiene las 25 accessions con la
aceptación verificada. Ningún hash cubre ese instante —el de la asignación de
industria es sobre taxonomía, sujeto, código y resolución— y ninguna corrida de
valuación de la base personal lo congeló en su snapshot. Las réplicas donde se
midió `F5-06` no se tocan: una corrida guardada se reproduce con lo que vio.

## Enmienda (2026-10-19, `F4-01`): marcadores de fecha, `1.1.0`

Extender la historia de I+D a diez ejercicios (ADR 0037) hizo que la ingesta
leyera los históricos más viejos de Incyte y NVIDIA, y los dos quedaron en
cuarentena con `submissions_history_acceptance_clock_undetermined`. Estaban
corridos sin duda desde 2003; lo que los volvía indeterminados eran sus filas
de los noventa. Hasta ~2002 EDGAR publica sólo la fecha de aceptación, y la fila
trae como marcador la **medianoche de Nueva York**, que con el bug aparece a las
10:00Z o 08:00Z: fuera de horario en las dos lecturas. 157 marcadores en Incyte
y 74 en NVIDIA; ningún archivo moderno de los sondeados tiene uno.

Un marcador no es evidencia del reloj, y contarlo también era peligroso en el
otro sentido: en un archivo sano, corregido cae a las 19:00 o 20:00 del día
anterior, dentro de horario, y empujaría a corregir de más. `1.1.0` aparta de
la evidencia toda aceptación que sea exactamente medianoche de Nueva York en
alguna de las dos lecturas, la cuenta en `datePlaceholders` y la corrige igual
que las demás (vuelve a ser la medianoche de su día). Sin ninguna aceptación
con hora, el archivo es `no_acceptances`. Sobre los 30 archivos reales, ahora
**695 de 695** aceptaciones coinciden con lo guardado.

## Consecuencias

- La ingesta, el refresh, los eventos corporativos y las tareas de IA vuelven a
  leer la aceptación verdadera de un archivo corrido, sin gastar requests de
  más: la regla no necesita la página índice.
- Si la SEC arregla el bug, los archivos vuelven a leerse `published_utc` sin
  cambiar nada.
- Si la SEC cambiara a otro reloj, lo más probable es que ninguna lectura encaje
  y el archivo se rechace con nombre en vez de publicarse mal.

## Alternativas descartadas

- **Leer la aceptación de la página índice de cada presentación.** Es el testigo
  primario, pero cuesta un request por presentación —decenas por filer— contra
  uno por archivo.
- **Rechazar los archivos corridos hasta que la SEC los arregle.** Frenaría toda
  la SEC en semanas, cuando la corrección es exacta y verificable.
- **Corregir siempre que la lectura corregida encaje mejor.** Con pocas filas a
  media tarde encajan las dos, y dos avisos nocturnos de la SEC alcanzarían para
  adelantar cuatro horas un archivo que estaba bien.
- **Subir la versión del parser.** Ver decisión 3.
