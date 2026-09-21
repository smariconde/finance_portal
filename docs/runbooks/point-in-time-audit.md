# Verificar el contrato point-in-time sobre la base

- Slice: `F2-07`, incremento 1 — el **gate de la Fase 2** vuelto comando
- Contrato: [point-in-time](../data/point-in-time-contract.md)
- Runtime: personal local o protegido, con PostgreSQL. No sale a la red y no
  escribe nada.

El verificador no prueba el código: prueba **lo que la base ya publicó**. Los
tests de dominio prueban que la selección de revisión hace lo que creemos; este
comando prueba que las filas persistidas siguen mereciendo esa selección.

## Cuándo se corre

- Después de cualquier ingesta, poda, refresh o migración que toque
  `observations`, `source_documents` o `ingestion_runs`.
- Antes de declarar cerrada una fase que afirme algo sobre la historia.
- Cuando una lectura devuelve un número que no se explica.

Es inocuo y repetible: lee, cuenta y se va.

## Procedimiento

```sh
pnpm gate:point-in-time            # informe legible
pnpm gate:point-in-time --json     # el mismo informe como evidencia
```

Termina en `0` si todas las afirmaciones pasan y en `1` si alguna falla **o quedó
sin ejercitar**. Lo segundo importa: una base sin ninguna cadena restateada no
prueba nada sobre el no-look-ahead, y llamar a eso un verde sería el default
silencioso que el contrato prohíbe.

`--page-size` cambia cuántas cadenas entran por página. El default (200) no
cambia ningún resultado: una cadena se lee siempre entera, nunca partida entre
dos páginas.

## Las cinco afirmaciones

| Afirmación                         | Qué dice                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `provenance_resolves`              | La fila que cita un documento llega hasta él, y las dos fechas de disponibilidad coinciden.        |
| `availability_precedes_fetch`      | La disponibilidad es la aceptación del filing, nunca el instante de descarga.                      |
| `revision_chain_ordered`           | Números densos desde 1, cada revisión más nueva que la anterior, encadenada, una sola vigente.     |
| `as_known_excludes_later_revision` | Un instante antes de la aceptación de una revisión se devuelve la anterior; en la aceptación, esa. |
| `restatement_changes_content`      | Una revisión nueva cambia algo. Si repite valor, parser y flags, es un duplicado.                  |

La cuarta se evalúa **a través de `queryObservations`**, el mismo dominio que lee
la aplicación. Un verificador con su propia copia de la selección probaría la
copia.

`filas sin documento citado` es un conteo, no una afirmación: una fuente de
fixture no publica documentos. Para la SEC vale cero, y pasar de cero a N es la
regresión que hay que mirar.

## Cuando algo falla

El informe nombra la afirmación, el motivo, el sujeto, la métrica, el período y
el `observation_id`. Cada motivo dice qué mirar:

- `unknown_source_document` — la fila cita una presentación que no está en
  `source_documents`. Se borró el documento, o la ingesta publicó filas sin
  registrar la presentación.
- `document_availability_mismatch` — la fila y su presentación no coinciden en la
  fecha. Una de las dos se movió después de publicarse.
- `availability_dated_with_the_clock` — la fila quedó fechada con el reloj de la
  descarga. Es lo que la [ADR 0010](../architecture/adr/0010-sec-xbrl-ingestion.md)
  prohíbe: rompe todo `as_known` posterior.
- `revision_not_newer`, `broken_restatement_link`,
  `supersession_does_not_match_successor`, `no_current_revision`,
  `more_than_one_current_revision`, `current_revision_is_not_the_last` — la
  cadena dejó de ser una cadena. Hasta arreglarla, ninguna lectura de ese hecho
  es confiable.
- `later_revision_leaked_into_earlier_query` — **la falla grave**: una consulta
  anterior a un restatement devolvió el valor enmendado. Es `TM-06` roto.
- `revision_not_visible_at_its_own_availability` o
  `earlier_knowledge_returned_nothing` — el hecho no se puede leer en el instante
  en que se volvió público, normalmente porque su `as_of` es posterior a la
  aceptación del filing que lo reporta.
- `duplicate_content_hash` o `identical_value_without_reason` — el dedupe dejó
  pasar una revisión que no aporta nada.

Ninguna se arregla desde el verificador: es de sólo lectura. La salida es volver
a ingerir el sujeto, podarlo, o corregir la migración que lo dejó así.

## Evidencia registrada

`F2-07` incremento 1, sobre el PostgreSQL personal del 2026-09-21:

```text
regla                              point-in-time-audit-1.0.0
cadenas                            4946
revisiones                         5107
cadenas con restatement            159
filas sin documento citado         0

provenance_resolves                ok · 5107 evaluadas, 0 fallidas
availability_precedes_fetch        ok · 5107 evaluadas, 0 fallidas
revision_chain_ordered             ok · 10053 evaluadas, 0 fallidas
as_known_excludes_later_revision   ok · 161 evaluadas, 0 fallidas
restatement_changes_content        ok · 161 evaluadas, 0 fallidas

gate                               pasa
```

Seis filers —cinco miembros del índice más el antecesor de reporte de
ExxonMobil—. Las 161 transiciones son restatements reales de la SEC, no casos
construidos.
