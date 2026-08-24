# Contrato point-in-time

- Estado: contrato aceptado para implementación posterior
- Versión: 0.1
- Fecha: 2026-08-21
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
  periodType: "instant" | "quarter" | "annual" | "ttm" | "daily" | "monthly";
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
  serie histórica, pero debe mostrar la base y transformación.
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

## Semántica por dominio

### Identidad y CEDEAR

- `valid_from/valid_to` determinan qué listing, símbolo o ratio estaba efectivo.
- `available_at` determina desde cuándo podía saberse.
- Una consulta de ratio antes de su fecha efectiva conserva el ratio anterior
  aunque el cambio ya haya sido anunciado.
- Una consulta que no pueda resolver el subyacente exacto devuelve
  `ambiguous_identity`.

### SEC y fundamentales

- El sujeto es legal entity/security interna, no ticker.
- Se conservan accession, form, filed, accepted, fy, fp, start, end, frame, unit,
  taxonomy y tag original.
- `available_at` usa `accepted_at` cuando está disponible; de lo contrario aplica
  la regla documentada de la fuente y un quality flag.
- Un amendment/restatement crea otra revisión.
- `latest_restated` y `as_known` son vistas diferentes y visibles.

La API de frames puede ser útil para agregados, pero su alineación calendaria no
reemplaza el período fiscal exacto de un filing.

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

Queda deferido y no debe presentarse como disponible:

- persistir el grafo de identidad —hoy vive como fixture sintética en
  [`demo-identity-fixtures.ts`](../../src/modules/identity/infrastructure/demo-identity-fixtures.ts)—
  y sus corporate actions, que corresponden a `F2-02`;
- el constraint de exclusión temporal por rango: exige la extensión `btree_gist`
  y por lo tanto un ADR propio. Hoy el no solapamiento se prueba en dominio con
  `assertNoOverlappingVersions` y en PostgreSQL sólo para el caso peligroso —dos
  revisiones vigentes simultáneas—;
- el push-down de la selección temporal a SQL: hoy el repositorio devuelve las
  revisiones acotadas del sujeto y la selección corre en el dominio, para que
  exista una sola implementación del contrato.

Este documento no autoriza una ingesta real ni marca disponible un historial
point-in-time de datos reales: la única empresa cubierta es sintética.

## Fuentes primarias

- [SEC: EDGAR APIs y XBRL](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC: asociaciones CIK/ticker y sus límites](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [Caja de Valores: CEDEAR y ratios](https://cajadevalores.com.ar/Servicios/Cedears)
- [ISO 10383: MIC](https://www.iso20022.org/market-identifier-codes)
- [OpenFIGI: mapping y scopes](https://www.openfigi.com/api/documentation)
