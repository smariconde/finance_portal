# ADR 0018: filas de observación más livianas

- Estado: aceptado
- Fecha: 2026-09-17
- Alcance: incremento 2 de `F2-05`, paso 2. Fija cómo se guarda una observación
  publicada en PostgreSQL: qué columnas se dejan de guardar porque se reconstruyen
  sin pérdida, en qué representación van los hashes y qué índices quedan. No cambia
  qué se guarda (la ventana de la [ADR 0017](0017-sec-history-window.md)) ni la
  forma de la observación en el dominio.
- Decisiones relacionadas: [ADR 0010](0010-sec-xbrl-ingestion.md) (ingesta XBRL),
  [ADR 0016](0016-analysis-scope-sector-matrices.md) (base hosteada en un plan
  gratuito), [ADR 0017](0017-sec-history-window.md) (ventana de historia),
  [contrato point-in-time](../../data/point-in-time-contract.md)

## Contexto

Con la ventana de cinco ejercicios, el universo ocupó 451 MB en una réplica: 434 MB
de observaciones a 980 bytes por fila. La base de `F6-06` debería entrar en un plan
gratuito, con 0,5 GB de tope, y el owner no quiere guardar nada «por las dudas».
El backlog anotó que unos 260 de los 555 bytes de cada fila eran procedencia
redundante y pidió medir con un prototipo antes de decidir.

La medición sobre la base personal (14.276 filas de seis filers) encontró:

- `content_hash` y `revision_group_id` son hex en texto: 65 bytes cada uno, y el
  segundo aparece además en dos índices únicos;
- `external_id` ocupa 95 bytes y se reconstruye **exacto** en las 14.276 filas con
  el `subject_key` de la corrida, el concepto, la unidad, el período y la
  presentación;
- `source_id`, `dataset_id` y `parser_version` (50 bytes) son los de la corrida en
  el 100 % de las filas;
- `metric_id` es igual a `concept` en el 100 % de las filas (37 bytes): hasta que
  exista el catálogo de métricas, la métrica de un hecho reportado es su concepto;
- `quality_flags` guarda `["late_ingestion"]` en el 100 % de las filas (23 bytes).
  El flag es función de `available_at` y `recorded_at`, y coincide con la regla de
  24 horas en todas;
- `observations_knowledge_idx` tiene 0 scans: ninguna consulta filtra por tiempo en
  SQL, porque la selección temporal corre en el dominio;
- `observations_subject_idx` incluye `as_of`, que ninguna consulta usa para
  ordenar, y con él casi cada clave es distinta: 72 bytes por fila.

### Prototipo

Copias frescas de la tabla, sin las tuplas muertas de las supersesiones, en una
réplica descartable de la base personal:

| Variante                                                                                  | Tabla | Índices | Total por fila |
| ----------------------------------------------------------------------------------------- | ----: | ------: | -------------: |
| Formato anterior                                                                          |   581 |     306 |            890 |
| Hashes en `bytea`                                                                         |   512 |     222 |     737 (−17%) |
| + sin ID externo ni procedencia de la corrida, `metric_id` nulo, índices de la decisión 6 |   322 |     160 |     484 (−46%) |
| + `late_ingestion` derivado                                                               |   306 |     158 | **467 (−48%)** |
| + columnas reordenadas para no pagar alineación                                           |   297 |     160 |     459 (−48%) |

Bytes por fila. El reordenamiento aporta 8 bytes y exige recrear la tabla: queda
afuera.

## Decisión

La fila guarda una sola vez cada dato y deja afuera lo que reconstruye sin pérdida.
El dominio no cambia: `Observation` sigue trayendo fuente, dataset, parser, métrica
y flags, y el repositorio los completa al leer.

### 1. Hashes en binario

`content_hash` y `revision_group_id` pasan a `bytea` de 32 bytes, con un check de
largo. El tipo `sha256` de Drizzle convierte en el borde: el dominio sigue viendo 64
dígitos hex, y un valor que no los tiene se rechaza antes de llegar a la base, en
vez de truncarse. El orden de `bytea` es el mismo que el del hex en minúsculas.

### 2. El ID externo es identidad de staging

`externalId` nombra un registro dentro de un lote: detecta duplicados, nombra
rechazos y ordena la publicación. La observación publicada ya no lo lleva, y la fila
no lo guarda. Sigue entrando al content hash, que se calcula con el registro de
staging, así que **ningún hash cambia**.

Para la SEC, el ID sale entero de la fila y su corrida:

```text
subject_key : concepto : unidad de la fuente : inicio | instant : as_of : accession
```

`secFactExternalId` es la única fórmula: la usa la construcción de vintages, y
`formatSecUnit` invierte `mapSecUnit` sin pérdida. Un test fija el formato, porque
cambiarlo haría que todo lo publicado pareciera una revisión nueva. El rollback
repite la fórmula en SQL.

### 3. Fuente, dataset y parser son los de la corrida

La fila apunta a su corrida (`ingestion_run_id`), que ya guarda los tres. El
repositorio los lee con un join por clave primaria. Al publicar, verifica que cada
observación traiga los de su corrida y, si no, falla con
`ObservationProvenanceError` antes de escribir nada. Antes esa coincidencia no se
verificaba; ahora es una invariante.

### 4. `metric_id` nulo es el concepto

`metric_id` es nulo mientras la métrica sea el concepto reportado, y un check
impide guardar una copia (`metric_id <> concept`). La lectura devuelve
`coalesce(metric_id, concept)`, y el filtro por métricas usa la misma expresión.
Cuando el catálogo de Fase 3/4 asigne métricas propias, se guardan sin migración.

### 5. `late_ingestion` es una regla, no un dato guardado

`isLateIngestion(availableAt, recordedAt)` vive en el dominio: más de un día entre
la publicación y el registro local. El schema de `Observation` exige el flag
**exactamente** cuando la regla lo pide, y en el último lugar. Por eso sacarlo al
guardar y volver a agregarlo al leer devuelve la misma observación. La fila guarda
sólo los flags de la fuente, y un check rechaza `late_ingestion` guardado.

Cambiar el umbral reetiquetaría la historia, así que exige otra decisión y volver a
guardar el flag.

### 6. Índices

- `observations_subject_idx` pasa a indexar el sujeto y la métrica efectiva:

  ```sql
  (subject_type, subject_id, coalesce(metric_id, concept))
  ```

  Sin `as_of`, las claves se repiten y PostgreSQL las deduplica: de 72 a 10 bytes
  por fila.

- `observations_knowledge_idx` se borra.
- Los dos índices únicos de revisión quedan, más chicos por la decisión 1.

### 7. Migración `0012` y rollback

La migración empieza con un guardia que cuenta las filas que perderían
información:

- un `external_id` distinto de la fórmula;
- una procedencia distinta de la de su corrida;
- flags distintos de «los de la fuente más `late_ingestion` según la regla».

Si alguna cuenta no da cero, se niega, nombra las tres cuentas y no toca nada.
Después borra los índices viejos, vacía `metric_id` y el flag con un `UPDATE`, borra
las cuatro columnas y cambia los dos tipos en una sola reescritura, que además
compacta la tabla.

El rollback pareado restaura la forma anterior, fila por fila. Se niega mientras
haya observaciones cuyo ID externo no se puede reconstruir: las de una corrida que
no es companyfacts de la SEC o que no tiene `subject_key`.

## Medición sobre datos reales (2026-09-17)

**Réplica de la base personal** (14.276 observaciones de seis filers):

- la migración tarda 1 s. `observations` pasa de 13 MB a **7,0 MB**, de 954 a
  **491 bytes por fila**: la tabla, de 8,1 a 4,7 MB, y los índices, de 5,5 a
  2,2 MB;
- las 14.276 filas conservan byte a byte todo lo que queda, hashes incluidos;
- `fundamentals:ingest --apply` de Apple, NVIDIA, Alphabet, Duke y ExxonMobil con
  su antecesor: **0 publicadas y 5.107 duplicadas** en 14 requests. Cada hash
  recalculado se encontró en su cadena;
- `corporate-actions:splits --apply` de NVIDIA y Apple da `unchanged`. El filtro
  por métrica encuentra 666 y 689 revisiones sensibles;
- el rollback deja las 14.276 filas idénticas en todas sus columnas, con los
  índices y checks anteriores, y la `0012` se vuelve a aplicar al mismo tamaño;
- el guardia se niega con un ID externo alterado, un parser ajeno y un flag fuera
  de lugar, y nombra una fila de cada uno. El rollback se niega con una fila de
  otra fuente.

**Universo sobre una réplica limpia del grafo:**

- 501 de 501 filers en dos corridas y 21 minutos, con 1.192 requests (936 hasta la
  reserva de presupuesto y 256 después). No hubo señales de la fuente ni items
  fallados o envenenados.
- Mismas filas que con el formato anterior (ADR 0017): 464.531 observaciones de
  501 sujetos, 13.141 documentos, 464 corridas `succeeded` y 37 `partial` con
  2.611 registros rechazados con nombre.
- **Tamaño:** las observaciones ocupan **229 MB**, contra 434 MB: 136 de tabla y
  93 de índices, **516 bytes por fila** contra 980 (−47 %). La base completa pasa
  de 451 a **245 MB**, y entra en el plan gratuito de `F6-06` con la mitad libre.
- **Compactada** (`VACUUM FULL`, 2 s), la tabla queda en 206 MB, a 465 bytes por
  fila, lo que dio el prototipo. La diferencia es espacio libre de las
  supersesiones y de los índices llenados fuera de orden, y PostgreSQL lo reutiliza.
- Sólo 47 filas guardan flags (`availability_inferred`) y ninguna guarda
  `metric_id`.

**Base personal:** la `0012` se aplicó después de un backup. `observations` pasó de
13 a 6,8 MB y la base, de 24 a 18 MB. Las 14.276 filas se leen por el repositorio
y pasan el schema del dominio.

## Consecuencias

- Toda lectura de observaciones pasa por el join con `ingestion_runs`, una tabla
  chica leída por clave primaria. SQL a mano que filtre observaciones por fuente
  tiene que pasar por la corrida.
- Una fuente nueva que publique observaciones tiene que poder reconstruir su ID
  externo, o el rollback de `0012` se niega con sus filas. Hoy sólo publica la SEC.
- Los fixtures que arman observaciones a mano derivan el flag con
  `withIngestionFlags`.
- `source_documents` e `ingestion_runs` siguen con hashes en texto: son tablas
  chicas (13.141 documentos y 5 MB para el universo).

## Alternativas descartadas

- **Reordenar columnas.** Ahorra 8 bytes por fila y obliga a recrear la tabla con
  sus constraints y su foreign key.
- **Diccionario de conceptos** (un entero en lugar del texto). Ahorraría otros 33
  bytes por fila, pero suma un upsert en cada publicación y un join más en cada
  lectura. Queda como opción si `F6-06` no entra.
- **Borrar `metric_id`.** El catálogo de métricas lo va a necesitar, y volver a
  agregarlo sería otra migración.
- **Guardar `late_ingestion` como booleano.** Ahorra lo mismo, pero sigue guardando
  un valor derivado que puede contradecir a la regla.
- **Truncar los hashes a 16 bytes.** Cambia la identidad de cada cadena y de cada
  contenido publicado.
- **Mover `fetched_at` a la corrida.** Son 8 bytes y la corrida no guarda ese
  instante.
