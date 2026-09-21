# ADR 0024: validación semántica XBRL y el lugar de Arelle/DQC

- Estado: aceptado
- Fecha: 2026-09-21 (aceptada por el owner el 2026-09-21)
- Alcance: resuelve el incremento 3 de `F2-07`, el último del gate de la Fase 2.
  Decide si Arelle/EFM y las reglas del Data Quality Committee entran como
  oráculo independiente de validación semántica, qué aportarían sobre lo que ya
  existe, y qué ocupa su lugar si no entran. No decide nada sobre la ingesta ni
  sobre los oráculos ya construidos, y no cambia ninguna versión de selección,
  parser ni regla.
- Decisiones relacionadas: [ADR 0009](0009-egress-boundary.md) (la única puerta
  de salida), [ADR 0010](0010-sec-xbrl-ingestion.md) (semántica de la ingesta),
  [ADR 0017](0017-sec-history-window.md) (ventana de historia),
  [ADR 0018](0018-lighter-observation-rows.md) (frugalidad de la fila),
  [ADR 0023](0023-frozen-sec-extracts-rights.md) (corpus congelado)

## Contexto

El gate de la Fase 2 nombra «validación semántica XBRL de muestra (Arelle/EFM y
DQC)» como oráculo independiente. El nombre viene de
[`03_DATA_AND_PROVENANCE.md`](../../finance-portal-masterplan/03_DATA_AND_PROVENANCE.md)
y [`08_QUALITY_SECURITY_OPERATIONS.md`](../../finance-portal-masterplan/08_QUALITY_SECURITY_OPERATIONS.md),
escritos antes de que existiera la ingesta, con un argumento correcto: **un
schema JSON válido no prueba semántica financiera correcta**. Zod valida forma.

Desde entonces se construyeron tres oráculos que aquel texto no podía prever:

1. el **filer sintético** (`fixture-sec-filer.ts`), que prueba que el parser hace
   lo que creemos y cubre los casos que el cable real no ofrece —documento
   ilegible, fuente caída, lote vacío—;
2. el **corpus congelado** ([ADR 0023](0023-frozen-sec-extracts-rights.md)), que
   prueba que el cable es lo que creemos, con números reconciliados contra el
   filing y fijados por `sha256`;
3. la **reconciliación de treinta empresas** (`F2-07` incremento 2), que prueba
   que lo guardado cierra: el balance de 26 de 30 cuadra, 24 de ellas en
   0,0000 % exacto, sobre tres bancos, tres aseguradoras, tres REIT, dos
   holdings y dos empresas en distress.

La pregunta ya no es si hace falta validación semántica. Es qué agrega Arelle
sobre esos tres, y qué cuesta.

### Arelle valida un artefacto que no ingerimos

Es la observación que decide la ADR. Arelle, el EDGAR Filer Manual y las reglas
del DQC validan el **XBRL inline de la presentación**: el exhibit que el emisor
adjunta a su 10-K.

Este proyecto no ingiere ese artefacto. Ingiere
`data.sec.gov/api/xbrl/companyfacts`, que es la extracción que **la propia SEC**
construye a partir de esas presentaciones ([ADR 0010](0010-sec-xbrl-ingestion.md)).
La cadena de riesgo es:

```text
presentación (XBRL inline) → extracción de la SEC (companyfacts) → nuestro parser → nuestras filas
                             ↑                                     ↑               ↑
                        Arelle/DQC llegan hasta acá          corpus congelado   reconciliación
```

Arelle cubre el primer tramo, que es el único que no está en nuestro camino.
Sobre los tres tramos siguientes no dice nada: una presentación impecable puede
llegar mal extraída, mal parseada o mal guardada, y Arelle la aprobaría igual.

Eso no vuelve inútil a Arelle —diría algo verdadero sobre la calidad del emisor—,
pero lo corre del lugar de «oráculo independiente de lo que hacemos» al de
«oráculo de lo que hace el emisor», que es otra pregunta.

### Lo que las reglas del DQC revisan, y dónde ya se revisa

El DQC publica reglas de consistencia sobre estados financieros etiquetados:
identidades del balance, coherencia de signos, relaciones entre pares de
elementos, fechas de contexto, uso de ejes y miembros. Sobre **lo que
guardamos**, la reconciliación de `F2-07` ya corre la familia de identidades
—activo contra pasivo más patrimonio, resultado contra EPS por acciones
diluidas— y el verificador del contrato corre cinco afirmaciones sobre las 27.862
observaciones.

La familia que el DQC cubre y nosotros no es la **dimensional**: ejes, miembros y
contextos. Y ahí hay una razón concreta por la que no nos alcanza hoy: la ingesta
toma únicamente los hechos **sin dimensiones**
([ADR 0010](0010-sec-xbrl-ingestion.md)). Un error de ejes en la presentación no
llega a nuestras filas porque los hechos dimensionados no se ingieren.

### Lo que costaría

- **Python en un repositorio que no tiene ninguno.** El toolchain es Node y pnpm,
  y CI corre dos jobs con las actions pineadas por SHA. Arelle agrega un
  intérprete, un gestor de paquetes y su superficie de supply chain a una
  validación que no está en el camino del dato.
- **Red fuera de la única puerta.** Arelle resuelve los schemas de las taxonomías
  por HTTP —`xbrl.fasb.org`, `www.xbrl.org`, `www.sec.gov`—. El egress de este
  proyecto tiene una sola puerta con cuatro hosts en el allowlist
  ([ADR 0009](0009-egress-boundary.md), `TM-08`), y `getSourceEgressFetch` es
  obligatorio para todo lo demás. Un proceso Python que abre sus propios sockets
  **no pasa por esa puerta**: no lo alcanza el allowlist, ni la cuota diaria, ni
  el kill switch ([ADR 0020](0020-source-daily-budget-kill-switch.md)). La
  alternativa es vendorizar los paquetes de taxonomía, que son cientos de
  megabytes contra la frugalidad declarada de las ADR 0017 y 0018.
- **Un pin más que seguir.** Las reglas del DQC se publican por versión y se
  actualizan; adoptarlas es otra versión que fijar, revisar y mover.

## Decisión

**Arelle/EFM y las reglas del DQC no se adoptan** en la Fase 2, y el punto del
gate se da por resuelto con su motivo escrito, no por omisión.

Lo que ocupa su lugar es explícito: la **validación semántica del proyecto es la
coherencia sobre lo que guardamos**, y hoy son dos familias —identidades del
balance y del resultado por acción, en
[`reconciliation-anchors.ts`](../../../src/modules/fundamentals/domain/reconciliation-anchors.ts)—
más las cinco afirmaciones del contrato point-in-time en
[`point-in-time-audit.ts`](../../../src/modules/observations/domain/point-in-time-audit.ts).
Crecer es agregar una regla nombrada, con su test y su tolerancia declarada, no
importar un motor.

Tres límites de esta decisión, para que no se lea como más de lo que es:

1. **no dice que el XBRL de las presentaciones esté bien.** Dice que validarlo no
   prueba lo que este proyecto necesita probar;
2. **no cubre la familia dimensional.** Hoy no hace falta porque no ingerimos
   hechos con dimensiones; el día que se ingieran, esta ADR queda obsoleta;
3. **no es irreversible.** La condición de revisión está abajo.

## Condición de revisión

Esta decisión se revisa si pasa cualquiera de estas tres cosas:

- el proyecto empieza a ingerir **XBRL inline de las presentaciones** en vez de
  —o además de— `companyfacts`. Ahí Arelle valida el artefacto que sí está en el
  camino, y el análisis cambia por completo;
- se empiezan a ingerir **hechos con dimensiones**, que es la familia de reglas
  que hoy no cubrimos y no necesitamos;
- la reconciliación empieza a encontrar residuos que **no se explican** con lo
  guardado. El precedente existe y salió bien: el residuo de EPS de la tanda 1 se
  explicó con un concepto ausente y se resolvió agregándolo a la selección
  (`sec-core-concepts-3.0.0`), sin ningún motor externo. Si un residuo se
  resistiera a esa clase de explicación, sería señal de que falta un oráculo de
  otra naturaleza.

## Consecuencias

- El gate de la Fase 2 cierra con tres oráculos —filer sintético, corpus
  congelado, reconciliación de treinta— y sin dependencia de Python.
- `03_DATA_AND_PROVENANCE.md` y `08_QUALITY_SECURITY_OPERATIONS.md` conservan su
  texto: la afirmación «Zod valida forma, no semántica» sigue siendo cierta y
  sigue siendo la razón de que exista la reconciliación. Lo que cambia es qué
  herramienta la satisface.
- Queda declarado y visible lo que **no** se valida: la consistencia dimensional
  de las presentaciones, y la calidad del etiquetado del emisor.
- El egress conserva una sola puerta. Ningún proceso del proyecto abre sockets
  fuera de `getSourceEgressFetch`.

## Alternativas descartadas

- **Arelle en CI sobre una muestra.** Agrega Python, su supply chain y la
  resolución de taxonomías por red a los dos jobs que hoy corren en minutos, para
  validar un artefacto que no ingerimos. Es el costo más alto de las cuatro
  opciones y el beneficio menos alineado.
- **Arelle a mano, fuera de CI.** Baja el costo de CI pero no el de la red ni el
  del toolchain, y un oráculo que se corre a mano y rara vez no es un oráculo de
  regresión: es una auditoría puntual. El corpus congelado ya cumple ese papel
  con números que no se mueven.
- **Vendorizar los paquetes de taxonomía.** Resuelve la red a cambio de cientos
  de megabytes en un repositorio público que declaró frugalidad como criterio
  (ADR 0017, 0018) y que hoy guarda 2,7 MB de corpus.
- **Los R-files del Financial Report de EDGAR como segundo oráculo.** Es la
  alternativa más interesante y la única que valida el tramo que importa: son los
  estados financieros renderizados de la propia presentación, así que comparar
  nuestra fila contra ellos reconcilia contra el filing sin intervención humana.
  Queda descartada **para esta fase** y no por principio: son una o más requests
  por presentación, un parser de HTML nuevo y una semántica de tablas que la
  SEC no versiona. Es un slice propio, y la reconciliación manual de treinta
  empresas ya da la evidencia que el gate pide.
