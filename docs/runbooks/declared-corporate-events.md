# Registrar una adquisición o un cambio de ticker

- Slice: `F2-04`, incremento 3b
- Decisión: [ADR 0014](../architecture/adr/0014-declared-corporate-events.md)
- Runtime: personal local o protegido, con PostgreSQL y `SEC_USER_AGENT`

## Preparación

Aplicar las migraciones con `pnpm db:migrate`. Los dos CIK de una adquisición deben
existir en el grafo; el comando no incorpora empresas desconocidas. Para un ticker,
el grafo debe conservar el símbolo anterior y un único instrumento del emisor en ese
MIC. No reconstruye una historia anterior a la apertura del símbolo.

Guardar la declaración en un archivo privado fuera del repositorio, por ejemplo en
`/tmp/declaracion.json`. Máximo 32 KiB, objeto JSON único, sin campos adicionales.
`decidedAt` es el instante real de la declaración del owner, nunca la fecha del
anuncio histórico. `rationale` identifica la evidencia leída y el motivo; no es una
instrucción para una IA. Fechas y roles deben provenir de documentos revisados.

## Cambio de ticker

Ejemplo **sintético**, no una declaración para aplicar al universo real:

```json
{
  "kind": "symbol_change",
  "cik": "0000000085",
  "mic": "XNYS",
  "fromSymbol": "OLDT",
  "toSymbol": "NEWT",
  "effectiveOn": "2025-09-12",
  "decidedBy": "owner",
  "decidedAt": "2025-09-20T17:00:00.000Z",
  "rationale": "Ejemplo sintético del cambio del mismo instrumento."
}
```

El job verifica que la tabla vigente de la SEC asigne sólo el nuevo símbolo al mismo
CIK y MIC y que el anterior ya no aparezca en ese MIC. La tabla no prueba la fecha:
la declara el owner. El conocimiento se fija en la primera verificación satisfactoria,
conservando la declaración original en los términos del evento. Antes de ese corte,
una consulta histórica sigue viendo el símbolo anterior.

## Adquisición

Ejemplo **sintético**:

```json
{
  "kind": "acquisition",
  "acquiredCik": "0000000082",
  "acquirerCik": "0000000083",
  "acquiredClosingAccession": "0000000900-25-000001",
  "acquirerClosingAccession": "0000000900-25-000002",
  "sharedCommunicationAccession": "0000000900-25-000003",
  "effectiveOn": "2025-09-17",
  "decidedBy": "owner",
  "decidedAt": "2025-09-20T17:00:00.000Z",
  "rationale": "Ejemplo sintético de compra integral sin continuidad de reporte."
}
```

Revisar los cuerpos de ambos 8-K para declarar los roles. El job verifica formularios,
ítems, fecha del evento, aceptaciones y una comunicación `425` compartida; no interpreta
el texto. La evidencia debe figurar en los índices recientes. El vínculo `acquired_by`
queda disponible cuando todas las presentaciones requeridas fueron aceptadas. No une
los fundamentales del adquirido a los del adquirente, ni registra términos de canje.
El delisting se reconcilia por separado con `corporate-actions:listings`.

## Ejecución y recuperación

```bash
pnpm corporate-actions:declare --file /tmp/declaracion.json
pnpm corporate-actions:declare --file /tmp/declaracion.json --apply
```

La primera orden descarga, valida y planifica sin escribir siquiera el registro de
fuentes. Revisar `status`, `rejection`, `plan` y `availableAt`. La segunda registra
corrida, documentos y el cambio atómico del grafo. Un rechazo devuelve código de
salida 1 y conserva el grafo.

- Una repetición idéntica devuelve `duplicate` sin nuevas versiones ni eventos.
- Si se corta tras la corrida/documentos, repetir el mismo archivo completa el grafo
  bajo la corrida original y conserva el primer instante de verificación.
- Un conflicto de documento, un plan desactualizado o una declaración incompatible
  falla; no borrar filas ni modificar fechas para forzar su aceptación.
- Un `429` o `5xx` registra fallo reintentable. No hay retry automático ni scheduler:
  se vuelve a ejecutar manualmente. Este comando no toma el lease de la fuente
  ([ADR 0015](../architecture/adr/0015-durable-ingestion-jobs.md)): no correrlo
  durante un backfill.
- La migración `0009` tiene rollback pareado. Rechaza la reversión si todavía existen
  eventos o vínculos que usan los tipos nuevos. Probar únicamente en una base
  descartable; no borra decisiones personales para hacer que el downgrade pase.

## Validación del incremento

Fixtures sintéticas prueban las dos operaciones y sus fallos sin red. Integración
prueba PostgreSQL, idempotencia, consultas anteriores/posteriores, atomicidad,
constraints y planes desactualizados. El sondeo real y la réplica técnica del estado
previo no equivalen a una declaración del owner aplicada: los datos personales no se
modifican para fabricar esa evidencia.
