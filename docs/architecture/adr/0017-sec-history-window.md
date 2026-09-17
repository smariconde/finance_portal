# ADR 0017: ventana de historia de cinco ejercicios para la SEC

- Estado: aceptado
- Fecha: 2026-09-17
- Alcance: incremento 2 de `F2-05`, paso 1. Fija qué períodos de companyfacts se
  guardan, cómo se ancla el corte, cómo queda registrado en la corrida y qué pasa
  con la evidencia de splits. Las filas más livianas (paso 2) son otra decisión.
- Decisiones relacionadas: [ADR 0010](0010-sec-xbrl-ingestion.md) (selección
  versionada), [ADR 0012](0012-stock-splits-share-basis.md) (evidencia de splits),
  [ADR 0015](0015-durable-ingestion-jobs.md) (jobs durables),
  [ADR 0016](0016-analysis-scope-sector-matrices.md) (alcance analítico),
  [contrato point-in-time](../../data/point-in-time-contract.md)

## Contexto

El backfill del universo ocupó 1,2 GB con toda la historia XBRL desde 2009. El
owner decidió guardar **cinco ejercicios** (2026-09-16). La ADR 0016, del mismo día,
agrega dos requisitos:

- la ventana gobierna también la ingesta por ticker y por sector;
- la matriz de divergencias compara dos cierres fiscales separados por el
  horizonte, así que a 5 años necesita el EPS diluido, el net income y las acciones
  diluidas **anuales** del cierre base.

El diseño del backlog cortaba las duraciones que terminan después de
`ancla − 5 años + 14 días`. Eso deja afuera el ejercicio base entero.

Antes de escribir la regla se midieron 25 filers, con 50 requests y sin conservar
payload. La muestra incluye cierres en enero, mayo, junio, agosto y noviembre,
ejercicios de 52/53 semanas, splits recientes, spin-offs y el sucesor de
ExxonMobil. Tres hallazgos cambiaron el diseño:

1. **El ancla necesita el foco `FY`.** El fin de la duración anual más reciente con
   `fp = FY` coincide con el `reportDate` del último 10-K en los 24 filers de la
   muestra que tienen uno. Sin exigir `FY` falla: Amazon publica duraciones
   anuales (TTM) en sus 10-Q de 2026. Los 8-K con `fp = FY` existen, pero sólo
   re-expresan ejercicios viejos.
2. **El corte del backlog no deja calcular la divergencia a 5 años.** En los 21
   filers con cinco años de historia, el EPS diluido y el net income anuales del
   ejercicio base quedan afuera. Con un corte único por fin de período entran, y
   cuesta 0,8 puntos de filas. Las únicas ausencias son de conceptos que el filer
   no etiqueta: Berkshire no publica EPS diluido y Broadcom dejó de usar
   `NetIncomeLoss` en 2019. Esa es normalización de Fase 3.
3. **La ventana rompe la evidencia de splits del primer año.** La presentación que
   confirma un split re-expresa comparativos de un año antes (ADR 0012). Si esos
   comparativos quedan afuera:
   - el 4:1 de NVIDIA de 2021 pierde la re-expresión de sus dos 10-Q y la regla lo
     confirmaría en el 10-K de marzo de 2022, siete meses tarde;
   - el 1:8 de GE de 2021 no se confirmaría.

## Decisión

### 1. Un corte por fin de período, anclado en el último ejercicio del filer

Regla `sec-history-5fy-1.0.0`: se conserva un hecho seleccionado si

```text
end >= ancla − 5 años − 14 días
```

- **Ancla:** el fin de la duración anual (350 a 378 días) más reciente de una
  presentación con foco `FY`. No depende del reloj: la misma descarga recorta
  siempre igual, y un filer con cierre en junio sin 10-K nuevo no pierde un año.
- **Sin ejercicio anual** (el sucesor de ExxonMobil, un registrante nuevo), el ancla
  es el último fin de período publicado (`latest_period`).
- **Un reporte anual sin doce meses** —el período de un sucesor tras una fusión, un
  10-KT por cambio de cierre— no mueve el ancla, que queda en el último ejercicio
  completo. El corte resulta más amplio y nunca pierde un período.
- **Los 14 días** absorben los ejercicios de 52/53 semanas. En cinco años, el cierre
  base cae entre un día antes y seis después de la fecha del ancla (Deere cierra el
  2025-11-02 y el 2020-11-01; NVIDIA, el 2026-01-25 y el 2021-01-31).
- **Qué entra:** cinco ejercicios completos más el cierre base, con su anual, su
  cuarto trimestre si se publica y su balance. Del ejercicio base no entran el
  tercer trimestre ni los acumulados de nueve meses.
- **Restar años** conserva mes y día, y un 29 de febrero cae en el 28: correr el
  corte hacia adelante dejaría afuera un cierre que entra.

### 2. Un ejercicio más para la evidencia de splits

Los seis conceptos que la regla de base accionaria re-expresa usan el corte
`ancla − 6 años − 14 días`:

- EPS básico y diluido;
- promedios ponderados de acciones, básico y diluido;
- `CommonStockSharesOutstanding`;
- `dei:EntityCommonStockSharesOutstanding`.

Ese ejercicio es evidencia, no historia de análisis. La lista sale de
`share-basis.ts` y el test de la selección la fija.

Con el ejercicio extra, todo split que afecta valores de la ventana de análisis se
puede confirmar donde lo confirmaría la historia completa, porque su comparativo de
un año antes queda guardado. El borde se corre a las filas de evidencia. Un split
confirmado por un 10-Q del ejercicio extra, sin ninguna re-expresión de acciones
dentro del corte, podría confirmarse tarde y ajustar dos veces esas filas. Nunca
las de la ventana: el primer valor de la ventana se publica en el 10-K del cierre
base, que ya es posterior.

### 3. Se aplica antes de las vintages y de los archivos históricos

`live-company-facts-source` recorta los hechos seleccionados justo después de
`parseSecCompanyFacts`. Lo que queda afuera no se publica y no pide archivos
históricos de submissions.

Una regla que mira toda la accession, como la firma fiscal de la presentación, ve
sólo los hechos de la ventana. Es el mismo criterio que ya se aplica a los conceptos
no seleccionados.

### 4. La selección sube a `sec-core-concepts-2.0.0`

La selección son los mismos 58 conceptos recortados a la ventana.
`SEC_CONCEPT_SELECTION` declara la ventana como componente, y un test rompe si
cambia sin subir la versión.
El parser sigue en `sec-companyfacts-1.0.0`: filtrar no cambia el contenido de un
hecho.

Un job planeado con la 1.0.0 no corre con este código (`assertCompanyFactsJob`).

### 5. El ancla queda en la corrida

La versión sola no dice qué períodos se buscaron, porque el corte depende de cada
descarga. La migración `0011` agrega `ingestion_runs.selection_anchor_on`:

- `date`, con un check que exige `selection_version` cuando hay ancla, espejado en
  Zod;
- se llena en toda corrida que llegó a leer los hechos: publicada, duplicada, vacía
  o en cuarentena;
- entra a la versión del documento, así que forma parte de la identidad de la
  corrida.

Con versión y ancla, `F3-02` puede separar «el filer no lo reportó» de «esta
corrida no lo fue a buscar» para cada período.

El rollback se niega mientras haya anclas. Exportarlas y limpiarlas es una decisión
explícita.

### 6. Los ratios anteriores a la historia publicada no se juzgan

`split-claim-horizon-1.0.0` separa los ratios declarados en presentaciones
conocibles no después de la primera vintage sensible publicada del filer. La regla
de evidencia no los recibe, y la corrida los cuenta como candidatos
`precedes_published_history`.

Sin este paso pasaban dos cosas:

- un ratio viejo salía `no_coherent_reexpression`, como si el filer no hubiera
  re-expresado, cuando en realidad no se fue a buscar;
- el anuncio de un split viejo que nadie confirmó «corroboraba» un split posterior
  con el mismo ratio. Nike declara 2:1 entre 2014 y 2018, y el test del horizonte lo
  reproduce con un 4:1.

La regla de evidencia no cambia (`sec-split-evidence-1.0.0`). El contenido de un
split registrado incluye esa versión, así que subirla haría que volver a correr los
splits ya registrados diera `conflicting_split`. Sube sólo el pipeline, a
`sec-split-1.1.0`.

### 7. Sin poda

Lo publicado no se borra. La ventana gobierna las ingestas nuevas: cuando llega un
10-K nuevo, el ancla avanza y las filas anteriores quedan. Una poda sería otra
decisión, con su auditoría, y la ADR 0016 ya la pide antes de `F6-06`. La base
personal conserva la historia completa de sus seis filers (13 MB de observaciones).

## Medición sobre datos reales (2026-09-17)

`pnpm fundamentals:ingest` en dry run sobre los seis filers del backlog. El
«antes» corrió con el código de `main` contra la base personal; el «después», con
este código contra una réplica descartable.

| Filer         | Vintages antes |  Vintages después | Archivos históricos |    Requests |
| ------------- | -------------: | ----------------: | ------------------: | ----------: |
| Apple         |          3.254 |     1.151 (35,4%) |               1 → 0 |       3 → 2 |
| JPMorgan      |          2.078 |       614 (29,5%) |             45 → 25 |     47 → 27 |
| Berkshire     |          1.793 |       614 (34,2%) |               1 → 0 |       3 → 2 |
| NVIDIA        |          3.541 |     1.194 (33,7%) |               1 → 1 |       3 → 3 |
| Realty Income |          2.034 |       821 (40,4%) |               1 → 0 |       3 → 2 |
| Wells Fargo   |          2.174 |       756 (34,8%) |               6 → 2 |       8 → 4 |
| **Total**     |     **14.874** | **5.150 (34,6%)** |         **55 → 28** | **67 → 40** |

En la muestra de 25 filers, la ventana con el ejercicio de evidencia conserva el
37,3 % de las vintages. La ventana del backlog conservaba el 35,4 %, y el corte
único sin evidencia, el 36,2 %.

**Splits sobre la réplica, con la ventana:**

- NVIDIA 4:1 y 10:1, Apple 4:1 y Alphabet 20:1 se confirman en las mismas
  presentaciones que con la historia completa, y con el mismo hash de contenido que
  sus eventos de la base personal;
- GE 1:8 se confirma en el 10-Q del 2021-10-26 y Amazon 20:1 en el del 2022-07-29;
- los 7:1 de Apple, los ocho 2:1 de Nike y los 2:1 de Alphabet de 2016 quedan
  `precedes_published_history`.

**Contrafáctico.** Se borraron de la réplica las filas de evidencia de NVIDIA y GE
y se volvieron a juzgar:

- el 4:1 de NVIDIA se confirma en el 10-K del 2022-03-18. Las 18 vintages de Q2 y
  Q3 FY2022, publicadas ya en base nueva (EPS diluido 0,94 y 0,97; 2.500 millones
  de acciones), se habrían ajustado otra vez por cuatro;
- GE queda `reexpression_incomplete` y `reexpressed_before_ratio_filing`.

**Universo sobre una réplica:** 501 de 501 filers completos, en dos corridas y 25
minutos (la primera paró por la reserva de presupuesto con 936 requests).

- **Requests:** 1.194, contra 1.649 con la historia completa, que tardaron 37
  minutos.
- **Señales de la fuente:** una `transport_error` difirió a Warner Bros. Discovery
  sin gastar el intento y el reintento completó. No hubo items fallados ni
  envenenados.
- **Filas:** 464.531 observaciones, el 35,8 % de las 1.299.374 de antes, y 13.141
  documentos. Corridas: 464 `succeeded` y 37 `partial`, con 2.611 registros
  rechazados con nombre.
- **Tamaño:** la base pasó de 9,4 MB (sólo el grafo) a **451 MB**. Las
  observaciones ocupan 434 MB: 259 de tabla y 175 de índices, 980 bytes por fila.
  La estimación previa era el 37,3 % de 1,2 GB, unos 448 MB.
- **Anclas:** 497 coinciden con el cierre del último reporte anual.
  - El sucesor de ExxonMobil y Honeywell Aerospace no tienen reporte anual y anclan
    en su último período.
  - Paramount Skydance (período del sucesor tras la fusión) y Ferguson (10-KT de
    cinco meses por cambio de cierre) anclan en su último ejercicio de doce meses.
    Su corte queda más amplio, nunca más estrecho.

## Consecuencias

- La ingesta por ticker, la de un sector y el backfill usan la misma ventana.
- JPMorgan sigue siendo el peor caso de archivos históricos (25). El techo de 64 y
  la reserva de 66 requests por empresa no cambian.
- `corporate-actions:splits` nombra lo que quedó antes de la historia y no lo
  confunde con un filer que no re-expresó.
- Las filas del ejercicio de evidencia son legibles como cualquier observación. Una
  lectura que las use hereda el borde descripto en la decisión 2.
- `CLAUDE.md`, `AGENTS.md`, el runbook del backfill, el de migraciones, el contrato
  point-in-time y el backlog quedan alineados.

## Alternativas descartadas

- **El corte del backlog** (duraciones desde `ancla − 5 años + 14 días`). No deja
  calcular la divergencia a 5 años.
- **Seis ejercicios para todos los conceptos.** Resuelve la evidencia de splits,
  pero suma un ejercicio entero de filas —cerca de un 20 % más, estimado— que la
  metodología no usa.
- **Ventana por fecha de filing.** Guardaría la re-expresión de un comparativo viejo
  sin su vintage original. La primera fila conocida llevaría una disponibilidad
  posterior a la real, y un restatement parecería un valor original.
- **Anclar en el reloj.** Un filer con cierre en junio perdería un año entre su
  cierre y su 10-K, y la misma descarga recortaría distinto según el día.
- **Bajar la evidencia de splits con `companyconcept` al verificar.** Cambia el
  contrato de la ADR 0012 (la segunda evidencia son hechos ya publicados) y cuesta
  requests y archivos históricos por concepto.
- **Subir la versión de la regla de evidencia** para nombrar los ratios viejos.
  Cada split ya registrado pasaría a `conflicting_split`.
