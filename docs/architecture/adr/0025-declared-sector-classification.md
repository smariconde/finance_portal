# ADR 0025: el sector como clasificación declarada y versionada

- Estado: propuesto
- Fecha: 2026-09-21
- Alcance: resuelve `F7-02`. Decide qué taxonomía responde «de qué sector es esta
  empresa», con qué evidencia, con qué vigencia y bajo qué nombre se guarda. No
  decide la fuente de precios (`F7-01`, abierta), no decide el arquetipo de
  valuación (`F3-01`) ni el mapeo a las industrias de Damodaran (`F3-05`): esta
  ADR sostiene que esas tres son clasificaciones **distintas** y que el error a
  evitar es tratarlas como una sola.
- Decisiones relacionadas: [ADR 0013](0013-listing-events-dated-evidence.md)
  (evidencia fechada y supersesión), [ADR 0014](0014-declared-corporate-events.md)
  (lo declarado frente a lo detectado),
  [ADR 0016](0016-analysis-scope-sector-matrices.md) (la Fase 7 y sus matrices),
  [ADR 0023](0023-frozen-sec-extracts-rights.md) (los derechos se deciden, no se
  infieren)

## Contexto

La matriz sectorial necesita una población: «las securities de los miembros del
sector al `as_of`». El
[masterplan](../../finance-portal-masterplan/03_DATA_AND_PROVENANCE.md) ya fijó la
exigencia en una frase: el sector es **«una clasificacion versionada con taxonomia
y vigencia, nunca una columna sin origen»**.

Hoy el dato está a mano y deliberadamente sin guardar. El parser del paquete PDDL
lee la columna `GICS Sector` y la deja pasar, con el motivo escrito en el propio
archivo:

> El sector se lee pero el planner no lo persiste: mezclar una taxonomía sin
> registrar cuál es y en qué versión es lo que el modelo de identidad prohíbe.

`F7-02` es exactamente levantar esa reserva, y sólo se puede levantar respondiendo
lo que la reserva pedía: cuál es la taxonomía y en qué versión.

### Hay dos candidatas, y ninguna es GICS

**El `sic` de la SEC.** Llega gratis: el `submissions` que el refresh ya descarga
trae `sic` y `sicDescription`, de una fuente cuyos derechos son `allowed`. Pero el
SIC es una taxonomía **industrial** de 1987, de cuatro dígitos, que no agrupa como
agrupan las matrices ni como agrupan los arquetipos: convertirlo en «sector» exige
un mapeo propio, versionado y discutible, que es más trabajo y más opinión que la
alternativa. Y el `submissions` publica el SIC **vigente**, sin fecha de efecto:
un cambio de SIC no viene fechado, que es el mismo problema que la tabla de
tickers le planteó a la [ADR 0013](0013-listing-events-dated-evidence.md).

**La columna `GICS Sector` del paquete PDDL.** Es lo que las matrices piden
—Energy, Financials, Health Care— y ya está descargada, parseada y pineada por
commit. Pero **no es GICS**. GICS es una taxonomía propietaria de S&P y MSCI; lo
que el paquete publica es una columna derivada de Wikipedia que la reproduce, y el
registro de fuentes ya dice de ese paquete que «su upstream es Wikipedia y no
prueba membresía oficial».

Eso no la descalifica: es exactamente el mismo estatus epistémico que ya tiene la
**membresía al índice**, que sale del mismo archivo y de la que depende toda la
Fase 2. Lo que sí exige es no mentir sobre qué es.

## Decisión

### 1. El sector se guarda como una aserción, no como una columna de la entidad

Una clasificación es una **aserción fechada de una fuente sobre un sujeto**, con
taxonomía, versión y vigencia, y se guarda como tal. No es un campo de
`legal_entity`.

El motivo es el que el modelo de identidad viene aplicando desde `F1-04`: un
campo en la entidad tiene una sola respuesta y no tiene fecha, así que no puede
decir «de qué sector era esta empresa en 2023» ni sostener dos taxonomías a la
vez. Y van a ser al menos tres: el sector de las matrices (esta ADR), el
arquetipo de valuación (`F3-01`) y la industria de Damodaran (`F3-05`).
Convertirlas en una sola columna es el error que hace que el día que
discrepen —y discrepan: un REIT es `Real Estate` para la matriz, `REIT` para el
arquetipo y otra cosa para Damodaran— haya que elegir cuál pierde.

La tabla es **agnóstica de taxonomía**. Agregar el SIC más adelante es insertar
filas, no migrar un schema.

### 2. La taxonomía se llama por lo que es

El identificador de taxonomía es `sp500-wikipedia-gics-sector`, no `gics`.

Es la decisión más chica de la ADR y la que más se va a agradecer. Llamarla `gics`
afirmaría una procedencia que el proyecto no puede defender —nadie verificó contra
S&P que esta columna sea la clasificación oficial— y sugeriría derechos sobre una
taxonomía propietaria que el proyecto no tiene. El nombre dice las tres cosas que
importan: qué universo cubre, de dónde viene realmente y qué pretende reproducir.

Es el mismo criterio de la [ADR 0023](0023-frozen-sec-extracts-rights.md): los
derechos y la procedencia se declaran, no se infieren de que el dato esté
disponible.

### 3. La versión y la vigencia son el pin

La versión de la clasificación es el **commit pineado** del paquete, y su
`available_at` es el `committedAt` de ese commit
(`SP500_CONSTITUENTS_PIN`).

Esto sale gratis y resuelve la exigencia entera: la clasificación queda
reproducible —el mismo pin da el mismo sector—, fechada con una fecha real y no
con el instante de la descarga, y versionada por algo que ya es un diff revisable.
Un pin nuevo **supersede** las aserciones del anterior en lugar de cerrarlas en el
pasado, por la razón de la [ADR 0013](0013-listing-events-dated-evidence.md): la
fuente no dice desde cuándo cambió, así que fechar el cambio con la corrida sería
inventar evidencia.

La consecuencia es deliberada y hay que decirla: **una reclasificación que ocurra
entre dos pines es invisible**. La clasificación tiene la resolución temporal del
pin, que es la misma que ya tiene la membresía.

### 4. La población del sector se resuelve al `as_of`, por composición

La población es la intersección de dos vigencias leídas al mismo `as_of`: la
membresía al índice y la clasificación. Las dos salen del mismo archivo pineado,
así que son consistentes por construcción y no hace falta reconciliarlas.

Un sujeto sin aserción vigente al `as_of` **no tiene sector**, y eso es `null` con
motivo, nunca un sector por defecto ni un «Otros» que agrupe lo que no se supo
clasificar.

## Límites declarados

1. **No es GICS oficial.** Un sector de esta tabla puede discrepar del que publica
   S&P, y nada en el proyecto lo detectaría.
2. **Sólo clasifica miembros del índice.** Una empresa que el paquete no lista no
   tiene sector, aunque el proyecto tenga sus fundamentals.
3. **Un solo nivel.** GICS tiene sector, grupo, industria y sub-industria; acá se
   guarda sólo el sector, que es lo que la matriz usa. Agregar niveles es agregar
   filas con otra taxonomía, no columnas.
4. **La resolución temporal es la del pin**, como en el punto 3.
5. **El sesgo de supervivencia no lo arregla esta ADR.** El paquete lista los
   miembros actuales, así que los que salieron del índice no aparecen; la matriz
   declara ese sesgo, según el masterplan.

## Consecuencias

- `F7-02` puede entregarse **sin resolver `F7-01`**: no necesita precios ni fuente
  nueva, y usa un paquete que ya está en la allowlist, ya tiene derechos
  aprobados y ya se descarga.
- La reserva escrita en `parse-sp500-constituents.ts` y en
  `universe-source-records.ts` se levanta, citando esta ADR.
- `F3-01` (arquetipo) y `F3-05` (industria de Damodaran) reciben una tabla donde
  escribir sin discutir de nuevo el modelo, y con la obligación explícita de usar
  **su propia** taxonomía en vez de reinterpretar ésta.
- El SIC queda disponible como segunda taxonomía sin cambio de schema, si algún
  slice futuro lo necesita.

## Alternativas descartadas

- **Una columna `sector` en `legal_entity`.** Es lo que el modelo de identidad
  prohíbe y lo que la reserva del parser venía evitando: sin fecha, sin fuente,
  sin versión y con una sola respuesta posible para tres preguntas distintas.
- **Derivar el sector del SIC de la SEC.** Más autoritativo en la forma y peor en
  el fondo: exige inventar un mapeo SIC → sector, versionarlo y defenderlo, para
  terminar aproximando la misma clasificación que el paquete ya trae hecha. Queda
  como taxonomía futura, no como la primera.
- **Llamarla `gics`.** Más cómodo de leer y falso. Ver el punto 2.
- **Licenciar GICS.** Es la respuesta correcta si alguna vez hay que defender la
  clasificación ante un tercero. Para un portal personal de un solo owner, el
  costo y el contrato no tienen relación con el problema.
- **Esperar a `F7-01`.** Habría dejado la Fase 7 entera detenida por una decisión
  de derechos de precios que es independiente de ésta, y `F3-01` depende de la
  clasificación, no de los precios.
