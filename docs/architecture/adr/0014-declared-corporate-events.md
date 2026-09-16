# ADR 0014 — Adquisiciones y cambios de ticker declarados

- Estado: aceptada
- Fecha: 2026-09-15
- Slice: `F2-04`, incremento 3b
- Continúa: [ADR 0013](0013-listing-events-dated-evidence.md)

## Contexto y sondeo

Dos consultas a `submissions`, sin conservar payload, sobre AvalonBay (915912) y
Vivmark (906107) encontraron 15 accessions `425` compartidas. No identifican la
orientación del vínculo: sus prefijos son agentes de presentación (1140361 y
1193125), no los CIK de las partes. La intersección del índice reciente no contiene
un `S-4`: no se exige ese supuesto del borrador.

El [8-K de AvalonBay](https://www.sec.gov/Archives/edgar/data/915912/000110465926097833/tm2623381d1_8k.htm)
y el [8-K de Vivmark](https://www.sec.gov/Archives/edgar/data/906107/000114036126033377/ef20080318_8k.htm)
describen el cierre del 17 de agosto y los roles. Sus aceptaciones son
20:01:44Z y 20:01:49Z respectivamente. Las comunicaciones previas corroboran una
operación, no prueban su cierre. El [criterio de la SEC sobre Rule 425](https://www.sec.gov/divisions/corpfin/guidance/phonesupplement3.htm)
distingue expresamente quien presenta de la compañía objeto de la comunicación.

## Decisión

Un comando manual recibe una declaración JSON explícita. No descubre roles leyendo
nombres, ni convierte una divergencia de ticker en autorización del owner.

### Adquisición

- La declaración nombra los dos CIK, sus 8-K de cierre, una accession `425`
  compartida, fecha efectiva, motivo y `decidedBy = owner` con `decidedAt`.
- Ambos CIK deben resolver a entidades distintas del grafo. El job no incorpora
  compañías desconocidas ni infiere instrumentos cancelados o ratios de canje.
- Verifica 8-K del adquirido con 2.01 y 5.01, del adquirente con 2.01, ambos con
  `reportDate` igual a la fecha declarada; verifica el mismo `425`, con metadata
  coincidente, en ambos índices y anterior al cierre. Se rechaza evidencia ausente,
  ambigua, posterior a la descarga o inválida. Los roles son una decisión declarada,
  corroborada por esos índices; el job no interpreta el cuerpo del filing.
- Evento `acquisition` sobre la entidad adquirida y vínculo `acquired_by` desde
  adquirido (`predecessorLegalEntityId`) a adquirente (`successorLegalEntityId`).
  Reusa las columnas del vínculo; no significa sucesión de reporte.
- `validFrom` es medianoche de Nueva York en la fecha declarada y `availableAt`
  el máximo de las aceptaciones que prueban el vínculo. Corrige el borrador que
  usaba sólo la aceptación del adquirido y adelantaba cinco segundos la evidencia.
- Un adquirente admite varias adquisiciones; un adquirido sólo un vínculo abierto
  de este tipo. Ciclos y modificaciones de un evento registrado se rechazan.
- Sólo `reporting_successor` participa en el linaje financiero. No cambian hechos,
  listings, instrumentos ni membresías por registrar la adquisición.

### Ticker

- La declaración identifica CIK, MIC, ticker anterior/nuevo, fecha efectiva, motivo,
  `decidedBy = owner` y `decidedAt`. La SEC vigente debe asignar únicamente el nuevo
  ticker al mismo CIK y MIC; el anterior debe estar ausente en ese MIC. Una tabla
  con filas rechazadas no prueba ausencia; un ticker relevante con venue desconocido
  tampoco puede descartarse como ajeno a ese mercado.
- El grafo debe contener un único listing activo de ese emisor en ese MIC con el
  ticker anterior. Un segundo instrumento/clase es ambiguo. Se rechazan cambios
  anteriores a la apertura del símbolo: no se fabrica historia que no se guardó.
- Conocimiento conservador: el instante de la primera verificación satisfactoria,
  posterior a declaración y descarga de corroboración. Un replay preserva ese instante.
- Se supersede la asignación anterior y se agregan dos filas: la asignación vieja
  con fin efectivo declarado y el nuevo símbolo desde ese borde. La asignación
  original conserva su intervalo abierto para los cortes anteriores a la declaración.
  Se usan IDs nuevos para las filas corregidas: la PK existente no admite dos
  versiones de conocimiento con igual `(listing_symbol_id, valid_from)`.
- Evento `symbol_change` sobre el listing con declaración, regla, motivo y hash;
  no se cambia el listing ni la security.

### Operación y controles

Schema estricto, entrada acotada, fuente registrada y derechos antes de red, egress
existente y ritmo SEC de 2 requests/s. Dry run sin escritura; aplicación con auditoría,
documentos inmutables y transacción del grafo. Un conflicto de documento impide la
escritura del grafo. Reintentar tras un fallo completa la publicación bajo la corrida
original. Fixtures sintéticas; no se versionan payloads reales ni declaraciones
personales. `TM-05`, `TM-06`, `TM-08`, `TM-11`, `TM-16`.

## Alternativas y límites

- Inferir adquirente del prefijo del accession: los agentes de filing lo invalidan.
- Cerrar el símbolo anterior en el lugar: altera las respuestas de cortes anteriores
  a la declaración. La supersesión conserva lo que se sabía.
- Crear un grafo de securities por una adquisición: el índice no prueba términos de
  canje. Sigue diferido junto con spin-offs.
- No hay scraping HTML ni nuevos hosts, dependencias, endpoints web o UI. Una
  declaración errónea no se corrige mediante overwrite: requiere otro slice de
  corrección explícita. La verificación es acotada al índice reciente.
