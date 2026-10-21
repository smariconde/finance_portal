# ADR 0045: la corrida por ticker es un job de evaluación

- Estado: aceptado
- Fecha: 2026-10-21
- Alcance: `F6-01`. Encola la corrida de un ticker, expone su estado y no sale a
  la red. No arma el snapshot, no publica un valor y no baja fundamentals.
- Decisiones relacionadas: [ADR 0007](0007-ticker-driven-valuation-pivot.md)
  (la corrida es un job), [ADR 0005](0005-request-time-runtime-boundary.md)
  (el modo se resuelve en el request), [ADR 0015](0015-durable-ingestion-jobs.md)
  (jobs durables de ingesta, que este job no reutiliza),
  [ADR 0030](0030-sector-prices-on-open.md) (la primera Server Action),
  [ADR 0031](0031-on-demand-company-assessment.md) (la evaluación offline)

## Contexto

La ADR 0007 dejó escrito que resolver identidad, traer filings, llamar al
modelo y calcular no cabe en un request. `F6-01` es el primer tramo de esa
corrida: el owner escribe un ticker y el portal encola un trabajo con estado.

La frase «primera Server Action» de esa ADR ya no describe el repositorio. La
abrió `refreshSectorPrices` ([ADR 0030](0030-sector-prices-on-open.md)). Lo que
`F6-01` abre es la frontera de la valuación, con los mismos controles.

Bajar la ventana que falta es `F6-05`. El historial y la comparación son
`F6-02`. La superficie del número es `F6-03`. Este slice no los adelanta: una
evaluación que inventara un valor por acción, o que disparara la SEC o el
modelo desde la página, mezclaría tres issues y saltaría el límite de `TM-03`
sobre la capa IA.

## Decisión 1 — no es un job de ingesta

`ingestion_jobs` es un plan fijo de sujetos de **una** fuente, bajo el lease de
esa fuente. Una corrida por ticker no es eso:

- el sujeto lo elige el owner, no un plan de CIKs;
- en este slice no hay fuente: no se abre un socket;
- tomarle el lease a `sec-edgar` frenaría el refresh mientras se lee la base.

La tabla es `valuation_jobs` (migración `0031`). Una fila es un pedido. El
estado es `queued`, `running` o `completed`. El resultado es un código cerrado,
nunca un mensaje de la base ni de un proveedor.

Hay a lo sumo un job abierto por ticker. Consultar no crea otro. Encolar cuando
ya hay uno abierto devuelve ese. Un job `completed` sí deja lugar a otro: es el
owner pidiendo de nuevo, no un poll.

## Decisión 2 — el worker lee lo guardado y nombra el hueco

`valuation-job-1.0.0` resuelve el ticker contra el grafo al corte del pedido
(`as_known`, el instante en que se encoló) y, si hay entidad y CIK, corre
`assessCompany` con lo persistido. No observa el SIC, no llama al modelo y no
escribe una corrida de valuación: no hay snapshot de supuestos que valuar.

El job termina con un gap:

| Gap                      | Qué pasó                                                      |
| ------------------------ | ------------------------------------------------------------- |
| `unresolved_ticker`      | el símbolo no está en el grafo                                |
| `ambiguous_ticker`       | resuelve a más de una security                                |
| `identity_conflict`      | el grafo se contradice                                        |
| `cik_missing`            | hay entidad y no hay CIK vigente al corte                     |
| `annual_fundamentals`    | no hay serie anual ingerida (`F6-05` es quien la va a bajar)  |
| `unsupported_method`     | el selector se niega, con su motivo                           |
| `snapshot_not_assembled` | hay método y rigor; falta el snapshot, y por eso no hay valor |
| `assessment_failed`      | la lectura falló; se puede volver a encolar                   |

Un proceso que muere deja la fila `running`. Otro intento la retoma si el
arranque tiene más de dos minutos: el token del reclamo cerca el cierre, así
que el worker viejo ya no puede escribir. La evaluación no muta observaciones,
así que dos lecturas no publican nada dos veces.

## Decisión 3 — la Server Action

`enqueueValuation` en `src/app/valuacion/actions.ts` se trata como un endpoint
público (`TM-03`):

- el modo se resuelve en el request y un runtime trabado responde
  `unavailable` sin componer la base;
- la entrada es un esquema cerrado: un ticker que, normalizado, es un símbolo
  (`^[A-Z][A-Z0-9.-]{0,15}$`) y la intención `enqueue` o `status`. No acepta
  URL, CIK, fecha ni campos de más. El plan lo arma el servidor;
- la salida son códigos. No salen ids internos, SQL ni el ticker inválido;
- no hay egress. El peor abuso es leer la base del owner, una vez por ticker
  abierto, y el worker único del proceso serializa las evaluaciones;
- el render no escribe. La página muestra el formulario; el cliente llama a la
  acción. `status` reanuda un job abierto y no crea uno.

`src/app/` sigue sin poder importar la capa IA.

## Consecuencias

- `/valuacion` es la entrada de la corrida. `/valuacion/referencia` sigue siendo
  el motor sobre el snapshot fijo, enlazado desde la página y no reemplazado.
- Un ticker con fundamentals guardados termina en `snapshot_not_assembled` con
  el perfil, el método y el rigor. Eso no es un valor.
- `F6-05` puede ocupar el gap `annual_fundamentals` sin cambiar la frontera:
  el cliente sigue enviando un ticker y una intención.

## Alternativas descartadas

**Reutilizar `ingestion_jobs`.** Mezcla una lectura local con el lease de una
fuente y obliga a inventar un dataset para un trabajo que no ingiere.

**Valuar en el request.** Es lo que la ADR 0007 prohibió, y además la
evaluación de una empresa con linaje no es un render.

**Publicar el valor con supuestos por defecto.** Un número sin snapshot
reproducible contradice el motor. El hueco se nombra.
