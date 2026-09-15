# ADR 0011: sucesión de emisor y linaje de reporte

- Estado: aceptado
- Fecha: 2026-09-14
- Alcance: incremento 1 de `F2-04`; fija cómo una reorganización que cambia el CIK
  del filer une historias sin reasignar hechos ni adelantar conocimiento
- Decisiones relacionadas: [ADR 0010](0010-sec-xbrl-ingestion.md) (sujeto por CIK
  al corte de la descarga), [modelo de identidad](../../data/identity-model.md),
  [contrato point-in-time](../../data/point-in-time-contract.md)

## Contexto

`F2-03` dejó a ExxonMobil con 89 hechos: el universo le asigna el CIK de
`ExxonMobil Holdings Corp` (2115436), y diecisiete años de historia viven en el de
`Exxon Mobil Corporation` (34088). Una valuación de XOM vería un trimestre.

El cable, medido el 2026-09-14 sin conservar payload, muestra la forma del caso:

- el sucesor presenta un `8-K12B` con evento el 2026-07-01 y aceptación a las
  16:36:49Z, dos minutos después del 8-K del antecesor con ítem 3.01;
- el antecesor presenta el `25-NSE` al día siguiente;
- el 10-Q del segundo trimestre de 2026 **es conjunto**: figura en los dos índices,
  cubre un período que cerró un día antes de la vigencia, y sus hechos XBRL están
  **sólo** en el `companyfacts` del sucesor. De sus 269 puntos, 138 repiten un hecho
  del antecesor —los 138 con el mismo valor que su última vintage— y 131 son del
  trimestre nuevo.

## Decisión

### La sucesión se declara y se verifica; no se detecta

`submissions` no publica un «CIK antecesor» y el 8-K12B lo nombra en texto libre.
Inferirlo por nombre violaría la invariante 8 del modelo de identidad. El owner
declara la sucesión en `declared-successions.ts` —un diff revisable, como el registro
de fuentes y el pin de constituyentes— con el accession de la presentación, y el job
la contrasta con los índices de los dos filers (`sec-succession-evidence-1.0.0`):

- la presentación existe en el índice del sucesor, es `8-K12B` u `8-K12G3` y tiene
  aceptación publicada: sin aceptación se rechaza, no se infiere;
- la vigencia es su `reportDate`; si falta, no se supone la fecha de filing;
- el sucesor no tiene reportes periódicos **aceptados** antes de la sucesión. La
  primera versión de la regla prohibía reportes **de períodos** anteriores y habría
  rechazado a XOM: el 10-Q conjunto cierra antes y se acepta después;
- el antecesor presentó al menos un reporte periódico antes de la sucesión.

Lo que no cierra deja una corrida `quarantined` con el código en el flag y no toca el
grafo. Que el antecesor siga presentando después no es un rechazo; si reporta un
período posterior a la vigencia, la evidencia lleva
`predecessor_reports_after_succession`.

### Evento y vínculo separados

`corporate_actions` guarda el evento inmutable con su fecha calendaria y la
presentación que lo probó. `legal_entity_relationships` guarda el vínculo como
dimensión versionada entre dos entidades legales que conservan sus IDs:

- `available_at` es la aceptación de la presentación;
- `effective_on` es la fecha del evento y `valid_from` es ese día a las 00:00 de
  Nueva York. PostgreSQL lo verifica con su base de zonas; medianoche UTC correría la
  fecha a la noche anterior en el huso de EDGAR;
- un solo antecesor de reporte abierto por sucesor y un solo sucesor por antecesor,
  como índices únicos parciales; los ciclos se rechazan en el dominio.

El antecesor entra al grafo como entidad legal propia con su CIK autoritativo. Igual
que el universo, esa identidad se conoce desde la descarga que la trajo: lo que tiene
fecha pública propia es el vínculo, no la entidad.

### La historia se une en la lectura

Los hechos del antecesor se ingieren con su propio sujeto, una corrida por CIK, sin
cambiar `ingestCompanyFacts`. `reporting-lineage-1.0.0` los une al leer:

1. un vínculo participa si es efectivo en `effective_at` y conocible en el corte con
   la regla de selección de dimensión: un `as_known` anterior a la aceptación no ve
   al antecesor, y bajo `system_recorded` además hace falta haberlo registrado;
2. el antecesor aporta hechos con `as_of` anterior a la vigencia;
3. un hecho reportado por más de un segmento se resuelve por la revisión conocible
   más reciente. Mismo instante con valores distintos es `ambiguous_revision`; con el
   mismo valor gana el segmento más cercano al sujeto;
4. cada fila conserva su `subjectId`, así que la provenance sigue diciendo qué filer
   reportó el valor.

## Consecuencias

- Módulo nuevo `src/modules/corporate-actions/` y comando
  `pnpm corporate-actions:record`, dry run por defecto.
- Migración `0006`: `corporate_actions`, `legal_entity_relationships` y tres tipos.
  Su rollback no borra las entidades que una sucesión trajo al grafo: las
  observaciones ya las referencian.
- `pnpm fundamentals:ingest --ticker` ingiere también los CIK de los antecesores
  conocidos, cada uno en su corrida.
- `parseSecSubmissions` devuelve el nombre del filer sin invalidar el documento si
  falta: los hechos no dependen de él.
- Resultado sobre datos reales: XOM pasa de 0 a 17 ingresos anuales (FY2009 a
  FY2025) y de 89 a 2.522 hechos visibles; los 49 hechos seleccionados que los dos
  filers reportan coinciden en valor.

## Alternativas descartadas

- **Reasignar los hechos del antecesor al sucesor.** Reescribiría quién reportó cada
  valor y reciclaría la identidad, que la invariante 9 prohíbe.
- **Unir en la ingesta armando vintages sobre los dos `companyfacts`.** Mezclaría
  dos documentos en una corrida y la lineage dejaría de apuntar a una descarga.
- **Detectar sucesiones buscando `8-K12B` en el universo.** Encuentra sucesores, no
  antecesores: el CIK anterior no está en ningún campo estructurado. Queda como
  barrido de cobertura para `F2-05`, que ya recorre todos los `submissions`.
- **Backdatear la entidad del antecesor a sus hechos.** Mismo motivo que en la
  ADR 0010: fingiría que el grafo la conocía antes.

## Límites conocidos

- **Sólo `reporting_successor`.** Adquisiciones, spin-offs, traspasos de mercado y
  renombres son el incremento 3; ninguno une historias.
- **Corregir una sucesión registrada** —otra presentación, otra vigencia— se rechaza
  como `conflicting_succession`. Supersederla exige su propia regla y no hay un caso
  real que la pida.
- **La versión del linaje todavía no viaja en un snapshot de valuación**: no hay
  valuación sobre datos reales hasta Fase 6.
