# Contrato point-in-time

- Estado: contrato aceptado para implementación posterior
- Versión: 0.5
- Fecha: 2026-08-21; SEC y documentos de fuente el 2026-09-14; linaje de reporte
  el 2026-09-14; corrección de una dimensión el 2026-09-15
- Alcance: identidad, fundamentales, mercado, macro, CEDEAR y valuaciones
- Persistencia: diferida al slice de PostgreSQL/Drizzle de Fase 1

## Propósito

El contrato permite responder dos preguntas distintas sin look-ahead:

1. ¿Qué era económicamente válido en una fecha?
2. ¿Qué información podía conocerse —o había registrado esta instalación— en ese
   momento?

No alcanza con guardar `date` y el último valor. Cada registro distingue tiempo
efectivo, tiempo de conocimiento público y tiempo de sistema.

```text
effective time   -> cuándo aplica el hecho o relación en el mundo
knowledge time   -> desde cuándo la fuente lo hizo públicamente conocible
system time      -> cuándo esta instalación lo obtuvo y registró
```

Las dos primeras dimensiones forman el contrato point-in-time del producto. La
tercera conserva auditoría operativa y permite reproducir qué tenía realmente la
instalación, incluso cuando ingiere historia atrasada.

## Vocabulario temporal

| Campo                         | Semántica                                                              |
| ----------------------------- | ---------------------------------------------------------------------- |
| `as_of`                       | fecha o instante económico que describe una observación                |
| `period_start` / `period_end` | intervalo contable o estadístico cubierto                              |
| `valid_from` / `valid_to`     | vigencia efectiva de una identidad, relación o definición              |
| `announced_at`                | momento en que se anunció un evento futuro                             |
| `published_at`                | publicación declarada por la fuente                                    |
| `filed_at`                    | fecha de filing asignada por el regulador                              |
| `accepted_at`                 | instante de aceptación/diseminación cuando la fuente lo provee         |
| `available_at`                | primer instante defendible en que el dato podía conocerse públicamente |
| `superseded_at`               | instante desde el que otra versión pasa a ser la vigente en esa cadena |
| `fetched_at`                  | instante de descarga desde la fuente                                   |
| `recorded_at`                 | instante de commit exitoso en la base local                            |

Los timestamps usan UTC ISO 8601. Una fecha sin hora conserva tipo `date` y
timezone/calendario de la fuente; no se convierte arbitrariamente a medianoche UTC.

## Intervalos

Los intervalos de vigencia y conocimiento son semiabiertos:

```text
[from, to) => from inclusive, to exclusive
```

Así, una asignación puede terminar exactamente cuando comienza su sucesora sin
solaparse. `valid_to=null` o `superseded_at=null` significa intervalo abierto, no
certeza de permanencia futura.

## Tipos de registro

### Dimensiones versionadas

Identidades, nombres, símbolos, listings, ratios depositarios, clasificaciones y
definiciones tienen vigencia efectiva:

```ts
type VersionedDimension = {
  subjectId: string;
  validFrom: string;
  validTo: string | null;
  availableAt: string;
  supersededAt: string | null;
  sourceId: string;
  sourceDocumentId: string | null;
  contentHash: string;
  recordedAt: string;
};
```

Ejemplo: un cambio de ticker anunciado el 10 de mayo y efectivo el 1 de junio
tiene `available_at=10 de mayo` y `valid_from=1 de junio`. Antes del 1 de junio se
conoce el cambio, pero el símbolo anterior sigue siendo el válido.

Una versión registrada puede nacer desactualizada: el grafo abrió a Franklin Templeton
el 2026-09-05 con un nombre que EDGAR había dejado de usar el 14 de agosto. Cerrarla en
el pasado le haría decir a un corte anterior algo que la instalación no sabía. Se
**supersede**: `superseded_at` es el instante en que se conoció la corrección y la
versión nueva vale desde el borde publicado, con ese mismo `available_at`. Un
`as_known` anterior sigue viendo el nombre viejo; uno posterior, el nuevo también para
fechas efectivas anteriores a la versión superseded
([ADR 0013](../architecture/adr/0013-listing-events-dated-evidence.md)).

### Ticker declarado y adquisición

[ADR 0014](../architecture/adr/0014-declared-corporate-events.md): una declaración
retrospectiva no cierra destructivamente el símbolo original. Supersede esa fila en
la primera verificación satisfactoria y agrega dos asignaciones conocidas desde ese
corte: el símbolo viejo hasta la fecha efectiva declarada y el nuevo desde ella. La
fila original conserva su intervalo para consultas con corte anterior. Repetir la
declaración no mueve el corte ni genera versiones adicionales.

Un vínculo `acquired_by` usa la última aceptación de las presentaciones que lo
corroboran, aunque la del adquirido haya ocurrido antes. Es visible con la selección
de dimensión habitual, pero **no participa** en `resolveReportingLineage`: tampoco
solicita observaciones del adquirido en una lectura del adquirente.

### Observaciones

Precios, hechos financieros y series macro describen un instante o período:

```ts
type PointInTimeObservation = {
  observationId: string;
  subjectType: "legal_entity" | "security" | "listing" | "macro_series";
  subjectId: string;
  metricId: string;
  asOf: string;
  periodStart: string | null;
  periodEnd: string | null;
  periodType:
    | "instant"
    | "quarter"
    | "year_to_date"
    | "annual"
    | "ttm"
    | "daily"
    | "monthly";
  unit: string;
  currency: string | null;
  rawValue: string | null;
  normalizedValue: string | null;
  rawValueStatus: "stored" | "not_provided" | "license_restricted";
  availableAt: string;
  supersededAt: string | null;
  fetchedAt: string;
  recordedAt: string;
  revisionGroupId: string;
  revisionNumber: number;
  restatementOfId: string | null;
  transformationId: string | null;
  contentHash: string;
  qualityFlags: string[];
  ingestionRunId: string;
};
```

Un valor `null` conserva motivo. `rawValueStatus` siempre existe, incluso cuando
una licencia impide guardar el raw.

### Eventos

Filings, publicaciones, corporate actions y anuncios son eventos inmutables. Un
evento puede anunciar un cambio efectivo futuro y producir nuevas versiones, pero
no edita el evento anterior.

```ts
type TemporalEvent = {
  eventId: string;
  eventType: string;
  subjectIds: string[];
  announcedAt: string | null;
  effectiveAt: string | null;
  availableAt: string;
  sourceDocumentId: string;
  contentHash: string;
  recordedAt: string;
};
```

## Identidad de una observación

Una observación no se deduplica sólo por ticker, métrica y fecha. Su clave lógica
incluye:

- sujeto interno estable;
- métrica y versión de definición;
- período o instante;
- unidad y moneda;
- fuente/dataset;
- concepto o tag original;
- base reported/normalized;
- revision group y parser version.

El `content_hash` se calcula sobre una serialización canónica de payload relevante,
provenance y parser version. El mismo hash dentro de la misma clave lógica es
idempotente; un hash diferente crea una revisión o conflicto, no un overwrite.

## Revision y restatement

Cada cadena de revisiones usa `revision_group_id` estable.

1. La primera publicación crea `revision_number=1`.
2. Una enmienda o revisión crea otra fila con `restatement_of_id`.
3. La versión anterior conserva su valor y `available_at`.
4. `superseded_at` registra desde cuándo la versión siguiente pasa a ser la
   seleccionada por la política de esa fuente.
5. Una corrección de parser crea una transformación/version nueva y no finge que
   el sistema conocía el resultado corregido antes.

Si la fuente no publica el instante exacto de disponibilidad, se usa la mejor
evidencia defendible y se agrega `availability_inferred`. Nunca se backdatea al
fin del período por conveniencia.

## Basis de conocimiento

Una consulta debe elegir una de estas bases:

### `public_availability`

Responde qué podía conocer un observador según la publicación de la fuente.
Permite reconstruir historia después de una ingesta tardía usando
`available_at`, pero no afirma que la instalación ya tuviera el dato.

### `system_recorded`

Responde qué había sido efectivamente registrado por esta instalación. Además de
`available_at`, exige `recorded_at <= known_at`. Es la base de auditoría para
reproducir la experiencia real del owner.

La UI y los exports etiquetan la basis. No mezclan resultados de ambas sin
explicación.

## Contrato de consulta

```ts
type PointInTimeQueryBase = {
  effectiveAt: string;
  adjustmentPolicy: "as_known" | "latest_adjusted";
  sourcePolicyVersion: string;
};

type PointInTimeQuery =
  | (PointInTimeQueryBase & {
      revisionPolicy: "as_known";
      knownAt: string;
      knowledgeBasis: "public_availability" | "system_recorded";
    })
  | (PointInTimeQueryBase & {
      revisionPolicy: "latest_restated";
      knownAt: null;
      knowledgeBasis: "public_availability";
    });
```

Reglas:

- `as_known` exige un `known_at` finito y aplica el cutoff.
- `latest_restated` es una vista actual explícita; no puede etiquetarse como
  point-in-time histórico.
- `latest_adjusted` puede aplicar splits/corporate actions conocidos hoy a una
  serie histórica, pero debe mostrar la base y transformación. «Hoy» es el corte de
  la consulta: ver [Base accionaria](#base-accionaria).
- Una valuación o screening guarda el query completo, no sólo `as_of`.
- No hay defaults silenciosos entre vista original y restated.

### Selección de dimensión

Para una relación efectiva y conocida en el corte:

```sql
valid_from <= :effective_at
AND (valid_to IS NULL OR :effective_at < valid_to)
AND available_at <= :known_at
AND (superseded_at IS NULL OR :known_at < superseded_at)
```

Con `knowledgeBasis=system_recorded` se agrega:

```sql
recorded_at <= :known_at
```

### Selección de observación

1. Filtrar sujeto, métrica, período, unidad y moneda compatibles.
2. Excluir filas con `available_at > known_at` en `as_known`.
3. Aplicar `recorded_at <= known_at` cuando la basis sea `system_recorded`.
4. Elegir dentro del revision group la versión vigente en el cutoff.
5. Aplicar precedencia de fuente y tolerancias versionadas del metric catalog.
6. Ante empate o desacuerdo no resuelto, devolver conflicto o quality flag.

El orden por `fetched_at DESC` nunca sustituye estas reglas.

### Linaje de reporte

Cuando una reorganización cambia el filer que presenta los estados del mismo grupo,
la historia del antecesor se lee junto a la del sucesor sin reasignar sujetos
(`reporting-lineage-1.0.0`,
[ADR 0011](../architecture/adr/0011-issuer-succession-reporting-lineage.md)):

1. el vínculo `reporting_successor` se selecciona con la regla de dimensión de
   arriba: efectivo en `effective_at`, `available_at <= known_at` —la aceptación de
   la presentación de sucesión— y `recorded_at <= known_at` bajo `system_recorded`;
2. cada segmento se selecciona por su propio sujeto con las reglas de observación;
3. el antecesor aporta sólo hechos con `as_of` anterior a la fecha efectiva de la
   sucesión, y un antecesor lejano el borde más temprano de la cadena;
4. un hecho —la clave lógica sin sujeto— reportado por más de un segmento se
   resuelve por la revisión con `available_at` más reciente. El mismo instante con
   valores distintos es `ambiguous_revision`; con el mismo valor gana el segmento
   más cercano al sujeto consultado;
5. cada fila devuelta conserva su `subject_id`: la provenance sigue nombrando al
   filer que reportó el valor.

Un `as_known` anterior a la aceptación de la sucesión devuelve la historia del
sucesor sola, aunque el antecesor ya haya presentado todo lo que presentó.

### Base accionaria

`adjustmentPolicy` decide en qué base se expresa un valor en acciones o por acción
(`split-adjustment-1.0.0`,
[ADR 0012](../architecture/adr/0012-stock-splits-share-basis.md)):

1. las revisiones se eligen siempre con la base reportada; `queryObservations`
   rechaza `latest_adjusted` con `unsupported_revision_policy` porque no conoce los
   splits, y la lectura ajustada pasa por el linaje;
2. con `as_known` cada valor queda en la base de la presentación que lo publicó;
3. con `latest_adjusted` cada valor sensible se multiplica —acciones— o divide —por
   acción— por el producto de los ratios de los splits confirmados cuya presentación
   es posterior a la de su vintage y conocible en el corte: `available_at <= known_at`
   y, bajo `system_recorded`, `recorded_at <= known_at`. La presentación del split ya
   está en base nueva; otra del mismo instante es `ambiguous_share_basis`;
4. la base es la del corte de conocimiento, no la de `effective_at`: la fecha efectiva
   filtra hechos y no deshace splits;
5. cada fila sensible nombra la transformación y su factor —`1` si ya estaba en
   base—, conserva la observación publicada y un valor faltante sigue faltando;
6. cada revisión se clasifica `original`, `restatement` o `split_reexpression`: es de
   split si difiere de la anterior exactamente por los splits publicados entre las dos,
   dentro del redondeo del filer;
7. una fila sensible de un antecesor del linaje no se lleva a la base del sucesor sin
   la conversión de acciones de la sucesión (`adjustment_across_succession`).

Un `as_known` anterior a la presentación del split lo ignora aunque el split ya haya
ocurrido: al 2014-05-01 el EPS básico FY2012 de Apple vale 44,64 con las dos
políticas.

## Semántica por dominio

### Identidad y CEDEAR

- `valid_from/valid_to` determinan qué listing, símbolo o ratio estaba efectivo.
- `available_at` determina desde cuándo podía saberse.
- Una consulta de ratio antes de su fecha efectiva conserva el ratio anterior
  aunque el cambio ya haya sido anunciado.
- Una consulta que no pueda resolver el subyacente exacto devuelve
  `ambiguous_identity`.

Reglas implementadas en `F7-03` ([ADR 0027](../architecture/adr/0027-cedear-registry-sources.md)):

- **Vigencia es observación.** Ninguno de los dos emisores fecha lo que publica,
  así que `available_at` y `valid_from` de un programa y de su ratio son el
  instante en que se leyó la publicación. No es la regla de la SEC —donde la
  descarga nunca es la disponibilidad porque la aceptación está publicada—: acá
  no hay nada publicado, y la observación es la primera fecha probable. Nunca
  mete look-ahead. Cada corrida lo declara con `availability_is_observation`.
- **Antes de la primera captura no hay respuesta negativa.** Un corte anterior a
  la primera observación devuelve `not_effective_at_cutoff`, nunca «sin CEDEAR».
- **Los cambios supersiden, no cierran.** Un ratio distinto supersede sólo al
  ratio y un estado distinto al programa, en el instante de la observación. La
  fecha efectiva está en el aviso del emisor, que el registro todavía no lee:
  fecharla con la corrida la inventaría. Consecuencia declarada: sabiendo del
  cambio, un corte anterior a su observación queda sin ratio.
- **La lista del emisor es autoritativa sobre sus programas.** Dejar de listar
  uno lo retira —se supersede sin sucesor—, y una corrida que retiraría más de
  la décima parte se niega (`withdrawal_guard`).

### SEC y fundamentales

- El sujeto es legal entity/security interna, no ticker.
- Se conservan accession, form, filed, accepted, fy, fp, start, end, unit,
  taxonomy y tag original. `frame` **no** se conserva: la SEC lo asigna al hecho
  más reciente de cada período calendario y lo mueve con cada presentación nueva,
  así que no describe lo reportado.
- `available_at` usa `accepted_at` cuando está disponible; de lo contrario aplica
  la regla documentada de la fuente y un quality flag.
- Un amendment/restatement crea otra revisión.
- `latest_restated` y `as_known` son vistas diferentes y visibles.

La API de frames puede ser útil para agregados, pero su alineación calendaria no
reemplaza el período fiscal exacto de un filing.

Reglas implementadas en `F2-03` ([ADR 0010](../architecture/adr/0010-sec-xbrl-ingestion.md)):

- **Aceptación.** `acceptanceDateTime` de `submissions` es UTC real: sobre 1.000
  presentaciones del filer 320193, leído como UTC cae dentro del horario operativo
  de EDGAR el 99,8%; leído como hora de Nueva York, el 33,9%. Sin aceptación, y
  sólo para formularios periódicos o corrientes, `available_at` es el primer
  instante del día siguiente al filing en Nueva York con offset EST (`05:00Z`) más
  `availability_inferred`: puede llegar tarde, nunca antes.
- **Vintages.** Un hecho es `(taxonomía, concepto, unidad, inicio, fin)`. Un
  re-reporte del mismo valor no crea revisión; un valor distinto en una
  presentación posterior sí, con el `available_at` de la primera presentación que
  lo mostró.
- **Sujeto.** El CIK se resuelve una vez, al corte de la descarga, contra el grafo
  vigente. Resolverlo al corte de cada hecho rechazaría toda la historia anterior a
  la constitución del universo; hacerlo al corte de la descarga no adelanta el
  conocimiento del hecho, porque el CIK no se reasigna.
- **Período.** El acumulado desde el inicio del ejercicio que no llega a un año es
  `year_to_date`, clasificado por duración medida; inicio y fin exactos siguen en la
  clave lógica.
- **Documento.** Cada presentación es un evento inmutable en `source_documents`,
  con su foco fiscal: `fy`/`fp` describen a la presentación, no al período del
  hecho.

### Mercado

- Precio y market cap se identifican por listing/security, venue, moneda e
  instante de mercado.
- `available_at` considera cierre/finalización de la barra y latencia del feed.
- Market cap propio usa precio y shares compatibles en fecha y base de ajustes.
- La política de corporate actions se guarda con la transformación.
- Un ticker rename no relabela destructivamente el listing histórico.

### Macro

- `as_of` describe el período económico; `published_at/available_at` describen el
  release.
- Cada revisión conserva vintage y metodología.
- Series original, desestacionalizada, real o rebased son métricas/transformaciones
  distintas.
- Un cambio metodológico no fusiona segmentos sin un puente versionado.

### Valuación

- El input snapshot referencia IDs de observaciones y versiones exactas.
- Una corrida aceptada no vuelve a ejecutar consultas “latest”.
- Replay usa los mismos inputs, engine, metodología y política numérica.
- Recalcular con un restatement crea otra corrida y registra el vínculo.

## Transformaciones

Toda transformación material registra:

```ts
type TransformationRecord = {
  transformationId: string;
  transformationType: string;
  transformationVersion: string;
  inputObservationIds: string[];
  parameters: Record<string, string>;
  outputObservationId: string;
  availableAt: string;
  recordedAt: string;
  formulaHash: string;
};
```

Para una observación derivada:

```text
available_at(output) = max(available_at(inputs), available_at(methodology))
recorded_at(output)  = instante de publicación local exitosa
```

Una fórmula no puede producir un output conocido antes de cualquiera de sus
inputs. La metodología/version del cálculo también forma parte del cutoff.

## Snapshots reproducibles

Un snapshot aceptado contiene:

- query temporal completo;
- IDs y hashes de cada input;
- identity resolution y versión de reglas;
- source policy y metric catalog version;
- transformaciones y corporate-action basis;
- parser, metodología y engine versions;
- fecha de creación y hash canónico.

El snapshot es append-only. Si una fuente corrige un dato, se crea un snapshot
nuevo; el anterior permanece reproducible y puede marcarse `superseded`, nunca
reescribirse.

## Ingesta e idempotencia

1. El ingestion run guarda source, dataset, as-of esperado, cursor y parser.
2. El adaptador descarga y registra `fetched_at`.
3. Staging valida schema, identidad, unidades, intervalos y hashes.
4. Dedupe compara clave lógica y content hash.
5. La publicación atómica inserta nuevas revisiones y cierra intervalos cuando
   existe evidencia.
6. `recorded_at` se asigna en el commit.
7. Sólo entonces se invalidan lecturas derivadas.

Una corrida repetida con el mismo dataset, as-of, parser y hash no duplica filas.
Una respuesta vacía, parser roto o fuente stale no cierra el último intervalo
válido.

Los pasos 1 a 4 están implementados en
[`execute-ingestion-run.ts`](../../src/modules/ingestion/application/execute-ingestion-run.ts):
la corrida guarda source, dataset, as-of, vintage, cursor y parser; el adaptador
registra `fetched_at`; staging valida con `stagedRecordSchema`; y la dedupe compara
el content hash del lote contra la última corrida publicable. Los estados `empty`,
`quarantined` y `failed` son terminales pero no publicables, de modo que ninguno
cierra el último intervalo válido.

Los pasos 5 a 7 están implementados en
[`publish-observations.ts`](../../src/modules/observations/application/publish-observations.ts):
resuelve el sujeto interno con el corte de conocimiento del propio registro, arma
la cadena de revisión, publica supersesión y revisión nueva en una sola
transacción, asigna `recorded_at` en ese commit y recién después devuelve las
identidades de cache a invalidar. Una corrida no publicable nunca llega a
publicar: `publishObservations` la rechaza antes de tocar el repositorio.

El vintage solicitado forma parte de la clave de idempotencia. Sin él, una
enmienda publicada más tarde sobre el mismo `as_of` se confundiría con un replay
exacto y no podría descubrirse nunca.

## Fallbacks y conflictos

- Un fallback conserva su propio source ID y `fallback_source` flag.
- La precedencia está versionada por métrica, no hardcodeada en la UI.
- Diferencias fuera de tolerancia producen `provider_disagreement` y la acción
  `flag`, `quarantine` o `manual_review`.
- No se promedian valores conflictivos para ocultar la discrepancia.
- Un fallback más reciente no reescribe la historia de la fuente primaria.

## Ejemplo de restatement

```text
2025-02-20: FixtureCo publica FY2024 revenue = 100
  as_of=2024-12-31
  available_at=2025-02-20T21:00:00Z
  revision=1

2025-05-01: FixtureCo presenta amendment, revenue = 96
  as_of=2024-12-31
  available_at=2025-05-01T14:00:00Z
  revision=2, restatement_of=revision-1
```

- `known_at=2025-03-01`, `as_known` devuelve 100.
- `known_at=2025-06-01`, `as_known` devuelve 96.
- `latest_restated` devuelve 96 y se etiqueta como vista actual.

El ejemplo es ficticio y existe únicamente para probar la semántica.

## Errores obligatorios

- `invalid_temporal_interval` para `from >= to`;
- `future_knowledge` si un output antecede a un input;
- `overlapping_effective_versions` para intervalos autoritativos incompatibles;
- `ambiguous_revision` si no existe desempate defendible;
- `missing_availability` cuando el método exige una fecha no disponible;
- `currency_or_unit_mismatch` antes de comparar o agregar;
- `ambiguous_identity` si el sujeto no se resuelve en el corte;
- `unsupported_revision_policy` ante combinaciones incoherentes.

## Tests requeridos

### Unit y property

- bordes exactos de intervalos semiabiertos;
- `known_at` antes, igual y después de `available_at`;
- ingesta tardía bajo ambas knowledge bases;
- amendment/restatement y selección de revisión;
- output derivado nunca disponible antes de sus inputs;
- `null`, cero, negativos, no finitos, unidad y moneda incompatible;
- determinismo del hash canónico.

### Integración

- constraints de no solapamiento;
- publicación atómica y dedupe/idempotencia;
- consulta `as_known` contra múltiples revisiones;
- runtime sin acceso a connection string de migraciones;
- fallo de parser que conserva el último snapshot válido.

### Casos de dominio

- ticker rename y ticker reutilizado;
- ratio CEDEAR anunciado antes de ser efectivo;
- split con `as_known` y `latest_adjusted`;
- filing original y amendment;
- serie macro revisada y cambio metodológico;
- valuación reproducida desde IDs exactos después de existir datos más nuevos.

## Estado de implementación

`F1-04` implementó el contrato sobre una sola empresa fixture:

- [`src/modules/temporal/domain/`](../../src/modules/temporal/domain/): envelope
  versionado, predicados de vigencia y conocimiento, query point-in-time y los
  códigos de error obligatorios;
- [`src/modules/observations/domain/`](../../src/modules/observations/domain/):
  observación publicada, clave lógica, `revision_group_id`, content hash y
  selección de revisión bajo ambas knowledge bases;
- [`observations`](../../src/server/db/schema.ts) en PostgreSQL, con índice único
  de revisión, índice parcial de una sola revisión vigente por cadena, checks de
  valor faltante, período, cadena de revisión y supersesión, y foreign key hacia
  la corrida que publicó cada fila.

`F2-02` persistió el grafo de identidad y constituyó el universo real del S&P 500.

`F2-03` llevó el contrato a datos reales de la SEC:

- [`src/modules/fundamentals/`](../../src/modules/fundamentals/): parsers de
  `submissions` y `companyfacts`, reglas de período, unidad y disponibilidad, y la
  construcción de vintages;
- [`source_documents`](../../src/server/db/schema.ts): el evento inmutable de cada
  presentación;
- [`publish-observations.ts`](../../src/modules/observations/application/publish-observations.ts):
  sujeto de documento, varias revisiones de un hecho en un lote y duplicados
  reconocidos contra toda la cadena;
- verificado sobre Apple en PostgreSQL personal: `as_known` un segundo antes de la
  aceptación de la 10-K/A del 2010-01-25 devuelve `Assets` FY2008 = 39.572 M; en la
  aceptación, 36.171 M.

`F2-04` sumó la sucesión de emisor y el linaje de reporte:

- [`src/modules/corporate-actions/`](../../src/modules/corporate-actions/):
  verificación de la sucesión declarada, vínculo versionado y lectura del linaje;
- [`corporate_actions` y `legal_entity_relationships`](../../src/server/db/schema.ts);
- verificado sobre ExxonMobil en PostgreSQL personal: la historia de `us-gaap:Revenues`
  anual pasa de 0 a 17 ejercicios (FY2009 a FY2025) y el vínculo no existe un segundo
  antes de la aceptación del `8-K12B` del 2026-07-01 16:36:49Z. Los ingresos del
  segundo trimestre de 2025 salen del antecesor antes del 10-Q conjunto y del sucesor
  después, con el mismo valor.

El incremento 2 de `F2-04` sumó los splits y la base accionaria:

- [`share-basis`, `verify-split-evidence`, `plan-split-recording` y `split-adjustment`](../../src/modules/corporate-actions/domain/):
  conceptos sensibles, coherencia, confirmación con dos evidencias de la misma
  presentación y lectura `latest_adjusted`;
- `split` y `reverse_split` en [`corporate_actions`](../../src/server/db/schema.ts),
  con `corporate_actions_split_terms_check`;
- verificado sobre Apple en PostgreSQL personal: de 150 re-expresiones, 71 son de split
  y 79 no; un segundo antes de la aceptación del 10-Q del 2014-07-23 el promedio de
  acciones FY2012 vale 934.818.000 y en la aceptación, con el 7:1 aplicado,
  6.543.726.000, el mismo valor que Apple re-expresó después.

Queda deferido y no debe presentarse como disponible:

- los cambios de ticker que la SEC no fecha y los vínculos de adquisición, que son el
  incremento 3b de `F2-04`. Traspasos de mercado, delistings y renombres ya se
  reconcilian con evidencia fechada (ADR 0013);
- la confirmación declarada de un split que la regla deja candidato —Duke Energy y
  Citigroup declaran su reverse split años después de re-expresar—: hasta entonces su
  serie por acción anterior al split sigue en la base vieja bajo `latest_adjusted`;
- el constraint de exclusión temporal por rango: exige la extensión `btree_gist`
  y por lo tanto un ADR propio. Hoy el no solapamiento se prueba en dominio con
  `assertNoOverlappingVersions` y en PostgreSQL sólo para el caso peligroso —dos
  revisiones vigentes simultáneas—;
- el push-down de la selección temporal a SQL: hoy el repositorio devuelve las
  revisiones acotadas del sujeto y la selección corre en el dominio, para que
  exista una sola implementación del contrato.

La ingesta real es manual y no un refresh. `pnpm fundamentals:ingest` trae un
ticker; `pnpm fundamentals:backfill` recorre el universo como job durable, con lease
por fuente, cursor y reanudación ([ADR 0015](../architecture/adr/0015-durable-ingestion-jobs.md)).
Ninguno detecta presentaciones nuevas ni corre programado: eso sigue en `F2-05`.

### Ventana de historia

Desde `sec-core-concepts-2.0.0` las dos guardan sólo la ventana
`sec-history-5fy-1.0.0` ([ADR 0017](../architecture/adr/0017-sec-history-window.md)):

- el corte es por fin de período, `end >= ancla − 5 años − 14 días`;
- el ancla es el último ejercicio anual del propio filer, no el reloj;
- los seis conceptos sensibles a splits conservan un ejercicio más, como evidencia.

Un período ausente no significa lo mismo a cada lado del corte:

- **Anterior al corte** de la corrida que lo habría traído: esa corrida **no lo fue a
  buscar**. La corrida registra `selection_version` y `selection_anchor_on`, y con
  los dos se reconstruye el corte.
- **Posterior al corte:** el filer no lo publicó, o se rechazó con nombre.

Una lectura que cruce el corte puede encontrar filas de corridas distintas, y cada
una se explica por su propia corrida.

`corporate-actions:splits` no juzga los ratios declarados antes de la primera
vintage sensible publicada del filer: los nombra `precedes_published_history`,
porque no hay con qué comparar ni nada que ajustar.

### Poda

La ventana gobierna las ingestas nuevas, pero el ancla avanza con cada ejercicio y
lo publicado antes se queda. `pnpm fundamentals:prune` lo borra con la regla
`sec-history-prune-1.0.0` ([ADR 0019](../architecture/adr/0019-observation-history-prune.md)),
que es el complemento exacto de la ventana: borra `as_of < ancla − 5 años − 14 días`
y les da a los seis conceptos de evidencia su ejercicio extra, con la misma
aritmética que la ingesta. El ancla sale de la corrida que la registró, nunca de las
filas guardadas: el foco `FY` que el ancla necesita no está en la observación. Un
sujeto sin ancla vigente se rechaza por nombre (`anchor_unknown`,
`selection_superseded`) y la salida es volver a ingerirlo.

Una poda es un borrado, no una re-expresión: no hay revisión nueva ni cadena que
cerrar. Un grupo de revisión es un hecho `(concepto, unidad, inicio, fin)`, así que
todas sus revisiones comparten `as_of` y la poda se lo lleva entero o no lo toca.

**Para un sujeto podado, la poda —y no la corrida— es la que explica una ausencia
anterior a su corte.** Cada una deja una fila append-only en `observation_prunes`
con la regla, la selección, el ancla y su corrida, los dos cortes, los conceptos de
evidencia, cuántas filas se borraron y cuántas quedaron, los extremos de lo
borrado, el actor y el motivo. Un check exige que nada borrado termine en el corte
o después, que es lo que hace confiable al registro:

- **anterior al corte de la poda:** la fila existió y el owner la borró, en la fecha
  que dice el registro;
- **entre el corte de la poda y el de la corrida:** esa corrida no fue a buscar el
  período;
- **posterior al corte de la corrida:** el filer no lo publicó, o se rechazó con
  nombre.

Los `source_documents` no se podan: el evento de que una presentación se leyó sigue
siendo cierto, y hay corporate actions que apuntan a documentos cuyas observaciones
ya no están. Un split confirmado con evidencia que la poda borró tampoco se toca: la
corrida de splits lo nombra `recorded_split_not_reconfirmed` y su ratio queda
`precedes_published_history`.

### Forma persistida

Desde la migración `0012`, la fila de `observations` no guarda lo que reconstruye
sin pérdida ([ADR 0018](../architecture/adr/0018-lighter-observation-rows.md)). La
observación del dominio no cambia:

- `source_id`, `dataset_id` y `parser_version` son los de la corrida, y publicar
  una observación con otros falla antes de escribir;
- `metric_id` nulo significa que la métrica es el concepto reportado;
- `late_ingestion` es una regla: el flag aparece, último, exactamente cuando
  `recorded_at` supera a `available_at` en más de un día;
- los dos hashes van en 32 bytes y el dominio los sigue viendo en hex.

`externalId` es una identidad de staging: nombra registros dentro de un lote y
entra al content hash, pero la observación publicada no lo lleva. Para la SEC se
reconstruye con `secFactExternalId` a partir de la fila y el `subject_key` de su
corrida, así que cada hash guardado se puede volver a calcular.

### Verificación sobre la base

`F2-07` convirtió las verificaciones de arriba en un comando. Hasta entonces cada
una se había corrido **una vez, a mano, sobre una empresa**: los 39.572 M de Apple
que pasan a 36.171 M en la aceptación de la 10-K/A, los 17 ejercicios que
ExxonMobil gana por el linaje, las 934.818.000 acciones que pasan a 6.543.726.000
con el 7:1. Quedaban escritas en prosa y no volvían a correr, así que una regresión
en la empresa número siete no rompía nada.

`pnpm gate:point-in-time` ([runbook](../runbooks/point-in-time-audit.md)) recorre
todas las cadenas publicadas y evalúa cinco afirmaciones:

- `provenance_resolves` — la fila que cita un documento llega hasta él y las dos
  disponibilidades coinciden;
- `availability_precedes_fetch` — la disponibilidad es la aceptación, no la descarga;
- `revision_chain_ordered` — números densos, cada revisión más nueva, encadenada,
  una sola vigente y es la última;
- `as_known_excludes_later_revision` — un instante antes de la aceptación de una
  revisión se devuelve la anterior, y en la aceptación esa;
- `restatement_changes_content` — una revisión nueva cambia algo.

La cuarta pasa por `queryObservations`, así que lo que se prueba es el mismo
dominio que lee la aplicación. Una afirmación que nunca se evaluó queda
`not_exercised` y el comando sale distinto de cero: una base sin ninguna cadena
restateada no prueba nada sobre el no-look-ahead.

Es de sólo lectura y no sale a la red. Sobre el PostgreSQL personal del
2026-09-21: 4.946 cadenas, 5.107 revisiones, 159 cadenas con restatement, 161
transiciones evaluadas y ninguna falla.

## Fuentes primarias

- [SEC: EDGAR APIs y XBRL](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC: asociaciones CIK/ticker y sus límites](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [Caja de Valores: CEDEAR y ratios](https://cajadevalores.com.ar/Servicios/Cedears)
- [ISO 10383: MIC](https://www.iso20022.org/market-identifier-codes)
- [OpenFIGI: mapping y scopes](https://www.openfigi.com/api/documentation)
