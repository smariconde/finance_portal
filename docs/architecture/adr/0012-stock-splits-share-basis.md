# ADR 0012: splits y base accionaria reportada

- Estado: aceptado
- Fecha: 2026-09-15
- Alcance: incremento 2 de `F2-04`; fija cuándo un split se considera probado, de
  quién es y cómo una lectura `latest_adjusted` lleva una serie por acción a una sola
  base sin reescribir lo publicado
- Decisiones relacionadas: [ADR 0003](0003-decimal-arithmetic-valuation-engine.md)
  (enmendada: la política decimal pasa a ser compartida),
  [ADR 0010](0010-sec-xbrl-ingestion.md) (vintages y disponibilidad),
  [ADR 0011](0011-issuer-succession-reporting-lineage.md) (linaje de reporte),
  [contrato point-in-time](../../data/point-in-time-contract.md)

## Contexto

`F2-03` publica cada re-expresión como una revisión nueva, y eso es correcto para un
restatement. Un split también re-expresa: de las 150 revisiones de Apple en PostgreSQL
personal, 71 difieren de la anterior por 7, por 4 o por 28. Bajo `latest_restated` el
EPS básico anual mezclaba tres bases —FY2008 6,94, FY2012 6,38 y FY2019 2,99— y
cualquier cálculo por acción sobre esa serie daba mal.

Además `adjustmentPolicy` existía en el contrato de consulta y **nadie lo leía**:
`queryObservations` devolvía la base reportada también bajo `latest_adjusted`, que es
el default silencioso que el contrato prohíbe.

El cable se midió el 2026-09-15 antes de escribir la regla, sin conservar payload
(22 requests para Apple, NVIDIA y los frames anuales del concepto; 6 de
`companyconcept`; 3 más para Duke, Motorola Solutions y AIG):

- **El ratio existe y no alcanza.** `us-gaap:StockholdersEquityNoteStockSplitConversionRatio1`
  aparece en la primera presentación posterior a cada split de Apple (7 en el 10-Q
  del 2014-07-23, 4 en el 10-K del 2020-10-29) y de NVIDIA (4 en el 10-Q del
  2021-08-20, 10 en el del 2024-08-28). Pero Alphabet declara su 20 en el 10-Q de
  abril de 2022, tres meses antes del split y con los valores todavía en base vieja;
  Carvana declara `0.0556` y Citizens Financial `6` sin ningún split; Citigroup
  declara su `0.1` de 2011 y Duke Energy su `0.3333` de 2012 recién en los 10-K de 2014.
- **La fecha del ratio no es la del split.** NVIDIA asocia su 4:1 al 2021-06-03 y
  después al 2021-07-19; su 10:1, a mayo y después a junio de 2024; Alphabet, a la
  aprobación de febrero.
- **La re-expresión trae el redondeo del filer.** El EPS se recalcula en la base nueva
  y se redondea a centavos: Apple pasa 2,18 a 0,55 por el 4:1, un factor aparente de
  3,9636. Los conteos de acciones cierran a menos de 0,05%.
- **La primera presentación en base nueva también corrige otras cosas.** El 10-Q de
  Apple de 2014 re-expresa además una cantidad de acciones que un 10-Q previo había
  publicado en miles: factor 7.000, no 7.
- **`companyconcept` es `companyfacts` recortado.** Para Apple y NVIDIA el arreglo de
  puntos es idéntico byte a byte. Un filer que nunca etiquetó el concepto responde
  `404`.
- **Reverse splits reales del universo**: Citigroup 1:10 (`0.1`), Duke Energy 1:3
  (`0.3333`), Howmet 1:3 (`0.33`, redondeado). Motorola Solutions y AIG no etiquetan
  el concepto.

## Decisión

### La base de un valor la decide la presentación que lo reportó

Por ASC 260 la primera presentación posterior a un split re-expresa el EPS y las
acciones de todos los períodos que muestra. No hace falta la fecha de distribución
—que XBRL no publica de forma confiable—: alcanza con saber cuál fue la primera
presentación en base nueva. Una vintage conocible antes de ella está en la base
anterior; una conocible desde ella, en la nueva. Otra presentación del mismo instante
no tiene desempate y es `ambiguous_share_basis`.

### Un split se confirma con dos evidencias de la misma presentación

`sec-split-evidence-1.0.0`:

1. **el filer declara un ratio**: un punto del concepto en `pure` en esa accession;
2. **los números del filer se movieron por ese ratio**: la misma presentación
   re-expresa al menos un EPS y al menos un conteo de acciones ya publicados, y la
   diferencia cierra con los splits confirmados entre las dos vintages por el ratio;
3. **ninguna presentación anterior ya mostraba la base nueva**: se busca entre la
   última vintage en base vieja que la presentación re-expresó y ella misma. Si
   aparece una, fijar la base en la presentación del ratio ajustaría esos valores dos
   veces (`reexpressed_before_ratio_filing`).

La presentación que repite el ratio sin re-expresar **corrobora** al split confirmado
vecino con el mismo ratio, siempre que no haya otro split confirmado entre los dos:
el anuncio de Alphabet de abril corrobora el split de julio. Lo demás queda
`candidate` con motivo nombrado y **no ajusta nada**: `invalid_ratio`,
`unexpected_unit`, `conflicting_ratios_in_filing`, `claim_filing_not_published`,
`no_coherent_reexpression`, `reexpression_incomplete`,
`reexpression_matches_inverse_ratio`, `reexpressed_before_ratio_filing`,
`missing_report_date` y `ratio_declared_after_reexpression`. Este último nombra además
la primera presentación en base nueva: para Duke, el 10-Q del 2012-08-08.

Una re-expresión con factor aparente distinto que no cierra con nada se cuenta como
outlier y marca el split con `split_evidence_outliers`, sin bloquearlo: la corrección
de escala de Apple es real y no desmiente el 7:1.

### Coherencia y tolerancias

`split-basis-1.0.0` declara qué conceptos se ajustan y en qué dirección —EPS básico y
diluido se dividen; promedio ponderado básico y diluido, acciones en circulación y
acciones de la carátula se multiplican— en una lista cerrada. La unidad no alcanza:
una unidad de acciones fuera de la lista no se ajusta, falla con
`unclassified_share_unit`.

Dos revisiones son coherentes con un factor `F` si:

- **acciones**: `|nuevo − viejo·F| ≤ 0,5%·|viejo·F|`;
- **por acción**: `|viejo − nuevo·F| ≤ max(0,005·(1 + F), 0,5%·|viejo|)`. El primer
  término es el redondeo de centavos de los dos lados; el segundo cubre un EPS grande
  redondeado a unidades.

Los ratios reales más cercanos entre sí —3:2 contra 4:3— distan 12,5%, así que la
banda no confunde un split con otro. Un cero o un cambio de signo no prueban ningún
factor.

### El split es de la entidad legal que reportó

Los hechos XBRL cuelgan de la entidad legal y el concepto del ratio llega sin
dimensiones: afirma que cambió la base de las acciones comunes **que ese filer
reporta**, no qué clase de acciones se dividió. El evento se registra sobre la entidad
legal con `terms.scope = filer_reported_shares`. Así Alphabet —dos securities en el
grafo— no queda afuera por una decisión que el cable no permite tomar, y no se afirma
nada por security: la proyección a cada clase la necesita un precio, y esa evidencia
llega con los datos de mercado.

### El registro reusa lo ya publicado

La segunda evidencia son las observaciones que la ingesta ya publicó, y la
disponibilidad sale de `source_documents`. El job no vuelve a descargar
`companyfacts`: pide un solo documento de pocos KB por filer. Si el filer no tiene
hechos sensibles publicados no sale a la red.

`corporate_actions` suma `split` y `reverse_split` (migración `0007`):

- `available_at` es la disponibilidad de la presentación confirmante —su aceptación—;
- `effective_on` es el **cierre del primer período presentado en base nueva**, no la
  fecha de distribución;
- `terms` guarda el ratio como texto exacto, el concepto, el formulario, las fechas
  que declaró el filer, el alcance y la versión de la regla que decidió;
- `corporate_actions_split_terms_check` espeja el dominio: entidad legal, ratio
  canónico, mayor que uno para `split` y entre cero y uno para `reverse_split`.

Registrar dos veces lo mismo no abre nada; otra descripción de la misma accession es
`conflicting_split` y deja la corrida en cuarentena; un split registrado que la
evidencia de hoy no reconfirma se nombra y no se borra.

### `latest_adjusted` es la base del último split conocible en el corte

`split-adjustment-1.0.0`:

1. las revisiones se eligen con la base reportada, como siempre;
2. cada valor sensible se multiplica o divide por el producto de los ratios de los
   splits cuya presentación es posterior a la de su vintage **y conocible en el
   corte**: un `as_known` anterior a la presentación del split no lo ve, y bajo
   `system_recorded` además hace falta haberlo registrado;
3. la base es la del corte y no la de `effective_at`: la fecha efectiva filtra hechos
   y no deshace splits;
4. cada fila sensible nombra la transformación y el factor —`1` si ya estaba en
   base— y conserva la observación publicada intacta; un valor faltante sigue
   faltando;
5. cada revisión se clasifica `original`, `restatement` o `split_reexpression`.

`queryObservations` ahora **rechaza** `latest_adjusted` con
`unsupported_revision_policy`: el dominio de observaciones no conoce los splits, y la
lectura ajustada pasa por el linaje, que exige la lista de corporate actions sin
default. Una fila sensible de un antecesor del linaje no se lleva a la base del
sucesor —`adjustment_across_succession`— porque la conversión de acciones de la
sucesión no está registrada.

## Consecuencias

- Módulos: `share-basis`, `verify-split-evidence`, `plan-split-recording` y
  `split-adjustment` en `src/modules/corporate-actions/domain/`; puerto, adaptador
  vivo y orquestador `record-splits` en `application/`; parser de `companyconcept` en
  `src/modules/fundamentals/domain/`; política decimal en `src/modules/numeric/`.
- Comando `pnpm corporate-actions:splits`, dry run por defecto, que va después de
  `pnpm fundamentals:ingest --apply`. El dataset `sec.companyconcept` se declara en el
  registro de fuentes; su endpoint ya estaba en la allowlist.
- Migración `0007` con rollback pareado que reconstruye el tipo y falla a propósito si
  queda algún split registrado.
- Sobre datos reales: las 150 re-expresiones de Apple quedan 71 `split_reexpression`
  y 79 no; `latest_adjusted` devuelve el EPS básico FY2008, FY2012 y FY2019 como
  0,2479, 1,595 y 2,99. Un segundo antes de la aceptación del 10-Q de 2014 el promedio
  de acciones FY2012 vale 934.818.000; en la aceptación, ×7 = 6.543.726.000, el mismo
  valor que Apple re-expresó después.

## Alternativas descartadas

- **Confirmar con el ratio solo.** Alphabet, Carvana y Citizens lo refutan con datos.
- **Fechar la base por la fecha efectiva del split.** XBRL no la publica de forma
  confiable y no hace falta: la base la decide la presentación.
- **Agregar el ratio a la selección de ingesta.** `sec-fact-rules` rechaza la duración
  de un mes con la que NVIDIA publica su 10:1, y crecer los buckets de período por un
  concepto cambiaría la identidad de otros hechos.
- **Volver a descargar `companyfacts` en el job de splits.** Cuatro MB por filer para
  leer un concepto que `companyconcept` sirve en uno; la re-expresión ya está
  publicada.
- **Publicar los valores ajustados como observaciones `normalized`.** Cada split nuevo
  obligaría a republicar la historia entera, y la base depende del corte de la
  consulta: no es un hecho, es una lectura.
- **Registrar el split sobre la security.** El cable no dice qué clase se dividió; con
  dos clases habría que adivinar, y con una sola el ID extra no agrega evidencia.
- **Declarar cada split a mano, como las sucesiones.** Son frecuentes en quinientas
  empresas y la regla los prueba con el cable; la declaración queda para los
  candidatos que la regla no puede cerrar.
- **Des-ajustar a la base de `effective_at`.** Volver a una base vieja agrega el
  redondeo del filer una segunda vez y no responde ninguna pregunta que el corte de
  conocimiento no responda.

## Límites conocidos

- **Un split que la regla no confirma no ajusta nada, y la lectura no lo advierte fila
  por fila.** Duke Energy y Citigroup declaran su reverse split años después: bajo
  `latest_adjusted` su EPS anterior al split sigue en la base vieja. El candidato queda
  en la corrida con su motivo y, para Duke, con la presentación que re-expresó. Cerrar
  estos casos exige una confirmación declarada por el owner, que hoy no existe.
- **Un ratio redondeado se aplica como se declaró.** `0.3333` pasa la tolerancia y
  ajusta con un error de 0,01% contra 1/3; `0.33` no la pasa y Howmet queda candidata.
- **La lectura no sabe si el job de splits corrió para el emisor.** Hasta que `F2-05`
  orqueste ingesta y evaluación juntas, correr `corporate-actions:splits` después de
  cada ingesta es parte del runbook.
- **Sin conversión de acciones en una sucesión**, una fila sensible de un antecesor
  falla bajo `latest_adjusted`; con `as_known` se lee igual que antes.
- **Una vintage mal escalada por el filer** se ajusta como fue publicada: el factor la
  multiplica, no la corrige. La clasificación la muestra como restatement.
- **Dividendos en acciones, spin-offs y la proyección por security** quedan para el
  incremento 3 y para los datos de mercado.
