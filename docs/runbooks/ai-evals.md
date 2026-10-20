# Evals de la capa IA

- Slice: `F5-07`
- Decisión: [ADR 0035](../architecture/adr/0035-ai-layer-evals.md)
- Runtime: personal, con PostgreSQL y `OPENROUTER_API_KEY` para medir; la captura
  del corpus necesita además `SEC_USER_AGENT`
- Relacionado: [gasto de la capa IA](ai-spend.md),
  [resolución de industria](industry-resolution.md),
  [mix de operaciones](operations-mix.md), [corpus congelado](golden-corpus.md)

Los evals miden las dos tareas de la capa IA —`industry-resolution-1.0.0` y
`operations-mix-1.0.0`— sobre un corpus congelado de extractos de 10-K: si
validan el schema, si aciertan contra un gold declarado, si citan bien, si se
abstienen cuando la evidencia no alcanza, si un texto hostil las desvía y cuánto
cuestan. Hay dos niveles:

- **Offline**, en cada `pnpm test`: hashes del corpus, gold que pasa la policy
  sobre su propia evidencia, cerco de la evidencia intacto ante cada inyección y
  la policy rechazando la respuesta que obedece cada inyección contenible. No
  gasta.
- **En vivo**, a mano: `pnpm ai:eval`. Gasta dólares y cuota de `openrouter`.

## El corpus

```sh
pnpm ai:eval-capture             # el plan: documentos, secciones y requests; sin red
pnpm ai:eval-capture --apply     # baja cada 10-K declarado, lo recorta y lo congela
```

Una request a la SEC por documento (25). Cada 10-K se recorta con los lectores de
las tareas —`sec-10k-sections-1.0.0` y `sec-10k-geographic-revenue-1.0.0`— y sólo
se guardan las secciones que algún caso lee; el documento entero no. El comando
dice si algún extracto difiere del que guardó la corrida de producción
(`distinto de producción`): si pasa, o el filer reemplazó el documento o un
lector cambió, y hay que saber cuál antes de comparar.

Los casos se declaran en `src/modules/ai-evals/application/declared-eval-cases.ts`
y el gold en `declared-eval-gold.ts`. Cambiar el corpus es un diff revisable: se
recaptura y se mira qué cambió.

## El gold

Cada respuesta correcta lleva su motivo y `review: "pending_owner"` hasta que el
owner la confirma; entonces pasa a `"owner_reviewed"`. El resumen dice cuántas
siguen sin revisar: mientras haya alguna, la corrección es provisoria.

El gold del mix es una respuesta completa con citas. Si el test offline dice que
un gold no pasa la policy, el gold está mal escrito —una cita que no está en el
extracto, una línea que no suma—, no la policy.

## Medir

```sh
pnpm ai:eval                                                   # plan: pendientes, peor caso, gasto de hoy
pnpm ai:eval --task mix --rung 1 --apply                       # un escalón de la escalera vigente
pnpm ai:eval --variant ai-eval-low-effort-1.0.0 --task mix --rung 3 --apply
pnpm ai:eval --task industry --kind injection --apply          # sólo los casos con inyección
pnpm ai:eval --case mix/AAPL --apply                           # los casos de una empresa
```

Cada caso va a **un** escalón. Son 63 casos, así que un escalón de las dos tareas
son 63 requests contra los 100 diarios de `openrouter`, y la escalera vigente
entera, 189: un barrido se reparte en varios días. El reporte
(`.ai-evals/attempts.jsonl`, ignorado por git) se escribe a medida que avanza;
cuando un tope frena la corrida, el mismo comando la retoma sin repetir lo
medido. En el libro de gasto los intentos quedan con `purpose = 'eval'` y la
variante como versión de la escalera.

## Leer

```sh
pnpm ai:eval --summary
pnpm ai:eval --summary --ladder ai-model-ladder-1.0.0#2,ai-model-ladder-1.0.0#1
pnpm ai:eval --summary --json
```

Una fila por variante, tarea, escalón y tipo de caso:

| Columna | Qué es                                                                   |
| ------- | ------------------------------------------------------------------------ |
| `schm`  | respuestas que validaron el schema sobre las que llegaron                |
| `trc`   | respuestas cortadas por largo (`finish_reason: length`)                  |
| `acep`  | aceptadas por la policy                                                  |
| `corr`  | aceptadas y correctas contra el gold, sobre los casos con gold           |
| `rej`   | válidas que la policy rechazó: la tasa de corrección de la policy        |
| `abs`   | abstenciones                                                             |
| `inyec` | respuestas que obedecieron la inyección, sobre los casos con inyección   |
| `lk`    | **gate**: inyección contenible aceptada con lo que pedía                 |
| `awe`   | caso de abstención aceptado (gate sólo en el mix)                        |
| `cit`   | rechazos por citas: ID desconocido, monto o total que no está en la cita |
| `USD`   | lo contado contra el tope                                                |
| `lat`   | latencia media                                                           |

Después vienen las **escaleras simuladas**: con la medición de cada escalón, el
resumen arma lo que habría hecho cada escalera —la primera aceptada termina, cada
intento anterior suma su costo— sin una llamada más. Por defecto simula la de
cada variante; `--ladder` agrega otras, por ejemplo otro orden o un escalón de
cada variante. Un caso al que le falta un escalón se cuenta aparte (`−n`).

## Decidir

Una variante reemplaza a la vigente sólo si `lk` y el `awe` del mix siguen en
cero, la corrección de los casos base no baja y mejora schema, aceptación o
costo por caso aceptado sin empeorar lo demás (ADR 0035, decisión 7). Si gana,
sale como versión nueva de la escalera, y las resoluciones guardadas conservan
la versión con que se hicieron.

## Extensión a opciones de empleados (`F4-05`, en curso)

El ejecutor y el rejuicio admiten `employee-equity`; su puntuación compara la
lectura financiera normalizada: opciones, strike y su base, plazo y unidades
sin consolidar. No compara la prosa ni exige idéntico formato decimal.

`buildEmployeeEquityEvalCases` valida cada gold contra la policy y conserva su
estado de revisión. Agrega inyecciones de unidades inventadas y plazo excesivo
sólo si la respuesta base tiene esos campos, y una coerción de abstención.
La aceptación de una inyección contenible o de un caso sin evidencia se mide
como falla. Los casos sintéticos de tests prueban esa infraestructura sin red.

Esta extensión todavía no se carga desde el corpus de producción: el comando
sigue midiendo industria y mix. Faltan captura declarada de las notas reales,
manifiesto, gold confirmado por el owner y medición en vivo. `--task employee-equity` falla con un motivo explícito mientras no tenga casos
cargados; no informa una medición vacía como si hubiera pasado.
