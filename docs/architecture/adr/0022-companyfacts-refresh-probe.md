# ADR 0022: sondeo, marca de agua y job del refresh

- Estado: aceptado
- Fecha: 2026-09-18
- Alcance: incremento 4 de `F2-05`. Cómo se decide que un filer del conjunto
  seguido tiene algo nuevo, qué se guarda para no volver a preguntarlo, y cómo
  corre la vuelta completa. No autoriza cron, gasto ni proveedores nuevos.
- Decisiones relacionadas: [ADR 0021](0021-refresh-followed-set.md) (a quiénes
  sigue), [ADR 0015](0015-durable-ingestion-jobs.md) (jobs durables y lease por
  fuente), [ADR 0020](0020-source-daily-budget-kill-switch.md) (cuota diaria y
  kill switch), [ADR 0010](0010-sec-xbrl-ingestion.md) (qué se ingiere),
  [ADR 0017](0017-sec-history-window.md) (ventana),
  [ADR 0019](0019-observation-history-prune.md) (poda),
  [threat model](../../security/threat-model.md) (`TM-10`, `TM-11`, `TM-16`)

## Contexto

La ADR 0021 fijó a quiénes mira el refresh: los filers con fundamentals
publicados. Falta la mecánica, y el costo depende entera de ella. Volver a bajar
companyfacts de los seis son 20 requests y 15 segundos; preguntar primero si
cambió algo son 6 requests y 3 segundos. La diferencia crece con el conjunto.

La pregunta «¿cambió?» tiene una respuesta barata: `submissions` es un request y
publica el índice de presentaciones del filer con su instante de aceptación. Lo
que no es obvio es contra qué comparar.

## Decisión

### 1. La comparación es contra una marca de agua propia, no contra lo publicado

Lo primero que se intentó fue comparar contra lo que la base ya tiene: la
aceptación más nueva entre los documentos registrados. Falla en un caso real y
frecuente. Medido el 2026-09-18 sobre Apple: la presentación relevante más nueva
del índice es un `8-K/A` aceptado el 2026-09-01 que no publica ningún hecho de los
58 seleccionados. Comparando contra lo publicado, ese 8-K se ve nuevo **en cada
vuelta**: baja companyfacts, no publica nada, y la vuelta siguiente vuelve a
bajarlo. Para siempre.

Por eso el refresh guarda su propia marca: **el par `(aceptación, accession)` de
la presentación relevante más nueva que el sondeo vio**, haya publicado algo o no.
Tabla `ingestion_refresh_state` (migración `0015`), una fila por
`(fuente, dataset, sujeto)`.

El par y no el instante solo: dos presentaciones del mismo filer pueden compartir
el segundo, y comparar por tupla no deja a ninguna del lado viejo.

Es **estado y no bitácora**, por la misma razón que el contador de la ADR 0020: la
corrida de cada sondeo queda igual en `ingestion_runs` y explica la vuelta, pero
«¿qué sabía el portal la última vez?» tiene que poder contestarse con una lectura
directa, sin reconstruirla desde un log filtrado por versión de parser —que cambia
de significado justo cuando el parser cambia—.

### 2. La marca se escribe al final, y por eso sólo puede quedar atrás

El orden de una vuelta es: registro y derechos → sondeo → decisión → corrida del
sondeo → companyfacts, si hace falta → marca.

No hay transacción que cruce repositorios, y no hace falta: si algo se corta en el
medio, la marca queda **atrás** de la realidad y la vuelta siguiente vuelve a
bajar —que deduplica por contenido y no publica nada—. Lo que nunca puede pasar es
que quede **adelante** de un refresh que no ocurrió, que es la única falla que
perdería datos. Una ingesta que falla no mueve la marca; una que termina sin
publicar nada sí, porque el filer igual quedó al día.

Una escritura tardía tampoco la hace retroceder: el upsert está condicionado a que
el sondeo sea al menos tan nuevo como el último.

### 3. Qué presentación cuenta: una lista declarada

Apple presenta varios Form 4 por semana. Contarlos haría que «cambió» sea siempre,
que es exactamente lo que el incremento evita. Sólo despiertan una descarga los
formularios que pueden traer hechos XBRL de empresa
(`sec-companyfacts-forms-1.0.0`): `10-K`, `10-Q`, `10-KT`, `10-QT`, `8-K`, `20-F`,
`40-F`, `6-K` y sus `/A`. De las 149 presentaciones relevantes que el índice de
Apple trae hoy, el resto del índice no se mira.

La lista coincide hoy con la de formularios cuya fecha de filing acota la
disponibilidad (`sec-fact-rules.ts`), y se declara aparte igual: una contesta «qué
puede traer hechos» y la otra «para qué formulario la fecha de filing es una cota
defendible». Cambiar una no debería cambiar la otra en silencio.

La versión viaja en la fila. Si la lista crece, el sujeto se marca
`form_selection_superseded` y se refresca una vez: lo que la marca dice dejó de ser
comparable.

### 4. Un sujeto sin marca se refresca una vez

No hay semilla. La primera vuelta de un filer es `never_probed`: baja companyfacts
una vez —que deduplica— y deja la marca escrita. Medido: los seis filers costaron
20 requests la primera vuelta y 6 la segunda.

Se descartó sembrar la marca desde lo ya registrado. La semilla más cercana es la
aceptación más nueva de los documentos de companyfacts, y puede quedar **adelante**
de la verdad cuando la SEC no publicó la aceptación y la disponibilidad se infirió
(`sec_filing_date_end_of_day`, un día después). Una semilla adelantada esconde una
presentación; veinte requests una sola vez por filer, no.

### 5. El sondeo deja su corrida, y lo que vio es su contenido

Toda vuelta registra una corrida de `sec.submissions` con
`parser_version = sec-refresh-probe-1.0.0`: «cuándo se miró y qué se vio» se
contesta desde la base (`TM-16`), y es además la corrida con la que el item del job
cierra. `cursor` lleva la marca de la que partió y `next_cursor` la que dejó.

La clave de idempotencia incluye `documentVersion`, que es el hash de lo que el
sondeo observó. Dos vueltas que ven lo mismo comparten clave y la segunda queda
`duplicate`: repetir un sondeo sin novedades no inventa una corrida publicable.

Lo que la corrida cuenta es el **documento** que pidió, no las presentaciones que
trae. Contar presentaciones haría de «sondeé y no había nada nuevo» un estado
imposible, porque `succeeded` exige haber aceptado todo lo leído. Cuántas
relevantes vio y cuántas eran nuevas vive en la decisión y lo informa el comando.

### 6. La vuelta completa es un job durable, con su propio kind

`sec_companyfacts_refresh` (migración `0016`) reusa entera la maquinaria de la
ADR 0015 —lease por fuente, cursor, intentos, poison policy, recuperación
manual— y la admisión de la ADR 0020. Es un kind propio y no un backfill con otro
plan: el item empieza por un sondeo y sólo a veces termina bajando.

La reserva del peor caso es el sondeo más la carga completa, 67 requests. Que la
mayoría de los items gaste uno solo no cambia la reserva: lo que se evita es
quedarse sin cuota a mitad de un documento.

### 7. El refresh no borra

Cuando una presentación nueva mueve el ancla de la ventana, lo que quedó afuera lo
saca `pnpm fundamentals:prune` (ADR 0019). Borrar sigue siendo un acto propio, con
su motivo y su fila. El refresh trae; la poda saca.

## Verificación

`format:check`, `lint`, `typecheck` y `build` (cuatro rutas en `ƒ (Dynamic)`)
pasan. 1.251 unit tests y 131 integration tests, con el contrato de la marca
corrido sobre el doble en memoria y sobre PostgreSQL.

Ensayo sobre datos reales (2026-09-18), en una réplica descartable clonada del
grafo personal:

- **Vuelta completa, primera vez.** 6 filers, 20 requests, 15,3 s. Los seis
  `never_probed`: cada uno bajó companyfacts y publicó **cero** filas nuevas
  —todas duplicadas— y dejó su marca.
- **Vuelta completa, segunda vez.** 6 requests, 2,7 s, ninguna descarga de
  companyfacts. Es el estado estacionario.
- **Apple en detalle.** Primera vuelta 3 requests; segunda 1. Su marca quedó en el
  `8-K/A` del 2026-09-01 que no publica hechos: sin marca propia, ese 8-K habría
  disparado una descarga por vuelta para siempre.
- **Una presentación nueva.** Con la marca movida a mano al 2026-05-01, el sondeo
  nombró las tres relevantes posteriores —un `8-K`, el `10-Q` del 2026-07-31 y el
  `8-K/A`—, volvió a bajar, publicó cero y dejó la marca donde iba.
- **Kill switch.** Con `sec-edgar` frenada, el comando sale con el motivo antes de
  abrir ningún socket.
- **Reserva del peor caso.** Con el tope del día en 35 y 30 gastadas, el job paró
  en `daily_budget_exhausted` con **0 requests**, los 6 items `pending`, ninguno
  fallado ni envenenado, el lease libre y la hora en que se repone el contador.
- **Dos procesos a la vez.** Uno completó el job (6 requests) y el otro salió
  `source_busy` con 0 requests, nombrando al holder.
- **`kill -9` a mitad de un item.** El item quedó `running` bajo el lease de un
  proceso muerto; la corrida siguiente salió `source_busy` sin ningún request;
  `pnpm ingestion:jobs --release` lo devolvió a `pending` con el motivo en la
  bitácora; la corrida siguiente lo completó en el intento 2 y terminó el job en 6
  requests.

Contra la base personal se gastó **un** request —el sondeo en seco de Apple— y no
se escribió nada: las migraciones `0015` y `0016` se aplicaron ahí, sin filas.

## Consecuencias

- Mantener fresco el conjunto seguido cuesta un request por filer y por vuelta.
- Una presentación que no publica hechos deja de disparar descargas para siempre.
- El refresh hereda las tres negativas de la ADR 0020 sin código nuevo: fuente
  frenada, cuota agotada y presupuesto de corrida paran la vuelta sin envenenar
  sujetos sanos.
- Una vuelta que mueve el ancla de la ventana deja al sujeto con historia de más
  hasta que el owner pode. El comando lo informa.
- Sigue sin haber cron. Lo que falta para programarlo ya no es mecánica: es el
  gate de correr algo solo.

## Alternativas descartadas

- **Comparar contra lo publicado, sin marca propia.** Es el bucle del punto 1.
- **Guardar el conjunto de accessions vistos.** Contesta lo mismo que la marca y
  crece sin techo.
- **Derivar la marca de las corridas de sondeo** (`next_cursor` de la última
  publicable). Evita una tabla, pero el filtro depende de la versión del parser y
  cambia de significado justo cuando esa versión cambia; además una vuelta sin
  novedades queda `duplicate`, que no es publicable, y la consulta tendría que
  mezclar los dos estados.
- **Pasarle al sondeo el documento ya descargado para que la ingesta no lo vuelva
  a pedir.** Ahorra un request por filer **cambiado**, sobre los 3 a 67 que esa
  descarga cuesta igual, y a cambio acopla el puerto de la fuente a un caché.
- **Un `job_kind` compartido con el backfill.** El plan se vería igual y el
  ejecutor tendría que adivinar cuál es. `ingestion:jobs` tampoco podría
  distinguirlos.
- **Mirar también los archivos históricos de `submissions`.** Una presentación
  nueva siempre está entre las mil recientes; pedir el resto gastaría cuota sin
  cambiar la respuesta.
