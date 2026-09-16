# ADR 0010: ingesta XBRL de la SEC — disponibilidad, vintages y sujeto

- Estado: aceptado
- Fecha: 2026-09-14
- Alcance: cierra `F2-03`; fija cómo un hecho de `companyfacts` se convierte en una
  observación point-in-time
- Decisiones relacionadas: [ADR 0007](0007-ticker-driven-valuation-pivot.md) (la
  SEC es la primera fuente de fundamentals), [ADR 0009](0009-egress-boundary.md)
  (la única salida a red), [contrato point-in-time](../../data/point-in-time-contract.md)

## Contexto

`companyfacts` publica, por filer, todos los hechos XBRL sin dimensiones que
presentó. Parece una serie lista para usar y no lo es: el mismo hecho aparece una
vez por cada presentación que lo mostró, el documento no dice **cuándo** se hizo
público cada valor —trae la fecha de filing, no el instante—, y la SEC agrega
campos que cambian con cada presentación nueva sin que el hecho cambie.

Sobre ese material el contrato exige tres cosas que no se pueden adivinar:
`available_at` defendible, vintages y restatements preservados, y un sujeto interno
estable. Las decisiones de abajo se tomaron contra el cable real (filers 320193,
19617, 1067983, 1045810, 726728, 2115436 y los cinco grandes bancos), sin
conservar ningún payload.

## Decisión

### `available_at` es la aceptación, y el `Z` es UTC real

`acceptanceDateTime` sale de `submissions`, no de `companyfacts`. Llega como
`YYYY-MM-DDTHH:MM:SS.sssZ` y hubo que decidir si el `Z` es verdad o si son dígitos
de hora de Nueva York mal etiquetados: en el segundo caso, tomarlo por UTC habría
adelantado cada hecho cuatro o cinco horas, que es look-ahead.

La evidencia es el horario operativo de EDGAR (6:00 a 22:00 de Nueva York). Sobre
las 1.000 presentaciones recientes del filer 320193, leído como UTC, 998 caen
dentro; leyendo los dígitos como hora local caen 339. El `Z` es UTC.

Sin aceptación publicada, y **sólo** para formularios cuya fecha de filing nunca
precede a la diseminación (10-K, 10-Q, 8-K, 20-F, 40-F, 6-K, sus transiciones y
enmiendas), `available_at` es el primer instante del día siguiente en Nueva York con
el offset más tardío del año (`05:00Z`) y la observación lleva
`availability_inferred`. Puede llegar una hora tarde en verano; nunca antes. Otros
formularios sin aceptación se rechazan: en el cable hay cartas `NO ACT` fechadas
semanas antes de diseminarse.

### Un re-reporte no es una revisión; un valor distinto sí

Un hecho es `(taxonomía, concepto, unidad, inicio, fin)`. Sus puntos se ordenan por
disponibilidad; el primero publica una vintage, los siguientes con el mismo valor
se colapsan y uno con otro valor publica la vintage siguiente, que la cadena de
revisión registra como re-expresión. El `available_at` de una vintage es el de la
**primera** presentación que mostró ese valor.

Lo que no tiene desempate se rechaza con nombre: dos valores dentro de la misma
presentación, o dos presentaciones conocibles en el mismo instante que dicen cosas
distintas.

### El sujeto se resuelve por CIK, una vez, al corte de la descarga

El grafo de identidad conoce a las empresas desde que se constituyó el universo
(2026-09-05). Resolver cada hecho al corte de su propia disponibilidad —como hace la
publicación para una clave de proveedor— no encontraría a nadie en 2009 y rechazaría
la historia entera.

El documento es de un solo filer y lo nombra un CIK, que la SEC no reasigna. Se
resuelve una vez, con el corte de la descarga. Eso no filtra conocimiento hacia
atrás: el hecho sigue siendo conocible desde su `available_at`, y lo único que se
decide con el grafo de hoy es a qué ID interno pertenece ese CIK. Un registro que
nombra otro CIK se rechaza como `subject_mismatch`. Un ticker, que sí se reasigna,
no puede usar esta vía.

### Qué se ingiere es una selección versionada, registrada en la corrida

`sec-core-concepts-1.0.0` lleva 58 conceptos de `us-gaap` y `dei`: los que usa la
metodología. En Apple reduce 12.901 vintages a 3.254. Cada hecho se publica con su
concepto original —`Revenues` y `RevenueFromContractWithCustomer…` siguen siendo
dos—; decidir cuál es «el revenue» es normalización y no se hace acá.

La versión se guarda en `ingestion_runs.selection_version`. Sin ella, un concepto
ausente sería ambiguo entre «no reportado» y «no buscado», y el perfil de
completitud de `F3-02` no podría separarlos. Filtrar no cambia el contenido de un
hecho, así que crecer la selección **no** sube la versión del parser.

### Los acumulados son `year_to_date`

Los estados de un 10-Q traen el trimestre y el acumulado de seis o nueve meses, y el
flujo de fondos sólo en acumulado. Clasificarlos como `quarter` haría que un semestre
pasara por el último trimestre. `observation_period_type` suma `year_to_date`,
asignado por duración medida (175–190 y 266–282 días); inicio y fin exactos siguen en
la clave lógica, así que la clasificación nunca cambia la identidad del hecho.

### La presentación es un evento inmutable; `frame` no se conserva

`source_documents` guarda una fila por accession con formulario, fecha de filing,
aceptación, regla de disponibilidad, report date y foco fiscal. Nunca se reescribe:
otra descripción de la misma accession es un conflicto reportado.

`fy` y `fp` describen a la presentación, no al período del hecho —el 10-K de FY2023
repite el revenue de FY2021 con `fy=2023`—, por eso viven acá y no en la observación.
`frame` no se guarda: la SEC lo asigna al hecho más reciente de cada período
calendario y lo mueve cuando llega otra presentación, así que no describe lo
reportado.

### Una corrida por documento, idempotente por contenido

La corrida registra el CIK en `subject_key`. `companyfacts` es un documento vivo:
pedir «el vigente» una semana después puede traer otra presentación, así que la
misma solicitud no es un replay. La clave de idempotencia suma la versión del
contenido —registros aceptados, rechazos y presentaciones—; el mismo contenido deja
una corrida `duplicate` que apunta a la original, y el índice único de corridas
publicables pasa a significar «a lo sumo una por contenido». Los campos nuevos sólo
entran al hash cuando existen: ninguna clave registrada cambió.

### Valores exactos y ritmo acotado

El importe se toma del texto fuente del JSON (`JSON.parse` con `context.source`,
disponible desde Node 22), nunca de un `double`. Las llamadas salen de a una, a 2
requests/s y con presupuesto de 1.000 por corrida, como fija la matriz de cuotas.

## Consecuencias

- Módulo nuevo `src/modules/fundamentals/` y comando `pnpm fundamentals:ingest`.
- Migración `0005`: `source_documents`, `ingestion_runs.subject_key` y
  `selection_version`, y el valor `year_to_date`. Su rollback reconstruye el tipo y
  falla a propósito si alguna fila lo usa.
- `publishObservations` acepta un sujeto de documento, publica varias revisiones de
  un mismo hecho en un lote y reconoce como duplicado cualquier revisión de la
  cadena, no sólo la punta.
- `executeIngestionRun` no cambia: su replay sigue siendo correcto para fuentes
  paginadas por dataset.

## Alternativas descartadas

- **Ingerir todo companyfacts.** Cuatro veces el volumen para conceptos que ningún
  método usa, en una base personal que en `F6-06` pasa a hosting pago.
- **Frames API.** Alinea al calendario y no al período fiscal exacto de cada filing;
  el contrato ya lo descarta como reemplazo.
- **Fecha de filing como `available_at` para todo.** Existe la aceptación; usar la
  fecha teniendo el instante es perder precisión por comodidad.
- **Backdatear el grafo de identidad a la fecha de los hechos.** Fingiría que el
  universo se conocía antes de constituirse.
- **Paginar el documento en corridas de 500 registros.** Partiría la lineage de un
  mismo documento en corridas artificiales.

## Límites conocidos

- **Un cambio de parser sobre contenido idéntico** se rechaza como
  `ambiguous_revision`: la versión del parser está en el hash de la observación
  desde `F1-04`. Resolverlo exige la transformación versionada del contrato y queda
  para cuando haga falta cambiar un parser con datos publicados.
- **Sucesión de CIK.** El universo asigna a XOM el CIK de la holding nueva
  (0002115436), con 89 puntos; la historia vive en el CIK anterior. Unir las dos es
  una corporate action y corresponde a `F2-04`.
- **Bancos con miles de notas estructuradas** parten su índice en decenas de archivos
  (JPMorgan necesita 41). El techo por empresa es 64; más allá, la corrida falla
  nombrada.
- Lease y reanudación llegaron con la [ADR 0015](0015-durable-ingestion-jobs.md);
  el refresh sólo de CIK cambiados sigue en `F2-05`.
