# ADR 0052: la corrida le pide a la IA lo cualitativo que le falta

- Estado: aceptado
- Fecha: 2026-10-22
- Alcance: `F6-13`. Con los datos bajados y auditados, la corrida por ticker
  corre las tareas de IA que la evaluación dice que faltan —industria ambigua,
  opciones de empleados, mix de operaciones— antes de armar el snapshot.
- Decisiones relacionadas: [ADR 0007](0007-ticker-driven-valuation-pivot.md) (la
  IA propone, el motor calcula), [ADR 0033](0033-ai-layer-industry-resolution.md)
  (capa IA, topes en dólares, escalera), [ADR 0034](0034-operations-weighted-country-risk.md)
  (mix de operaciones), [ADR 0040](0040-failure-probability-employee-options.md)
  (opciones de empleados), [ADR 0045](0045-ticker-valuation-job.md) (la corrida
  es un job), [ADR 0051](0051-on-demand-valuation-data.md) (la corrida baja lo
  que falta)

## Contexto

La ADR 0051 dejó la corrida en «sólo datos». Un ticker nuevo llegaba a una
evaluación con su SIC y su ventana, pero:

- con la industria ambigua, la corrida terminaba en `cost_of_capital_unavailable`;
- sin transcripción de opciones, en `employee_equity_not_proposed`;
- sin mix, el CRP salía sólo del domicilio.

Las tres tareas existían como comandos (`valuation:resolve-industry`,
`valuation:employee-equity`, `valuation:operations-mix`), cada una con su policy
determinista, su evidencia del 10-K y su tope en dólares. El 2026-10-22 el owner
pidió que el sistema dé resultados en vez de frenar por un dato cualitativo, y
eligió correr **las tres** desde el job.

## Decisión 1 — qué se pregunta, decidido sobre la evaluación

`valuation-qualitative-1.0.0` corre sólo cuando el método elegido es `fcff_base`
—el único con snapshot— y el paso de datos de la ADR 0051 terminó sin bloquear:
una tarea sobre una ventana que no pasó la auditoría preguntaría sobre datos
rotos.

| Tarea            | Falta cuando                                             |
| ---------------- | -------------------------------------------------------- |
| `industry`       | la evaluación dice `ambiguous`                           |
| `employeeEquity` | no hay transcripción aceptada visible al corte del job   |
| `operationsMix`  | la evaluación no tiene mix (ni declaración ni propuesta) |

El orden es fijo: industria, opciones, mix. Cada tarea es la misma función que
corre su comando, con `apply` y sin `again`. Si ya preguntó por ese 10-K,
saltea. Una declaración del owner sigue siendo el lock: no se le pregunta al
modelo.

## Decisión 2 — un freno no es una respuesta

Las tres tareas guardan toda respuesta, también la que no lo es: una escalera
que frenó por el breaker, la clave, el kill switch o la cuota (`stopped`), o
porque el tope en dólares no dejó salir la llamada (`ai_budget_exhausted`). Con
la regla anterior, ese registro contaba como «ya se preguntó por este 10-K», y
la empresa quedaba sin preguntar hasta un `--again` a mano. En un job
automático, un día con el tope gastado la dejaba trabada.

`isTransientAiAnswer` saca esos dos casos del «ya se preguntó». Vale también
para los comandos. Una abstención sobre la evidencia (`insufficient_evidence`,
`ladder_exhausted`) sigue siendo una respuesta: preguntar otra vez por el mismo
10-K da lo mismo y cuesta.

Dentro de un job, una escalera que frena corta las tareas siguientes
(`not_run`), igual que en los comandos: seguir sería pagar por la misma falla.
Una tarea que lanza (la SEC no responde, la evidencia no puede viajar) queda
`failed` con el nombre del error como código, nunca su mensaje, y las otras
siguen.

## Decisión 3 — una decisión aceptada se valúa en otro job

Una resolución de industria se publica como aserción disponible desde el
instante en que se aceptó, y una propuesta aceptada se lee por `acceptedAsKnown`
al corte. Las dos son posteriores al corte del job que las pidió. Mover ese
corte rompería el contrato de la ADR 0045, como en la ADR 0051.

Si el paso deja **al menos una** decisión aceptada, el job termina en
`qualitative_resolved` y, en la misma transacción, encola otro con corte nuevo
(`follows_job_id`). Si no deja ninguna, el job sigue al snapshot, que nombra lo
que falta; el registro del paso dice por qué la IA no lo resolvió.

La cadena es de tres como mucho —bajar, decidir, valuar—. No hay bucle: cada
tarea guarda una respuesta por 10-K, así que el tercer job no tiene nada nuevo
que preguntar. El paso cuesta una request a `submissions` por tarea pendiente,
que las tres comparten porque el job pide cada URL una vez.

## Decisión 4 — la acción no ve la IA

La frontera de `TM-03` se abre sólo para el worker. `enqueueValuation` no
cambia: esquema de ticker e intento, respuesta de códigos. El worker corre
después de responder, con `after()`, y es lo único que importa
`@/server/ai`, desde `src/server/jobs/`. ESLint sigue prohibiendo que
`src/app/` importe la capa IA.

Lo que limita el gasto es lo mismo que limita un comando:

- USD 0,10 por tarea y USD 1,00 por día UTC, reservados antes de salir;
- 100 requests diarias a OpenRouter y 10 a Tavily (una por job como mucho);
- el kill switch de cada fuente;
- el breaker, compartido por las tres tareas del job.

Un pedido no puede disparar más de tres tareas, y una empresa que ya tiene sus
tres decisiones no gasta nada. El registro del paso guarda lo cobrado en
nano-dólares; el libro de gasto tiene cada intento.

## Registro

`valuation-job-1.3.0`, migración `0035`:

- gap nuevo: `qualitative_resolved`;
- `qualitative_step` (`jsonb`, validado por `valuation-qualitative-1.0.0`): por
  tarea, `present`, `skipped`, `accepted`, `abstained`, `stopped`, `not_run` o
  `failed`, con su motivo o código, más lo cobrado;
- lo pueden llevar `qualitative_resolved`, `snapshot_not_assembled` y
  `run_recorded`.

Una fila `1.2.0` conserva su paso de datos y no tiene paso cualitativo. El
rollback pareado se niega si hay filas `1.3.0` y no toca las tablas de las
tareas.

## Consecuencias

- Un ticker nuevo puede llegar solo a una corrida aunque su SIC sea ambiguo o no
  tenga transcripción de opciones.
- Valuar una empresa nueva gasta IA: medido, céntimos de dólar por empresa, sólo
  la primera vez por 10-K.
- Lo que la IA no resuelve se dice en la página en una oración, sin códigos.

## Límites

- La lectura de expectativas (`F6-11`) sigue siendo un comando: no bloquea el
  valor.
- Si el 10-K no trae la nota de compensación en acciones donde el extractor la
  busca (`equity_note_not_found`), el snapshot sigue sin armarse. No hay regla
  para valuar sin la transcripción; decidirla es otro slice.
- No cubre los huecos de datos que no son cualitativos: una deuda sin receta
  (`reported-debt-1.0.0`) deja el capital invertido sin resolver, y la IA no lo
  inventa.
