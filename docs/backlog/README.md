# Backlog ejecutable

- Estado: activo desde el cierre de Fase 0
- Owner: propietario técnico del repositorio
- Autoridad de fase: [`06_PHASED_ROADMAP.md`](../finance-portal-masterplan/06_PHASED_ROADMAP.md)
- Contratos transversales: [threat model](../security/threat-model.md) e
  [interface foundations](../design/interface-foundations.md)

## Propósito y reglas

Este tracker convierte el roadmap en unidades pequeñas, ordenadas y verificables.
No reemplaza el estado de las fases ni autoriza trabajo por sí solo: el roadmap
decide qué fase está activa y este archivo decide qué issue de esa fase sigue.

- Sólo puede existir un issue `in_progress`.
- Un issue pasa a `done` únicamente con sus criterios de aceptación y evidencia.
- `ready` identifica el único próximo slice autorizado; `queued` conserva el orden
  futuro y `blocked` exige una causa y condición de salida explícitas.
- Cada cambio que cierre un issue actualiza este archivo y el registro de sesiones
  del roadmap en la misma entrega.
- Una dependencia estructural, proveedor real, gasto, recurso externo o cambio de
  exposición necesita su gate o ADR antes de comenzar.
- Los IDs `TM-*` y `UI-*` son controles transversales, no features opcionales.

## Tracker activo

| Orden | Issue      | Estado        | Resultado verificable                                                                                                                                                                                                     | Dependencias     |
| ----: | ---------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
|     1 | `F1-01`    | `done`        | Shell y health navegables con estados honestos, sin DB, proveedor real, mutación ni rutas que simulen datos.                                                                                                              | Fase 0 `done`    |
|     2 | `F1-02`    | `done`        | PostgreSQL/Drizzle y repositorios base con aislamiento explícito entre fixture demo y storage personal.                                                                                                                   | `F1-01`          |
|     3 | `F1-UI-01` | `done`        | Fundación shadcn/Base UI y superficies existentes migradas a un workspace financiero estándar.                                                                                                                            | `F1-02`          |
|     4 | `F1-03`    | `done`        | Registro de fuentes, corridas de ingesta y fake provider determinista cubiertos por contratos.                                                                                                                            | `F1-UI-01`       |
|     5 | `F1-04`    | `done`        | Una empresa fixture recorre identidad completa, provenance y consulta point-in-time sin look-ahead.                                                                                                                       | `F1-03`          |
|     6 | `F1-05`    | `done`        | FCFF base y sensibilidad se calculan en dominio puro con snapshot y hash reproducibles.                                                                                                                                   | `F1-04`          |
|     7 | `F1-06`    | `done`        | Superficie de resultado y trazabilidad con fuentes, freshness, supuestos y sensibilidad accesibles.                                                                                                                       | `F1-05`          |
|     8 | `F1-07`    | `done`        | Unit, contract y E2E prueban el flujo personal, runtime trabado, teclado y mobile.                                                                                                                                        | `F1-06`          |
|     9 | `F1-08`    | `deferred`    | Walkthrough del owner sobre el runtime personal registra hallazgos y cierra el gate de Fase 1.                                                                                                                            | `F1-07`          |
|    10 | `F2-01`    | `done`        | Acceso personal remoto habilitado en produccion, con los tests de frontera invertidos a proposito.                                                                                                                        | ADR 0008         |
|    11 | `F2-02`    | `done`        | Universo S&P 500 con identidad completa: issuer, security, listing, simbolo vigente y CIK.                                                                                                                                | `F2-01`          |
|    12 | `F2-03`    | `done`        | SEC EDGAR integrada: companyfacts publicado como observaciones point-in-time, con aceptación, vintages y cuarentena.                                                                                                      | `F2-02`          |
|    13 | `F2-04`    | `done`        | Corporate actions con vigencia: splits, cambios de símbolo, sucesiones de CIK, delistings y fusiones.                                                                                                                     | `F2-03`          |
|    14 | `F2-05`    | `done`        | Backfill y refresh durable con presupuesto, cursor, lease y recuperación verificables.                                                                                                                                    | `F2-04`          |
|    15 | `F2-06`    | `done`        | Golden fixtures desde extractos reales congelados, en reemplazo de `FixtureCo` como oráculo de regresión.                                                                                                                 | `F2-03`          |
|    16 | `F2-07`    | `done`        | Gate de Fase 2 verificado sobre datos reales: contrato point-in-time auditado, 30 empresas reconciliadas y validación semántica decidida.                                                                                 | `F2-06`          |
|    17 | `F7-02`    | `done`        | El sector como clasificación declarada y versionada, con la población resuelta al `as_of`.                                                                                                                                | Fase 2           |
|    18 | `F7-01`    | `done`        | Precios diarios crudos por security, con splits y dividendos fechados y la base de ajuste declarada.                                                                                                                      | Fase 2           |
|    19 | `F7-03`    | `done`        | Registro CEDEAR de los dos emisores, con cada CEDEAR como security propia y el subyacente resuelto contra el grafo.                                                                                                       | `F7-02`          |
|    20 | `F7-04`    | `done`        | Catálogo de métricas acotado a las matrices y `sortino-1.0.0` puro sobre base total return, con los parámetros decididos por el owner.                                                                                    | `F7-03`          |
|    21 | `F7-05`    | `done`        | Matriz de riesgo por sector al `as_of`: referencia `^SP500TR` en la misma base, recta nombrada, CEDEAR, nulos con motivo y consulta acotada.                                                                              | `F7-04`          |
|    22 | `F7-08`    | `done`        | La matriz es a hoy y, al abrirla, descarga sólo los precios que le faltan, como job durable con progreso, sin bucles y sin pasar la cuota.                                                                                | `F7-05`          |
|    23 | `F7-06`    | `done`        | Descarga CSV personal de la matriz con valores exactos, nulos, definiciones, versiones y atribucion de las fuentes.                                                                                                       | `F7-05`          |
|    24 | `F7-07`    | `done`        | Degradacion, reconciliacion y quality score explicable de la matriz.                                                                                                                                                      | `F7-05`          |
|    25 | `F3-01`    | `done`        | Selector determinista de arquetipo con reglas explícitas, requisitos y rechazo de métodos no admitidos.                                                                                                                   | Fase 7 `done`    |
|    26 | `F3-02`    | `done`        | Perfil de completitud medido por empresa sobre los datos que existen, sin estimar lo ausente.                                                                                                                             | `F3-01`          |
|    27 | `F3-03`    | `done`        | Nivel de rigor derivado de la completitud y declarado en la corrida, recalculado por el motor.                                                                                                                            | `F3-02`          |
|    28 | `F3-04`    | `done`        | Datasets Damodaran versionados y fechados: ERP implícita, betas por industria, riesgo país y rating sintético.                                                                                                            | Fase 7 `done`    |
|    29 | `F3-05`    | `done`        | Mapeo empresa → industria de Damodaran por SIC, con la ambigüedad nombrada y resuelta sólo por declaración del owner.                                                                                                     | `F3-04`          |
|    30 | `F3-06`    | `done`        | Costo de capital bottom-up con componentes fechados, recalculado por el motor en cada corrida.                                                                                                                            | `F3-05`          |
|    31 | `F5-01`    | `done`        | Controles de la capa IA antes de la primera llamada: egress `POST` con credencial, fuentes registradas, gasto en dólares, breaker y escalera.                                                                             | Fase 3 `done`    |
|    32 | `F5-02`    | `done`        | Guard server-side de la capa IA: sólo existe en `personal` y ninguna clave llega al browser, probado sobre el build.                                                                                                      | `F5-01`          |
|    33 | `F5-03`    | `done`        | Industria ambigua resuelta con secciones dirigidas del 10-K, policy determinista y aserción persistida, medida sobre las 16 ambiguas.                                                                                     | `F5-02`          |
|    34 | `F5-04`    | `done`        | Tavily como último recurso de la industria cuando el 10-K no alcanza: extractos sin abrir URLs, evidencia no confiable y medida con los evals.                                                                            | `F5-03`          |
|    35 | `F5-05`    | `done`        | Mix geográfico de ingresos transcripto del 10-K por la IA con policy determinista y lock del owner; el CRP del WACC se pondera por operaciones y el motor lo recalcula.                                                   | `F5-03`          |
|    36 | `F5-06`    | `done`        | Replay de una corrida con industria y mix propuestos por la IA: reproduce ambos hashes desde el snapshot sin volver a llamar al modelo.                                                                                   | `F5-05`          |
|    37 | `F5-07`    | `done`        | Evals de injection, citas, abstención, schema, costo y corrección sobre las dos tareas de la capa IA.                                                                                                                     | `F5-06`          |
|    38 | `F4-01`    | `done`        | Capitalización de arrendamientos operativos e I+D con puente auditable sobre EBIT, capital invertido y deuda, recalculado por el motor.                                                                                   | Fase 3           |
|    39 | `F4-02`    | `done`        | Regla terminal `g <= risk_free_rate` en el check y en cada celda de la sensibilidad, con la libre de riesgo de la corrida; `fcff-1.2.0` sin reescribir corridas.                                                          | `F4-01`          |
|    40 | `F4-03`    | `done`        | Normalización reported/adjusted del ejercicio base: capital invertido, deuda, caja, tasa y cargos no recurrentes con libro de ajustes; el puente sale del libro.                                                          | `F4-01`          |
|    41 | `F4-04`    | `done`        | Escenarios bear/base/bull como conjuntos coherentes de supuestos en el mismo snapshot, recalculados enteros por el motor y sometidos a los mismos checks que la base.                                                     | `F4-03`          |
|    42 | `F4-05`    | `done`        | Probabilidad de fracaso del rating sintético con recupero sobre el capital en libros, y opciones de empleados valuadas con Black-Scholes ajustado por dilución y restadas del equity, con básicas + RSU como denominador. | `F4-03`          |
|    43 | `F4-06`    | `done`        | Bancos/aseguradoras, cíclicas/commodities, pérdidas/high growth y REIT entregados como experimentales con gates independientes. Holdings/SOTP y distress diferidos hasta demanda observada.                               | `F4-04`, `F4-05` |
|    44 | `F6-01`    | `done`        | Corrida por ticker encolada con estado; la acción evalúa lo guardado y nombra el hueco, sin valor ni red durante el render.                                                                                               | Fase 4, Fase 5   |
|    45 | `F6-07`    | `done`        | Supuestos `fcff_base` derivados de lo guardado por una regla versionada; el job arma el snapshot, corre el motor y registra la corrida, o nombra el faltante.                                                             | `F6-01`          |
|    46 | `F6-02`    | `done`        | Historial de corridas: volver a ver, refrescar lo que cambió y comparar contra la anterior sin sobrescribirla.                                                                                                            | `F6-07`          |
|    47 | `F6-03`    | `done`        | Superficie de resultado sobre empresa real con nivel de rigor, provenance y supuestos distinguidos de los hechos.                                                                                                         | `F6-02`          |
|    48 | `F6-04`    | `done`        | Acceso CEDEAR en el resultado: programa, depositario, estado y ratio al corte de la corrida, y el valor por CEDEAR en USD.                                                                                                | `F6-02`          |
|    49 | `F6-05`    | `done`        | Ingesta bajo demanda de la ventana de fundamentals que falta, con presupuesto, reanudación y auditoría point-in-time del sujeto.                                                                                          | `F6-01`          |
|    50 | `F6-08`    | `done`        | Precio del CEDEAR en BYMA y valor por CEDEAR en pesos con el CCL implícito del propio CEDEAR, con su ADR de fuente.                                                                                                       | `F6-04`          |
|    51 | `F6-09`    | `done`        | Precio de mercado al `as_of` de la corrida y DCF inverso por driver: qué crecimiento, margen, ROIC terminal o tasa exige el precio, al lado de lo que la empresa mostró.                                                  | `F6-03`          |
|    52 | `F6-10`    | `done`        | `derived-assumptions-2.0.0`: ROIC terminal por regla con el dataset de Damodaran, crecimiento por tendencia y escenarios bear/bull derivados.                                                                             | `F6-09`          |
|    53 | `F6-11`    | `done`        | Lectura cualitativa de la IA sobre lo que exige el precio: plausibilidad por driver con citas del 10-K verificadas, sin mover el valor.                                                                                   | `F6-09`          |
|    54 | `F6-12`    | `done`        | Flujo de valuación en un solo lugar por ticker: pedir, ver el estado y leer el resultado sin saltos, con la jerarquía orientada a decidir.                                                                                | `F6-09`          |
|    55 | `F6-13`    | `done`        | La corrida le pide a la IA lo cualitativo que falta —industria ambigua, opciones de empleados, mix— con las tareas y topes de sus comandos, y valúa con lo aceptado en un job con corte nuevo.                            | `F6-05`          |
|    56 | `F6-14`    | `done`        | La selección y la serie leen los conceptos que los filers usan de verdad, los intereses salen de una receta con bases nombradas y una ventana vieja se baja otra vez.                                                     | `F6-13`          |
|    57 | `F6-15`    | `done`        | Deuda cero con evidencia y EBIT sin resultado operativo en el puente, congelados en el snapshot y recalculados por el motor.                                                                                              | `F6-14`          |
|    58 | `F6-16`    | `done`        | Opciones de empleados robustas: nota bien elegida, etiqueta de ejercicio de los minoristas, XBRL como respaldo y valuación sin restar opciones cuando no hay nada.                                                        | `F6-14`          |
|    59 | `F6-06`    | `in_progress` | Despliegue remoto: Postgres hosteada, protección de la plataforma verificada y walkthrough del owner sobre una valuación real.                                                                                            | `F6-08`          |

`F1-02` cerró con PostgreSQL 17.11 local dedicado, migración aplicada, composición
aislada y repository integration test. `F1-UI-01` cerró el 2026-08-23 con la
revisión desktop/mobile ejecutada sobre el build de producción y las capturas de
`.impeccable/review/` regeneradas. `F1-03` cerró el 2026-08-23 con el módulo
`src/modules/ingestion/`, la migración `0001` y su rollback pareado, y contract e
integration tests sin red. `F1-04` cerró el 2026-08-24 con los módulos
`src/modules/temporal/`, `src/modules/identity/` y `src/modules/observations/`, la
migración `0002` y su rollback pareado. `F1-05` cerró el 2026-08-24 con
`src/modules/valuation/`, la ADR 0003 que incorpora `decimal.js` y la migración
`0003` con su rollback pareado. `F1-06` cerró el 2026-08-25 con
`/valuacion/referencia`; la revisión renderizada la ejecutó el owner manualmente y
queda como evidencia del criterio de revisión.

**Pivote del 2026-08-25.** El owner decidió que la aplicación no tendrá deployment
público y que los datos son de uso particular. La [ADR 0004](../architecture/adr/0004-personal-first-runtime.md)
reemplaza el eje `demo | personal` por `locked | personal` con fallo cerrado: no
existe una demo pública ni un conjunto de datos de reemplazo, y ningún slice futuro
invierte en datos ficticios como superficie de producto. Las fixtures quedan como
dobles de test. `F1-07` y `F1-08` se rescopearon al flujo personal.

**Pivote del 2026-09-04.** El owner declaró el objetivo real del producto: escribir
un ticker y obtener una valuación rigurosa según Damodaran, persistida y
refrescable, con una IA que decide lo cualitativo —tipo de empresa, riesgo,
exposición— que mueve parámetros como la tasa de descuento. Universo inicial: el
S&P 500. La [ADR 0007](../architecture/adr/0007-ticker-driven-valuation-pivot.md)
reordena las fases alrededor de ese resultado, fija la frontera «la IA propone, el
motor calcula», convierte la completitud de datos en nivel de rigor declarado y
degrada el gate de derechos de fuente a procedencia informativa. La
[ADR 0008](../architecture/adr/0008-remote-personal-access.md) habilita el acceso
personal remoto en producción, que el código hoy niega. Nada del alcance anterior se
elimina: screener, divergencias, macro argentina y soja bajan de prioridad
conservando sus criterios.

**Alcance del 2026-09-16.** El owner aclaró qué análisis quiere del portal
([ADR 0016](../architecture/adr/0016-analysis-scope-sector-matrices.md)):

- **Sin screener general.** El filtrado amplio lo hace con Finviz gratuito.
- **Valuaciones puntuales.** Son sobre las empresas que pide por ticker, y sus
  fundamentals se bajan al pedirlas.
- **Matrices por sector.**
  - La de riesgo compara el Sortino a 2 y a 5 años, con el S&P 500 de referencia y
    las empresas con CEDEAR distinguidas; usa sólo precios.
  - La de divergencias necesita pocos fundamentals por empresa del sector.

Cambios en el backlog:

- la Fase 7 pasa a ser la matriz de riesgo;
- `F6-05` pasa a ser la ingesta bajo demanda;
- `F8-01` se acota al sector;
- el backfill del universo deja de ser objetivo de producto;
- la Fase 7 se ejecuta después de la Fase 2 y antes de la Fase 3, por decisión
  del owner del mismo día: no depende del motor de valuación;
- el registro CEDEAR pasa a `F7-03`, y `F6-04` conserva la anotación de acceso en
  la valuación;
- la vista principal de divergencias es market cap contra EPS, con el sesgo de
  recompras a la vista.

Orden de ejecución de las fases: 2 → 7 → 3 → 4 → 5 → 6 → 8 → 9 → 10. Los IDs no
cambian.

Desde el 2026-10-02 la Fase 5 se ejecuta antes de la Fase 4
([ADR 0033](../architecture/adr/0033-ai-layer-industry-resolution.md)):
2 → 7 → 3 → 5 → 4 → 6 → 8 → 9 → 10.

`F1-08` queda `deferred` por ese pivote: mide la comprensión de una superficie
construida sobre una fixture sintética que deja de ser el producto. Condición de
reingreso: la medición se rehace en Fase 6 sobre la primera valuación de una empresa
real, con el mismo protocolo del
[runbook](../runbooks/owner-walkthrough.md), que sigue siendo válido.

## Issues por fase

### Fase 1 — vertical slice demo

<a id="f1-ui-01"></a>

#### `F1-UI-01` — Fundación shadcn y migración visual

Alcance: reemplazar la dirección “Mesa de calibración” por un workspace financiero
estándar y familiar. Incluye Base UI/shadcn, tokens semánticos, shell, home,
configuración, contratos de diseño y skill de revisión financiera. No incluye
datos, charts reales, rutas futuras ni controles que simulen capacidades.

Criterios de aceptación:

- `components.json` fija Base UI y CSS variables; los primitives viven en
  `src/components/ui/` y se agregan sólo cuando tienen uso real;
- sidebar, header, cards, estados y tabla de health usan patrones familiares y
  conservan foco, contraste, reflow y lectura sin color;
- home y configuración eliminan rail, hero editorial y geometría experimental;
- Recharts/shadcn queda como motor inicial y ECharts como escape medido, sin
  instalar una segunda librería sin evidencia;
- `financial-visualization-review` se valida y su mejora requiere evidencia,
  diff y autorización, sin autoescritura silenciosa ni red;
- documentación normativa, briefs y sidecar quedan alineados con el render;
- format, lint, typecheck, unit, build y revisión desktop/mobile pasan.

Controles: `TM-12`, `TM-13`, `UI-02`, `UI-03`, `UI-04`.

Evidencia (2026-08-23): `components.json`, `src/components/ui/`, `src/app/` y
`DESIGN.md` con su brief en `.impeccable/surfaces/`; `detect.mjs` sin findings;
capturas `.impeccable/review/desktop.png` y `mobile.png` regeneradas desde el
build de producción; medición 1440×900 y 390×844 en tema claro y oscuro sin
overflow horizontal, sin controles sin nombre accesible y sin targets menores a
24 px fuera del rail duplicado de la sidebar; la tabla de health expone región
desplazable enfocable sólo cuando desborda; format, lint, typecheck, 20 unit
tests y build pasan.

<a id="f1-01"></a>

#### `F1-01` — Shell, navegación y health

Alcance: extraer el shell compartido desde la home, habilitar navegación sólo hacia
superficies reales del slice y representar `ready | degraded | disabled | planned`
sin controles muertos.

Criterios de aceptación:

- existe un brief de superficie específico antes del cambio visual;
- desktop y mobile conservan jerarquía, foco visible, reflow y lectura sin color;
- la reducción de movimiento conserva feedback y no elimina todo cambio de estado;
- la escala tipográfica reusable queda registrada sin promover cada literal;
- los headers de seguridad base se definen y verifican antes de cualquier preview;
- la UI no abre DB personal ni realiza llamadas externas, ingestas o mutaciones;
- format, lint, typecheck, unit y build pasan.

Controles: `TM-01`, `TM-02`, `TM-04`, `TM-12`, `UI-02`, `UI-03`, `UI-04`.

#### `F1-02` — Persistencia y repositorios base

Criterios de aceptación:

- Drizzle y la migración inicial usan conexión pooled en runtime y directa sólo en
  el job de migración;
- fixture demo y PostgreSQL personal se seleccionan en composición server-only, no
  por un parámetro del browser;
- schemas preservan IDs estables, vigencia, `available_at` y valores faltantes;
- tests cruzados prueban que ningún modo lee el repositorio o cache del otro;
- rollback y comandos de migración quedan documentados.

Controles: `TM-01`, `TM-02`, `TM-04`, `TM-06`, `TM-07`.

#### `F1-03` — Source registry, ingestion runs y fake provider

Criterios de aceptación:

- los schemas Zod son la frontera runtime y el fake no importa framework ni SDK;
- la fixture es sintética, determinista, versionada y no deriva de payloads live;
- source registry e ingestion run conservan parser version, estado, counts, hash y
  error seguro;
- contract tests cubren happy path, vacío, parcial, schema inválido y replay;
- no existe acceso de red en tests ni render.

Controles: `TM-02`, `TM-05`, `TM-11`, `TM-15`, `TM-16`.

Evidencia (2026-08-23): `src/modules/ingestion/` con dominio puro
(`source-registry-entry`, `ingestion-run`, `staged-record`, `content-hash`,
`ingestion-failure`), puertos y orquestador en `application/`, y fixtures más fake
provider en `infrastructure/`; `src/server/db/schema.ts` agrega `source_registry`
—un derecho por columna con default `unknown`— e `ingestion_runs` append-only, con
migración `drizzle/0001_workable_lethal_legion.sql` y rollback pareado.

- `TM-15`: `evaluateIngestionRights` corre **antes** del provider; el spy de
  `fetchDataset` no se invoca para `sec-edgar`, que queda registrado como corrida
  `failed` con código `rights_not_approved`. Los checks
  `source_registry_rights_review_check` y `source_registry_public_display_check`
  espejan el gate en PostgreSQL.
- `TM-05`: respuesta vacía → `empty` y lote íntegramente inválido → `quarantined`;
  ninguno publica ni reemplaza el último lote válido. `rawValue` ausente conserva
  `rawValueStatus` y quality flags; un cero en lugar de un valor no publicado es
  rechazado por el schema.
- `TM-11`: `computeIdempotencyKey` es determinista sobre dataset, as-of, cursor y
  parser; el replay exacto no vuelve a contactar la fuente y el índice único
  parcial `ingestion_runs_publishable_idempotency_uidx` admite reintentos fallidos
  pero no dos corridas publicables por clave. Contenido idéntico bajo otra
  solicitud queda como `duplicate`.
- `TM-02`: `redactFailureMessage` borra credenciales de connection string, pares
  clave/valor sensibles y literales largos; los rechazos reportan sólo rutas de
  campo, nunca el valor recibido.
- `TM-16`: cada intento queda como fila append-only con parser version, estado,
  counts, hash, quality flags y error seguro.

Verificación: `format:check`, `lint`, `typecheck`, 96 unit tests, 7 integration
tests contra PostgreSQL 17.11 local y `build` pasan. `vi.spyOn(globalThis, "fetch")`
confirma que la ruta de ingesta no abre red.

#### `F1-04` — Empresa fixture point-in-time

Criterios de aceptación:

- entidad legal, security, listing, símbolo vigente y programa depositario no se
  colapsan;
- cada observación declara tiempo efectivo, conocimiento público, registro local,
  unidad, moneda, source y quality flags;
- consultas `as_known` excluyen revisiones posteriores;
- fixtures golden cubren ticker ambiguo, cambio de vigencia y restatement.

Controles: `TM-05`, `TM-06`, `TM-16`.

Evidencia (2026-08-24): `src/modules/temporal/domain/` con el envelope versionado,
los predicados de vigencia y conocimiento, el query point-in-time y los códigos de
error obligatorios; `src/modules/identity/` con los cinco niveles separados, la
resolución determinista y la fixture sintética de `FixtureCo`;
`src/modules/observations/` con la observación publicada, la cadena de revisión y
la publicación atómica; `observations` en `src/server/db/schema.ts` con la
migración `drizzle/0002_fresh_redwing.sql` y su rollback pareado.

- Identidad no colapsada: `resolveIdentity` devuelve `legalEntityId`,
  `securityId`, `listingId` y `depositaryProgramId` por separado. El CEDEAR
  `ARFIXTURE001` conserva su propio emisor, moneda y listing, y su programa
  vincula —sin fusionar— la security depositaria con la subyacente.
- Ticker ambiguo: `FIXA` sin MIC alcanza XNAS y XBUE y devuelve `ambiguous` con
  ambos candidatos. Con MIC resuelve, y en 2025 el mismo ticker pertenece a otro
  emisor: el símbolo nunca es la identidad.
- Cambio de vigencia: `FIXA → FXCO` es efectivo el 2024-06-01 y conocible desde el
  2024-05-10; una consulta con corte anterior al anuncio no lo resuelve. El ratio
  depositario anunciado el 2024-07-15 y efectivo el 2024-09-01 conserva 10:1 antes
  de esa fecha y 20:1 después, y una consulta anterior al anuncio devuelve la
  versión abierta previa.
- `TM-06`: el restatement del revenue FY2024 crea la revisión 2 y cierra la 1 con
  `superseded_at`; `as_known(2025-03-01)` devuelve `100000000`,
  `as_known(2025-06-01)` devuelve `96000000` y `latest_restated` se etiqueta como
  vista actual. `system_recorded` distingue lo público de lo registrado: con corte
  en 2025 no devuelve nada porque la instalación registró en 2026.
- `TM-05`: una corrida `quarantined` no publica ni reemplaza el último lote válido
  —`publishObservations` la rechaza antes de tocar el repositorio— y el check
  `observations_raw_value_status_check` rechaza un cero en lugar de un valor no
  publicado. `capital_expenditure` conserva `not_provided` y
  `shares_outstanding` conserva `license_restricted`.
- `TM-16`: cada observación conserva `as_of`, período, unidad, moneda,
  `available_at`, `superseded_at`, `fetched_at`, `recorded_at`, source, dataset,
  parser version, documento, content hash, quality flags e `ingestion_run_id` con
  foreign key a la corrida. El vintage solicitado entra en la clave de
  idempotencia para que una enmienda no se confunda con un replay.

Verificación: `format:check`, `lint`, `typecheck`, 167 unit tests, 16 integration
tests contra PostgreSQL 17.11 local y `build` pasan. `vi.spyOn(globalThis, "fetch")`
confirma que publicar una observación no abre red.

Diferido con motivo: persistir el grafo de identidad y sus corporate actions
corresponde a `F2-02`; el constraint de exclusión temporal por rango exige la
extensión `btree_gist` y por lo tanto un ADR propio, así que hoy el no solapamiento
se prueba en dominio y en PostgreSQL sólo se impide el caso peligroso de dos
revisiones vigentes simultáneas.

#### `F1-05` — FCFF demo determinista

Criterios de aceptación:

- la política decimal y la serialización canónica producen el mismo hash y resultado;
- NOPAT, reinversión, descuento, terminal y puente EV-equity viven en dominio puro;
- checks rechazan no finitos, shares no positivas y `WACC <= g + buffer`;
- tests incluyen `null`, cero, negativos, mismatch de moneda y sensibilidad;
- recalcular no usa red ni IA.

Controles: `TM-06`, `TM-16`.

Evidencia (2026-08-24): `src/modules/valuation/domain/` con la política decimal,
el snapshot de entrada, el motor FCFF, los policy checks, la sensibilidad y la
corrida persistible; `src/modules/valuation/application/` con el orquestador y el
puerto de repositorio; `src/modules/valuation/infrastructure/` con el snapshot
sintético de `FixtureCo` y el repositorio demo en memoria; `valuation_runs` en
`src/server/db/schema.ts` con la migración `drizzle/0003_typical_maximus.sql` y su
rollback pareado; `docs/architecture/adr/0003-decimal-arithmetic-valuation-engine.md`
como gate de la dependencia `decimal.js`.

- Política decimal: `decimal.js` clonado con `precision=34` y `ROUND_HALF_EVEN`,
  importado sólo desde `decimal-policy.ts`. `0.1 + 0.2` da exactamente `0.3`, los
  empates rompen al dígito par, `toFixed()` nunca emite notación exponencial y el
  cero no conserva signo. `100,000,000`, `1e5` y `NaN` son `invalid_decimal`.
- Hash reproducible: el mismo snapshot canónico produce
  `input_hash = fb0277d0…8c25` y `result_hash = b0c831f0…4169` bajo otro
  `valuation_run_id`; reordenar las claves del snapshot no cambia el hash y
  cambiar un supuesto sí. `valuePerShare = 13.54613115387460161790309586190624`.
- Dominio puro: NOPAT, reinversión por sales-to-capital o `growth / ROIC`, factor
  de descuento acumulado, terminal y puente EV-equity viven en `domain/` sin
  importar React, Next.js, Drizzle ni un SDK. Mezclar convenciones sin puente
  declarado es un rechazo.
- Checks en modo `reject`: no finitos y división por cero
  (`salesToCapital = 0`, ROIC terminal `0`), acciones diluidas no positivas,
  `WACC <= g + 0.005`, moneda distinta a la de la valuación, claim `missing`,
  `1 + wacc <= 0` y reinversión terminal fuera de `[0, 1]`. En modo
  `require_review`: tax rate fuera de `[0, 0.5]`, margen terminal fuera de
  `[0, 0.6]`, terminal por encima de `0.85` del EV y equity value no positivo.
- `TM-05`: una claim faltante nunca vale cero. `declared_absent` vale cero **con
  motivo registrado** y `missing` bloquea la corrida; `computeFcff` vuelve a
  fallar si un `missing` llega hasta él.
- `TM-06`: la corrida hereda el contrato point-in-time. El mismo modelo con corte
  `as_known(2025-03-01)` usa revenue `100000000` y da
  `14.170553285286043351982391522819`; con corte `as_known(2025-06-01)` usa el
  revenue enmendado `96000000`. Son dos corridas con dos hashes, no un recálculo.
- `TM-16`: `valuation_runs` es append-only con snapshot, resultado, política
  decimal, versiones, provenance y error seguro. Una corrida rechazada también se
  persiste. El índice único `valuation_runs_replay_uidx` hace que un replay exacto
  devuelva la corrida existente en vez de duplicarla, y los checks
  `valuation_runs_outcome_check` y `valuation_runs_hash_check` quedan verificados
  en PostgreSQL.
- Sensibilidad: grilla WACC × `g` de 5 × 5 con unidad, rango y step declarados;
  las dos celdas donde `WACC <= g + buffer` quedan `rejected` con su motivo en vez
  de vaciarse. El caso base es exactamente la celda `(0.09, 0.02)`, el valor cae
  al subir el WACC y sube al subir `g`.

Verificación: `format:check`, `lint`, `typecheck`, 252 unit tests, 24 integration
tests contra PostgreSQL 17.11 local y `build` pasan. `vi.spyOn(globalThis, "fetch")`
confirma que calcular, persistir y replayar una valuación no abre red, y el
orquestador recibe reloj e ID por inyección en vez de leerlos.

Diferido con motivo: escenarios bear/base/bull como conjuntos coherentes de
supuestos, normalización reported/adjusted, selector automático de método y WACC
que converge entre etapas corresponden a Fase 4 (`F4-01` a `F4-03`). La superficie
que muestre este resultado corresponde a `F1-06`.

#### `F1-06` — Resultado y trazabilidad de una corrida

Criterios de aceptación:

- fuentes, `as_of`, `available_at`, freshness, calidad y transformaciones son visibles;
- supuestos y bear/base/bull se distinguen de hechos reportados;
- sensitivity cuenta con equivalente tabular y estados faltantes honestos;
- la ruta no presenta recomendación, datos live ni persistencia personal simulada;
- revisión desktop/mobile y accesibilidad queda registrada.

Controles: `TM-02`, `TM-12`, `TM-15`, `UI-02`, `UI-03`, `UI-04`.

Evidencia (2026-08-25): la ruta `/valuacion/demo` en `src/app/valuacion/demo/` con
su brief en `.impeccable/surfaces/src-app-valuacion-demo-page-tsx.md`; el dominio
puro `src/modules/valuation/domain/display-format.ts` —formato `es-AR`
determinista sin `Intl`, para que el mismo número salga igual del servidor y del
navegador— y `valuation-report.ts` —freshness versionada, evidencia, ausencias,
transformaciones aplicadas y sensibilidad anotada—;
`src/modules/valuation/infrastructure/demo-valuation-run.ts` con reloj e
identificador inyectados; `toFixedScale` en `decimal-policy.ts` como única
serialización de presentación. `DESIGN.md` registra las data marks y la
sensitivity matrix; `docs/design/interface-foundations.md` registra la extensión.

- Provenance visible: cada hecho muestra valor, unidad, moneda, cierre,
  `available_at`, antigüedad, `source_id`, documento y quality flags. El revenue
  base expone `restated_by_source`, y las acciones diluidas viajan sin moneda en
  vez de recibir una inventada.
- Freshness: `classifyFreshness` es una convención de lectura versionada
  (`valuation-freshness-1.0.0`, umbrales 180 y 365 días) y no un juicio de calidad
  de la fuente. Los bordes se prueban: 180 días es `current`, 181 es `aging`, 365
  sigue `aging` y 366 es `stale`; un hecho fechado después de la valuación es
  `posterior` en vez de “vigente”. En la corrida demo el revenue FY2024 aparece
  `Envejecido` a 181 días y las acciones diluidas `Vigente` a 0 días.
- `TM-05`: hechos reportados, supuestos y ausencias declaradas llevan marcas
  distintas y no comparten tabla. Las tres ausencias se muestran con su motivo
  registrado, nunca como una fila de valor cero, y el test verifica que ninguna
  fila de hechos vale `0`.
- `TM-06`: la card “El mismo modelo bajo otro corte de conocimiento” muestra que
  `as_known(2025-03-01)` da `14,17` y `as_known(2025-06-01)` da `13,55`, con dos
  `result_hash` distintos. Son dos corridas, no una corrección de la primera.
- Escenarios: bear/base/bull se declaran `planned` con su fase, y la superficie
  explica que la grilla es una sensibilidad mecánica, no una distribución de
  probabilidad. No se fabrica un escenario que el motor no calcula.
- Sensibilidad accesible: tabla semántica con `caption` que declara unidad,
  moneda, rango y paso de ambos ejes; `th scope="col"` y `th scope="row"` asocian
  cada celda; cada celda lleva su importe escrito más una lectura `sr-only`
  completa. Las 2 celdas donde `WACC <= g + buffer` muestran `No definido` con su
  motivo. La celda base se marca sólo cuando el WACC del snapshot es plano; con un
  WACC que varía no se marca ninguna y la página lo dice.
- `UI-03`: el tinte de la grilla ordena las celdas de menor a mayor y nunca es el
  único canal. La rampa se asigna por posición en el orden y no por rango lineal,
  porque una perpetuidad con denominador cerca de cero produce `105,05` en una
  esquina y aplastaría el resto de la grilla contra un solo color; con rangos la
  distribución medida en el HTML es `10 / 8 / 10 / 8 / 10`.
- `TM-02` y `TM-12`: la página no expone valores de configuración ni secretos; el
  motivo de un rechazo muestra código y rutas de campo, nunca el valor recibido.
- `TM-15`: la fixture es sintética y se declara como tal en la alerta de alcance,
  en el badge `Demo` de la sidebar y en la card de límites. No hay recomendación,
  precio objetivo ni comparación contra un precio de mercado.
- Aislamiento: el render calcula la corrida en el proceso desde la fixture, sin
  repositorio, red ni persistencia, así que su contenido es idéntico en demo y en
  personal y no simula una persistencia personal. `build` lo confirma al
  prerenderizar la ruta como estática.

Verificación: `format:check`, `lint`, `typecheck`, 282 unit tests, 24 integration
tests contra PostgreSQL 17.11 y `build` pasan. El detector de Impeccable devuelve
`[]` sobre la página, sus componentes, la sidebar y la home. El contraste de la
rampa y de los textos sobre celda teñida se calculó en oklab sobre los tokens de
ambos temas: peor caso `4.68:1` para el delta y `4.77:1` para la etiqueta del caso
base, sobre un floor de `4.5:1`. Sobre el HTML prerenderizado se verificó un solo
`h1`, 10 `h2` y 8 `h3` sin salto de nivel, 7 tablas con 42 `th scope="col"` y 38
`th scope="row"`, 18 `<time datetime>` y 72 alternativas `sr-only`.

Revisión renderizada: la ejecutó el owner manualmente el 2026-08-25 sobre la ruta
servida y no reportó hallazgos. No se automatizó ni se capturaron screenshots: no
hay navegador disponible en la sesión del agente y los scripts `live` de Impeccable
no están aprobados por `AGENTS.md`. Automatizarla es criterio de `F1-07` y sigue
siendo el follow-up de `UI-02`.

Renombrado el 2026-08-25: la ruta pasó de `/valuacion/demo` a
`/valuacion/referencia` y dejó de presentarse como demo del producto
([ADR 0004](../architecture/adr/0004-personal-first-runtime.md)). Los paths de esta
evidencia siguen esa ruta.

#### `F1-07` — Gate automatizado del flujo personal

Rescopeado el 2026-08-25 por la [ADR 0004](../architecture/adr/0004-personal-first-runtime.md):
lo que se prueba ya no es el aislamiento entre dos modos con datos, sino que el
runtime trabado no sirve nada y que el runtime personal sirve su superficie.

Criterios de aceptación:

- unit y contract tests corren sin red;
- un E2E recorre shell, corrida de referencia y runtime trabado, y verifica que el
  estado trabado no expone datos ni nombres de valores de configuración;
- se prueban invocación directa de fronteras existentes, fallo cerrado de la
  composición y no exposición de secretos;
- teclado, foco, mobile, reduced motion y chequeo automatizado de accesibilidad
  generan evidencia reproducible, incluida la revisión renderizada que `F1-06`
  dejó como follow-up de `UI-02`;
- los scripts `test:integration` o `test:e2e` sólo se anuncian si existen.

Controles: `TM-01`, `TM-02`, `TM-03`, `TM-04`, `TM-07`, `TM-12`, `UI-02`.

Evidencia (2026-08-26): [ADR 0005](../architecture/adr/0005-request-time-runtime-boundary.md)
y [ADR 0006](../architecture/adr/0006-e2e-accessibility-harness.md);
`playwright.config.ts`, `scripts/run-e2e.ts`, `tests/e2e/` con soporte y specs,
`tests/setup/no-network.ts` y su test, `src/server/persistence/runtime-composition.test.ts`,
`src/server/config/app-environment.ts`, `src/app/not-found.tsx`, el job `e2e` en
`.github/workflows/quality.yml` y
[el runbook del gate](../runbooks/e2e-accessibility-gate.md).

- **Frontera medida sobre el artefacto, no sobre el código.** Al preparar el gate se
  encontró que el modo efectivo se horneaba en `next build`: `index.html`
  prerenderizado decía `personal` y `valuacion/referencia.html` contenía la corrida
  completa, con lo cual el artefacto servía datos sin importar el entorno del
  runtime. La ADR 0005 mueve la resolución al request (`connection()` en
  `getRequestConfigHealth()` más `instant = false` por ruta) y las cuatro rutas pasan
  a `ƒ (Dynamic)`; los `.html` prerenderizados quedan en 0 bytes.
- `TM-01` y `TM-04`: **un mismo build** se sirve en dos puertos con dos entornos. El
  personal muestra la corrida; el trabado devuelve la negativa y su HTML no contiene
  `FixtureCo`, `13,55`, el valor exacto, ninguno de los dos hashes, ni las secciones
  de sensibilidad o evidencia —tampoco en el payload RSC—.
- `TM-01` y `TM-04` en composición: los cinco selectores de
  `src/server/persistence/` se prueban contra seis entornos trabados —sin declarar,
  `locked` explícito, `personal` sin acceso privado, sin pooled URL, `local` dentro
  de Vercel y producción de Vercel que dice estar protegida— y en los treinta casos
  lanzan `RuntimeLockedError` **sin** llegar a pedir la base. `getRuntimeDatabase` es
  un espía porque el driver es perezoso: lo que importa es si la composición pidió la
  conexión, no si el socket llegó a abrirse.
- `TM-02`: cada variable declarada en `.env.example` recibe un centinela único. No
  aparece ninguno en el health serializado bajo tres combinaciones de modo, ni en el
  body, los headers o el payload RSC de las cuatro rutas en ambos servidores. El
  nombre de lo que falta sí se muestra —`DATABASE_URL` en el runtime trabado—, que
  es lo accionable.
- `TM-03`: todavía no existe ninguna Route Handler ni Server Action. Las fronteras
  que hoy existen son las raíces de composición y quedan probadas arriba; el control
  sigue `contracted` para el primer endpoint real.
- Sin red, por construcción: `tests/setup/no-network.ts` hace fallar `fetch`,
  `http`, `https` y un socket TCP directo en toda la suite unitaria, con su propio
  test para que el guard no pueda dejar de funcionar en silencio. El guard lanza
  sincrónicamente a propósito: un `fetch(...).catch(() => porDefecto)` se tragaría
  una promesa rechazada y el test seguiría en verde. El E2E fija
  `NEXT_TELEMETRY_DISABLED=1` en el build y en los dos servidores.
- "Esta página no abre PostgreSQL" pasa de afirmación a aserción: el servidor
  personal recibe una `DATABASE_URL` que apunta a un puerto donde no escucha nada,
  así que una ruta que empezara a consultar la base rompería el gate.
- `UI-02` cerrado: 131 tests de Playwright en 6 proyectos —escritorio 1440×900 claro
  y oscuro, 390×844 y `prefers-reduced-motion`—, `axe-core` sin findings `serious` ni
  `critical` en las 4 rutas de ambos modos, y capturas regeneradas en
  `.impeccable/review/`. Detalle y hallazgos en
  [interface foundations](../design/interface-foundations.md).
- Tres defectos reales que la revisión manual de `F1-06` no había visto se
  corrigieron en este slice: la cifra de antigüedad de una data mark bajaba de 4.5:1
  por `opacity-80`; las herramientas planificadas perdían su `disabled` dentro del
  `TooltipTrigger` de Base UI y se anunciaban como accionables; y en mobile el
  tooltip capturaba `Escape`, así que el drawer no se cerraba por teclado. Un cuarto
  ajuste sacó del árbol de accesibilidad al rail de la sidebar, que duplicaba el
  nombre del trigger.
- `src/app/not-found.tsx` existe porque `/_not-found` hereda el layout dinámico y
  porque la 404 por defecto de Next.js deja al owner sin navegación. Comparte forma
  con la negativa del runtime trabado.

Verificación: `format:check`, `lint`, `typecheck`, 338 unit tests, 24 integration
tests contra PostgreSQL `17.11`, `build` y 131 tests E2E pasan. El detector de
Impeccable devuelve `[]` sobre la UI modificada.

Diferido con motivo: cobertura en Firefox y WebKit y los presupuestos de performance
corresponden a `F10-06`; el harness usa un solo motor por decisión registrada en la
ADR 0006. No se adoptan snapshots de imagen como aserción: producirían fallos por
diferencias de renderizado de fuentes entre máquinas sin expresar ningún contrato del
producto.

#### `F1-08` — Walkthrough y cierre de Fase 1

Criterios de aceptación:

- el owner completa una tarea desktop y una mobile desde una sesión limpia sobre el
  runtime personal, y confirma que un entorno sin declarar queda trabado;
- tiempo, bloqueos, confusiones y hallazgos quedan anexados como evidencia;
- los hallazgos se convierten en issues o se difieren con motivo;
- el gate de Fase 1 y el próximo slice quedan actualizados sin iniciar Fase 2.

Controles: `UI-02`.

Harness y protocolo (2026-09-03): `scripts/run-walkthrough.ts` con el script
`pnpm walkthrough`, [el runbook del walkthrough](../runbooks/owner-walkthrough.md)
y [la plantilla de registro](../walkthroughs/TEMPLATE.md).

- El slice no se automatiza: lo que falta medir —tiempo hasta la respuesta, dónde
  duda el owner, qué término no se entiende— no lo produce un test. Lo que sí se
  hace reproducible es la **sesión**, para que dos corridas del walkthrough se
  puedan comparar y para que el resultado no dependa de cómo estaba configurada la
  máquina ese día.
- Un solo build servido en dos puertos, igual que el gate: `3120` con el
  `.env.local` real del owner y `3121` con modo, acceso y `DATABASE_URL` vaciados.
  A diferencia del gate, el servidor personal **no** se fabrica con centinelas ni
  con una base inalcanzable: la sesión tiene que correr sobre el runtime que el
  owner realmente tiene, y si ese entorno no alcanza para `personal`, eso ya es el
  primer hallazgo.
- Los dos servidores escuchan sólo en `127.0.0.1`. La tarea mobile se hace con
  emulación a 390×844 en vez de exponer a la red local un runtime que sirve datos
  reales, que es exactamente lo que la ADR 0004 evita. El límite queda declarado:
  la emulación no reproduce teclado virtual, gesto de volver ni rendimiento del
  dispositivo, y eso corresponde a `F10-06`.
- El entorno "sin declarar" vacía las variables en lugar de borrarlas del archivo
  del owner; una variable declarada vacía recorre la misma rama de fallo cerrado.
  El caso verdaderamente ausente ya está cubierto por
  `src/server/persistence/runtime-composition.test.ts`.

Verificación (2026-09-03): `format:check`, `lint` y `typecheck` pasan.
`getConfigHealth` recibiendo el entorno exacto que arma el script para el
servidor sin declarar —partiendo del peor caso, un shell que ya exporta
`APP_MODE=personal`, `APP_RUNTIME_ACCESS=local` y una `DATABASE_URL` con
credenciales— devuelve `mode = locked`, `servesRealData = false`, el mensaje
"El runtime no pudo probar que es privado" y `missingVariables = [APP_MODE,
APP_RUNTIME_ACCESS]`: nombra lo que falta sin exponer ningún valor (`TM-02`).

Verificación en Arch Linux (2026-09-04): el checkout nativo desbloqueó lo que
faltaba correr. `format:check`, `lint`, `typecheck`, 338 unit tests, 24 integration
tests contra PostgreSQL local, `build` con las cuatro rutas en `ƒ (Dynamic)` y 131
tests E2E pasan, reproduciendo exactamente los números registrados en `F1-07`. El
harness levanta ambos servidores: `3120` sirve la corrida y `3121` la niega sin
filtrar el sujeto, el valor ni las secciones de datos.

`deferred` desde el 2026-09-04 por la
[ADR 0007](../architecture/adr/0007-ticker-driven-valuation-pivot.md). Lo único que
quedaba era la sesión cronometrada del owner, y esa sesión mediría la comprensión de
una superficie construida sobre `FixtureCo`, que el pivote saca del producto. La
parte mecánica de las tres tareas ya está cubierta por los 131 tests de `F1-07`; lo
que la sesión aportaba —tiempo hasta la respuesta, dónde duda el owner, qué término
no se entiende— tiene valor sobre una empresa real, no sobre una fixture.

Condición de reingreso: `F6-06` ejecuta el mismo protocolo del
[runbook](../runbooks/owner-walkthrough.md) sobre la primera valuación real. El
harness `pnpm walkthrough`, la plantilla y el runbook se conservan sin cambios.

### Fase 2 — datos reales SEC y universo S&P 500

Los IDs `F2-*` a `F9-*` se reasignaron el 2026-09-04 al nuevo orden de fases de la
[ADR 0007](../architecture/adr/0007-ticker-driven-valuation-pivot.md). Los IDs
`F1-*` conservan su significado y su evidencia.

<a id="f2-01"></a>

#### `F2-01` — Acceso personal remoto en producción

- Estado: `done` (2026-09-04)
- Fase y dependencia: Fase 2; habilitado por la [ADR 0008](../architecture/adr/0008-remote-personal-access.md)
- Alcance incluido: eliminar la rama `isProtectedPreview` de `getConfigHealth()`;
  invertir a propósito los tests que hoy afirman que producción de Vercel queda
  trabada; documentar en el runbook que Deployment Protection se activa **antes** de
  declarar `protected`.
- Fuera de alcance: contratar la base hosteada, desplegar, autenticación de
  aplicación.

Criterios de aceptación:

- `personal` resuelve en Vercel producción con `APP_RUNTIME_ACCESS=protected` más
  `DATABASE_URL` pooled;
- producción **sin** acceso declarado, y `public` en cualquier entorno, siguen
  trabados; los cinco selectores de `src/server/persistence/` siguen lanzando
  `RuntimeLockedError` en esos casos;
- `runtime-composition.test.ts` y `config-health.test.ts` expresan el cambio de
  sentido de forma explícita, no por omisión;
- el E2E sigue probando que un mismo artefacto sirve o niega según su entorno;
- ningún valor de configuración aparece en el health serializado (`TM-02`).

Controles: `TM-01`, `TM-02`, `TM-04`, `TM-14`.

Este slice fue primero porque era la única pieza del pivote que ya estaba bloqueando
algo concreto: el owner no podía llegar a la aplicación desde fuera de su máquina.

Evidencia (2026-09-04): `src/modules/configuration/domain/config-health.ts` pierde la
rama `isProtectedPreview`; `protected` deja de estar acoplado a Vercel y nombra la
propiedad —la URL está detrás de la protección de la plataforma— en vez del
proveedor. `local` dentro de una plataforma de hosting sigue siendo un rechazo.

- Inversión explícita, no por omisión: el test que afirmaba que producción quedaba
  trabada «aunque declare protección» ahora afirma que sirve, con el motivo del
  cambio escrito al lado. Se sumaron los dos casos que sostienen la frontera:
  producción **sin** acceso declarado sigue trabada, y `protected` fuera de Vercel
  resuelve `personal`.
- `runtime-composition.test.ts` cambia el entorno trabado «una producción de Vercel
  que dice estar protegida» por «una producción de Vercel sin acceso declarado», y
  suma un caso positivo: los cinco selectores construyen sobre PostgreSQL en una
  producción con protección declarada. 45 → 50 tests.
- `TM-02`: el health sigue nombrando la variable que falta —`APP_RUNTIME_ACCESS` en
  la producción sin declarar— y nunca su valor.
- El hecho que motivaba la regla eliminada no desaparece y quedó registrado donde se
  declara la variable: en Vercel Hobby, Standard Protection no cubre el dominio de
  producción. `.env.example`, el README, el doc de despliegue y la ADR 0008 dicen que
  la protección se confirma **antes** de declarar `protected`.

Verificación: `format:check`, `lint`, `typecheck`, 345 unit tests (338 + 7), `build`
con las cuatro rutas en `ƒ (Dynamic)` y 131 tests E2E pasan. El gate E2E sigue
probando sobre el artefacto servido que el runtime trabado no filtra datos.

<a id="f2-02"></a>

#### `F2-02` — Universo con identidad completa

- Estado: `done` (2026-09-05; motor y persistencia el 2026-09-04, universo real el 2026-09-05)
- Fase y dependencia: Fase 2; `F2-01`
- Alcance incluido: persistir el grafo de identidad que `F1-04` dejó diferido;
  regla determinista que constituye un universo a partir de una lista de
  constituyentes y de las asignaciones autoritativas ticker→CIK; membresía de
  índice versionada.
- Fuera de alcance: egress real, corporate actions con vigencia (`F2-04`),
  clasificación de industria (`F3-05`), programas depositarios (`F6-04`).

Criterios de aceptación:

- issuer, security, listing, símbolo vigente y CIK quedan separados y el CIK
  cuelga de la entidad legal;
- constituir dos veces el mismo universo no duplica identidades;
- un renombre y una salida del índice se historizan sin reescribir la fila
  anterior;
- lo que las fuentes no alcanzan a decidir queda rechazado y nombrado, no
  adivinado;
- el universo del S&P 500 real queda constituido y consultable por ticker.

Controles: `TM-06`, `TM-16`.

Entregado (2026-09-04): `src/modules/universe/` con el dominio
(`index-membership`, `universe-source-records`, `venue-map`,
`resolve-constituents`, `plan-universe-constitution`), el puerto y el orquestador
en `application/`, y el corpus sintético más el doble en memoria en
`infrastructure/`; las ocho tablas del grafo de identidad en
[`src/server/db/schema.ts`](../../src/server/db/schema.ts) con la migración
`drizzle/0004_common_proteus.sql` y su rollback pareado;
`src/server/db/postgres-universe-repository.ts` y
`src/server/persistence/get-universe-repository.ts`.

- Identidad no colapsada: tres emisores producen cuatro instrumentos. Dos clases
  del mismo CIK son dos securities con el mismo `issuer_legal_entity_id`, y el
  CIK se persiste como una única `identifier_assignment` de `subject_type =
legal_entity`. Un ticker sólo alcanza al listing.
- Registro y versiones separados por nivel: la foreign key apunta a la identidad,
  que es inmutable, y no a una fila que cambia con cada renombre. La clave
  primaria de cada versión es `(id, valid_from)`.
- `TM-06`: repetir la constitución no escribe una fila más —los seis contadores
  quedan en cero y el conteo de tablas no cambia—. Un renombre abre una versión y
  cierra la anterior en el mismo instante, y la fila histórica conserva su nombre.
  Una salida del índice cierra la membresía sin borrarla y **sin** deslistar el
  instrumento. Un snapshot que no es posterior a la versión vigente se rechaza
  como `stale_effective_date` en vez de crear un intervalo vacío.
- `TM-05`: un lote sin miembros resueltos no se aplica. La lista descargada rota
  resolvería cero constituyentes y el rebalanceo "vaciaría" el índice cerrando
  cada membresía vigente; el orquestador corta antes.
- Lo irresuelto se nombra: `issuer_not_assigned`, `ambiguous_issuer`,
  `ambiguous_venue`, `missing_exchange`, `unmapped_venue`,
  `duplicate_claim_symbol`, `issuer_conflict` y `unresolved_share_class`. El
  último es deliberado: con estas dos fuentes no se puede distinguir un cambio de
  ticker de una clase nueva, y esa evidencia llega en `F2-04`.
- Convención de separadores `constituent-match-1.0.0`: `BRK.B` y `BRK-B` son el
  mismo ticker escrito por dos fuentes distintas. El match relajado es un segundo
  intento, sólo se acepta si es unívoco, se declara en el resultado y conserva las
  dos formas originales. Se persiste la de la fuente autoritativa.
- Invariantes espejadas en PostgreSQL y verificadas: una sola versión abierta por
  sujeto (`legal_entity_versions_open_uidx`), un identificador autoritativo que no
  puede quedar abierto para dos sujetos
  (`identifier_assignments_authoritative_uidx`) y el hash de contenido obligatorio
  (`index_memberships_content_hash_check`).
- `TM-16`: cada versión conserva `valid_from`, `valid_to`, `available_at`,
  `superseded_at`, `source_id`, `source_document_id`, `content_hash` y
  `recorded_at`. El hash cubre el contenido y **no** el instante de registro, así
  que la misma versión escrita en otra corrida hashea igual.

Verificación: `format:check`, `lint`, `typecheck`, 380 unit tests (345 + 35), 31
integration tests contra PostgreSQL 17.11 local (24 + 7) y `build` con las cuatro
rutas en `ƒ (Dynamic)` pasan. La composición del universo se suma a
`runtime-composition.test.ts`: son seis selectores en vez de cinco, y el nuevo
lanza `RuntimeLockedError` en los seis entornos trabados sin pedir la base.

Diferido con motivo: los parsers de los formatos de cable —CSV del paquete PDDL y
el JSON de `company_tickers_exchange`— llegan con el provider en `F2-03`.
Escribirlos hoy sería fijar una forma de archivo que este slice no puede verificar
contra un payload real, y el contrato que sí se puede fijar sin red es el de los
dos registros de dominio.

Falta para cerrar: constituir el universo real. Necesita el primer egress del
proyecto y por lo tanto los controles de `TM-08`, que se cierran en `F2-03` junto
al provider de la SEC. El owner decidió el 2026-09-04 no adelantarlos acá para no
cerrar el control a medias sobre dos archivos estáticos.

Cierre (2026-09-05): con la base de egress y los parsers de `F2-03`, el universo real
quedó constituido sobre PostgreSQL personal. Evidencia:

- **503 miembros, cero rechazos.** El plan aplicó 500 entidades legales, 503
  securities, 503 listings, 503 símbolos, 500 asignaciones de CIK y 503 membresías,
  con 0 cierres.
- **La identidad no se colapsa, y el número lo prueba:** 500 emisores producen 503
  instrumentos. Los tres de más son Alphabet (`GOOG`, `GOOGL`), Fox (`FOX`, `FOXA`) y
  News Corp (`NWS`, `NWSA`): dos securities bajo un mismo `issuer_legal_entity_id`, con
  una sola asignación de CIK colgando de la entidad legal y no del instrumento.
- **Idempotencia verificada sobre la base real:** la segunda corrida del mismo pin deja
  los siete contadores en cero y no agrega una fila.
- **Consultable por ticker:** `AAPL → Apple Inc. / XNAS / 0000320193`,
  `BRK-B → BERKSHIRE HATHAWAY INC / XNYS / 0001067983`,
  `GOOG` y `GOOGL → Alphabet Inc. / XNAS / 0001652044`. El CIK se persiste normalizado a
  diez dígitos y el símbolo en la forma de la fuente autoritativa, no en la de la lista.
- El corte del índice es el commit del paquete, no el instante de la corrida: dos
  corridas del mismo pin describen el mismo estado del índice.

<a id="f2-03"></a>

#### `F2-03` — SEC EDGAR integrada

- Estado: `done` (2026-09-14; base de egress y parsers del universo el 2026-09-05,
  provider XBRL el 2026-09-14)
- Fase y dependencia: Fase 2; `F2-02`
- Alcance incluido: la primera salida a red del proyecto y sus controles `TM-08`;
  el adaptador de la SEC con `available_at` del filing, vintages y restatements
  preservados; cuarentena ante schema roto; los parsers de los dos formatos de
  cable que `F2-02` dejó diferidos.
- Fuera de alcance: backfill durable con cursor y lease (`F2-05`), corporate
  actions (`F2-04`), golden fixtures congeladas (`F2-06`).

Criterios de aceptación:

- ninguna salida acepta una URL arbitraria: el destino se autoriza contra la
  allowlist de una fuente, por host y prefijo de path;
- un nombre aprobado que resuelve a loopback, red privada o metadata no abre el
  socket, y la validación es la misma resolución que usa la conexión;
- cada redirect vuelve a autorizarse completo y la cadena tiene techo;
- un runtime trabado no genera tráfico ni resuelve un nombre;
- la SEC recibe una identificación con contacto real o no se la contacta;
- `available_at` del filing, vintages y restatements se preservan y un schema roto
  se cuarentena sin reemplazar el último lote válido.

Controles: `TM-05`, `TM-06`, `TM-08`.

Entregado (2026-09-05) — base de egress: `src/server/egress/` con la política pura
(`ip-address-policy`, `egress-policy`, `egress-allowlist`, `egress-user-agent`), el
guard de resolución (`guarded-lookup`), el transporte (`https-transport`), el
orquestador (`fetch-approved-resource`) y la raíz de composición
(`get-egress-client`), más la [ADR 0009](../architecture/adr/0009-egress-boundary.md).

- Estructural, no por convención: no existe una función que acepte una URL sola. La
  allowlist empareja host con prefijos de path, así que `/submissions/` en
  `www.sec.gov` y `/files/…` en `data.sec.gov` se rechazan aunque los dos hosts
  estén aprobados.
- Dos controles que no se cubren entre sí: `sec-edgar` es alcanzable y **no** es
  ingerible. Su rights row sigue en `rights_review_pending`, y un test lo afirma
  para que aprobar una cosa no apruebe la otra por descuido.
- `TM-08` sobre rebinding: la comprobación **es** la resolución. El `lookup`
  validado se le pasa a `https.request`, así que no queda una segunda resolución sin
  vigilar. Se usa `node:https` y no `fetch` justamente porque `fetch` no expone ese
  hook, y el agente es propio con `keepAlive: false` porque una conexión reusada no
  vuelve a resolver el nombre.
- Una dirección no pública rechaza la conexión entera en vez de filtrarse: un host
  aprobado que empezó a resolver a `127.0.0.1` dejó de ser el que se aprobó.
- Las formas heredadas de IPv4 se rechazan en vez de interpretarse —`0177.0.0.1`,
  `2130706433`, `0x7f.0.0.1`—, y los tres prefijos IPv6 que embeben una IPv4 real
  —mapped, NAT64 y 6to4— se clasifican por la dirección embebida.
- El presupuesto de tiempo es uno para la operación completa: un timeout por salto
  dejaría que una cadena de redirects lo multiplique.
- `TM-02`: el error nombra un código cerrado y el destino sin query; la
  identificación rechazada se reporta por su problema y nunca por su valor.
- `TM-01`: `getEgressClient()` lanza `RuntimeLockedError` en los seis entornos
  trabados, antes de construir el transporte.

Verificación: `format:check`, `lint`, `typecheck`, 488 unit tests (380 + 108),
`build` con las cuatro rutas en `ƒ (Dynamic)` y 131 tests E2E pasan. El guard de red
de la suite unitaria **no** se relajó: la política se prueba con un resolver y un
transporte inyectados y ningún test abre un socket.

Verificación fuera de la suite, contra el DNS real del host: `localtest.me` —un
nombre del DNS público que resuelve a `127.0.0.1`— se rechaza como
`address_not_publicly_routable` nombrando `loopback`; `www.sec.gov` y `data.sec.gov`
aprueban sus tres direcciones cada uno; un nombre inexistente cae en
`address_unresolvable`. Es la mitad del control que no se puede probar con un
resolver inyectado: que la clasificación se comporte igual sobre respuestas reales.

Primer egress real del proyecto (2026-09-05): `GET`
`https://www.sec.gov/files/company_tickers_exchange.json` devuelve `200`,
`application/json`, 522.452 bytes en un solo salto y sin redirect. En la misma
corrida, los tres destinos vecinos cortan **antes** del socket: otro path del mismo
host (`path_not_allowlisted`), otro host (`host_not_allowlisted`) y un nombre que
resuelve a loopback (`host_not_allowlisted`, porque la allowlist corre antes que la
resolución, que es el orden correcto).

Contrato de cable confirmado, sin conservar el payload: `fields` es
`["cik","name","ticker","exchange"]`, 10.412 filas, todas de aridad 4; `cik` llega
como **número**, no como string con ceros a la izquierda; `exchange` es
`string | null` y sus valores reales son `CBOE`, `NYSE`, `Nasdaq`, `OTC` y `null`.

Dos hipótesis de `F2-02` quedan confirmadas contra datos reales en vez de asumidas:
el `missing_exchange` que el resolver ya declara existe de verdad —hay filas con
`exchange: null`—, y las cuatro etiquetas reales caen exactamente donde
`venue-map-1.0.0` las esperaba: `CBOE`, `NYSE` y `Nasdaq` están mapeadas y `OTC`
está ausente **a propósito**, así que rechaza en vez de adivinar un MIC.

Entregado (2026-09-05) — parsers y adaptador vivo:
`src/modules/universe/domain/parse-company-tickers-exchange.ts` y
`parse-sp500-constituents.ts`, el puerto
`application/universe-source-provider.ts` y su implementación
`application/live-universe-source.ts`; fila de `datahub-sp500-pddl` en el registro
de fuentes y en la allowlist de egress.

- Los dos parsers leen su **encabezado** en vez de fijar índices de columna. Un
  índice hardcodeado seguiría "funcionando" después de un reordenamiento de la
  fuente y asignaría nombres como tickers: es el modo de falla silencioso que
  importa, y hay un test por parser que lo fija.
- El CSV real trae comillas —`"Saint Paul, Minnesota"` es un campo con una coma
  adentro, en 503 de sus 505 líneas—, así que el lector implementa las reglas de la
  RFC 4180 y no un `split(",")`, que correría las columnas siguientes.
- El CSV publica **su propio CIK y no se lee**. La lista deriva de Wikipedia; tomar
  su CIK crearía un join irreversible sobre una fuente que el registro declara
  universo de desarrollo. Reconciliar ambos y reportar discrepancias es otro slice:
  exige decidir qué significa el desacuerdo, no sólo detectarlo.
- Ninguno de los dos deduplica ni desempata: dos clases del mismo CIK y dos
  emisores que reclaman el mismo ticker pasan enteros, porque resolverlos o
  rechazarlos es de `constituent-match-1.0.0`.
- Fallo de forma del payload y fila inválida están separados: lo primero cuarentena
  el lote entero (`TM-05`), lo segundo se rechaza nombrado —fila y columna, nunca el
  valor (`TM-02`)— mientras el resto sigue.
- El adaptador vivo evalúa **primero los derechos y después la red**: una fuente sin
  rights row aprobada no genera tráfico (`TM-15`), y hay un test que verifica que el
  espía de egress no se llamó. Pide `normalizedStorage` y no `rawStorage`, porque el
  payload no se conserva: pedir de más volvería el gate una formalidad.
- El pin es obligatorio y se comprueba antes que todo lo demás: una URL de
  constituyentes que no fije un SHA completo se rechaza como `source_not_pinned`,
  porque una lista servida desde `main` cambia bajo los pies y la corrida deja de ser
  reproducible.

Validación contra los payloads reales (2026-09-05), que es el motivo por el que
estos parsers estaban diferidos: la tabla de la SEC produce 10.412 asignaciones con
**cero** rechazos y la lista 503 claims con cero rechazos. `resolveConstituents`
resuelve **503 de 503, sin un solo rechazo**: 501 matches exactos y 2 por separador
relajado, que resultan ser exactamente `BRK.B → BRK-B` y `BF.B → BF-B`, los dos
casos para los que se escribió `constituent-match-1.0.0`. Los venues se reparten en
`XNYS` 342, `XNAS` 160 y `BATS` 1, las tres etiquetas que el mapa ya cubría.

Aprobación de derechos (2026-09-05): el owner aprobó `sec-edgar` y
`datahub-sp500-pddl` como `approved_personal` / `spike_ready`, con `personalUse`,
`automatedAccess`, `normalizedStorage` y `derivedStorage` en `allowed`. `rawStorage`
sigue en `unknown` **a propósito**: el payload descargado no se conserva, y el
adaptador pide sólo lo que usa. Base documental: acceso público de la SEC bajo Fair
Access y PDDL 1.0 para el paquete, ambos ya confirmados en la matriz de uso.

Pieza que faltaba y no estaba prevista: el registro de fuentes se declaraba en código
pero nunca se proyectaba a PostgreSQL, así que el gate de derechos habría consultado
una tabla vacía. `syncDeclaredSourceRegistry` la sincroniza en **un solo sentido** —la
declaración revisada es la que vale— de modo que un derecho concedido con un `UPDATE`
a mano vuelve a su valor declarado en la próxima corrida.

Falta para cerrar `F2-03`: el provider XBRL con `available_at` del filing, vintages y
restatements, y las golden fixtures de `F2-06`.

Diferido con motivo: el ritmo de las llamadas —espaciado, concurrencia y
presupuesto por corrida que la matriz de cuotas fija en 2 requests/s, concurrencia 1
y 1.000 requests/run— es `TM-10` y `TM-11`, y se cierra junto al job que las
necesita (`F2-05`). Este cliente no espacia ni cuenta llamadas, así que hasta
entonces el egress es para llamadas puntuales y verificables, no para un job.

Cierre (2026-09-14) — provider XBRL: `src/modules/fundamentals/` (parsers de
`submissions` y `companyfacts`, reglas de período, unidad y disponibilidad, selección
versionada de conceptos, construcción de vintages, adaptador vivo y orquestador),
`source_documents` y las columnas `ingestion_runs.subject_key` y `selection_version`
en la migración `0005` con su rollback pareado, el espaciador de egress y el comando
`pnpm fundamentals:ingest`. Decisiones en la
[ADR 0010](../architecture/adr/0010-sec-xbrl-ingestion.md).

- **`available_at` del filing, medido y no supuesto.** `acceptanceDateTime` es UTC
  real: leído así, 998 de 1.000 aceptaciones del filer 320193 caen dentro del
  horario de EDGAR; leyendo los dígitos como hora de Nueva York caerían 339, y cada
  hecho habría quedado conocible cuatro horas antes de tiempo. Sin aceptación, sólo
  para formularios periódicos, se infiere el fin del día de filing con offset EST y se
  marca `availability_inferred`.
- **Vintages y restatements.** Un re-reporte del mismo valor no crea revisión; un
  valor distinto sí, con la disponibilidad de la primera presentación que lo mostró.
  Lo que no tiene desempate —dos valores en una presentación, dos presentaciones en el
  mismo instante— se rechaza con nombre.
- **Sujeto.** El CIK se resuelve una vez, al corte de la descarga: el universo existe
  desde el 2026-09-05 y resolver al corte de cada hecho rechazaba toda la historia. Un
  test fija el contraste.
- **Cuarentena (`TM-05`).** Un envelope que no se entiende —en cualquier concepto,
  también en uno no seleccionado— deja una corrida `quarantined` con el documento y el
  motivo en el flag, y lo publicado queda idéntico. Una fila de submissions ilegible no
  cae en la disponibilidad inferida: sus hechos se rechazan.
- **Exactitud.** El importe sale del texto fuente del JSON (`context.source`), no de un
  `double`; `12345678901234567890` sobrevive entero.
- **Idempotencia de un documento vivo (`TM-11`).** La clave suma sujeto, selección y
  versión del contenido, sólo cuando existen, así que ninguna clave registrada cambió.
  El mismo contenido deja una corrida `duplicate` que apunta a la original y, si la
  publicación anterior se cortó, la completa bajo la corrida original.
- **Ritmo (`TM-10`).** De a una, 2 requests/s, 1.000 por corrida y hasta 64 archivos
  históricos por empresa; el presupuesto corta antes de abrir la conexión.
- Tres defectos encontrados y corregidos en el camino. El test del orquestador mostró
  que republicar una cadena comparaba sólo contra su punta y rechazaba la vintage
  original como `ambiguous_revision`: la idempotencia ahora mira la cadena entera. Los
  datos reales mostraron los otros dos: el techo de 6 archivos históricos bloqueaba a
  los bancos que emiten notas estructuradas —JPMorgan necesita 41, Goldman Sachs y
  Morgan Stanley 34, Citigroup 30, Bank of America 17—, y los rangos declarados en
  `filings.files` dejan huecos de un día (CIK 19617: el archivo 015 termina el
  2024-04-30 y el 014 empieza el 2024-05-02), así que dos 10-Q caían en disponibilidad
  inferida; ahora se piden los dos vecinos del hueco.

Verificación: `format:check`, `lint`, `typecheck`, 715 unit tests (535 + 180), 36
integration tests contra PostgreSQL 17.11 (31 + 5), `build` con las cuatro rutas en
`ƒ (Dynamic)` y 131 tests E2E pasan. El guard de red de la suite unitaria no se
relajó: el adaptador se prueba con un `EgressFetch` inyectado y fixtures sintéticas con
la forma del cable, sin valores descargados. El rollback de `0005` se verificó sobre
una base descartable: con una fila `year_to_date` falla y deshace todo, sin ella
revierte tipo, columnas y tabla, y `0005` vuelve a aplicarse.

Evidencia sobre datos reales (2026-09-14), en PostgreSQL personal:

- **Apple (CIK 320193), `--apply`:** 3 requests y 3,9 s. De 25.135 puntos en 505
  conceptos, la selección toma 7.000 en 48; salen 3.254 vintages con 150
  re-expresiones, 3.746 re-reportes colapsados, 0 rechazos y 0 disponibilidades
  inferidas; 2.247 presentaciones indexadas y 70 registradas como documentos. Por tipo
  de período: 1.041 `instant`, 1.038 `quarter`, 745 `year_to_date` y 430 `annual`.
- **Idempotencia:** la segunda corrida queda `duplicate`, con 3.254 duplicadas, 0
  rechazos, 70 documentos sin cambios y ninguna fila nueva.
- **`as_known` contra un restatement real.** `us-gaap:Assets` al 2008-09-27: la
  revisión 1 vale 39.572 M, conocible desde la aceptación del 10-Q del 2009-07-22
  20:41:33Z —el 10-K de octubre repitió el valor y se colapsó—; la revisión 2 vale
  36.171 M, desde la aceptación de la 10-K/A del 2010-01-25 21:25:58Z. Un segundo antes
  de esa aceptación `as_known` devuelve 39.572 M; en la aceptación, 36.171 M;
  `latest_restated`, 36.171 M. Es el criterio del gate de Fase 2 sobre una empresa
  real.
- **Dry run sobre otros arquetipos:** Berkshire Hathaway 1.793 vintages y 0 rechazos;
  NVIDIA, con ejercicio no calendario, 3.541 y 0; Realty Income 2.034 con 8 duraciones
  fuera de bucket rechazadas por nombre; Wells Fargo 2.174; JPMorgan 2.078, 47
  requests, 117.525 presentaciones indexadas y 0 inferidas. ExxonMobil muestra el
  límite que sigue: el universo le asigna el CIK de la holding nueva (0002115436), con
  89 puntos, y la historia vive en el CIK anterior.

Límites que quedan declarados en la ADR: un cambio de parser sobre contenido idéntico
se rechaza como `ambiguous_revision` porque la versión del parser está en el hash de la
observación desde `F1-04`; la sucesión de CIK es `F2-04`; lease, reanudación y refresh
por CIK cambiado son `F2-05`; las golden fixtures reales son `F2-06`.

<a id="f2-04"></a>

#### `F2-04` — Corporate actions con vigencia

- Estado: `done` (2026-09-16; iniciado el 2026-09-14)
- Fase y dependencia: Fase 2; `F2-03`
- Alcance incluido, en tres incrementos que se cierran en este orden:
  1. **sucesión de emisor**: una reorganización que cambia el CIK del filer une la
     historia de reporte del antecesor con la del sucesor, sin reasignar hechos ni
     adelantar conocimiento;
  2. **splits**: una re-expresión por split se distingue de un restatement y las
     series por acción se leen en una sola base (`latest_adjusted`);
  3. **símbolos, delistings y fusiones**, partido por el sondeo en dos:
     - **3a — traspasos, delistings y renombres**: la evidencia fechada del índice de
       la SEC lleva al grafo un cambio de mercado, una salida del mercado y un
       renombre, y nombra lo que la SEC no fecha;
     - **3b — vínculos de adquisición y cambios de ticker declarados**: lo que el
       índice no fecha por sí solo y necesita una regla de declaración.
- Fuera de alcance: barrido del universo buscando sucesiones no declaradas
  (`F2-05`, que ya recorre todos los `submissions`), versión de linaje dentro del
  snapshot de valuación (Fase 6), comando permanente de inspección (`F2-06`),
  programas depositarios (`F6-04`).

Criterios de aceptación del incremento 1:

- la sucesión se **declara** con el accession de su presentación y se **verifica**
  contra `submissions` de los dos CIK; lo que no cierra se rechaza con nombre y no
  se infiere un antecesor por nombre;
- `available_at` del vínculo es la aceptación de la presentación de sucesión y su
  vigencia es la fecha del evento que esa presentación declara;
- los hechos del antecesor conservan su sujeto: la historia se une en la lectura,
  y un `as_known` anterior a la aceptación no ve al antecesor;
- el antecesor sólo aporta hechos de períodos anteriores a la vigencia, y ante un
  mismo hecho reportado por los dos gana la vintage conocible más reciente;
- registrar dos veces la misma sucesión no escribe una fila más, y reconstituir el
  universo no abre ni cierra nada por ella;
- ExxonMobil queda con su historia real unida sobre PostgreSQL personal.

Los criterios de los incrementos 2 y 3 están abajo: cada uno se fijó al cerrar el
anterior, con el cable medido, igual que la regla de verificación del incremento 1.

Controles: `TM-05`, `TM-06`, `TM-16`.

Sondeo del cable (2026-09-14), sin conservar payload, 4 requests: el sucesor
`ExxonMobil Holdings Corp` (CIK 2115436) presenta un `8-K12B` con evento el
2026-07-01 y aceptación 16:36:49Z; el antecesor `EXXON MOBIL CORP` (CIK 34088)
presenta el mismo día un 8-K con ítem 3.01 y al siguiente un `25-NSE`. El 10-Q del
segundo trimestre de 2026 es una **presentación conjunta** que figura en los dos
índices, pero sus hechos XBRL están sólo en el `companyfacts` del sucesor: 269
puntos, de los cuales 138 repiten un hecho del antecesor —los 138 con el mismo valor
que su última vintage— y 131 son del trimestre nuevo. La historia del antecesor
cubre de FY2009 a Q1 2026. Esto corrigió una regla antes de escribirla: el sucesor
**sí** reporta períodos anteriores a la vigencia, así que lo verificable es que no
tenga reportes periódicos aceptados antes de la presentación de sucesión.

Entregado (2026-09-14) — incremento 1, sucesión de emisor:
`src/modules/corporate-actions/` (declaración, verificación de evidencia, planner de
registro, linaje de reporte, adaptador vivo, orquestador y lectura con linaje),
`corporate_actions` y `legal_entity_relationships` en la migración `0006` con su
rollback pareado, `src/server/db/postgres-corporate-action-repository.ts`, el
selector `get-corporate-action-repository.ts` y el comando
`pnpm corporate-actions:record`. Decisiones en la
[ADR 0011](../architecture/adr/0011-issuer-succession-reporting-lineage.md).

- **Declarada y verificada, no detectada.** `declared-successions.ts` cita los dos
  CIK y el accession; `sec-succession-evidence-1.0.0` la contrasta con los índices de
  los dos filers y rechaza con diez códigos nombrados. Lo que no cierra deja una
  corrida `quarantined` con el código en el flag y no toca el grafo.
- **Tiempo.** `available_at` del vínculo es la aceptación del `8-K12B`; `valid_from`
  es la fecha del evento a las 00:00 de Nueva York, verificada en PostgreSQL por
  `legal_entity_relationships_valid_from_check` con su base de zonas. Los días de
  cambio de horario y la regla anterior a 2007 salen de esa base, no de una regla
  escrita a mano.
- **Identidad (`TM-06`).** El antecesor entra al grafo como entidad legal propia con
  su CIK autoritativo; el sucesor conserva su ID. Un antecesor abierto por sucesor,
  un sucesor por antecesor y ningún ciclo, en índices únicos parciales y en dominio.
- **Linaje en la lectura.** `reporting-lineage-1.0.0` une segmentos que conservan su
  `subject_id`: el antecesor aporta hechos anteriores a la vigencia y un hecho de dos
  filers se resuelve por la revisión conocible más reciente. La ingesta por ticker
  suma los CIK de los antecesores, cada uno en su corrida.
- **Idempotencia y recuperación (`TM-11`, `TM-16`).** Registrar dos veces la misma
  sucesión deja una corrida `duplicate` y ninguna fila de grafo; un registro cortado
  después de anotar su corrida se completa bajo la corrida original.
- **Pieza no prevista:** `parseSecSubmissions` devuelve el nombre del filer, sin
  cuarentenar el índice si falta, porque el nombre legal del antecesor sale de la SEC
  y no de la declaración.

Verificación: `format:check`, `lint`, `typecheck`, 802 unit tests (715 + 87), 43
integration tests contra PostgreSQL 17.11 (36 + 7), `build` con las cuatro rutas en
`ƒ (Dynamic)` y 131 tests E2E pasan. El rollback de `0006` se verificó sobre una base
descartable: quita tablas y tipos, y `0006` vuelve a aplicarse.

Evidencia sobre datos reales (2026-09-14), en PostgreSQL personal:

- **Registro:** 2 requests; antecesor `EXXON MOBIL CORP`, vigencia 2026-07-01,
  `8-K12B` aceptada 16:36:49Z, último reporte previo el 10-Q al 2026-03-31. Escribió 1
  entidad, 1 CIK, 1 evento, 1 vínculo y 1 documento. La segunda corrida quedó
  `duplicate` y sólo sumó su propia fila de auditoría.
- **Ingesta:** `--ticker XOM --apply` con 5 requests publicó 89 vintages del sucesor y
  2.510 del antecesor, con 28 re-expresiones, 0 rechazos y 0 disponibilidades
  inferidas.
- **Linaje:** `us-gaap:Revenues` anual pasa de 0 ejercicios con el sucesor solo a 17
  (FY2009 a FY2025), y `us-gaap:NetIncomeLoss` a 19. Sobre la selección completa se
  ven 2.522 hechos, 2.433 del antecesor; los 49 que reportaron los dos filers tienen
  el mismo valor y ninguno difiere. Un segundo antes de la aceptación del `8-K12B` el
  linaje tiene un segmento; en la aceptación, dos. Los ingresos del segundo
  trimestre de 2025 salen del antecesor consultados al 2026-08-01 y del sucesor hoy,
  con el mismo valor y la disponibilidad de cada presentación.
- **Universo:** planificar la constitución en memoria con el antecesor ya en el grafo
  no abre ni cierra nada por la sucesión.

Material para el incremento 3, encontrado al replanificar el universo contra la tabla
viva de la SEC: el pin de la lista no cambió, pero la tabla sí. `BEN` pasó de
`FRANKLIN RESOURCES INC` a `FRANKLIN TEMPLETON INC` —un renombre, que con el mismo pin
se rechaza como `stale_effective_date` en vez de inventarle vigencia— y `KHC` pasó de
`Nasdaq` a `NYSE`, un traspaso de mercado que el planner sólo puede nombrar como
`unresolved_share_class`.

##### Incremento 2 — splits (especificado el 2026-09-14, entregado el 2026-09-15)

Problema medido en PostgreSQL personal: de las 150 re-expresiones de Apple, 71 tienen
ratio de split (7 por el de 2014, 4 por el de 2020, 28 por los dos) y la cadena de
revisión las trata igual que la 10-K/A de 2010. Bajo `latest_restated` el EPS básico
anual mezcla tres bases: FY2008 6,94 (antes de los dos splits), FY2012 6,38 (sólo el
7:1) y FY2019 2,99 (los dos). Cualquier cálculo por acción sobre esa serie da mal.

Idea central a validar: la base de un valor por acción la decide **la presentación
que lo reportó**, no el período. Por ASC 260 la primera presentación posterior al
split ya viene ajustada, así que no hace falta la fecha efectiva exacta del split:
alcanza con saber cuál fue la primera presentación en base nueva.

Antes de escribir código:

1. **Sondeo del cable** sobre Apple (7:1 en 2014, 4:1 en 2020) y NVIDIA (4:1 en 2021,
   10:1 en 2024), con el patrón de siempre: qué presentaciones traen
   `us-gaap:StockholdersEquityNoteStockSplitConversionRatio1`, con qué período y
   valor, y si esa misma presentación re-expresa EPS y acciones con el mismo ratio.
   Buscar también un reverse split real en el universo.
2. **Enmienda de la ADR 0003:** `decimal.js` sólo se importa desde
   `decimal-policy.ts` dentro de `src/modules/valuation/`, y ajustar por un ratio
   exige aritmética decimal fuera de la valuación. Mover la política a un módulo
   compartido es la primera pieza del incremento.
3. **Decidir el sujeto del split.** Los hechos XBRL cuelgan de la entidad legal, pero
   un split es de la security. Con una sola security por emisor el vínculo es
   unívoco; Alphabet, Fox y News Corp tienen dos y hay que declarar qué pasa ahí en
   vez de adivinarlo.

Criterios de aceptación (borrador; se ajustan con lo que muestre el sondeo, como se
corrigió la regla del incremento 1):

- un split se registra como `corporate_action` `split` o `reverse_split` con ratio
  exacto en dos decimales —nunca un `number` binario— y la presentación que lo prueba;
  su `available_at` es la aceptación de la primera presentación en base nueva;
- dos evidencias independientes —el concepto de ratio y la re-expresión coherente de
  EPS y acciones en la misma presentación— lo confirman por regla; con una sola queda
  `candidate` y no ajusta nada;
- las filas publicadas no se reescriben: una re-expresión por split se clasifica en la
  lectura, y de las 150 de Apple las 71 con ratio de split quedan marcadas y las 79
  restantes no;
- `latest_adjusted` devuelve el EPS de Apple FY2008, FY2012 y FY2019 en una sola base,
  con la transformación versionada nombrada en cada fila; FY2012 vale 44,64 ÷ 28 =
  1,594;
- `as_known` no cambia: al 2014-05-01 el EPS básico de FY2012 sigue siendo 44,64;
- un valor reportado por una presentación posterior a todos los splits conocidos sale
  igual en `latest_adjusted` que en `latest_restated`.

Fuera del incremento 2: precios y market cap (no hay datos de mercado), dividendos en
acciones y spin-offs (incremento 3).

Entregado (2026-09-15) — incremento 2, splits: `src/modules/numeric/` (la política
decimal compartida), `share-basis`, `verify-split-evidence`, `plan-split-recording` y
`split-adjustment` en `src/modules/corporate-actions/domain/`; el puerto, el adaptador
vivo y el orquestador `record-splits` en `application/`; `parse-sec-company-concept`
en `src/modules/fundamentals/domain/`; `split` y `reverse_split` con
`corporate_actions_split_terms_check` en la migración `0007` con su rollback pareado;
el dataset `sec.companyconcept` en el registro de fuentes y el comando
`pnpm corporate-actions:splits`. Decisiones en la
[ADR 0012](../architecture/adr/0012-stock-splits-share-basis.md) y en la enmienda de la
[ADR 0003](../architecture/adr/0003-decimal-arithmetic-valuation-engine.md).

Lo que el sondeo cambió antes de escribir la regla (2026-09-15, sin conservar
payload): el ratio **no alcanza solo** —Alphabet lo declara en el 10-Q de abril de
2022, tres meses antes del split y con los valores en base vieja; Carvana declara
`0.0556` y Citizens `6` sin ningún split—; su **fecha no es la del split** —NVIDIA
asocia el 4:1 al 2021-06-03 y después al 2021-07-19—; `companyconcept` publica
exactamente los mismos puntos que `companyfacts`; y el EPS re-expresado trae el
redondeo de centavos del filer.

Los tres puntos que la especificación dejaba abiertos:

1. **Sondeo:** hecho arriba. Reverse splits reales del universo: Citigroup `0.1`,
   Duke Energy `0.3333` y Howmet `0.33`; Motorola Solutions y AIG no etiquetan el
   concepto.
2. **Enmienda de la ADR 0003:** la política vive en `src/modules/numeric/` y cada
   consumidor liga su error con `createDecimalOperations`; la valuación no cambió un
   import, y una regla de ESLint hace estructural que un solo archivo importe
   `decimal.js`.
3. **Sujeto:** la entidad legal, con `terms.scope = filer_reported_shares`. El
   concepto llega sin dimensiones y afirma que cambió la base que ese filer reporta,
   no qué clase se dividió; así Alphabet no queda afuera por una decisión que el cable
   no permite tomar.

Criterios, contra lo que se entregó:

- **Registro con ratio exacto y presentación que lo prueba.** `split` o
  `reverse_split` sobre la entidad legal, ratio como texto exacto en `terms` y la
  accession confirmante como `source_document_id`; `available_at` es su aceptación y
  `effective_on` el cierre del primer período en base nueva. PostgreSQL rechaza un
  ratio uno, un ratio que no es decimal canónico —sin romper el cast—, un reverse split
  mayor que uno y un split sobre una security.
- **Dos evidencias; con una sola, `candidate` que no ajusta nada.** El ratio y la
  re-expresión de al menos un EPS y al menos un conteo de acciones en la **misma**
  presentación. Lo que no cierra queda con diez motivos nombrados; lo que repite el
  ratio corrobora al split vecino con el mismo ratio.
- **Las filas publicadas no se reescriben y la re-expresión se clasifica en la
  lectura.** Sobre Apple en PostgreSQL personal: **150 re-expresiones, 71
  `split_reexpression` y 79 no**; sin splits registrados, las 150 parecen
  restatements.
- **`latest_adjusted` en una sola base, con la transformación nombrada.** EPS básico
  FY2008 0,2479 (×28), FY2012 1,595 (×4), FY2019 2,99 (×1), cada fila con
  `split-adjustment-1.0.0` y su factor. **Corrección del borrador:** FY2012 no es
  44,64 ÷ 28 = 1,594 sino 6,38 ÷ 4 = 1,595. `latest_restated` elige la revisión más
  reciente, que es la re-expresión que Apple publicó en el 10-K de 2014 ya redondeada a
  centavos; partir del 44,64 original ignoraría la política de revisión.
- **`as_known` no cambia.** Al 2014-05-01 el EPS básico FY2012 es 44,64 con la base
  reportada y también con `latest_adjusted`, porque el split todavía no era
  conocible.
- **Un valor posterior a todos los splits sale igual en las dos políticas.** FY2023
  6,16 con factor 1.

Verificación: `format:check`, `lint`, `typecheck`, 924 unit tests (802 + 122), 51
integration tests contra PostgreSQL 17.11 (43 + 8), `build` con las cuatro rutas en
`ƒ (Dynamic)` y 131 tests E2E pasan. El rollback de `0007` se verificó sobre una base
descartable: con un split registrado falla y deshace todo, sin él reconstruye el tipo y
quita el check, y `0007` vuelve a aplicarse. `queryObservations` ahora rechaza
`latest_adjusted` con `unsupported_revision_policy` en vez de devolver la base
reportada en silencio, y la corrida de referencia conserva sus dos hashes con la
política compartida.

Evidencia sobre datos reales (2026-09-15), en PostgreSQL personal, con `0007` aplicada:

- **Apple:** 1 request. 7:1 confirmado en el 10-Q aceptado el 2014-07-23 20:32:48Z
  —4 EPS y 4 acciones, 1 outlier: la corrección de escala de 899.213 a 6.294.494.000—
  y 4:1 en el 10-K del 2020-10-29 22:06:25Z —18 EPS, 5 acciones, 0 outliers—; las
  otras cinco presentaciones corroboran. La segunda corrida queda `duplicate` y no
  escribe nada. Un segundo antes de la aceptación del 10-Q de 2014 el promedio de
  acciones FY2012 vale 934.818.000; en la aceptación, ×7 = 6.543.726.000, el mismo
  valor que Apple re-expresó después.
- **NVIDIA** (ingerida en esta sesión, 3.541 vintages): 4:1 en el 10-Q del 2021-08-20 y
  10:1 en el del 2024-08-28, 4 EPS y 4 acciones cada uno. De sus 107 re-expresiones
  sensibles, 58 son del split; las 49 restantes son restatements reales —correcciones
  de escala ×0,001 y ×1.000 en 2009–2012, redondeo a millones, la adopción de
  ASU 2016-09 y un acumulado de 2017 mal etiquetado que va y vuelve—. El EPS diluido
  anual queda ×40 antes de 2021, ×10 entre los splits y ×1 después.
- **Alphabet** (ingerida en esta sesión): 20:1 confirmado en el 10-Q del 2022-07-27, no
  en el de abril, que corrobora como anuncio; los dos ratios `2` de 2016 —el dividendo
  en acciones de Google de 2014, reportado por otro CIK— quedan candidatos. 15 de sus
  15 re-expresiones sensibles son del split.
- **Duke Energy** (ingerida en esta sesión): el reverse split 1:3 de 2012 queda
  `candidate` con `ratio_declared_after_reexpression`. El `0.3333` aparece recién en el
  10-K de 2014 y el job nombra la primera presentación en base nueva, el 10-Q del
  2012-08-08, que publicó las acciones divididas por tres sin re-expresar el EPS; la
  primera con EPS y acciones es la del 2012-11-08, y nombrarla habría ajustado dos
  veces las acciones de agosto.

Límites declarados en la ADR: un split que la regla no confirma no ajusta nada y la
lectura no lo advierte fila por fila (Duke y Citigroup necesitan una confirmación
declarada que hoy no existe); un ratio redondeado se aplica como se declaró; la lectura
no sabe si el job corrió para el emisor, así que va después de cada ingesta hasta
`F2-05`; una fila sensible de un antecesor falla bajo `latest_adjusted` porque la
conversión de acciones de la sucesión no está registrada.

##### Incremento 3 — símbolos, traspasos, delistings y fusiones (especificado el 2026-09-15; 3a entregado el 2026-09-15, 3b entregado el 2026-09-16)

Material medido al cerrar el incremento 2, 3 requests de `submissions` sin conservar
payload:

- **Renombre:** BEN publica `formerNames` con `FRANKLIN RESOURCES INC` hasta
  2026-08-14T04:00Z y un 8-K con ítem 5.03 el 2026-07-31. Con el mismo pin de la lista,
  la reconstitución ya lo rechaza como `stale_effective_date` en vez de inventarle
  vigencia (incremento 1).
- **Traspaso de mercado:** KHC presenta un 8-K con ítem 3.01 el 2026-08-26 y un Form
  `25` el 2026-09-08, pero `submissions.exchanges` **todavía dice Nasdaq** mientras la
  tabla de tickers de la SEC ya dice NYSE: las dos fuentes no cambian el mismo día.
- **Cambio de ticker sin rastro en `submissions`:** META trae `Facebook Inc` hasta
  2021-10-27 en `formerNames`, pero el paso de FB a META de 2022 no figura: `tickers`
  sólo publica el vigente.

Antes de escribir código:

1. **Sondeo de la historia de símbolos:** qué fuente fechada prueba un cambio de
   ticker que `submissions` no guarda —el historial del paquete de constituyentes por
   commit, el Form 25 del listing viejo, el 8-K— sobre META, BEN y un delisting por
   adquisición real del universo.
2. **Decidir el evento de un traspaso:** si el Form 25 del mercado viejo y el primer
   día en el nuevo alcanzan para cerrar un listing y abrir otro sin inventar la fecha
   intermedia, y qué pasa mientras las dos fuentes de la SEC no coinciden.
3. **Decidir cuándo una fusión une historias:** una adquisición no entra al linaje de
   reporte (ADR 0011); hay que declarar qué vínculo registra y qué lectura lo usa.

Criterios de aceptación (borrador; se ajustan con lo que muestre el sondeo):

- un renombre abre una versión nueva de la entidad legal con la fecha de `formerNames`
  y la presentación que lo acompaña; la versión anterior conserva su nombre y un
  `as_known` anterior no ve el nuevo;
- un cambio de ticker abre un `listing_symbol` nuevo y cierra el anterior en el mismo
  instante, con evidencia fechada; sin evidencia fechada se rechaza con nombre en vez
  de tomar la fecha de la corrida;
- un traspaso de mercado cierra el listing en el MIC viejo y abre otro en el nuevo sin
  reciclar el ID de la security; mientras la tabla de tickers y `submissions`
  discrepan, la reconstitución no decide y lo nombra;
- un delisting cierra el listing con la fecha del Form 25 o `25-NSE` y no deslista la
  security de otros mercados ni borra su membresía histórica;
- una adquisición registra un vínculo que **no** une historias de reporte, y la lectura
  del adquirente no ve los hechos del adquirido;
- reconstituir dos veces el mismo estado no abre ni cierra nada.

Fuera del incremento 3: dividendos en acciones y spin-offs con reparto de base
(evaluar contra el cable antes de sumarlos), confirmación declarada de splits
candidatos, precios y market cap.

Lo que el sondeo cambió antes de escribir la regla (2026-09-15, sin conservar payload;
13 requests a la SEC y el historial de 39 commits del CSV de constituyentes desde
enero de 2025, comparados de a pares para encontrar casos reales):

- **Traspaso** (Kraft Heinz Nasdaq→NYSE; Fiserv NYSE→Nasdaq con FI→FISV): el emisor
  presenta `8-A12B` y `25` con segundos o minutos de diferencia y el mercado nuevo
  presenta el `CERT`. Un `8-A12B` con `CERT` y sin `25` es deuda: los dos lo hicieron.
- **Delisting por adquisición** (Hologic, Electronic Arts, AvalonBay): `25-NSE` del
  mercado y 8-K con 2.01, 3.01 y 5.01 el mismo día, en cualquier orden. El `25-NSE`
  de Kraft Heinz de 2025 no tiene 3.01: retiró deuda y las acciones siguieron.
- **Quién presentó** es el prefijo del accession: `0001354457` es Nasdaq y
  `0000876661` NYSE según la propia SEC. `submissions` publica además `items` y
  `formerNames` con borde.
- **La tabla sí deja de mostrar a quien sale** —Hologic, EA y AvalonBay ya no están—,
  aunque `submissions.tickers` siga publicando EA y AVB. La discrepancia entre
  `submissions.exchanges` y la tabla que el borrador pedía nombrar no decide nada: la
  fecha la ponen las presentaciones.
- **Un cambio de ticker en el mismo mercado no deja nada fechado**: BK→BNY, MMC→MRSH y
  SATS→ECHO no tienen `8-A12B`, `CERT` ni `25`. El paso de FB a META tampoco.
- **Una adquisición entre dos miembros** (AvalonBay por Vivmark, ex Equity
  Residential) comparte accessions de `425` y `S-4` en los dos índices; en los otros
  dos casos el adquirente es privado y no está en el grafo.
- **Defecto encontrado leyendo el planner:** un constituyente rechazado en la etapa de
  plan quedaba fuera de los miembros y, con un pin nuevo, **se cerraba su membresía
  como salida del índice**.

Los tres puntos que la especificación dejaba abiertos:

1. **Historia de símbolos:** no hay fuente fechada para un cambio de ticker en el mismo
   mercado. La lista por commit fecha el scraping, no el cambio. Queda rechazado con
   nombre y la confirmación declarada pasa a 3b.
2. **Evento de un traspaso:** alcanza sin inventar fechas. Se escribe en el instante en
   que la evidencia quedó completa —el `CERT`—, que es cierre, apertura y
   `available_at` a la vez; no se usa la vigencia legal del `25`, que el cable no
   publica.
3. **Fusión:** un delisting registra `change_in_control_completed` sin vínculo; el
   vínculo que no une historias es 3b, con la pareja de `425` compartidos como
   evidencia a evaluar.

Entregado (2026-09-15) — incremento 3a, traspasos, delistings y renombres:
`parse-sec-listing-index`, `detect-listing-divergences`, `verify-listing-evidence` y
`plan-listing-reconciliation` en `src/modules/corporate-actions/domain/`; puerto,
adaptador vivo y orquestador `reconcile-listings` en `application/`; `applyListingPlan`
en los repositorios en memoria y PostgreSQL; `listing_transfer` y `delisting` con
`corporate_actions_listing_terms_check` en la migración `0008` con su rollback pareado;
el comando `pnpm corporate-actions:listings`; y `universe-constitution-1.1.0`.
Decisiones en la [ADR 0013](../architecture/adr/0013-listing-events-dated-evidence.md).

Criterios, contra lo que se entregó:

- **Renombre con la fecha de `formerNames`; la versión anterior conserva su nombre y un
  `as_known` anterior no ve el nuevo.** Cumplido con una corrección que el borrador no
  preveía: el renombre de BEN es **anterior** a la versión registrada, así que se
  supersede en la descarga en vez de cerrarse en el pasado. No hay «presentación que lo
  acompaña»: el 5.03 también se usa para estatutos, y el documento es
  `submissions/CIK…json`.
- **Cambio de ticker con evidencia fechada; sin ella, rechazo con nombre.** Sin
  evidencia en ningún caso medido: `symbol_change_without_dated_evidence`. Un ticker
  nuevo que llega con un traspaso (FI→FISV) viaja en el listing nuevo.
- **Traspaso que cierra el listing viejo y abre otro sin reciclar la security.** Cumplido,
  con otro `listing_id` sobre la misma security y la membresía intacta.
- **Delisting con la fecha del `25-NSE` que no deslista la security ni borra la
  membresía.** Cumplido, con la corrección de que el instante es el de la evidencia
  completa: AvalonBay cierra con su aviso de las 20:01, no con el `25-NSE` de las 14:53.
- **Adquisición con vínculo que no une historias.** Pasa a 3b.
- **Reconstituir dos veces el mismo estado no abre ni cierra nada.** Cumplido sobre la
  base personal y sobre la réplica, y reforzado: un rechazo ya no cierra membresías.

Verificación: `format:check`, `lint`, `typecheck`, 969 unit tests (924 + 45), 55
integration tests contra PostgreSQL 17.11 (51 + 4), `build` con las cuatro rutas en
`ƒ (Dynamic)` y 131 tests E2E pasan. El rollback de `0008` se verificó sobre una base
descartable: con delistings registrados falla y deshace todo, sin ellos reconstruye el
tipo y quita el check, y `0008` vuelve a aplicarse.

Evidencia sobre datos reales (2026-09-15):

- **PostgreSQL personal, con `0008` aplicada.** Dry run y `--apply` con 3 requests: dos
  divergencias y dos corridas `succeeded`. **Kraft Heinz**: `XNAS:KHC` se cierra y
  `XNYS:KHC` se abre en el `CERT` de NYSE aceptado el 2026-09-09T12:44:23Z, con `25`
  `0001637459-26-000062`, `8-A12B` `-000061` y aviso 3.01 `-000057`; un segundo antes
  el grafo resuelve `XNAS`, en el `CERT` `XNYS`. **Franklin Templeton**: la versión
  `FRANKLIN RESOURCES INC` queda superseded y `FRANKLIN TEMPLETON INC` vale desde el
  2026-08-14T04:00Z; conocido un segundo antes de la corrección el nombre al
  2026-09-10 sigue siendo el viejo. La segunda corrida hace 1 request y encuentra 0
  divergencias. Replanificar el universo con el mismo pin pasa de **2 rechazos a 0**
  sin abrir ni cerrar nada.
- **Base descartable constituida con el pin del 2026-07-22** —con las filas de la tabla
  que EA y AVB tenían antes de salir, declaradas como réplica porque la tabla no tiene
  historia—: la reconciliación detecta los dos `listing_unassigned` y los deslista con el
  cable real. **Electronic Arts** en `XNAS` el 2026-08-04T20:57:00Z (`25-NSE` de Nasdaq
  `0001354457-26-000757` y 8-K `0001140361-26-031157`); **AvalonBay** en `XNYS` el
  2026-08-17T20:01:44Z. Las dos con `change_in_control_completed`. La segunda pasada
  no encuentra nada; el pin del 2026-09-05 cierra las dos membresías como salida del
  índice y abre las tres altas; la tercera constitución no escribe nada.

Límites declarados en la ADR: cambios de ticker sin evidencia rechazados; delistings
sin vínculo al adquirente; sólo Nasdaq y NYSE en el mapa de mercados; la security de
un adquirido sigue vigente; corregir un listing se rechaza; un renombre posterior
cerrado en el lugar tiene el mismo límite que el del planner del universo.

##### Incremento 3b — vínculos de adquisición y cambios de ticker declarados (especificado el 2026-09-15, entregado el 2026-09-16)

Material medido en el sondeo del 3a:

- **AvalonBay → Vivmark (ex Equity Residential)**: los dos índices comparten las
  accessions de los `425` y del `S-4`; el adquirido presenta `25-NSE`, 8-K 2.01/3.01/5.01
  y `15-12G`; el adquirente, 8-K con 2.01 y 5.03 el mismo día y `formerNames` con el
  nombre anterior. El universo real ya tiene a Vivmark (`VMRK`) y no a AvalonBay.
- **Cambios de ticker sin evidencia**: BK→BNY, MMC→MRSH y SATS→ECHO, todos en el
  universo real con el ticker nuevo porque se constituyó después.

Antes de escribir código:

1. **Sondeo de los `425` compartidos**: si la pareja de accessions en los dos índices
   identifica sin ambigüedad adquirente y adquirido —un `425` también lo presentan
   terceros— y si hay un caso con los dos miembros en el grafo al mismo tiempo.
2. **Decidir la declaración de un cambio de ticker**: qué verifica el job cuando el
   owner declara la fecha —que la tabla asigne el ticker nuevo al mismo CIK, que el
   viejo haya desaparecido— y qué `decided_by` y `available_at` quedan.

Criterios de aceptación (borrador):

- una adquisición entre dos entidades del grafo registra un vínculo `acquired_by` con
  la aceptación del 8-K 2.01 del adquirido, que **no** entra al linaje de reporte: la
  lectura del adquirente no ve los hechos del adquirido;
- un cambio de ticker declarado cierra y abre `listing_symbol` en la fecha declarada,
  con `decided_by = owner`, y un `as_known` anterior a la declaración no lo ve;
- lo que la declaración no cierra se rechaza con nombre y no toca el grafo.

Entregado (2026-09-16): [ADR 0014](../architecture/adr/0014-declared-corporate-events.md),
`declared-event.ts`, `plan-declared-event.ts`, `record-declared-event.ts`,
`applyDeclaredEventPlan` en ambos repositorios, migración
`0009_pretty_thunderbird.sql` con rollback pareado y
`pnpm corporate-actions:declare --file <path>`;
[protocolo y ejemplos sintéticos](../runbooks/declared-corporate-events.md).

El sondeo previo corrigió el borrador:

- 15 accessions `425` compartidas entre AvalonBay y Vivmark, presentadas por agentes;
  no prueban la dirección. La intersección reciente no trae `S-4`. Los roles se
  declaran después de leer los 8-K y se corroboran con sus ítems y fecha de evento.
- La aceptación del adquirido es 20:01:44Z; la del adquirente 20:01:49Z. El vínculo
  usa **la última aceptación requerida**, corrigiendo los cinco segundos de
  anticipación que habría introducido el borrador.
- El ticker conserva `decidedBy = owner`, instante y motivo de la declaración. Su
  `availableAt` es la primera verificación satisfactoria, no la fecha del cambio.
  Superseder la fila original y agregar viejo-cerrado/nuevo-abierto conserva el
  resultado de un `as_known` anterior. Una tabla incompleta no prueba ausencia;
  una fila del símbolo con mercado desconocido tampoco se descarta como ausente.

Criterios cumplidos:

- `acquired_by` entre dos entidades del grafo, sin incorporar compañías desconocidas,
  sin unir historias ni siquiera solicitar hechos del adquirido en la lectura del
  adquirente; un comprador admite varias adquisiciones y sólo `reporting_successor`
  mantiene un antecesor único;
- cambio de ticker sobre el mismo listing/security con vigencia y conocimiento
  separados, declaración explícita y tabla SEC completa como corroboración;
- schema estricto y entrada acotada, derechos/modo/identidad antes de red, rechazos
  nombrados, fallo y conflicto de documentos sin cambiar el grafo;
- transacción atómica, rechazo de planes desactualizados, replay sin versiones nuevas
  y recuperación después del registro de auditoría/documentos.

Evidencia: 1.004 unit tests (969 + 35), 62 integration tests (55 + 7), build con las
cuatro rutas dinámicas y 131 E2E aprobados (2 casos mobile omitidos en proyectos
exclusivamente desktop). `format:check`, `lint`, `typecheck` y `git diff --check`
aprobados. Rollback probado en base creada para ese propósito: rechaza eventos en
uso sin perderlos, revierte tipos sin datos y permite reaplicar `0009`. Migración
aplicada también al PostgreSQL personal; no se aplicó ninguna declaración personal.

Validación real (2026-09-15, 3 requests adicionales, sin conservar payload): sobre
una **réplica técnica del grafo anterior** —no una declaración del owner— el planner
admite AvalonBay→Vivmark desde 2026-08-17T04:00Z y conocible desde 20:01:49Z;
EQR→VMRK cierra/abre el símbolo el 2026-08-18T04:00Z y queda conocible desde la
verificación. Nada se escribió en el grafo personal. Las pruebas PostgreSQL usan
fixtures sintéticas conforme a la política del repositorio.

`F2-04` cierra. Límites: no se infieren roles desde accessions, no se reconstruye un
ticker anterior al grafo registrado, y canjes/spin-offs requieren evidencia distinta.
El backfill durable sigue en `F2-05`.

#### `F2-05` — Backfill y refresh durable

- Estado: `done` (2026-09-18, iniciado el 2026-09-16). Los cuatro incrementos
  están entregados: jobs durables (2026-09-16); la ventana (paso 1), las filas más
  livianas (paso 2) y la poda (paso 3), los tres el 2026-09-17; el presupuesto
  diario con kill switch por fuente y el refresh de CIK cambiados, los dos el
  2026-09-18.
- Fase y dependencia: Fase 2; `F2-04` cerrado.
- Alcance, en cuatro incrementos que se cierran en este orden:
  1. **jobs durables** (entregado):
     - ADR del almacenamiento de jobs y presupuestos;
     - cursor y checkpoint, lease, vencimiento, poison policy y recuperación
       manual, con reloj inyectado y PostgreSQL;
     - backfill manual del universo sobre la SEC.
  2. **ventana de historia de cinco ejercicios y almacenamiento eficiente**
     (entregado: la ventana y las filas más livianas; ver abajo).
  3. **presupuesto diario y kill switch por fuente** (entregado), en PostgreSQL y
     antes de cualquier programación. Los comandos manuales de un ticker pasan a
     respetarlos.
  4. **refresh de CIK cambiados**: `submissions` detecta presentaciones nuevas y
     sólo esos filers vuelven a bajar companyfacts. El conjunto que recorre son
     **los filers que ya tienen fundamentals publicados**
     ([ADR 0021](../architecture/adr/0021-refresh-followed-set.md)). La
     programación llega recién después, con su propio gate.
- El issue completo debe probar idempotencia, concurrencia entre procesos, límites
  por corrida y por día, kill switch, `429`, reanudación tras un crash y poison
  policy. La página sigue leyendo PostgreSQL: ninguna request recorre los 503
  emisores.
- Controles: `TM-10`, `TM-11`, `TM-16`.
- No autoriza cron live, gasto ni recursos externos.
- Desde la [ADR 0016](../architecture/adr/0016-analysis-scope-sector-matrices.md):
  - el backfill del universo deja de ser objetivo de producto;
  - el job sirve planes por ticker y por sector;
  - el refresh del incremento 4 recorre sólo el conjunto seguido, no el universo;
    la [ADR 0021](../architecture/adr/0021-refresh-followed-set.md) reemplaza esa
    definición —«las empresas valuadas y los sectores con matriz»— por los filers
    que ya tienen fundamentals publicados, que hoy son seis y crecen con cada
    ingesta.

Criterios de aceptación del incremento 1:

- el almacenamiento se decide por ADR, sin dependencias estructurales nuevas;
- el lease vence y está cercado por token:
  - dos procesos no corren la misma fuente;
  - un proceso muerto no la retiene más que el TTL;
  - un proceso zombi no escribe;
- cursor y checkpoint se escriben en la misma transacción, en orden estricto, y
  una corrida retoma desde el cursor;
- poison policy: el intento se cuenta al empezar, los huérfanos se recuperan y hay
  un techo de intentos;
- las señales de la fuente no gastan intentos, y el presupuesto por corrida
  reserva el peor caso de una empresa;
- la recuperación manual queda auditada: pausar, reanudar, cancelar, reencolar y
  liberar;
- el reloj es inyectado, el mismo contrato corre sobre el doble en memoria y sobre
  PostgreSQL, y la concurrencia se prueba con conexiones reales.

Entregado (2026-09-16) — incremento 1, jobs durables. Decisiones en la
[ADR 0015](../architecture/adr/0015-durable-ingestion-jobs.md) y operación en el
[runbook](../runbooks/ingestion-backfill.md).

- `src/modules/ingestion/`:
  - dominio `ingestion-job` y `ingestion-job-transitions`;
  - puerto `ingestion-job-store` con su contrato compartido;
  - worker `run-ingestion-job`;
  - doble en memoria.
- `src/modules/fundamentals/`: plan del backfill, observador de señales de la SEC
  y ejecutor.
- `postgres-ingestion-job-store.ts` y la raíz de composición.
- Migración `0010`, con cuatro tablas y rollback pareado.
- Comandos `pnpm fundamentals:backfill` y `pnpm ingestion:jobs`.

Lo que fija el incremento:

- **Lease por fuente.** Lo que se protege es la cuota de la SEC, no un job.
  - Vencer habilita la toma, no la produce.
  - Cada escritura del worker está cercada por el token y renueva el vencimiento.
  - Un lock transaccional por fuente (`pg_advisory_xact_lock`) serializa las
    transiciones: sin deadlocks y sin lecturas viejas.
- **Cursor = primer item no terminal**, recalculado en el mismo commit que el
  checkpoint. Reencolar lo hace retroceder sin una regla aparte.
- **Poison policy.** El intento se cuenta al empezar. El próximo dueño recupera el
  huérfano de un proceso muerto, que se envenena al tercer intento.
- **Señales de la fuente.**
  - `429`, `403`, `503` y la red caída difieren el job sin gastar el intento.
  - Una espera de hasta 5 minutos se hace con el lease tomado.
  - Tres señales seguidas frenan la corrida.
- **Presupuesto.** Una empresa sólo empieza si la corrida cubre su peor caso: 66
  requests.

Verificación:

- `format:check`, `lint`, `typecheck`, `git diff --check` y `build` (cuatro rutas
  en `ƒ (Dynamic)`) pasan.
- 1.100 unit tests (1.004 + 96).
- 93 integration tests (62 + 31):
  - el contrato del almacén corre completo sobre PostgreSQL;
  - ocho conexiones compiten por el lease y una sola lo toma;
  - seis conexiones piden el mismo plan y se crea un solo job;
  - el checkpoint tardío y la toma se fuerzan en los dos órdenes con el lock
    retenido desde otra conexión, y nunca ganan los dos;
  - las invariantes se sostienen también en la base;
  - un backfill de punta a punta con `429` y un checkpoint perdido repetido deja
    una corrida `duplicate`.
- 131 E2E, sin cambios.
- Rollback de `0010` probado en una base descartable: se niega con un job abierto
  y con un lease tomado, revierte sin trabajo en curso y `0010` se vuelve a
  aplicar.
- Migración aplicada al PostgreSQL personal. Ahí no se creó ningún job.

Evidencia sobre datos reales (2026-09-16), en una réplica descartable clonada del
grafo personal:

- **Plan.** 503 miembros dan 501 filers: 500 emisores más el antecesor de
  ExxonMobil, con cero rechazos. El plan en seco sobre la base personal da lo
  mismo.
- **Job de nueve arquetipos:** JPMorgan, el antecesor de ExxonMobil, Wells Fargo,
  Apple, Realty Income, Microsoft, NVIDIA, Berkshire y ExxonMobil. Pedirlo dos
  veces devuelve el mismo job.
  - **`kill -9` con JPMorgan en curso:**
    - la corrida siguiente encuentra la fuente ocupada, nombra al holder y no hace
      ningún request;
    - al vencer el lease, otra corrida lo toma, recupera el item y lo reintenta
      (intento 2: 47 requests en 29,8 s).
  - **Segundo `kill -9` con Apple en curso:**
    - `ingestion:jobs --release` recupera el item en el acto y deja el motivo en
      la bitácora;
    - dos procesos lanzados a la vez: uno corre y el otro sale `source_busy` sin
      ningún request.
  - **Pausa desde otro proceso:** la empresa en curso termina y la corrida se
    detiene con el lease libre. Reanudar completa el job: 9 de 9.
  - **Bitácora:** 46 eventos que cuentan toda la secuencia.
- **Universo completo, con las dos correcciones de abajo.**
  - Resultado: 501 de 501 filers completos, en tres corridas y unos 37 minutos, con
    1.649 requests y ningún item fallado ni envenenado.
  - Las corridas:
    - la primera, cortada con Ctrl-C, terminó la empresa en curso y soltó el lease;
    - la segunda paró por la reserva de presupuesto con 936 requests (268
      empresas en 20,5 min);
    - la tercera completó el resto con 593.
  - Ritmo: unas 3,3 requests y 4,4 s por empresa.
  - Corridas de ingesta: 354 `succeeded`, 136 `partial` (12.115 registros
    rechazados con nombre) y 11 `duplicate`.
  - Publicado: 1.299.374 observaciones de 501 sujetos y 30.852 documentos.
  - Tamaño: la base pasó de 24 MB a 1,2 GB, un dato para la base hosteada de
    `F6-06`.
  - Después de corregir el transporte: 1.529 requests sin ninguna señal de la
    fuente.
  - La réplica se borró al terminar. El backfill **no** se corrió sobre la base
    personal y no debe correrse hasta cerrar el incremento 2.

Dos defectos anteriores encontrados por estas corridas y corregidos, con pruebas
que fallan sobre el código viejo:

- **La tercera ingesta del mismo contenido chocaba con el índice único.**
  - `findByIdempotencyKey` devolvía la corrida más reciente, y las `duplicate`
    llevan la misma clave.
  - Apple terminó `poisoned` por ese defecto (la poison policy hizo su trabajo) y
    volvió a la cola con `--requeue` tras corregirlo.
  - Afectaba también a splits y listings. El repositorio devuelve ahora la corrida
    publicable.
- **`ETIMEDOUT` sin mensaje en menos de un segundo**: dos veces en unos 210
  requests del 2026-09-16, y una más el día anterior.
  - Causa: el _happy eyeballs_ de Node 22 prueba cada dirección con 250 ms y el
    host no tiene ruta IPv6, así que un SYN perdido hacia el único IPv4 de
    `data.sec.gov` tumba la conexión.
  - El transporte espera ahora 5 s por dirección (enmienda de la ADR 0009).
  - Antes de encontrar la causa, este corte llevó a que `unavailable` espere
    1 minuto dentro de la corrida en vez de frenarla.

Incremento 2 — ventana de historia y almacenamiento eficiente. Los dos pasos se
entregaron el 2026-09-17 (ver los dos «Entregado» al final). El owner aprobó el
paso 2 ese mismo día.

Decisión del owner (2026-09-16): se guardan **cinco ejercicios** de historia. Más
que eso no se justifica, y 1,2 GB para el universo es demasiado. El objetivo es
guardar sólo lo que la metodología va a usar.

Medición sobre la base personal (14.276 observaciones de 6 emisores), que motiva el
incremento:

- **Tamaño por fila:** cada observación ocupa unos 555 bytes más unos 390 de
  índices. 1,3 millones de filas dan los 1,2 GB del universo; no se guardan
  payloads.
- **Antigüedad:** el 37 % de las filas es de períodos anteriores a 2016, el 30 %
  de 2016–2020 y el 33 % de 2021 en adelante. Las re-expresiones son el 5 %.
- **Ventana de cinco ejercicios:** se queda con el **34 %** de las filas, unos
  **410 MB** para el universo con el formato actual.
- **Composición dentro de la ventana:**
  - 41 % saldos de balance y carátula;
  - 24 % trimestres de resultados;
  - 15 % acumulados de resultados, derivables de trimestres más ejercicio;
  - 9 % ejercicios de resultados;
  - 11 % flujo de fondos, donde el acumulado es lo único que publica la SEC.
- **Procedencia redundante:** unos 260 de los 555 bytes de cada fila.
  - `content_hash` y `revision_group_id` son hex en texto (65 bytes cada uno;
    32 en binario), y el segundo aparece además en dos índices.
  - `external_id` ocupa 95 bytes y se arma con datos que ya están en otras
    columnas.
  - `metric_id` es idéntico a `concept` en el 100 % de las filas (37 bytes), por
    ahora.
  - `source_id`, `dataset_id` y `parser_version` (50 bytes) se derivan de la
    corrida.

Alcance, en este orden:

1. **Ventana de cinco ejercicios** (decidida), como regla versionada
   `sec-history-5fy-1.0.0` con su ADR (0017; la 0016 fija el alcance analítico):
   - **Ancla:** el cierre del último ejercicio **anual** que reportó el propio
     filer, no el reloj. Si no hay ninguno, el último período. Así un filer con
     cierre en junio sin 10-K nuevo no pierde un año, y la misma descarga recorta
     igual.
   - **Qué entra:**
     - las duraciones que terminan después de `ancla − 5 años + 14 días`;
     - los saldos desde `ancla − 5 años − 14 días`, que incluyen el saldo de
       apertura del primer ejercicio.

     Los 14 días absorben los ejercicios de 52/53 semanas.

   - **Dónde se aplica:** en `live-company-facts-source`, justo después de
     `parseSecCompanyFacts` y **antes** de elegir los archivos históricos de
     `submissions`. Además de filas, ahorra requests: JPMorgan pedía 41 archivos
     por sus 10-K viejos.
   - **Versión de selección:** sube (`sec-core-concepts-2.0.0`, los mismos 58
     conceptos recortados a la ventana). Así, un período anterior sigue siendo
     «no se fue a buscar» para `F3-02`. Los jobs planeados con 1.0.0 dejan de
     correr (`assertCompanyFactsJob`).
   - **Sin poda:** lo ya publicado no se borra (append-only). La ventana gobierna
     las ingestas nuevas; una poda de filas viejas sería otra decisión, con su
     auditoría. La base personal hoy tiene 13 MB de observaciones. _(El owner la
     autorizó el 2026-09-17 y es el paso 3, abajo.)_
   - **Splits:** un split anterior a la ventana no afecta lecturas dentro de ella,
     porque todo lo reportado después ya está en la base nueva. Hay que
     documentarlo y verificar que `corporate-actions:splits` rechace con nombre lo
     que queda afuera.
   - **Tests:**
     - ancla anual, calendario y de 52/53 semanas;
     - filer sin ejercicio anual;
     - 29 de febrero;
     - saldo de apertura adentro y trimestre anterior afuera;
     - menos archivos históricos pedidos;
     - la corrida registra la versión.
   - **Medición real:** dry run de `fundamentals:ingest` sobre Apple, JPMorgan,
     Berkshire, NVIDIA, Realty Income y Wells Fargo, con vintages y requests
     antes y después.
2. **Filas más livianas**, con migración de `observations` y aprobación del owner
   antes de empezar:
   - hashes en `bytea`, convertidos en el borde del repositorio para que el
     dominio siga viendo hex;
   - `external_id`, `metric_id` y la procedencia repetida, evaluados contra el
     contrato point-in-time antes de tocarlos;
   - un índice redundante, si lo hay.

   Estimación: cerca de un 40 % menos por fila, unos **250 MB** para el universo
   con la ventana. Se mide con un prototipo antes de decidir.

3. **Poda de lo que quedó fuera de la ventana** (agregado el 2026-09-17, cuando el
   owner la autorizó): regla versionada, complemento exacto de la ventana y con su
   misma aritmética, sin red, con el ancla tomada de la corrida que la registró y
   una fila de auditoría por sujeto en la misma transacción que el borrado.
4. **Acumulados de resultados (15 %):** no se descartan en este incremento.
   Derivarlos es normalización de Fase 3/4. Queda anotado como opción medida.

Criterios de aceptación: la ventana es versionada y está probada; la reducción de
filas y de requests está medida sobre datos reales; la ADR 0017 existe; el
runbook y el plan del backfill reflejan la ventana; y el backfill del universo
sobre una réplica ocupa lo estimado.

Entregado (2026-09-17) — incremento 2, paso 1, la ventana. Decisiones en la
[ADR 0017](../architecture/adr/0017-sec-history-window.md).

El sondeo previo (25 filers, 50 requests, sin conservar payload) cambió el diseño
de arriba en dos puntos antes de escribir código:

- **Corte único por fin de período** (`end >= ancla − 5 años − 14 días`), también
  para las duraciones. El corte de arriba dejaba afuera el EPS diluido y el net
  income anuales del ejercicio base en los 21 filers con historia, y la matriz de
  divergencias a 5 años los necesita (ADR 0016). Cuesta 0,8 puntos de filas.
- **Un ejercicio más para los seis conceptos sensibles a splits.** Sin él, el 4:1
  de NVIDIA de 2021 se confirmaba en el 10-K de marzo de 2022 y ajustaba dos veces
  18 vintages ya en base nueva, y el 1:8 de GE no se confirmaba. Cuesta 1,1 puntos.

Además, el ancla es la duración anual más reciente con foco `FY`: sin el foco,
Amazon anclaría en un TTM de un 10-Q.

Qué se entregó:

- `src/modules/fundamentals/domain/sec-history-window.ts`: regla
  `sec-history-5fy-1.0.0`, aritmética de calendario con el 29 de febrero.
- `sec-concept-selection.ts`: selección `sec-core-concepts-2.0.0`, con la ventana
  como componente fijado por test y los conceptos de evidencia tomados de
  `share-basis`.
- `live-company-facts-source`: la ventana se aplica antes de las vintages y de los
  archivos históricos. El resultado de la ingesta y `pnpm fundamentals:ingest`
  muestran ancla, cortes y puntos dentro.
- `ingestion_runs.selection_anchor_on`:
  - migración `0011`, con su check espejado en Zod;
  - rollback pareado que se niega mientras haya anclas;
  - el ancla entra a la versión del documento.
- `split-claim-horizon-1.0.0` en `corporate-actions`: los ratios declarados antes
  de la primera vintage sensible publicada salen de la regla como
  `precedes_published_history`.
  - Sin eso, un anuncio viejo «corroboraba» un split posterior con el mismo ratio.
  - Pipeline `sec-split-1.1.0`. La regla de evidencia no cambia, así que los splits
    registrados siguen `unchanged`.
- Documentación: ADR 0017, enmienda de la ADR 0010, runbooks de backfill y de
  migraciones (que además no listaba el rollback de `0010`), contrato
  point-in-time, registro de fuentes, `CLAUDE.md`, `AGENTS.md` y `README.md`.

Verificación:

- `format:check`, `lint`, `typecheck`, `git diff --check` y `build`
  (cuatro rutas en `ƒ (Dynamic)`) pasan.
- 1.128 unit tests (1.100 + 28).
- 94 integration tests (93 + 1): el ancla hace ida y vuelta por PostgreSQL como
  fecha y el check rechaza un ancla sin versión.
- 131 E2E, sin cambios.
- Rollback de `0011` probado en una base descartable:
  - revierte sin anclas y la migración se vuelve a aplicar;
  - con anclas registradas se niega y la columna queda.

Evidencia sobre datos reales, en réplicas descartables del grafo personal:

- **Dry run de los seis filers del backlog**, antes (código de `main`) y después:

  | Filer         | Vintages antes |  Vintages después | Archivos históricos |    Requests |
  | ------------- | -------------: | ----------------: | ------------------: | ----------: |
  | Apple         |          3.254 |     1.151 (35,4%) |               1 → 0 |       3 → 2 |
  | JPMorgan      |          2.078 |       614 (29,5%) |             45 → 25 |     47 → 27 |
  | Berkshire     |          1.793 |       614 (34,2%) |               1 → 0 |       3 → 2 |
  | NVIDIA        |          3.541 |     1.194 (33,7%) |               1 → 1 |       3 → 3 |
  | Realty Income |          2.034 |       821 (40,4%) |               1 → 0 |       3 → 2 |
  | Wells Fargo   |          2.174 |       756 (34,8%) |               6 → 2 |       8 → 4 |
  | **Total**     |     **14.874** | **5.150 (34,6%)** |         **55 → 28** | **67 → 40** |

- **Anclas:** del cierre fiscal de cada filer: 2025-09-27 (Apple), 2026-01-25
  (NVIDIA), 2026-05-31 (Nike) y 2025-12-31 para los de calendario. El sucesor de
  ExxonMobil, sin ejercicio anual, ancla en su último período (2026-06-30); su
  antecesor aporta desde el cierre base 2020 hasta FY2025.
- **Splits con la ventana** (8 ingestas con 46 requests, 6 verificaciones con 6):
  - NVIDIA 4:1 y 10:1, Apple 4:1 y Alphabet 20:1 se confirman en las mismas
    presentaciones que con la historia completa, con el mismo hash de contenido
    que en la base personal;
  - GE 1:8 se confirma en el 10-Q del 2021-10-26 y Amazon 20:1 en el del
    2022-07-29;
  - los 7:1 de Apple, los ocho 2:1 de Nike y los 2:1 de Alphabet de 2016 quedan
    `precedes_published_history`.
- **Contrafáctico** (filas de evidencia de NVIDIA y GE borradas en la réplica):
  NVIDIA 4:1 se confirma en el 10-K del 2022-03-18, y GE queda
  `reexpression_incomplete` y `reexpressed_before_ratio_filing`.
- **Universo con la ventana**, en una réplica limpia del grafo:
  - 501 de 501 filers en dos corridas y 25 minutos, con 1.194 requests (antes,
    1.649 en 37 minutos);
  - una señal `transport_error` difirió a Warner Bros. Discovery sin gastar el
    intento; ningún item fallado ni envenenado;
  - 464.531 observaciones (35,8 % de antes) y 13.141 documentos;
  - la base pasó de 9,4 MB a **451 MB**. Las observaciones ocupan 434 MB, a 980
    bytes por fila, y la estimación era de unos 448 MB;
  - 497 anclas coinciden con el cierre del último reporte anual. Paramount
    Skydance y Ferguson, cuyo último reporte anual no cubre doce meses, anclan en
    su último ejercicio completo: un corte más amplio.
  - La réplica se borró al terminar. Nada se corrió sobre la base personal.
- **Migración `0011` aplicada al PostgreSQL personal**, sin ninguna corrida nueva:
  la columna existe y no tiene anclas.

Entregado (2026-09-17) — incremento 2, paso 2, filas más livianas. Decisiones en la
[ADR 0018](../architecture/adr/0018-lighter-observation-rows.md).

El prototipo (copias frescas de las 14.276 filas de la base personal en una
réplica) cambió el alcance de arriba en tres puntos:

- **`late_ingestion` también sale de la fila.** Estaba en el 100 % de las filas y
  coincide siempre con la regla de 24 horas: 17 bytes por fila.
- **`metric_id` no se borra: queda nulo cuando es el concepto.** El catálogo de
  métricas lo va a necesitar.
- **El índice que sobra no era uno sino un índice y media clave.**
  `observations_knowledge_idx` tenía 0 scans, y `as_of` en el índice de sujeto
  impedía deduplicar: de 72 a 10 bytes por fila.

Resultado del prototipo, en bytes por fila con índices: 890 → 737 con los hashes
en binario, → 484 sin ID externo ni procedencia repetida, → **467** con el flag
derivado. Reordenar las columnas daba 459 y obligaba a recrear la tabla: quedó
afuera.

Qué se entregó:

- `observation.ts`:
  - `externalId` deja la observación publicada: es identidad de staging y sigue
    entrando al content hash, así que ningún hash cambia;
  - `isLateIngestion` y `withIngestionFlags`; el schema exige `late_ingestion`,
    último, exactamente cuando la regla lo pide.
- `sec-fact-rules.ts`: `formatSecUnit`, inversa exacta de `mapSecUnit`, y
  `secFactExternalId`, la única fórmula del ID externo de la SEC, con su formato
  fijado por test. La usa la construcción de vintages.
- `schema.ts`: el tipo `sha256` (`bytea`, hex en el borde, rechaza lo que no es hex)
  para los dos hashes; `metric_id` nulo con check contra la copia; sin fuente,
  dataset, parser ni ID externo; check que rechaza `late_ingestion` guardado;
  índice de sujeto `(subject_type, subject_id, coalesce(metric_id, concept))`; sin
  índice de conocimiento.
- `postgres-observation-repository.ts`: lee con join a `ingestion_runs`, filtra por
  `coalesce(metric_id, concept)` y, al publicar, falla con
  `ObservationProvenanceError` antes de escribir si una observación no trae la
  fuente, el dataset y el parser de su corrida.
- Migración `0012`, escrita a mano sobre lo que generó `drizzle-kit`: un guardia
  que se niega y cuenta las filas que perderían información, y una sola
  reescritura. Su rollback pareado restaura la forma anterior y se niega con filas
  cuyo ID externo no tiene fórmula.
- Documentación: ADR 0018, contrato point-in-time, registro de fuentes, runbooks de
  migraciones y de backfill, `CLAUDE.md`, `AGENTS.md` y `README.md`.

Verificación:

- `format:check`, `lint`, `typecheck`, `git diff --check` y `build` (cuatro rutas
  en `ƒ (Dynamic)`) pasan.
- 1.145 unit tests (1.128 + 17).
- 131 E2E, sin cambios.
- 99 integration tests (94 + 5):
  - ida y vuelta exacta entre lo que la publicación construyó y lo que se lee;
  - forma física de la fila: sin las cuatro columnas, hashes de 32 bytes y flags
    de la fuente sin `late_ingestion`;
  - los tres checks nuevos y el hash mal formado rechazado en el borde;
  - cuatro procedencias ajenas rechazadas sin escribir ni cerrar la revisión
    vigente;
  - cada hash de la SEC se vuelve a calcular con la fila liviana y su corrida.

Evidencia sobre datos reales, en réplicas descartables de la base personal:

- **Migración:** 1 s. `observations` pasa de 13 MB a **7,0 MB**, de 954 a **491
  bytes por fila**. La tabla baja de 8,1 a 4,7 MB y los índices, de 5,5 a 2,2 MB.
  Las 14.276 filas conservan byte a byte todo lo que queda.
- **Reingesta con `--apply`** de Apple, NVIDIA, Alphabet, Duke y ExxonMobil con su
  antecesor: 0 publicadas y 5.107 duplicadas, en 14 requests.
- **Splits:** NVIDIA y Apple dan `unchanged`, y el filtro por métrica encuentra
  666 y 689 revisiones sensibles.
- **Rollback:** las 14.276 filas quedan idénticas en todas sus columnas, con los
  índices y checks anteriores. La `0012` se reaplica al mismo tamaño.
- **Guardias:**
  - la migración se niega con un ID externo alterado, un parser ajeno y un flag
    fuera de lugar, nombra una fila de cada uno y no toca nada;
  - el rollback se niega con una fila de otra fuente.
- **Universo**, en una réplica limpia del grafo:
  - 501 de 501 filers en dos corridas y 21 minutos, con 1.192 requests, sin
    señales de la fuente ni items fallados;
  - las mismas filas que en el paso 1: 464.531 observaciones, 13.141 documentos,
    464 `succeeded` y 37 `partial` con 2.611 rechazos con nombre;
  - las observaciones ocupan **229 MB** (antes 434), a **516 bytes por fila**
    (antes 980), y la base, **245 MB** (antes 451);
  - compactada, la tabla queda en 206 MB, a 465 bytes por fila, como el
    prototipo;
  - la réplica se borró al terminar.
- **Migración `0012` aplicada al PostgreSQL personal**, después de un backup:
  observaciones de 13 a 6,8 MB y base de 24 a 18 MB. Las 14.276 filas se leen por
  el repositorio y pasan el schema del dominio. No hubo corridas nuevas.

Entregado (2026-09-17) — incremento 2, paso 3, la poda. El owner la autorizó ese
día. Decisiones en la [ADR 0019](../architecture/adr/0019-observation-history-prune.md)
y operación en el [runbook](../runbooks/history-prune.md).

El punto de la decisión no fue borrar sino qué queda dicho después. La ADR 0017 §5
puso `selection_anchor_on` para que `F3-02` distinga «el filer no lo reportó» de «la
corrida no lo fue a buscar»; un `DELETE` a secas rompe eso, porque la corrida
`sec-core-concepts-1.0.0` de cada filer fue a buscar desde 2006 y la base pasaría a
afirmar que no hay nada anterior a 2020. Además el ancla avanza con cada ejercicio,
así que la poda se repite: no es un borrado único.

Qué se entregó:

- `observation-prune.ts`: el plan genérico (un corte por fin de período y otro, más
  ancho, para una lista de conceptos de evidencia) y el registro, con las
  invariantes que lo hacen legible sin el código que lo escribió.
- `plan-sec-history-prune.ts`: regla `sec-history-prune-1.0.0`. Toma el ancla de la
  corrida, nunca de las filas —el foco `FY` no está en la observación—, y rechaza
  por nombre `anchor_unknown` y `selection_superseded`.
- `secHistoryCutsFrom` en `sec-history-window.ts`: la aritmética de la ventana pasa
  a existir una sola vez, y la usan la ingesta y la poda.
- `ObservationRepository.countPruneTargets`, `prune` y `listPrunes`, en PostgreSQL y
  en el doble; `IngestionRunRepository.findLatestAnchored`.
- Migración `0013` con `observation_prunes` y su rollback pareado, que se niega
  mientras haya podas registradas.
- Comando `pnpm fundamentals:prune`.
- Documentación: ADR 0019, contrato point-in-time, runbook nuevo, runbook de
  migraciones, `CLAUDE.md`, `AGENTS.md` y `README.md`.

Verificación:

- `format:check`, `lint`, `typecheck`, `git diff --check` y `build` (cuatro rutas en
  `ƒ (Dynamic)`) pasan.
- 1.163 unit tests (1.145 + 18).
- 108 integration tests (99 + 9): el borrado conserva el ejercicio de evidencia y no
  toca otro sujeto, otra fuente ni otro dataset; el registro guarda ancla, corrida y
  extremos; la segunda poda no encuentra nada y se registra igual; los tres checks
  nuevos y la foreign key del ancla rechazan; y un registro que la base rechaza deja
  las seis filas en su lugar, porque el borrado y la auditoría son una transacción.
- 131 E2E, sin cambios.
- Rollback de `0013` probado en una base descartable: revierte sin podas, se reaplica
  y se niega con una poda registrada.

Evidencia sobre la base personal (2026-09-17), con `pg_dump -Fc` previo:

- **Reingesta de los seis filers** (14 requests): 0 publicadas, 5.107 duplicadas, y
  las seis anclas registradas —Apple 2025-09-27, NVIDIA 2026-01-25, Alphabet, Duke y
  el antecesor de ExxonMobil 2025-12-31, y el sucesor 2026-06-30 por
  `latest_period`, el único sin ejercicio anual—.
- **Poda**, sin red: 14.276 → **5.107** filas, 9.169 borradas.

  | Filer           |      Ancla |      Corte | Antes | Borradas | Quedan |
  | --------------- | ---------: | ---------: | ----: | -------: | -----: |
  | Apple           | 2025-09-27 | 2020-09-13 | 3.254 |    2.103 |  1.151 |
  | NVIDIA          | 2026-01-25 | 2021-01-11 | 3.541 |    2.347 |  1.194 |
  | Duke            | 2025-12-31 | 2020-12-17 | 3.071 |    2.170 |    901 |
  | Exxon antecesor | 2025-12-31 | 2020-12-17 | 2.510 |    1.688 |    822 |
  | Alphabet        | 2025-12-31 | 2020-12-17 | 1.811 |      861 |    950 |
  | Exxon sucesor   | 2026-06-30 | 2021-06-16 |    89 |        0 |     89 |

- **Las filas que quedan son las que una ingesta nueva produciría:** una tercera
  ingesta con `--apply` publica 0 y duplica 5.107 con 14 requests. Los 5.107 ya eran
  las vintages que la reingesta había contado filer por filer.
- **Integridad:** 0 cadenas de revisión rotas y 0 revisiones vigentes duplicadas.
  Ningún grupo cruza el corte, y no puede: sus revisiones comparten `as_of`.
- **Splits:** `unchanged` en Apple, NVIDIA y Alphabet. El 7:1 de Apple de 2014 sigue
  registrado y la corrida lo nombra `recorded_split_not_reconfirmed`, con su ratio
  `precedes_published_history`. Ninguna lectura `latest_adjusted` cambia: ese ratio
  sólo afectaba períodos anteriores a 2014 y la fila más vieja de Apple es del
  2019-09-28.
- **Documentos:** los 326 se conservan, 191 sin observaciones. Tres corporate actions
  registradas apuntan a documentos que quedarían huérfanos.
- **Tamaño:** observaciones de 6,5 MB a **2,4 MB** compactadas (481 bytes por fila,
  contra 491 medidos en la ADR 0018) y la base de 18 MB a **14 MB**.

Entregado (2026-09-18) — incremento 3, presupuesto diario y kill switch por fuente.
Decisiones en la [ADR 0020](../architecture/adr/0020-source-daily-budget-kill-switch.md)
y operación en el [runbook](../runbooks/source-budgets.md).

El ritmo por corrida acota **un proceso**: cada comando arranca con su techo
entero, así que dos ingestas seguidas son 2.000 requests y nada acota un día, que
es la unidad en la que una fuente mide el abuso. Y no había forma de frenar una
fuente sin dejar de correr los comandos y acordarse. Los dos agujeros son los que
`TM-10` y `TM-11` nombraban desde `F2-03`.

Qué se entregó:

- `source-budget.ts`: topes declarados (`SOURCE_DAILY_REQUEST_BUDGETS`), día UTC,
  tope efectivo —un control **baja** el declarado y nunca lo sube—, la reserva y
  los cuatro veredictos con su nombre.
- `source-budget-store.ts` con su contrato compartido, `metered-egress-fetch.ts`,
  `postgres-source-budget-store.ts` y el doble en memoria.
- `getSourceEgressFetch` como única forma de conseguir un `EgressFetch` fuera de
  `src/server/egress/`, con `getEgressClient` restringido por ESLint a ese
  directorio; los seis comandos migrados y con comprobación previa.
- `runIngestionJob` pregunta una sola admisión antes de contar el intento:
  `budget_reserve`, `source_disabled` y `daily_budget_exhausted`.
- Migración `0014` con las dos tablas y rollback pareado, que se niega con una
  fuente frenada.
- Comando `pnpm ingestion:sources`.
- Documentación: ADR 0020, threat model (`TM-10` pasa a implementado), matriz de
  cuotas, runbook nuevo, runbook de migraciones, `CLAUDE.md`, `AGENTS.md`,
  `README.md`.

Decisiones que el incremento fija:

- **El contador es de la fuente, no del proceso**, y el gasto es un upsert cuyo
  incremento está condicionado al tope. No devolver fila _es_ la negativa, así que
  no hacen falta lock, lease ni transacción: es lo que permite acotar los comandos
  manuales sin darles el lease del backfill.
- **El tope se declara en código y la fila sólo puede bajarlo.** Una fuente que no
  figura en la constante no emite ninguna llamada, aunque tenga allowlist y
  derechos: son tres controles y ninguno se deduce de otro.
- **El kill switch es una fila append-only**, no una columna de `source_registry`,
  que `syncDeclaredSourceRegistry` pisaría en el próximo comando.
- **La admisión va antes de contar el intento**, así que ninguna de las tres
  negativas envenena sujetos sanos. No se inventó ningún estado nuevo de job.
- **Una negativa nuestra no es una señal de la fuente**: el observador de señales
  la ignora, y si la fuente queda frenada a mitad de una empresa el ejecutor la
  difiere sin gastar el intento.

Verificación:

- `format:check`, `lint`, `typecheck`, `git diff --check` y `build` (cuatro rutas en
  `ƒ (Dynamic)`) pasan.
- 1.194 unit tests (1.163 + 31), con el contrato del almacén corriendo sobre el
  doble en memoria.
- 119 integration tests (108 + 11): el mismo contrato sobre PostgreSQL, más
  **doce llamadas simultáneas contra un tope de cinco, de las que pasan
  exactamente cinco** con contadores 1 a 5, y dos procesos que no pueden dejar dos
  controles vigentes de la misma fuente.
- 131 E2E, sin cambios.
- Rollback de `0014` probado en una base descartable: revierte sin fuentes
  frenadas, se reaplica y se niega con una frenada.
- La regla de ESLint se probó con un import real: rechaza `getEgressClient` fuera
  de `src/server/egress/`.

Evidencia sobre la base personal (2026-09-18), con la migración aplicada:

- **El contador cuenta lo que sale.** Un `fundamentals:ingest --ticker AAPL` en
  seco hizo 2 requests y el contador quedó en 2 de 2.000.
- **Kill switch.** Con `sec-edgar` deshabilitada, `fundamentals:ingest` y
  `corporate-actions:splits` salen con
  `Source sec-edgar is disabled: prueba del kill switch.` antes de abrir ningún
  socket, y el contador del día no se mueve.
- **El techo declarado manda:** `--limit 5000` se rechaza contra el declarado de
  2.000 sin escribir; `--limit 3` se aplica.
- **Agotarlo a mitad de una corrida manual:** con el tope en 3 y 2 gastadas, la
  ingesta pasó la comprobación previa, hizo la tercera llamada y la cuarta quedó
  negada; la corrida falló con `provider_error` llevando el mensaje del
  presupuesto y el contador quedó en 3 de 3. El backfill no tiene ese borde porque
  reserva el peor caso de una empresa antes de empezarla.
- **Historia:** los cuatro cambios del ensayo quedaron con actor, motivo e
  instante, y en todo momento hubo un solo control vigente. La fuente quedó
  habilitada y en su tope declarado.

Criterios de aceptación del incremento 4:

- el conjunto seguido se enumera sin red y sin escrituras, y es exactamente el de
  la [ADR 0021](../architecture/adr/0021-refresh-followed-set.md): un filer con
  observaciones publicadas de `sec.companyfacts` y CIK vigente; lo que no resuelve
  se rechaza por nombre;
- un sondeo por filer y por vuelta: `submissions` decide, y companyfacts se baja
  **sólo** para los filers con una presentación relevante posterior a su marca de
  agua;
- la marca de agua es durable y avanza también cuando la presentación nueva no
  publica nada, de modo que dos vueltas seguidas sin novedades cuestan un request
  por filer y ninguna baja de companyfacts;
- la primera vuelta de un filer que nunca se sondeó no vuelve a bajar lo que ya
  tiene: la marca arranca de la última aceptación ya registrada;
- el refresh corre como job durable de la ADR 0015 —lease por fuente, cursor,
  reintentos, poison policy y recuperación manual— y pasa por la admisión de la
  ADR 0020: kill switch y cuota diaria lo frenan sin envenenar sujetos sanos;
- cada sondeo deja su corrida de ingesta: «cuándo se miró y qué se vio» se contesta
  desde la base (`TM-16`);
- el refresh no borra nada: cuando una presentación nueva mueve el ancla de la
  ventana, el comando lo informa y la poda sigue siendo `fundamentals:prune`
  (ADR 0019);
- se prueban idempotencia, dos procesos a la vez, crash a mitad de un sondeo,
  `429`, cuota agotada y fuente frenada, sobre el doble en memoria y sobre
  PostgreSQL;
- sigue sin haber cron: la programación es un slice aparte con su propio gate.

Entregado (2026-09-18) — incremento 4, refresh de CIK cambiados. Decisiones en la
[ADR 0021](../architecture/adr/0021-refresh-followed-set.md) (a quiénes sigue) y la
[ADR 0022](../architecture/adr/0022-companyfacts-refresh-probe.md) (sondeo, marca y
job); operación en el [runbook](../runbooks/fundamentals-refresh.md).

- `src/modules/fundamentals/`:
  - `plan-company-facts-refresh.ts`: el conjunto seguido, sin red;
  - `sec-refresh-decision.ts`: la regla del sondeo y la lista de formularios;
  - `refresh-company-facts.ts`: la vuelta de un filer;
  - `company-facts-refresh-job.ts`: plan, admisión y ejecutor del job.
- `CompanyFactsProbeSource`, puerto aparte del de la carga, con su implementación
  viva: un request, el índice de presentaciones.
- `refresh-state-store` con su contrato compartido, doble en memoria y
  `postgres-refresh-state-store.ts`, más su raíz de composición.
- `ObservationRepository.listPublishedSubjects`, que es la consulta que **define**
  el conjunto.
- Migraciones `0015` (la marca) y `0016` (el `job_kind`), con rollbacks pareados;
  el de la `0016` se niega mientras exista un job de ese kind.
- Comando `pnpm fundamentals:refresh`.

Lo que fija el incremento:

- **La marca de agua es propia.** Comparar contra lo publicado hace que una
  presentación que no aporta hechos se vea nueva en cada vuelta. Medido sobre
  Apple: su presentación relevante más nueva es un `8-K/A` del 2026-09-01 que no
  publica ningún concepto seleccionado.
- **Se escribe al final.** La marca puede quedar atrás de un refresh que falló;
  nunca adelante de uno que no ocurrió. Por eso no hace falta una transacción que
  cruce repositorios.
- **Sólo despiertan una descarga los formularios que pueden traer hechos**
  (`sec-companyfacts-forms-1.0.0`). Sin esa lista, los Form 4 de Apple harían que
  «cambió» sea siempre.
- **Sin semilla.** Un filer sin marca se refresca una vez y queda.
- **Todo sondeo deja su corrida** de `sec.submissions`; una vuelta sin novedades
  queda `duplicate`, porque lo que el sondeo vio es su contenido.
- **La vuelta completa es un job de kind propio**, con la reserva del peor caso en
  67 requests.
- **El refresh no borra.** Un ejercicio nuevo mueve el ancla y lo que sobra lo saca
  `fundamentals:prune`.

Verificación:

- `format:check`, `lint`, `typecheck`, `git diff --check` y `build` (cuatro rutas
  en `ƒ (Dynamic)`) pasan.
- 1.251 unit tests (1.201 + 50).
- 131 integration tests (120 + 11), con el contrato de la marca corrido completo
  sobre PostgreSQL y sus invariantes negadas por la base.

Evidencia sobre datos reales (2026-09-18), en una réplica descartable clonada del
grafo personal:

- **Vuelta completa, primera vez:** 6 filers, 20 requests, 15,3 s. Los seis
  `never_probed`, cada uno con su descarga y **cero** filas nuevas publicadas.
- **Vuelta completa, segunda vez:** 6 requests, 2,7 s, ninguna descarga de
  companyfacts. Es el estado estacionario.
- **Apple:** 3 requests la primera vuelta y 1 la segunda.
- **Presentación nueva:** con la marca movida a mano al 2026-05-01, el sondeo
  nombró las tres relevantes posteriores —un `8-K`, el `10-Q` del 2026-07-31 y el
  `8-K/A`—, volvió a bajar y dejó la marca donde iba.
- **Kill switch:** con `sec-edgar` frenada, el comando sale con el motivo antes de
  abrir ningún socket.
- **Reserva del peor caso:** con el tope del día en 35 y 30 gastadas, el job paró
  en `daily_budget_exhausted` con 0 requests, los 6 items `pending`, ninguno
  envenenado, el lease libre y la hora de reposición.
- **Dos procesos a la vez:** uno completó el job (6 requests) y el otro salió
  `source_busy` con 0 requests, nombrando al holder.
- **`kill -9` a mitad de un item:** el item quedó `running` bajo el lease de un
  proceso muerto, la corrida siguiente salió `source_busy` sin ningún request,
  `ingestion:jobs --release` lo devolvió a `pending` con su motivo, y la corrida
  siguiente lo completó en el intento 2.

Contra la base personal se gastó **un** request —el sondeo en seco de Apple— y no
se escribió ninguna fila: las migraciones `0015` y `0016` se aplicaron ahí, vacías.

`F2-05` cierra. Límites: no hay cron —programarlo es un slice con su propio gate—;
un cambio de companyfacts sin presentación nueva no lo ve el refresh y se arregla
con `fundamentals:ingest --ticker`; y el refresh no dispara la verificación de
splits, que sigue siendo `corporate-actions:splits` a mano.

<a id="f2-06"></a>

#### `F2-06` — Golden fixtures desde extractos reales congelados

- Estado: `done` (2026-09-18, iniciado el mismo día). Los tres incrementos
  están entregados.
- Fase y dependencia: Fase 2; `F2-03` cerrado. Se apoya además en la ventana de la
  [ADR 0017](../architecture/adr/0017-sec-history-window.md) y en el egress con
  presupuesto de la [ADR 0020](../architecture/adr/0020-source-daily-budget.md),
  porque la captura sale por la misma puerta que una ingesta.
- Problema: hoy el oráculo de regresión de los tres parsers de la SEC es
  [`fixture-sec-filer.ts`](../../src/modules/fundamentals/infrastructure/fixture-sec-filer.ts),
  un filer sintético que copia la **forma** del cable y los casos que se
  observaron en él, pero ningún valor, fecha ni accession suyo viene de una
  descarga. Prueba que el parser hace lo que creemos que hace; no prueba que el
  cable sea como creemos que es. Un cambio de la SEC —un campo nuevo, una unidad
  no vista, un `frame` ausente, una taxonomía que se mueve— no rompe ningún test.
- Alcance, en tres incrementos que se cierran en este orden:
  1. **derechos y exposición** (gate): el repositorio es público y `AGENTS.md`
     prohíbe commitear payloads capturados. Congelar extractos reales cambia esa
     exposición, así que necesita su ADR antes de la primera descarga: qué
     autoriza la SEC sobre copia y redistribución, qué queda afuera, y cómo pasan
     a `allowed` los derechos que hoy `sec-edgar` declara `unknown`
     (`rawStorage`, `publicDisplay`, `export`). No convierte la fuente en
     `approved_public_demo`: no hay demo pública ([ADR 0004](../architecture/adr/0004-personal-first-runtime.md)).
  2. **corpus congelado**: un comando a mano captura `submissions` y
     `companyfacts` de los filers elegidos, los **reduce** a lo que el oráculo
     necesita y los escribe versionados con un manifiesto —URL, `accession`,
     instante de descarga, bytes, `sha256` y versión del reductor—. La captura
     sale por el egress con su presupuesto; el corpus, una vez congelado, no
     vuelve a la red nunca.
  3. **oráculo de regresión**: los tests de los parsers, de los vintages, de la
     ventana y de las reglas de split pasan a correr contra el corpus con sus
     salidas esperadas commiteadas. `FixtureCo` no se borra —sigue siendo el
     oráculo de los casos que el cable real no ofrece: parser roto, fuente caída,
     lote vacío— pero deja de ser el único.
- Controles: `TM-05` (el corpus es lo que hace detectable una respuesta parcial o
  un parser roto contra el cable real) y `TM-16` (el manifiesto es lo que deja
  explicar de dónde salió cada byte del oráculo).
- No autoriza: cron, demo pública, ni conservar el payload íntegro de una ingesta
  del modo personal. El corpus es un extracto elegido y reducido a propósito, no
  un recording.
- Fuera de alcance, declarado: la reconciliación contra el filing de 30 empresas
  de arquetipos distintos y la validación semántica XBRL de muestra (Arelle/DQC)
  son el **gate de Fase 2**, no este issue. `F2-06` entrega el corpus y el
  arnés que esa reconciliación va a usar; correrla y registrarla es el cierre de
  la fase.

Criterios de aceptación del incremento 1:

- una ADR cita la condición publicada por la SEC, con fecha de consulta, y dice
  qué se puede copiar, qué atribución corresponde y qué queda prohibido;
- `demo-source-registry.ts` deja de declarar `unknown` los derechos que la ADR
  resuelve, con `rightsReviewedAt` nuevo y evidencia apuntando a la ADR;
- el registro de fuentes, la matriz de uso y la política de fixtures del código
  dicen lo mismo;
- ninguna descarga ocurre antes de que el owner apruebe la ADR.

Criterios de aceptación del incremento 2:

- el comando es a mano, dry-run por defecto, y pasa por `getSourceEgressFetch`
  con el presupuesto de la fuente;
- cada archivo del corpus tiene manifiesto con URL, instante de descarga, bytes y
  `sha256`, y una verificación recalcula los hashes y falla si algo derivó;
- la reducción es determinista y versionada: el mismo extracto produce el mismo
  archivo, y el reductor declara qué tiró;
- el corpus entra en un presupuesto de bytes declarado y medido, coherente con la
  frugalidad de las ADR 0017 y 0018;
- los filers elegidos cubren arquetipos distintos y se justifica cada elección.

Criterios de aceptación del incremento 3:

- los tests de parsers, vintages, ventana y splits corren contra el corpus con
  salidas esperadas commiteadas, bajo la guardia de red del suite unitario;
- una diferencia del cable —campo nuevo, unidad no vista, concepto movido— rompe
  un test con un nombre que dice qué cambió;
- `FixtureCo` queda con su rol acotado y documentado, no borrado;
- la actualización del corpus es un diff revisable, nunca una resolución de
  «lo último» en runtime.

Entregado (2026-09-18). Derechos en la
[ADR 0023](../architecture/adr/0023-frozen-sec-extracts-rights.md) y operación en
el [runbook](../runbooks/golden-corpus.md).

- **Incremento 1**: la ADR cita la condición publicada por la SEC —información
  pública, copiable y redistribuible con cita, sin el sello ni los logos—
  consultada el 2026-09-18. `sec-edgar` pasa `rawStorage`, `publicDisplay` y
  `export` a `allowed` con revisión nueva; `aiTransfer` sigue `unknown` porque no
  lo decide la SEC sino el receptor. La fila sigue en `approved_personal`: mostrar
  datos en una superficie anónima sigue exigiendo `approved_public_demo`. La
  prohibición de commitear payloads se precisó en `AGENTS.md` y `CLAUDE.md` con
  las cuatro propiedades que distinguen un corpus de un recording. Hallazgo: la
  matriz de uso ya decía «copia y redistribución con cita»; la conclusión nunca
  había bajado a la fila del registro, que es la que el gate lee.
- **Incremento 2**: `pnpm fixtures:capture`, el reductor versionado
  (`sec-corpus-reducer-1.0.0`), el manifiesto con URL, instante, bytes y `sha256`
  —del archivo y del documento entero que no se conserva—, y
  `parseJsonPreservingNumbers`/`stringifyJsonPreservingNumbers`, que reescriben el
  JSON sin que ningún número pase por un `double`. El reductor es más grueso que
  lo que el corpus prueba —ocho ejercicios contra seis, más una muestra declarada
  de conceptos no seleccionados y el primer concepto de cada taxonomía
  desconocida—, porque un archivo recortado con la selección volvería tautológico
  el test de la selección. La lista de formularios de alto volumen es negra y no
  blanca, y los nombres cortos se comparan exactos: `4` como prefijo se llevaba
  puesto el `40-F`.
- **Incremento 3**: `golden-sec-oracle.test.ts`, con los números commiteados y
  reconciliados contra el filing —los US$ 391.035 millones del 10-K de Apple, el
  ejercicio 2019 repetido por tres 10-K, el EPS de NVIDIA de 12,05 a 1,21 por el
  10:1 y el de Alphabet de 113,88 a 5,69 por el 20:1—, más los dos casos en que la
  aceptación y la fecha de presentación no coinciden, que es de lo que depende
  `available_at`. `golden-sec-corpus.test.ts` verifica bytes y `sha256` de cada
  archivo. El filer sintético queda con su rol acotado y escrito en su encabezado.

Medido: 19,5 MB descargados quedan en 2,7 MB congelados (86 % de reducción), con
un presupuesto declarado de 4 MB. 24 requests gastados en total, entre el ensayo
en seco y la captura. 1.324 unit y 131 integration pasan.

`F2-06` cierra, y con él el último casillero de la Fase 2. Límites: el corpus son
seis filers y no los 30 arquetipos del gate de fase; la validación semántica XBRL
de muestra (Arelle/DQC) sigue pendiente; y el corpus no alimenta ninguna
superficie ni ninguna ingesta, sólo lo leen tests.

<a id="f2-07"></a>

#### `F2-07` — Gate de Fase 2: verificación sobre datos reales

- Estado: `done` (iniciado y cerrado el 2026-09-21).
- Fase y dependencia: Fase 2; `F2-06` cerrado. Es el **gate de la fase**, no un
  casillero más: el roadmap ya tiene sus seis puntos en `done` y la Fase 2 no puede
  pasar a `done` sin esta evidencia.
- Problema: las cuatro afirmaciones del gate —30 empresas de arquetipos distintos
  reconciliadas contra su filing, 100 % de filas con source/as-of/available-at,
  splits, restatements y un cambio de símbolo probados, y un `as_known` anterior a
  un restatement que no devuelve el valor enmendado— hoy están sostenidas por
  **verificaciones manuales de una sola empresa**, escritas en prosa en el
  [contrato point-in-time](../data/point-in-time-contract.md): los 39.572 M de
  Apple que pasan a 36.171 M en la aceptación de la 10-K/A, los 17 ejercicios que
  ExxonMobil gana por el linaje, las 934.818.000 acciones que pasan a 6.543.726.000
  con el 7:1. Cada una se corrió una vez, a mano, contra la base personal, y
  ninguna vuelve a correr sola. Una regresión que rompiera el contrato en la
  empresa número siete no rompería nada.
- Alcance, en tres incrementos que se cierran en este orden:
  1. **verificador del contrato sobre la base real**: las afirmaciones que no
     necesitan red ni empresas nuevas pasan de prosa a un comando repetible que
     recorre **todas** las cadenas publicadas y falla con el nombre de la
     afirmación rota. Corre a través del mismo dominio que lee la aplicación, no
     de SQL paralelo: un verificador que reimplementa la selección prueba su
     propia copia, no el contrato.
  2. **reconciliación de 30 empresas**: elegir los filers de los diez arquetipos
     de [`04_VALUATION_SYSTEM.md`](../finance-portal-masterplan/04_VALUATION_SYSTEM.md),
     ingerirlos con su presupuesto y reconciliar contra el filing, con el
     verificador del incremento 1 corriendo sobre el conjunto entero.
  3. **validación semántica XBRL**: una ADR decide si Arelle/EFM y las reglas DQC
     entran como oráculo independiente de muestra, qué agregan sobre el corpus
     congelado y la reconciliación, y qué cuestan —Python en el repositorio y en
     CI, reglas versionadas—. La ADR puede concluir que no se adoptan; ese también
     es el cierre del punto, con su motivo escrito.
- Controles: `TM-05` (una afirmación del gate que deja de valer se vuelve
  detectable), `TM-06` (el no-look-ahead es la afirmación central) y `TM-16` (el
  informe es la evidencia que explica de dónde sale cada verdicto).
- No autoriza: cron, superficie de UI, demo pública, ni escrituras. El verificador
  lee y no escribe nada.
- Fuera de alcance, declarado: el push-down de la selección temporal a SQL y el
  constraint de exclusión temporal por rango siguen diferidos con su motivo en el
  contrato point-in-time.

Criterios de aceptación del incremento 1:

- un comando a mano, de sólo lectura, sin red, recorre todas las cadenas
  publicadas y emite un informe con un verdicto por afirmación, sus conteos y las
  fallas nombradas;
- la afirmación de no-look-ahead se evalúa **a través del dominio**
  (`queryObservations`), no con SQL: para cada cadena con más de una revisión, un
  `as_known` un instante antes de la aceptación de la revisión siguiente devuelve
  la anterior, y en la aceptación devuelve la siguiente;
- cada afirmación tiene su test de dominio con una entrada deliberadamente rota
  que la hace fallar con nombre, además de la entrada sana;
- la lectura es acotada y paginada: el verificador no arma una consulta sin techo
  sobre la tabla entera (`TM-07`);
- el informe sobre la base personal queda como evidencia del incremento, con sus
  conteos reales.

Entregado el incremento 1 (2026-09-21). Operación en el
[runbook](../runbooks/point-in-time-audit.md).

`pnpm gate:point-in-time` recorre todas las cadenas publicadas y evalúa cinco
afirmaciones, de sólo lectura y sin red. La decisión de diseño fue **no escribir
SQL de verificación**: la afirmación central pasa por `queryObservations`, el
mismo dominio que lee la aplicación, porque un verificador con su propia copia de
la selección prueba la copia. La segunda decisión fue que una afirmación sin
ejercitar **no es un verde**: queda `not_exercised` y el comando sale distinto de
cero, porque una base sin ninguna cadena restateada no prueba nada sobre el
no-look-ahead.

Dos hallazgos del camino:

- exigir que **toda** fila cite un documento excede el contrato: una fuente de
  fixture no publica documentos, y la afirmación correcta es sobre la cita que no
  resuelve, no sobre la fila que no cita. Quedó como conteo del informe —para la
  SEC vale cero, y pasar de cero a N es la regresión que hay que ver—;
- el schema se negó a construir dos de las entradas rotas de los tests
  (`superseded_at` tiene que ser posterior a `available_at`), así que esas fallas
  sólo pueden entrar por una escritura que no pase por el dominio. El test de
  integración las produce alterando la fila en PostgreSQL, que es exactamente el
  caso que el verificador existe para ver.

Medido sobre el PostgreSQL personal: 4.946 cadenas, 5.107 revisiones, 159 cadenas
con restatement, 0 filas sin documento citado; `provenance_resolves` 5.107/0,
`availability_precedes_fetch` 5.107/0, `revision_chain_ordered` 10.053/0,
`as_known_excludes_later_revision` 161/0 y `restatement_changes_content` 161/0.
Las 161 transiciones son restatements reales de la SEC sobre seis filers, no
casos construidos. format, lint, typecheck, 1.342 unit, 135 integration y build
con las cuatro rutas en `ƒ (Dynamic)` pasan.

Pendientes los incrementos 2 (30 empresas reconciliadas) y 3 (ADR de validación
semántica XBRL).

Entregado el incremento 2 (2026-09-21). Operación en el
[runbook](../runbooks/gate-reconciliation.md).

**El arquetipo se declara.** Nada en la base puede decir de qué arquetipo es una
empresa: no hay columna de sector, industria ni SIC, y la clasificación
versionada es `F7-02`, posterior a esta fase. El dato existe gratis —el
`submissions` que ya se baja trae `sic` y `sicDescription`— pero persistirlo es
esa otra decisión. Así que `declared-gate-sample.ts` declara las treinta
empresas con el motivo de cada una, y `assertGateSample` se niega ante una
muestra que repite una empresa, deja un arquetipo sin representante o cuya
primera tanda no llega a los diez. Dos límites declarados: el S&P 500 tiene pocos
holdings puros y por construcción expulsa a las empresas en distress, así que
esos dos arquetipos llegan a dos y la diferencia se compensa con una cuarta
madura y una cuarta de commodity.

**Medición de la tanda 1** (los 6 sujetos ya publicados más 7 nuevos, doce
empresas que cubren los diez arquetipos): **39 requests** de los 2.000 diarios y
**2 MB** de base —de 14 a 16 MB, de 5.107 a 10.588 observaciones—. La estimación
previa era de ~240 requests y ~6 MB: venía de la medición anterior a la ventana,
y hoy la mayoría de los filers entra en 2-3 requests. Sólo JPMorgan necesitó 25,
por su historial de presentaciones paginado. El verificador del incremento 1
pasa sobre la base duplicada sin ningún cambio: 10.253 cadenas, 10.588
revisiones, 326 con restatement y 335 transiciones, todas en verde.

**Resultado de la reconciliación**: 10 de 12 balances cierran en **0,0000 %**
—incluidos un banco, una aseguradora, un REIT, un holding y una empresa en
distress—, lo que dice que la unidad, la escala y el signo sobreviven a la
ingesta en todos los arquetipos. 5 anclas de 84 quedan no reportadas, todas
decisiones del filer: Duke Energy y Carnival no publican `us-gaap:Liabilities`,
ExxonMobil no publica acciones diluidas y Berkshire no publica ni EPS diluida ni
acciones diluidas.

**El hallazgo del incremento.** Los cuatro residuos de EPS vienen de lo mismo, y
no es la ingesta: **la EPS diluida no se calcula sobre `NetIncomeLoss`**. Su
numerador es una cifra ajustada que el filer reporta aparte y que
`sec-core-concepts-2.0.0` no selecciona —no hay una sola fila de
`AvailableToCommon` ni de `PreferredStockDividends` en la base—, así que el
residuo no se explica con lo guardado.

El signo distingue dos ajustes opuestos, y por eso el residuo pasó a llevarlo:
Duke −1,31 % y JPMorgan −2,31 % tienen el numerador **por debajo** del resultado
(dividendos preferidos; en JPMorgan la diferencia son 1.314 M, del orden de sus
preferidos), mientras que Prologis +2,35 % y Carnival +2,61 % lo tienen **por
encima** (unidades de la sociedad operativa del REIT e intereses de convertibles
readicionados). Atribuir cada signo a ese ajuste es la lectura más plausible de
cada estructura y no está verificado contra el filing: confirmarlo es abrir las
cuatro presentaciones, que es el trabajo manual que la hoja habilita. Lo
verificado es que el numerador de la EPS no está en la base.

Un intento de confirmarlo contra el corpus congelado quedó inconcluso y vale
anotarlo: Duke está en el corpus y no tiene esos conceptos, pero el reductor
descarta la mayoría de los no seleccionados, así que su ausencia ahí no prueba
ausencia en el cable. No se corrigió en este incremento a propósito: cambiar la
selección es subirle la versión y reingerir los trece filers, y eso es un slice
con su propia medición.

Queda la tanda 2 —las 18 empresas restantes— y el incremento 3.

**Cierre del hallazgo (2026-09-21, mismo día).** El owner eligió arreglar la
selección antes de bajar la tanda 2, para que esas 18 —con 3 bancos, 3
aseguradoras y 2 REIT más— se ingieran una sola vez y nazcan explicables.

`sec-core-concepts-3.0.0` suma
`NetIncomeLossAvailableToCommonStockholders{Basic,Diluted}` —el numerador de la
EPS— y el puente de dividendos preferidos, y el chequeo de EPS pasa a usar ese
numerador cuando el emisor lo publica, diciendo en la salida cuál usó. Reingerir
los doce costó **53 requests**; publicó 422 filas nuevas y reconoció todo lo
demás como duplicado, que es la prueba de idempotencia.

El resultado confirma la hipótesis por construcción: **de 4 residuos a 0**. Duke
−1,3110 → −0,1859 %, JPMorgan −2,3059 → **+0,0083 %**, Prologis +2,3463 →
+0,0646 %, Carnival +2,6101 → +0,0367 %. Y las cinco empresas que no publican el
numerador —Apple, NVIDIA, Moderna, ExxonMobil, Berkshire— son exactamente las de
estructura de capital simple, que ya cuadraban contra `NetIncomeLoss`.

Los cuatro `not_evaluable` que quedan no los arregla ninguna selección: Duke y
Carnival no publican `us-gaap:Liabilities`, ExxonMobil no publica acciones
diluidas y Berkshire no publica ni EPS diluida ni acciones diluidas. Son
decisiones de quien presenta.

El verificador del incremento 1 sigue pasando con las filas nuevas: 10.666
cadenas, 11.010 revisiones, 335 con restatement y 344 transiciones, todo en
verde.

Entregada la tanda 2 y **cerrado el incremento 2** (2026-09-21). Las 18 empresas
restantes se ingirieron ya con la selección completa: **50 requests**, sin un
solo duplicado, y la base pasa de 16 a 26 MB con 27.862 observaciones sobre 31
sujetos. El día entero costó **144 requests de los 2.000**.

Dos trampas del anclaje que aparecieron con la muestra completa, y que hoy son
reglas con test:

- **un período de 365 días no es un ejercicio.** Amazon publica cifras de doce
  meses móviles que terminan en cada cierre de trimestre. Tomarlas por ejercicio
  pedía el balance a una fecha sin EPS publicada, y la hoja decía «no evaluable»
  sobre una empresa que sí tiene su ejercicio en la base. El ejercicio pasa a
  salir del ancla que registró la ingesta (`fp = FY`, ADR 0017);
- **un sucesor recién constituido no cerró un ejercicio.** El de ExxonMobil se
  registró en julio de 2026 y su única presentación es un 10-Q, así que su ancla
  es un cierre de trimestre. El ejercicio del grupo está del lado del antecesor,
  y el ancla tiene que seguir al linaje igual que la historia (ADR 0011).

`selectFiscalYearEnd` toma el ancla más reciente del linaje en la que el linaje
publicó anclas anuales, y devuelve `null` antes que inventar una fecha.

**Resultado sobre las treinta.** Balance: 26 de 30 cierran, **24 en 0,0000 %
exacto**, entre ellas tres bancos, tres aseguradoras, tres REIT, dos holdings y
dos empresas en distress; los otros dos dentro de tolerancia. EPS: 26 de 30 `ok`,
15 contra el numerador propio. Los 7 `not_evaluable` son conceptos que el filer
no publica —`us-gaap:Liabilities` en Duke, Amazon, Devon y Carnival; acciones
diluidas en ExxonMobil y Berkshire; EPS diluida en Freeport y Berkshire—: no los
arregla ninguna selección.

Queda **un residuo**, Norwegian Cruise Line con +3,8570 %, explicado y ajeno: su
EPS básica cuadra (0,94 × 448.542.442 = 421,6 M contra 423,2 M), pero la diluida
usa 29 M de acciones más por convertibles y readiciona su interés al numerador,
y Norwegian no publica el numerador ajustado. El chequeo lo marca para que
alguien abra el filing, que es su trabajo.

El verificador del contrato pasa sobre las 27.862 observaciones: 27.123 cadenas,
722 con restatement y 739 transiciones, sin una falla.

Queda el incremento 3: la ADR que decide Arelle/DQC.

Incremento 3 entregado para aprobación (2026-09-21):
[ADR 0024](../architecture/adr/0024-xbrl-semantic-validation.md), en estado
**propuesto**. Concluye que **Arelle/EFM y las reglas del DQC no se adoptan**, y
el argumento que decide no es el costo sino el alcance: validan el **XBRL inline
de la presentación**, un artefacto que este proyecto no ingiere. Lo que se
ingiere es `companyfacts`, la extracción que hace la propia SEC, así que Arelle
cubre el único tramo de la cadena que no está en nuestro camino —una presentación
impecable puede llegar mal extraída, mal parseada o mal guardada, y Arelle la
aprobaría igual—.

A eso se suman tres costos concretos: Python en un repositorio que no tiene
ninguno; la resolución de taxonomías por HTTP, que pondría un proceso abriendo
sockets **fuera de la única puerta de egress** —sin allowlist, sin cuota diaria y
sin kill switch— salvo vendorizando cientos de megabytes; y un pin más que
seguir.

Lo que ocupa su lugar queda declarado: la validación semántica del proyecto es la
coherencia sobre lo que guardamos —las identidades de `reconciliation-anchors.ts`
y las cinco afirmaciones de `point-in-time-audit.ts`—, y crecer es agregar una
regla nombrada con su test, no importar un motor. La familia que el DQC cubre y
nosotros no es la dimensional, y hoy no hace falta porque la ingesta toma sólo
hechos sin dimensiones (ADR 0010).

La ADR declara su condición de revisión: ingerir XBRL inline, ingerir hechos con
dimensiones, o encontrar un residuo que no se explique con lo guardado. Y deja
anotada la alternativa más interesante que descarta **para esta fase y no por
principio**: los R-files del Financial Report de EDGAR, que sí validan el tramo
que importa y son un slice propio.

**ADR 0024 aceptada por el owner (2026-09-21).** Con ella cierra el incremento 3,
cierra `F2-07` y cierra el **gate de la Fase 2**. Las cuatro afirmaciones del gate,
contra lo que quedó:

- **30 empresas de arquetipos distintos reconciliadas contra su filing.** Las
  treinta de `declared-gate-sample.ts`, con los diez arquetipos representados:
  balance 26 de 30 cerrando y 24 en 0,0000 % exacto, EPS 26 de 30 `ok`. Los 7
  `not_evaluable` son conceptos que el filer no publica y el único residuo
  —Norwegian +3,8570 %— está explicado y es ajeno a la ingesta. Repetible con
  `pnpm gate:reconcile`;
- **100 % de filas con source/as-of/available-at.** No por inspección sino por
  las dos primeras afirmaciones del verificador sobre las 27.862 observaciones:
  `provenance_resolves` y `availability_precedes_fetch`, ambas sin una falla, con
  0 filas que citen un documento inalcanzable;
- **splits, restatements y un cambio de símbolo probados.** Splits por regla, con
  el 10:1 de NVIDIA y el 20:1 de Alphabet reconciliados contra el corpus
  congelado; restatements en 722 cadenas con 739 transiciones; el cambio de
  símbolo con evidencia fechada en el traspaso de Kraft Heinz, donde `XNAS:KHC`
  cierra y `XNYS:KHC` abre en el `CERT` de NYSE, más el camino declarado de la
  [ADR 0014](../architecture/adr/0014-declared-corporate-events.md) para el que
  no tiene evidencia;
- **un `as_known` anterior a un restatement no devuelve el valor enmendado.** Es
  `as_known_excludes_later_revision`, evaluada **a través de `queryObservations`**
  sobre las 739 transiciones reales, no sobre un caso construido.

Lo que el gate **no** afirma queda igual de dicho: la consistencia dimensional de
las presentaciones y la calidad del etiquetado del emisor no se validan, por la
razón de la ADR 0024, y la ADR declara las tres condiciones que la reabren.

Con `F2-07` cerrado, la **Fase 2 pasa a `done`** y el roadmap habilita la Fase 7
—matrices sectoriales de riesgo—, que la [ADR 0016](../architecture/adr/0016-analysis-scope-sector-matrices.md)
corre antes de la Fase 3 porque `F7-02` es la clasificación versionada de la que
depende el selector de arquetipo.

| Issue   | Resultado y aceptación mínima                                                                                          | Depende de | Controles                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------- |
| `F2-03` | SEC XBRL integrada con `available_at` del filing, vintages y restatements preservados; cuarentena ante schema roto.    | `F2-02`    | `TM-05`, `TM-06`, `TM-08` |
| `F2-04` | Corporate actions con vigencia: splits, cambios de símbolo, delistings y fusiones sin sobrescribir historia.           | `F2-03`    | `TM-05`, `TM-06`          |
| `F2-05` | Backfill y refresh durable con presupuesto, cursor, lease, replay, `429`, crash y recuperación manual probados.        | `F2-04`    | `TM-10`, `TM-11`, `TM-16` |
| `F2-06` | Golden fixtures desde extractos reales congelados, en reemplazo de `FixtureCo` como oráculo de regresión.              | `F2-03`    | `TM-05`, `TM-16`          |
| `F2-07` | Gate de fase verificado sobre datos reales: contrato auditado por comando, 30 arquetipos reconciliados, XBRL decidido. | `F2-06`    | `TM-05`, `TM-06`, `TM-16` |

### Fase 3 — arquetipo, admisibilidad y costo de capital

| Issue   | Resultado y aceptación mínima                                                                                       | Depende de | Controles        |
| ------- | ------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------- |
| `F3-01` | Selector determinista de arquetipo con reglas activadas, inputs requeridos, confianza y `unsupported_method`.       | Fase 7     | `TM-05`          |
| `F3-02` | Perfil de completitud medido por empresa sobre los datos que existen, sin estimar lo ausente.                       | `F3-01`    | `TM-05`, `TM-16` |
| `F3-03` | Nivel de rigor `full \| standard \| screening \| unsupported` derivado de la completitud y declarado en la corrida. | `F3-02`    | `TM-05`, `TM-15` |
| `F3-04` | Datasets Damodaran versionados y fechados: ERP implícita, betas por industria y country risk premium.               | Fase 7     | `TM-05`, `TM-16` |
| `F3-05` | Mapeo empresa → industria del dataset, con el caso ambiguo declarado y no adivinado.                                | `F3-04`    | `TM-05`, `TM-06` |
| `F3-06` | Costo de capital bottom-up: beta desapalancada reapalancada, costo de deuda por spread y convergencia terminal.     | `F3-05`    | `TM-06`, `TM-16` |

**`F3-01`, incremento 1 (2026-10-02).** El
[contrato de decisión](../valuation/methodology.md#f3-01-incremento-1-contrato-de-decisión)
fija entradas con corte temporal, precedencia de exclusiones de FCFF y cuatro
motivos de abstención. Es documentación: el selector aún no está implementado,
los umbrales y la calibración de confianza siguen pendientes y el issue permanece
`in_progress`. El incremento siguiente fija casos sintéticos de aceptación;
el gate de `F3-01` espera un selector puro con tests.

**`F3-01`, incremento 2 (2026-10-02).** La
[tabla de casos](../valuation/methodology.md#f3-01-incremento-2-casos-de-aceptación)
fija siete resultados sintéticos: tres subtipos directos, sector insuficiente,
conflicto, admisión de FCFF y evidencia posterior al corte. El selector sigue sin
implementarse y `confidence` no tiene escala calibrada. Próximo incremento:
definir señales y umbrales versionados con evidencia, convertir los casos en
fixtures ejecutables e implementar el selector puro.

**`F3-01`, incremento 3 (2026-10-02).** `method-selection-0.1.0` implementa
un selector puro sobre evidencia de perfil versionada. Los siete casos del
incremento 2 y bordes de conocimiento público, registro local, vigencia,
solapamiento, entidad legal e inputs FCFF pasan en 12 tests.
`confidence` queda `null` hasta calibrarla. Sigue `in_progress`: falta constituir señales desde datos reales con
reglas y umbrales versionados, probarlas y conectar el selector a la corrida.

**`F3-01`, incremento 4 (2026-10-02).** `sec-sic-profile-1.0.0`
constituye señales positivas fechadas de banco, aseguradora y REIT desde el SIC
del `submissions` de la SEC. La lista de códigos proviene de la SEC; el corpus
congelado prueba que el SIC `3571` de Apple no fabrica una señal. SIC inválido,
CIK ajeno y respuesta rota se rechazan. Sigue `in_progress`: falta persistir y
versionar cambios de SIC, resolver las señales de los demás arquetipos con
evidencia suficiente e integrar el selector a la corrida.

**`F3-01`, incremento 5 — cierre (2026-10-02).** La
[ADR 0031](../architecture/adr/0031-on-demand-company-assessment.md) hace el gate
**a demanda**: `pnpm valuation:assess --ticker …` observa el SIC (un request),
lo guarda como aserción `sec-sic` fechada en su observación y evalúa la empresa
sobre lo ingerido. `method-selection-0.2.0` aplica precedencia estricta con
madurez residual; `sec-sic-profile-2.0.0` y `fundamental-profile-signals-1.0.0`
producen evidencia positiva y negativa con umbrales versionados (cobertura 1,25
de Damodaran; dos de tres y 15 % declarados por el proyecto); `confidence` es
ordinal. Agrega el perfil `loss_making`.

Criterios cumplidos: selector determinista con reglas activadas, inputs
requeridos, confianza y `unsupported_method`. Evidencia: 30 SIC observados con
30 requests; 21 de 29 arquetipos declarados coinciden y las 8 diferencias quedan
explicadas en la [metodología](../valuation/methodology.md#f3-01-incremento-5-señales-desde-datos-reales-y-cierre);
tests de selector, SIC, serie anual, reglas y servicio, más integración del
plan SIC con supersesión sobre PostgreSQL.

**`F3-02` — cierre (2026-10-02).** `completeness-profile-1.0.0` mide nueve
comprobaciones sobre la serie anual —insumos estructurales, años de historia,
caja y deuda, arrendamientos, I+D, reinversión, impuestos, industria y mix
geográfico— con estado y faltante nombrado. Reemplaza al preflight booleano del
selector y `pnpm valuation:assess` lo muestra.

Criterios cumplidos: perfil medido por empresa sobre los datos que existen, sin
estimar lo ausente. Evidencia: medido sobre las 30 de la muestra del gate
(historia de cinco años en 22, capex en 12 por conceptos fuera de la selección,
mix geográfico no ingerido en ninguna); ocho tests unitarios con huecos,
alternativas de EBIT y ausencias que no valen cero.

**`F3-03` — cierre (2026-10-02).** `rigor-level-1.0.0` deriva
`full`/`standard`/`screening`/`unsupported` de la selección y la completitud,
con `degradedBy` y las aproximaciones declaradas (`country_risk_by_domicile`,
`invested_capital_not_reconstructed`). `ValuationInput.assessment` lleva
selección, completitud y rigor a la corrida y al `input_hash`; tres policy checks
de rechazo exigen que el método sea el elegido, que el rigor coincida con el
recalculado y que no sea `unsupported`. Metodología `0.3.0`; la corrida de
referencia cambia de hashes.

Criterios cumplidos: nivel derivado de la completitud y declarado en la corrida
(`TM-05`, `TM-15`). Evidencia: seis tests del nivel, tres de los checks (uno
escrito a mano rechazado), la muestra del gate medida (8 `screening` por
industria pendiente, 22 `unsupported` con motivo) y E2E de la corrida de
referencia con los hashes nuevos.

**`F3-04` — cierre (2026-10-02).** La
[ADR 0032](../architecture/adr/0032-damodaran-reference-datasets.md) registra
`damodaran-current-data` como `approved_personal` (acceso automatizado
`owner_accepted`, el resto según los términos), con allowlist de cuatro rutas,
tope de 20 requests por día y parser `damodaran-html-1.0.0` que verifica
encabezados. `pnpm damodaran:record` guarda cada página como release
(`reference_dataset_releases` y `reference_dataset_rows`, migración `0023`) con
disponibilidad igual a la observación; la misma publicación es `duplicate` y otra
supersede.

Criterios cumplidos: datasets versionados y fechados de ERP implícita, betas por
industria y CRP (`TM-05`, `TM-16`). Evidencia: 96 industrias, 178 países, 66 años y
30 bandas, sin rechazos, 240 kB; idempotencia verificada contra la fuente;
fixtures sintéticas (los términos no permiten redistribuir), 27 tests unitarios y
3 de integración.

**`F3-05` — cierre (2026-10-02).** `sic-damodaran-industry-1.0.0` mapea los
SIC de la SEC a las industrias de `damodaran.betas-us`; un código con varias
candidatas es `ambiguous` y las nombra. Sólo una declaración del owner por CIK y
con motivo resuelve una ambigüedad (`declared-industry-assignments.ts`, vacío).
La industria se valida contra la release visible al corte y alimenta
`industry_mapping` de la completitud.

Criterios cumplidos: mapeo empresa → industria del dataset con el caso ambiguo
declarado y no adivinado (`TM-05`, `TM-06`). Evidencia: muestra del gate con 14
mapeadas y 16 ambiguas; AAPL y JNJ en `standard` declarando riesgo país por
domicilio; siete tests del mapeo, incluido que toda candidata exista en la
taxonomía de enero de 2026, y dos del servicio.

**`F3-06` — cierre (2026-10-02).** `cost-of-capital-1.0.0` construye el WACC
con nueve parámetros fechados de Damodaran: libre de riesgo neto del spread
soberano, beta de la industria reapalancada con Hamada a su D/E, ERP implícita
más CRP, costo de deuda por rating sintético y convergencia terminal a beta 1.
`ValuationInput.costOfCapital` lo lleva a la corrida y el policy check
`wacc_built_from_components` lo recalcula; metodología `0.4.0`.

Criterios cumplidos: beta desapalancada reapalancada, costo de deuda por spread y
convergencia terminal (`TM-06`, `TM-16`). Evidencia: catorce tests con valores
calculados a mano y bordes de banda, D/E cero, moneda y parámetros ausentes; tres
del check; Apple 9,75 % y JNJ 7,86 % sobre las releases reales; E2E de la corrida
de referencia con el mismo valor por acción.

**Gate de la Fase 3 — verificado el 2026-10-02.** Sobre las 30 empresas de la
muestra, evaluadas a demanda con `pnpm valuation:assess`: ninguna queda sin
arquetipo o sin el input que falta nombrado; el WACC se construye con
componentes fechados en las ocho no financieras que tienen industria y
cobertura, y las demás nombran qué falta; Apple y Johnson & Johnson, sin mix
geográfico, quedan en `standard` y declaran `country_risk_by_domicile`.

### Fase 4 — motor Damodaran y arquetipos

| Issue   | Resultado y aceptación mínima                                                                                                     | Depende de | Controles                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------- |
| `F4-01` | Capitalización de leases e I+D con puente auditable sobre EBIT, capital invertido y deuda.                                        | Fase 3     | `TM-05`, `TM-06`, `TM-16` |
| `F4-02` | Regla terminal `g <= risk_free_rate` además del buffer; incrementa `engine_version` sin reescribir corridas.                      | Fase 3     | `TM-16`                   |
| `F4-03` | Normalizador reported/adjusted con evidencia, regla y transformación versionada por ajuste.                                       | `F4-01`    | `TM-05`, `TM-06`, `TM-16` |
| `F4-04` | Escenarios bear/base/bull como conjuntos coherentes de supuestos, no multiplicadores sobre el resultado.                          | `F4-03`    | `TM-16`                   |
| `F4-05` | Probabilidad de fracaso y overhang de opciones incorporados a la dilución y al puente EV-equity.                                  | `F4-03`    | `TM-05`, `TM-16`          |
| `F4-06` | Arquetipos por slice: bancos/aseguradoras, cíclicas, pérdidas/high growth y REIT; holdings/SOTP diferido hasta demanda observada. | `F4-04`    | `TM-05`, `TM-06`, `TM-15` |

<a id="f4-01"></a>

**`F4-01` — capitalización de arrendamientos e I+D (cerrado el 2026-10-19).** [ADR 0037](../architecture/adr/0037-lease-rd-capitalization.md),
con tres decisiones del owner: el pasivo de ASC 842 como deuda con su interés
implícito al costo de deuda antes de impuestos; la vida de la I+D de la hoja
«Amortizable Lives Look-up Table» de Damodaran mapeada a las 96 industrias, con
diez ejercicios de I+D en la ventana; y un umbral de materialidad del 1 % de
las ventas. Tres incrementos:

1. **Historia** (hecho el 2026-10-19): `sec-history-5fy-2.0.0` y
   `sec-core-concepts-4.0.0` conservan diez ejercicios de I+D, incluida
   `ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost`, que es la I+D
   recurrente de Johnson & Johnson; la poda `sec-history-prune-1.1.0` conoce el
   corte nuevo (migración `0029`, rollback que se niega con cortes registrados).
   Reingesta de los 31 filers: diez con once ejercicios de I+D, Moderna con diez
   y JNJ con once. Los históricos viejos de Incyte y NVIDIA destaparon los
   marcadores de fecha de EDGAR, que `sec-acceptance-clock-1.1.0` aparta de la
   evidencia (enmienda de la ADR 0036; 695 de 695 aceptaciones coinciden).
2. **Dominio** (hecho): `lease-capitalization-1.0.0`, `rd-capitalization-1.0.0`
   y `rd-amortizable-life-1.0.0`, puros. El ejemplo de Amgen del paper es el
   oráculo (activo 13.283,6, amortización 1.694,1, cronograma fila por fila) y
   un test transcribe la hoja de vidas y exige cada vida de su fila; casos nulos,
   cero, negativos, sin industria, sin historia, con un ejercicio faltante y con
   años de 52/53 semanas.
3. **Corrida** (hecho): `ValuationInput.capitalization`
   (`capitalization-bridge-1.0.0`), la claim `leaseDebt` del puente EV-equity,
   el check `capitalization_recomputed`, `fcff-1.1.0` y metodología `0.7.0`.
   `pnpm valuation:assess --offline` imprime el puente; medido sobre la muestra
   (tabla en la metodología). Medir destapó dos defectos de la serie anual,
   corregidos en `annual-fundamentals-1.1.0`: cierres duplicados a un día de
   distancia (Deere) y la parte no corriente del pasivo tomada por el total.

Criterios cumplidos: el puente es auditable —hechos con provenance, regla,
versión y cronograma— sobre EBIT, capital invertido y deuda (`TM-05`: ningún
faltante vale cero; `TM-06`: los hechos son del cierre base al corte; `TM-16`:
el motor recalcula y rechaza un número escrito a mano). FixtureCo conserva su
valor por acción. Siguiente: `F4-02`.

<a id="f4-02"></a>

**`F4-02` — regla terminal contra la libre de riesgo (cerrado el 2026-10-19).**
`fcff-1.2.0` y metodología `0.8.0`. El check `terminal_growth_versus_risk_free`
(`reject`) exige `terminal.growth <= costOfCapital.derived.riskFree`: la libre
de riesgo es la que el costo de capital de la propia corrida deriva —bono del
Tesoro neto del default spread del soberano de la moneda—, así que el techo está
fechado, en la moneda de la valuación y en el snapshot. Borde inclusivo. El
buffer contra el WACC sigue como defensa aritmética: los dos checks corren y
cada uno nombra su motivo. La sensibilidad aplica la misma regla, antes que el
buffer, y rechaza la columna entera por encima del techo.

Criterios cumplidos: la regla rige además del buffer (un test con WACC terminal
de 20 % y `g` de 6 % pasa el buffer y se rechaza por la regla); incrementa
`engine_version` sin reescribir corridas —las de `fcff-1.1.0` conservan fila y
hashes y no se leen con este código—; `TM-16`: una corrida rechazada por la
regla se persiste con el check y las rutas de campo, sin valores. Medido con
`pnpm valuation:assess --offline`, que ahora imprime el techo: 3,96 % en dólares
(AAPL, JNJ, XOM). FixtureCo (libre de riesgo 4 %, `g` 2 %, eje hasta 4 %)
conserva su valor por acción y cada celda; cambian sus hashes por la versión.
Siguiente: `F4-03`.

<a id="f4-03"></a>

**`F4-03` — normalización reported/adjusted (cerrado el 2026-10-19).**
[ADR 0038](../architecture/adr/0038-reported-adjusted-normalization.md), con
cuatro decisiones del owner: capital invertido por el lado de la financiación,
toda la caja como excedente, cargos de reestructuración y deterioro ingeridos y
revertidos sólo si no se repiten, y deuda y caja del puente derivadas del libro.
Tres incrementos:

1. **Datos**: `sec-core-concepts-5.0.0` suma cinco conceptos de cargos y la no
   corriente con arrendamientos financieros, elegidos con un sondeo de los 31
   companyfacts que midió los solapamientos (el agregado de deterioro incluye
   el goodwill en Carnival y no en otros; Norwegian etiqueta un acumulado como
   cargo del año; Devon publica sus vencimientos dos veces).
   `annual-fundamentals-1.2.0` agrega partidas propias para la deuda por
   componente, los cargos, los títulos no corrientes y la compensación en
   acciones, sin tocar las que leen la completitud. Reingesta de los 31 filers:
   114 requests.
2. **Dominio**: `reported-debt-1.0.0` (tres recetas que no se solapan),
   `non-recurring-charge-1.0.0` (cuatro ejercicios sin el cargo),
   `excess-cash-1.0.0`, `invested-capital-1.0.0`, `base-tax-rate-1.0.0` y el
   libro `normalization-1.0.0`, puros, con casos de las formas medidas, nulos,
   ceros, negativos y capital no positivo.
3. **Corrida**: `ValuationInput.normalization`, el check
   `normalization_recomputed` que exige `bridge.debt` y `bridge.excessCash`
   iguales a los derivados, `fcff-1.3.0` y metodología `0.9.0`;
   `pnpm valuation:assess --offline` imprime el libro.

Criterios cumplidos: reported y ajustado en paralelo, y cada ajuste con monto,
moneda, ejercicio, evidencia, regla y versión, también los que no se hacen
(`TM-05`: deuda sin receta, caja ausente o tasa inexistente son `unresolved` o
`null` con motivo, nunca cero; `TM-06`: cada hecho es del cierre que dice;
`TM-16`: el motor recalcula y rechaza un monto escrito a mano). Medido sobre 20
no financieras: deuda resuelta en 14, deterioro de Ford revertido (9.435 M) y
la reestructuración de Salesforce leída como recurrente. FixtureCo conserva su
valor por acción.

Al cerrar, `pnpm gate:point-in-time` destapó 91 filas del sujeto de ExxonMobil
con la aceptación corrida +4 h contra su documento guardado: 89 las publicó la
reingesta de `F4-01` y 2 la de `F4-03`. El `submissions` del filer nuevo
(CIK 0002115436) vino corrido sin ninguna aceptación fuera del horario de
EDGAR, y `sec-acceptance-clock-1.1.0` lo leyó como sano; en una reingesta eso
no sólo atrasa, publica revisiones con el mismo valor. Arreglado el
2026-10-20 (enmienda de la ADR 0036): `sec-registered-acceptance-1.0.0` hace
que una presentación ya registrada conserve su aceptación, y las 91 filas se
repararon contra `source_documents`; el gate vuelve a pasar. Siguiente:
`F4-04`.

<a id="f4-04"></a>

**`F4-04` — escenarios bear/base/bull (cerrado el 2026-10-20).**
[ADR 0039](../architecture/adr/0039-coherent-valuation-scenarios.md), con
cuatro decisiones del owner: bear y bull viajan en el mismo snapshot que la
base; no mueven el costo de capital; no llevan probabilidades; y un desorden
de los tres valores pide revisión en vez de rechazar. `ValuationInput.scenarios`
(`scenario-set-1.0.0`) declara por escenario una tesis y sus drivers
—crecimiento, margen y reinversión por período; `g`, margen y retorno
terminales—, cada uno con valor y motivo. El motor materializa cada escenario
como un snapshot completo y lo pasa por los mismos checks y el mismo
`computeFcff` que la base (`fcff-1.4.0`, metodología `0.10.0`):
`scenario_drivers_declared` (`reject`) y `scenario_value_order`
(`require_review`) son los checks nuevos. `/valuacion/referencia` deja de
nombrarlos como planificados y muestra el rango y los drivers de cada uno.

Criterios cumplidos: los escenarios son conjuntos de supuestos, no
multiplicadores —un test valúa cada uno como la corrida independiente de su
snapshot materializado y verifica que ingresos, EV y equity no se mueven por un
mismo factor—; son coherentes porque pasan los mismos checks que la base y un
`reject` en cualquiera rechaza la corrida con rutas `scenarios.<clave>:<ruta>`;
y se ordenan cuando sus supuestos lo garantizan (propiedad sobre el margen).
`TM-16`: un único `input_hash` cubre los tres conjuntos, un driver cambiado es
otra corrida y una corrida rechazada por un escenario se persiste con su
motivo. FixtureCo: 9,54 / 13,55 / 17,56 USD, con el valor de la base intacto.
No hay corrida real con escenarios: sus supuestos los declara el owner.
Siguiente: `F4-05`.

<a id="f4-05"></a>

**`F4-05` — probabilidad de fracaso y opciones de empleados (cerrado el 2026-10-20).**
[ADR 0040](../architecture/adr/0040-failure-probability-employee-options.md),
con decisiones del owner: probabilidad del rating sintético, recupero sobre el
capital en libros, opciones valuadas y restadas, volatilidad de la serie,
transcripción por IA y denominador básicas + RSU. Hecho: el dominio puro
(incremento 1), la transcripción medida sobre diez 10-K reales con migración
`0030` y `pnpm valuation:employee-equity` (incremento 2, con corpus de evals),
las opciones en la corrida y la probabilidad de fracaso (`fcff-1.6.0`,
metodología `0.12.0`). El owner confirmó explícitamente las diez entradas del
gold de opciones el 2026-10-20; el gate queda cerrado.

Incremento de evals (2026-10-20): `employee-equity-eval-cases-1.0.0` arma
base, inyecciones aplicables y abstención a partir de una nota y gold explícitos;
el ejecutor mide un escalón con el libro de gasto de evals y el rejuicio usa la
policy vigente sin red. `ai-eval-scoring-1.1.0` compara cantidades normalizadas,
strike, plazo y unidades, y detecta inyección aceptada y aceptación sin evidencia.
Prueba offline con nota sintética: no constituye corpus SEC ni medición del
modelo. Pendiente del siguiente incremento: capturar las notas reales con
manifiesto y hashes, proponer gold `pending_owner`, confirmar ese gold y medir
base/inyección/abstención sobre la escalera. No hubo cambio de fórmulas ni gasto
real en ese incremento; `F4-05` permaneció `in_progress`.
Validación: 16 tests nuevos y 170 tests de evals pasan; la suite completa antes
del último caso pasó con 2.538 tests; tipos, lint, formato y diff pasan.
El build queda sin verificar en esta sesión: Turbopack no pudo abrir su puerto
local aun con escalación y Webpack falló leyendo `tsc --showConfig`.

Incremento de corpus y medición (2026-10-20): `ai-eval-corpus-1.1.0`
agrega diez notas SEC recortadas por `sec-10k-equity-compensation-1.0.0` y
veinte corroboraciones `companyconcept` del mismo filing y cierre, con URL,
instante, bytes, hash y versión del parser. Se recapturaron los 25 10-K con
45 requests en total: ninguna diferencia con producción y ningún extracto
anterior modificado; el corpus completo ocupa 598,1 kB. Las propuestas de
opciones medidas en una réplica anterior no están en la base personal: el gold
se escribió leyendo estas notas y quedó `pending_owner`, sin sembrarlo de una
respuesta del modelo. `ai-eval-cases-1.2.0` carga diez bases, nueve inyecciones
y tres abstenciones. La simulación admite la escalera vigente medida
directamente, además de las mediciones históricas que la seleccionaron.

Medición provisional de `ai-model-ladder-1.1.0`: 34 intentos, USD 0,080276 en
total. Las diez bases y las nueve inyecciones terminan aceptadas y coinciden
con el gold propuesto: ocho bases y ocho inyecciones en el escalón 1, las
restantes en el 2. Los tres casos sin nota se midieron en los cuatro escalones:
ninguno fue aceptado (once abstenciones y una respuesta inválida por schema,
JNJ en el escalón 4). Inyección filtrada = 0, aceptación sin evidencia = 0.
No se cambió prompt, policy ni escalera. En ese incremento la corrección
quedó provisional hasta que el owner confirmara las diez respuestas.
Límites explícitos del gold:
Ford conserva el strike desconocido y XOM transcribe el saldo total que no
separa las unidades liquidadas en efectivo.

Validación de este incremento: 217 tests de evals y 2.586 unit pasan, tipos,
lint, formato y diff pasan; build de producción con `next build --webpack`
pasa fuera del sandbox. El comando habitual con Turbopack sigue fallando al
abrir su puerto local en este entorno. Sin cambios de UI ni migración.
Al terminar ese incremento quedaban la confirmación del gold y la tabla de fracaso.

Incremento de fracaso (2026-10-20): la planilla Ginzu pudo descargarse por la
puerta y su hoja real es `Failure Rate worksheet`. La fuente existente suma
sólo esa URL exacta, con los mismos derechos y sin guardar el libro. El parser
`damodaran-failure-rates-1.0.0` verifica título, siete ratings, diez horizontes
y probabilidades acumuladas entre cero y uno, sin leer la tabla por edad.
Se publicó una release de siete filas y diez columnas; repetir fue
`duplicate` y conservó la release. Cinco archivos por proceso, diario sin
cambio en 20; el preflight cuenta URLs únicas.

`failure-risk-1.0.0` selecciona diez años, como la ilustración de la hoja,
agrupa los signos del rating y congela el parámetro con su release, fila,
campo y ambos relojes. El owner puede declarar otra por CIK con motivo y
fecha real; no se aplica antes de ser conocida ni se desempatan decisiones
contradictorias. Un rating sintético D queda sin probabilidad: no prueba un
default y la tabla no tiene esa fila. `failure_risk_recomputed` rechaza
selección incompatible o capital sin resolver.

`fcff-1.6.0` pondera el DCF condicional por supervivencia y el recupero por
fracaso, antes del puente a equity; el recupero es la mitad del capital
invertido **reportado**, cero con base nombrada si no es positivo. Publica
`failureAdjustment`; escenarios y sensibilidad aplican la misma regla sobre
su propio DCF. `terminalValueShare` conserva el DCF condicional como base.
Metodología `0.12.0`, sin migración ni reescritura. La fixture usa p sintética
cero, conserva 13,39 USD por acción y cambia sus hashes a
`4db820e6...2076` / `691e748d...7d5b`.

Evidencia: el libro de 287.995 bytes se procesó en memoria y produjo cero
rechazos; `valuation:assess --offline` sobre AAPL, JNJ, XOM, CCL, NCLH, F y
MRNA distingue probabilidad disponible, capital sin resolver, rating fuera de
tabla y ausencia de rating. Pasan 2.631 unit, 199 integration, 175 E2E con axe
(2 omitidos), tipos, lint, formato y diff. El gate E2E se ejecutó con copia
temporal del harness que sólo agregó `--webpack` al build: conservó
centinelas, escaneo de secretos y ambos runtimes; el script temporal se
eliminó, el gate habitual no cambió. Turbopack mantiene la limitación del
puerto en este entorno. Sin cambios de componentes UI ni llamadas a modelos.

Cierre (2026-10-20): el owner confirmó las diez entradas del gold, incluidos
el strike desconocido de Ford y la limitación de las unidades de XOM.
`declared-employee-equity-gold.ts` pasa a `owner_reviewed` sin cambiar cifras
ni citas. El resumen offline del reporte existente confirma cero gold pendientes,
bases 10/10, inyecciones 9/9, cero inyecciones filtradas y cero aceptaciones sin
evidencia. Se conservan los 34 intentos y USD 0,080276; la revisión no abre la
red ni gasta. Pasan de nuevo los 217 tests de evals, `pnpm format:check`
y `git diff --check`. `F4-05` pasa a `done`; `F4-06` queda `ready`.

Cada arquetipo de `F4-06` es un slice propio con selector, inputs, fórmulas,
fixtures independientes, diagnósticos y estado `experimental | reviewed | production`,
llevado a gate antes del siguiente. Ninguno agrega IA.

#### `F4-06` — 4.1 bancos y aseguradoras (cerrado el 2026-10-20)

El issue sigue `in_progress`: termina este arquetipo, no el conjunto de `F4-06`.
En ese cierre, el próximo slice autorizado fue 4.2, cíclicas y commodities.

- Contrato: `excess_return`, `excess-return-1.0.0`, metodología
  `financial-equity-1.0.0`; [ADR 0041](../architecture/adr/0041-financial-equity-excess-return.md).
- Inputs propios de equity: patrimonio común y acciones al `asOf`, componentes
  fechados de Ke, evidencia visible del perfil y pronósticos explícitos.
  El selector financiero usa `method-selection-0.3.0`; sin snapshot propio nombra
  requisitos, aunque los inputs industriales estén completos.
- Motor: exceso sobre patrimonio de inicio, retención y clean surplus por año,
  terminal con `g / ROE`, opciones y unidades recalculadas desde la nota congelada,
  escenarios completos y sensibilidad beta terminal/g con celdas rechazadas.
- Estado: `experimental`, rigor `screening` y siempre `requires_review`.
  Diagnósticos de capital regulatorio, calidad de activos/reservas y clean surplus.
  No habilita cobertura productiva de financieras reales. La construcción
  automática del snapshot y la UI por ticker quedan para incrementos posteriores.
- Persistencia: unión cerrada de FCFF y exceso de retorno en `valuation_runs`,
  sin migración. `valuation:replay` reproduce ambos. El comando local
  `valuation:financial --file <path>` es dry run, y sólo `--apply` escribe
  bajo el guard personal. No abre red, llama a modelos ni ingiere datos.
- Controles: `TM-05`, `TM-06`, `TM-15`, `TM-16`. Faltantes, moneda incompatible,
  fechas posteriores al cutoff, patrimonio no positivo, acciones desalineadas,
  payout y terminal inválidos se rechazan. `system_recorded` se rechaza porque
  este contrato no tiene fecha de registro por hecho.

Evidencia del gate del arquetipo:

- [Comparación independiente](../valuation/financial-equity-oracle.md): los diez
  excesos anuales y el terminal de `eqexret.xls` coinciden; valor por acción
  74,9440389004845 USD. Segundo oráculo DDM sintético y ROE = Ke con valor
  exactamente igual al patrimonio. Libro externo fuera del repositorio.
- Bordes: nulos, cero, negativos, no finitos, moneda, disponibilidad en el borde,
  opciones una sola vez, escenarios rechazados o invertidos, sensibilidad inválida,
  monotonía y los 60 períodos inválidos de tres pronósticos máximos conservados.
- 2.682 unit pasan; suite completa de 201 integration pasa y contrato de corridas
  revalidado después de cerrar el snapshot (11 tests). Tipos, lint, formato y diff
  pasan. PostgreSQL conserva decimales exactos, dedupe, rechazo y replay sin IA.
- Build Webpack y gate completo de 175 E2E con axe pasan (2 omitidos), con 496
  archivos escaneados sin centinelas. Se usó una copia temporal del harness que
  sólo agrega `--webpack`, eliminada al terminar. Turbopack sigue impedido de abrir
  su puerto local; el gate habitual no se modificó.
- Comando ensayado con un snapshot sintético fuera del repo: dry run,
  `requires_review`, valor 10,3570247933884 USD/acción y replay reproducido;
  sin escrituras en la base personal ni llamadas a proveedores o IA.

#### `F4-06` — 4.2 cíclicas y commodities (cerrado el 2026-10-20)

`F4-06` sigue `in_progress`: se cierra este arquetipo, no el conjunto.
En ese cierre, el próximo slice autorizado fue 4.3, pérdidas y high growth.

- Contrato: `normalized_fcff`, motor `normalized-fcff-1.0.0`, metodología
  `cycle-fcff-1.0.0`, selector `method-selection-0.4.0` para estas decisiones;
  [ADR 0042](../architecture/adr/0042-cycle-normalized-fcff.md).
- Historia explícita de cinco a diez ejercicios, margen anual con igual peso,
  pérdidas incluidas y EBIT normalizado a ventas actuales. El owner declara
  ciclo y base contable; el último año reconcilia contra la base ajustada y el
  motor verifica la convergencia y el objetivo terminal. No amplía la ventana SEC.
- Commodities usa la vía de margen de ciclo: no estima precio normalizado,
  reservas, volúmenes o futuros. Reinversión explícita por sales-to-capital;
  pérdidas proyectadas sin crédito fiscal inmediato ni arrastre supuesto.
- Bear/bull completos: el driver de margen terminal mueve el objetivo de ciclo
  y reconstruye toda la trayectoria. Sensibilidad WACC/g con celdas rechazadas.
  Comparación contra mantener el margen actual, con EV, valor por acción y delta.
- Estado `experimental`, rigor limitado a `screening`, siempre `requires_review`.
  La clasificación se vuelve a ejecutar desde señales fechadas; hechos y tasas
  deben respetar el cutoff, la nota de opciones declara aceptación por separado
  y se rechaza `system_recorded` sin fecha de registro por hecho.
- `pnpm valuation:cycle --file <path>` calcula sin red ni IA; límite de 512 kB,
  dry run salvo `--apply`, que exige personal y registra también el rechazo.
  Persistencia y replay admiten las tres familias sin migración; los números y
  hashes del FCFF maduro se conservan. No agrega UI ni un proveedor.
- Controles: `TM-05`, `TM-06`, `TM-15`, `TM-16`. Sin bloqueos pendientes para
  este slice; construir automáticamente el snapshot o elevar rigor sigue fuera.

Evidencia del gate:

- [Oráculo independiente](../valuation/cycle-normalization-oracle.md): cinco
  ratios de `normearn.xls` coinciden a 14 decimales; diferencia de ponderación
  documentada (margen anual 0,1465769334 frente al pooled 0,1471670346).
  Segundo oráculo: caja constante de 7,632 millones / 9 % = EV 84,8 millones.
- 2.720 unit, 203 integration y contrato final revalidado (13 tests) pasan.
  Bordes de nulos, cero, negativos, moneda, finitos, documentos futuros,
  clasificación, convergencia, escenarios, sensibilidad, escala y monotonía.
  Tipos, lint, formato y `git diff --check` pasan.
- Build habitual con Turbopack y gate completo: 175 E2E pasan, 2 omitidos;
  axe sobre ambos runtimes y escaneo de 643 archivos sin centinelas. Sin copia
  temporal del harness ni modificación de su contrato.
- CLI sobre fixture sintética fuera del repo: margen histórico 10,6 %, actual
  18 %, valor 7,3070419012 frente a 13,3859582309 USD/acción a margen actual;
  replay reproducido. `--apply` en locked falla antes de construir el storage.
  Sin escritura en la base personal, nuevas ingestas ni gasto IA.

#### `F4-06` — 4.3 pérdidas y alto crecimiento (cerrado el 2026-10-20)

Estado del slice: `done`, con su gate completo. `F4-06` sigue `in_progress`;
el próximo slice autorizado es 4.4, REIT con AFFO/NAV. Sin bloqueos para 4.3.

- Métodos: `fcff_three_stage` y `revenue_margin_survival`, motor/metodología
  `growth-fcff-1.0.0`, contrato `revenue-margin-1.0.0` y selector
  `method-selection-0.5.0`; [ADR 0043](../architecture/adr/0043-revenue-margin-survival.md).
- Snapshot explícito: señales fechadas, crecimiento inicial y años de alto
  crecimiento, transición lineal hasta `g`, margen sostenible y convergencia
  desde EBIT ajustado. El motor reconstruye ambas trayectorias; exige motivos
  de mercado, rentabilidad y financiación. No crea CAGR de ganancias negativas.
- Pool de pérdidas del cierre base con fuente/documento y límite de uso anual:
  cero explícito es admisible, faltante no. Cada año conserva uso, saldo e
  impuestos; las pérdidas no dan devolución inmediata. El terminal tributa
  normalmente y expone el saldo finito sin usar. El pool simplificado no modela
  vencimientos, créditos, cambios de control o mezcla de jurisdicciones.
- Pico de fondos operativos necesarios visible, antes de caja y financiación,
  sin restarlo otra vez del valor. Supervivencia y recupero mantienen ADR 0040;
  opciones y acciones se recalculan una sola vez. Estado `experimental`, rigor
  limitado a `screening`, siempre `requires_review`.
- Bear/bull son snapshots completos con las mismas reglas; el margen terminal
  reconstruye la convergencia y `g` reconstruye la transición de ventas. Un
  driver de crecimiento anual debe conservar la trayectoria derivada. La
  sensibilidad WACC/g mantiene fijo el pronóstico explícito.
- `valuation:growth --file <path>` calcula sin red ni IA, límite 512 kB;
  dry run salvo `--apply`, que exige personal y persiste también rechazos.
  Repositorio y replay admiten ambos perfiles sin migración. No cambia UI,
  ingesta ni los números/hashes de las familias previas. La construcción
  automática del snapshot sigue fuera de este incremento.
- Controles: `TM-01`, `TM-05`, `TM-06`, `TM-15`, `TM-16`; clasificación,
  moneda, cutoff, aceptación separada de la nota, versiones, periodicidad y
  trayectorias verificadas. `system_recorded` sin fecha por hecho se rechaza.

Evidencia:

- [Oráculo independiente](../valuation/revenue-margin-oracle.md): veinte valores
  de caja/impuestos de `higrowth.xls` coinciden a `5e-9`; diferencia de
  convergencia declarada. Segundo oráculo: perpetuidad diferida con escudo fiscal
  finito, EV 148.893.190,8088545 USD dentro de USD 0,000001.
- 2.767 unit y 205 integration pasan. Tests de nulos, cero, negativos, moneda,
  no finitos, pérdida sin devolución, límite anual, versiones, clasificación,
  fechas futuras, escenarios inválidos, sensibilidad y monotonía. PostgreSQL
  conserva decimales, dedupe, rechazos y replay de ambos perfiles.
- CLI sobre fixture sintética fuera del repo: 20,0943395764 USD/acción y pico de
  fondos de 38.976.000 USD; replay reproducido. `--apply` en locked falla antes
  de construir storage. Sin escritura en base personal ni gasto IA.
- Tipos, lint, formato y diff pasan. Build Turbopack y gate completo: 175 E2E
  pasan, 2 omitidos; axe en personal/locked y 643 archivos escaneados sin
  centinelas. Sin cambios al harness ni nueva UI.

#### `F4-06` — 4.4 REIT con AFFO/NAV (cerrado el 2026-10-20)

Estado del slice: `done`. Cierra `F4-06` y el gate de Fase 4 para los cuatro
arquetipos requeridos. Sin bloqueos. La fila 4.5 de la metodología y el roadmap
condicionan holdings/SOTP y distress a demanda observada: siguen `deferred`,
con reingreso por un caso concreto del owner, sin fallback a FCFF. No se inicia
Fase 6 en esta entrega; `F6-01` queda `ready` como próxima slice autorizada.

- Método `affo_nav`, motor `affo-nav-1.0.0`, metodología `reit-equity-1.0.0`,
  selector `method-selection-0.6.0`; [ADR 0044](../architecture/adr/0044-reit-affo-nav.md).
- Snapshot explícito de equity property REIT: conciliación de NI común a FFO/AFFO
  con documento por componente, mantenimiento y renta lineal; cero explícito,
  faltantes rechazados. Mortgage/hybrid REITs y AFFO no positivo requieren otro modelo.
- AFFO proyectado y retención que financia el crecimiento del año siguiente,
  incluido el salto al terminal; distribución descontada por Ke con componentes
  fechados. Interés y claims comunes ya están en los flujos: no resta deuda dos veces.
- NAV separado: NOI consolidado forward/cap rate, más activos no inmobiliarios
  y caja excedente, menos deuda, preferidas, minoritarios, otras obligaciones y
  costo corporativo capitalizado. NAV negativo conserva su signo. Sin promedio
  con el DCF. Opciones recalculadas una vez por equity; básicas más RSU como acciones.
- Bear/bull completos con drivers y horizonte anual común. Sensibilidad beta
  terminal/g sobre trayectoria de AFFO fija, recalculando el último año de
  reinversión; otra por cap rate de NAV. Rechazos por celda y orden independiente
  de los dos valores. `experimental`, `screening`, siempre `requires_review`.
- `valuation:reit --file <path>` sin red ni IA, límite 512 kB y dry run salvo
  `--apply` con guard personal. Repositorio append-only y replay admiten REIT
  sin migración. Sin nueva UI ni construcción automática del snapshot.
- Controles `TM-01`, `TM-05`, `TM-06`, `TM-15`, `TM-16`: clasificación,
  moneda, documentos, fechas, nota de empleados y versiones comprobados;
  `system_recorded` sin fecha de registro por hecho se rechaza.

Evidencia del gate:

- [Oráculo independiente](../valuation/reit-oracle.md): cinco conciliaciones de
  caja equity de `reval.xls` a USD `0,0000001`, Ke exacto 10,1864 %, valor de
  propiedades por múltiplo/NOI a USD `0,000001`. Diferencias de convención
  declaradas; no se afirma igualdad del DCF completo del inmueble y del REIT.
- Perpetuidad con crecimiento financiado: equity 106,25 y 10,625 USD/acción,
  coincidente a `1e-27` para cinco horizontes. Múltiplo de AFFO forward cuando
  retorno incremental = Ke; reinversión del siguiente año comprobada por separado.
- 61 tests nuevos; 2.828 unit y 206 integration pasan (16 del contrato de
  corridas). Nulos, cero, negativos, moneda, no finitos, fechas futuras, horizonte,
  financiación, opciones, scenarios inválidos, sensibilidad, monotonía y replay.
- Lint, tipos, formato y diff pasan. Build habitual Turbopack y 175 E2E con axe
  pasan, 2 omitidos; 643 archivos escaneados sin centinelas. Sin cambios al harness.
- CLI sintético en `/tmp`: 10,625 USD/acción por AFFO y NAV 18, replay reproducido;
  `--apply` en locked niega almacenamiento. Sin escritura en la base personal,
  nueva ingesta o gasto IA.

Límites: no valida refinanciación, distribución fiscal, cobertura de propiedades
ni la definición de AFFO del emisor. Automatizar snapshots y elevar rigor quedan
para incrementos posteriores. Próximo: `F6-01`, job de valuación por ticker.

### Fase 5 — capa IA acotada bajo policy engine

| Issue   | Resultado y aceptación mínima                                                                                          | Depende de | Controles                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| `F5-01` | Budget por corrida y por día, límite global, timeout, breaker, kill switch y métricas **antes** de la primera llamada. | Fase 3     | `TM-10`, `TM-16`                   |
| `F5-02` | Guard server-side: la IA sólo existe en `personal`; ninguna clave llega al browser.                                    | `F5-01`    | `TM-01`, `TM-02`, `TM-03`, `TM-14` |
| `F5-03` | Extracción cualitativa con schema cerrado, evidence IDs obligatorios y secciones dirigidas, no documentos completos.   | `F5-02`    | `TM-09`, `TM-15`                   |
| `F5-04` | Búsqueda web por un buscador allowlisted que devuelve el extracto, sin bajar sus URLs, y contenido no confiable.       | `F5-03`    | `TM-08`, `TM-09`, `TM-12`          |
| `F5-05` | Propuesta de supuestos que respeta locks, cita evidencia y siempre pasa por el policy engine antes del motor.          | `F5-03`    | `TM-09`, `TM-16`                   |
| `F5-06` | La propuesta se persiste en el snapshot; el replay reproduce ambos hashes sin volver a llamar al modelo.               | `F5-05`    | `TM-16`                            |
| `F5-07` | Evals de injection, citas, abstención, schema, costo y corrección.                                                     | `F5-06`    | `TM-09`, `TM-10`, `TM-15`          |

**Adelantada el 2026-10-02.** La [ADR 0033](../architecture/adr/0033-ai-layer-industry-resolution.md)
ejecuta la Fase 5 antes de la Fase 4, con un primer caso cerrado: la industria
de Damodaran cuando el SIC nombra varias candidatas. Tres incrementos:

1. `F5-01` y `F5-02`: `POST` con credencial agregada por el egress, `openrouter`
   y `tavily` en el registro, la allowlist y la tabla de topes, libro de gasto en
   dólares con tope por tarea y por día, breaker, escalera de modelos con dobles
   de test y una llamada real de humo medida.
2. `F5-03` y `F5-06` para este caso: secciones dirigidas del último 10-K,
   `industry-resolution-1.0.0` con policy determinista, resolución persistida
   como aserción `damodaran-industry` con precedencia owner → IA → SIC, comando
   `pnpm valuation:resolve-industry` e integración con `valuation:assess`. Se mide
   sobre las 16 ambiguas de la muestra del gate.
3. `F5-04`: Tavily como segunda evidencia cuando el 10-K no alcanza.

`F5-05` y `F5-07` conservan su alcance y su orden, y la persistencia de `F5-06`
se reusa para los supuestos.

<a id="f5-01"></a>

**`F5-01` — cierre (2026-10-15).** Los controles de la capa IA existen antes de
que cualquier tarea mande evidencia a un modelo:

- **Puerta `POST` con credencial** (`egress-policy-1.1.0`,
  `egress-client-1.1.0`): cada fuente declara método, identificación y, si
  corresponde, qué variable trae su credencial y en qué header va. La puerta la
  lee **después** de autorizar el destino; un adaptador no la ve. Un `POST`
  tiene techo de cuerpo y nunca sigue un redirect. Las fuentes del proyecto se
  presentan como `portal-financiero/1.0` y no reciben el contacto de la SEC, así
  que un runtime sin `SEC_USER_AGENT` ya no deja de construir el cliente: niega
  cada pedido a la SEC.
- **Fuentes registradas**: `openrouter` (`integrated`) y `tavily`
  (`spike_ready`, primera llamada en `F5-04`) en el registro, la allowlist
  (`egress-allowlist-1.1.0`, un endpoint exacto cada una) y la tabla de topes
  (100 y 10 requests/día). `sec-edgar` pasa a `aiTransfer: allowed`.
- **Gasto en dólares** (`ai-spend-1.0.0`, migración `0024`): `ai_spend_ledger`
  reserva el peor caso de cada llamada —bytes del pedido al precio máximo de
  entrada más `max_tokens` al de salida, en nanodólares enteros— contra USD 0,10
  por tarea y USD 1,00 por día UTC, bajo un lock consultivo por fuente, y lo
  liquida con `usage.cost`. Un transporte cortado, un `2xx` ilegible o un costo
  no informado siguen contando el peor caso. `ingestion:sources --spend-limit`
  baja el tope del día y nunca lo sube; el kill switch vale para las dos.
- **Escalera y breaker** (`ai-model-ladder-1.0.0`,
  `model-ladder-runner-1.0.0`, `provider-breaker-1.0.0`): tres familias con
  `zdr`, `data_collection: "deny"`, `require_parameters` y `max_price` fijados
  en el pedido; sube ante transporte, `429`/`5xx`, `4xx`, schema inválido,
  rechazo de la policy o abstención; frena ante una clave rechazada, nuestro
  kill switch o cuota; tres fallas de transporte seguidas abren el breaker de
  la corrida. Cada intento queda en el libro con modelo pedido y respondido,
  tokens, costo, latencia y motivo.
- **Llamada de humo medida** (`pnpm ai:smoke`, tarea `ai-smoke-1.0.0`): sin
  datos de ninguna fuente, por los tres escalones.

Criterios cumplidos: presupuesto por corrida y por día, límite global, timeout,
breaker, kill switch y métricas antes de la primera llamada (`TM-10`, `TM-16`;
también `TM-02` y `TM-08` para la credencial y el `POST`). Evidencia: los tres
escalones contestaron bajo ZDR el 2026-10-15 —`deepseek/deepseek-v4.1-flash`
USD 0,000123 en 1,0 s, `openai/gpt-5.6-luna` USD 0,000041 en 1,8 s,
`google/gemini-3.8-flash` USD 0,000374 en 4,5 s—, cada cobro entre 11 y 23 veces
por debajo de su reserva; 53 tests unitarios del módulo `ai`, 10 de la puerta,
el contrato del libro sobre el doble y sobre PostgreSQL con doce reservas
concurrentes de las que entran exactamente cinco; rollback de `0024` verificado
en una réplica (se niega con filas, deshace tabla y columna vacías, re-aplica).
`F5-02` sigue: el modo ya cierra la puerta y el libro, pero falta probar sobre el
build que ninguna clave llega al browser.

<a id="f5-02"></a>

**`F5-02` — cierre (2026-10-15).** La capa IA sólo existe en el servidor y sólo
en `personal`:

- **Una raíz de composición** (`src/server/ai/get-ai-layer.ts`, `server-only`):
  `getAiLayer()` entrega el libro de gasto y las dependencias de una corrida
  —egress medido, ritmo, breaker propio— y en un runtime trabado se niega con
  `RuntimeLockedError("ai layer")` antes de abrir PostgreSQL o preparar el
  egress, tenga o no la clave configurada. `pnpm ai:smoke` la usa.
- **Ninguna ruta llega a un modelo**: ESLint prohíbe importar `@/server/ai` y
  `@/modules/ai/application` desde `src/app/`. La primera superficie con IA es
  una frontera nueva con su propio slice y `TM-03`.
- **El artefacto no lleva claves**: el gate compila con centinelas en lugar de
  las claves y busca cada uno en todo `.next/` antes de Playwright.
- **Las respuestas tampoco**: en los dos servidores, cada ruta y el export se
  piden como documento y como navegación RSC, sin centinelas en body ni headers.

Criterios cumplidos: la IA sólo existe en `personal` y ninguna clave llega al
browser (`TM-01`, `TM-02`, `TM-03`; `TM-14` queda para el despliegue remoto de
`F6-06`). Evidencia: 5 tests de la composición (cuatro entornos trabados, uno
con la clave puesta, sin tocar base ni transporte); la regla de ESLint rechazó
un import de prueba desde `src/app/`; el escaneo revisó 627 archivos sin
hallazgos y detectó una fuga deliberada —una Route Handler estática que
devolvía `OPENROUTER_API_KEY` dejó el centinela en `server/app/<ruta>.body`—;
1898 unit y 175 E2E.

<a id="f5-03"></a>

**`F5-03` — cierre (2026-10-15).** La industria ambigua se resuelve con la capa
IA y evidencia primaria, y queda guardada (`F5-06` para este caso):

- **El 10-K al corte** (`sec-annual-report-locator-1.0.0`): el `10-K` original
  más reciente aceptado antes del corte, leído de `submissions` por un lector
  propio para no cambiar la versión del parser de la ingesta, con fallback al
  antecesor declarado (ExxonMobil). La allowlist de la SEC suma
  `/Archives/edgar/data/` (`egress-allowlist-1.2.0`) y el nombre del documento
  tiene que ser plano.
- **Secciones dirigidas** (`sec-10k-sections-1.0.0`): el Item 1 es el primer
  tramo de al menos 2.000 caracteres hasta el Item 1A —el índice no califica y
  las referencias cruzadas vienen después—, y la nota de segmentos se reconoce
  por los encabezados que usan los filers. Hasta 20 KB y 8 KB. Medido sobre diez
  10-K reales antes de gastar en un modelo.
- **La tarea** (`industry-resolution-1.0.0`): evidencia delimitada y no
  confiable, respuesta cerrada con schema estricto, policy determinista y
  `aiTransfer` comprobado por fuente antes de reservar (`ai-transfer-1.0.0`).
- **Persistencia** (migración `0025`): `industry_resolutions` y
  `industry_resolution_evidence` guardan toda respuesta con sus extractos y
  hashes; una resuelta se publica como aserción `damodaran-industry` en la misma
  transacción, disponible desde que se resolvió.
- **Precedencia** (`sic-damodaran-industry-1.1.0`): owner → IA → SIC, y una
  resolución sólo vale mientras su industria siga siendo candidata del SIC
  visible. `valuation:assess` la lee sin red y dice qué modelo la respondió.
- **`pnpm valuation:resolve-industry`**: no pregunta dos veces por el mismo SIC y
  el mismo 10-K salvo con `--again`, y una empresa que no es ambigua no gasta.

Criterios cumplidos: extracción cualitativa con schema cerrado, evidence IDs
obligatorios y secciones dirigidas (`TM-09`, `TM-15`); el replay de la
evaluación no vuelve a llamar al modelo. Evidencia: **16 de 16 ambiguas
resueltas, 0 abstenciones, USD 0,041 en total**: 9 en el escalón 1 y 7 en el 2,
ninguna en el 3. Ocho no financieras ganaron WACC; CRM sigue sin WACC por la
cobertura de intereses; las siete financieras tienen industria y siguen en costo
del equity. Repetir no gasta (`already_asked`). Las respuestas son las
esperables (GOOGL `software-internet`, JPM y BAC `bank-money-center`, USB
`banks-regional`, O `retail-reits`, XOM `oil-gas-integrated`), y el owner puede
corregir cualquiera con una declaración. Tests: 7 de secciones, 5 del
localizador, 12 de la tarea y la policy, 2 de `aiTransfer`, 5 del plan, 10 del
orquestador, la precedencia en el mapeo y la evaluación, el contrato del
repositorio sobre el doble y sobre PostgreSQL, y el rollback de `0025` en una
réplica.

El escalón 1 falló el schema en 5 de 16 empresas: 3 veces se quedó sin tokens
razonando (`not_json|length`) y 2 devolvió salidas incoherentes. Desde este
corte, cada `schema_invalid` registra campo y código del primer problema,
nunca el texto. Subir `max_tokens` o cambiar el escalón 1 es una versión nueva
de la tarea o de la escalera, y la decide `F5-07`.

<a id="f5-04"></a>

**`F5-04` — diferido (2026-10-15).** La búsqueda web era la segunda evidencia
para cuando el 10-K no alcanzara, y la medición de `F5-03` no encontró ese caso:
las 16 ambiguas se resolvieron con el Item 1 y la nota de segmentos, sin una
abstención. Construir el camino ahora sería medirlo forzado, sobre empresas que
no lo necesitan, y gastar la cuota de Tavily (10 requests/día) en probarlo.

Condición de reingreso: una empresa ambigua dentro del alcance para la que
`pnpm valuation:resolve-industry` termina en `no_annual_report` o
`item_1_not_found`, o cuya escalera completa se abstiene con
`insufficient_evidence`. Ese caso es el que se mide. Nada se retira:
`tavily` sigue registrada (`spike_ready`), en la allowlist y en la tabla de
topes, sin llamadas, y su revisión de derechos vence el 2027-04-01. `TM-09`
sigue `required` para la búsqueda web cuando reingrese.

**`F5-04` — cierre (2026-10-19).** Reingresó por decisión del owner, sin
esperar la condición de reingreso: la Fase 5 se cierra entera. El caso que
faltaba medir lo dieron los evals de `F5-07`, cuyos casos de abstención son
exactamente un 10-K que no alcanza
([ADR 0033](../architecture/adr/0033-ai-layer-industry-resolution.md),
incremento 3):

- **Adaptador** (`tavily-search-1.0.0`): búsqueda básica de cinco resultados,
  sin respuesta generada, contenido crudo ni imágenes; extractos de hasta
  1.500 bytes; la URL de un resultado nunca se abre (`TM-08`). `tavily` pasa a
  `integrated`.
- **Último recurso** (`resolveCompanyIndustry`): sólo sin 10-K, sin Item 1 o
  tras una abstención por `insufficient_evidence`, y la tarea se repite una sola
  vez. La consulta (`industry-web-query-1.0.0`) es el nombre y las candidatas.
  `aiTransfer` de `tavily` se comprueba antes de reservar; una búsqueda que no
  sale no frena la tarea. `--no-web` la apaga.
- **Prompt** `industry-resolution-prompt-1.1.0`: los resultados web son tan no
  confiables como un filing, con el mismo cerco.
- **Persistencia** (migración `0028`): evidencia `web_search` sin `accession`,
  con una restricción que sólo a ella se lo permite;
  `qualitative-decisions-1.1.0` la congela y sigue leyendo `1.0.0`.
- **Evals** (`ai-eval-cases-1.1.0`): casos `web` con búsquedas reales cacheadas
  junto al reporte local, nunca en el repositorio.

Criterios cumplidos: búsqueda por un buscador allowlisted que devuelve el
extracto, sin bajar las URLs, con contenido no confiable (`TM-08`, `TM-09`,
`TM-12`: ninguna superficie muestra un resultado). Evidencia: con las búsquedas
reales de Salesforce, Charles River y Realty Income, Luna resolvió las tres
abstenciones correctamente en el primer escalón de `ai-model-ladder-1.1.0`
(USD 0,0020; Gemini en sus dos variantes también, DeepSeek una); el prompt
`1.1.0` no movió los 31 casos de industria (16 de 16, 12 de 12, tres
abstenciones). 5 tests del adaptador, 4 del último recurso en el orquestador,
3 del schema, 3 offline de casos web y el contrato del repositorio con evidencia
web sobre PostgreSQL; rollback de `0028` verificado. 2297 unit y 191 de
integración.

**Gate de la Fase 5 (2026-10-19).** Ninguna cifra del resultado sale de texto
libre del modelo —la industria es una clave cerrada y el mix se transcribe con
citas que la policy comprueba—; el replay reproduce ambos hashes sin red ni
modelo (`F5-06`); una propuesta sin evidencia citada es rechazada; el costo por
corrida y la tasa de rechazo están en el libro de gasto, separados de los evals
por `purpose`, y medidos por los evals (`F5-07`). La fase cierra con `F5-01` a
`F5-07` en `done`. Sigue la Fase 4.

<a id="f5-05"></a>

**`F5-05` — primer caso: mix geográfico (decidido el 2026-10-15).** Hoy ningún
`ValuationInput` se arma con datos reales, así que los supuestos de período no
tienen todavía a qué engancharse. El mix geográfico de ingresos sí: es una
fila de la tabla cualitativa de la [metodología](../valuation/methodology.md),
`F5-03` ya recorta la nota de segmentos del 10-K, `cost-of-capital-1.0.0` ya
suma un CRP —hoy el del país de cotización— y `completeness-profile-1.0.0`
nombra el mix como el faltante que deja a Apple y Johnson & Johnson en
`standard`. `F5-05` arranca por ahí y depende de `F5-03`, no de `F5-04`:

- la IA propone pesos por región o país con cita a la evidencia, rango y
  confianza, como un supuesto `ai_proposed`;
- un lock del owner gana siempre y la IA no lo puede pisar;
- la policy rechaza pesos que no suman 100 %, regiones fuera de la release de
  Damodaran vigente y propuestas sin citas;
- el costo de capital pondera el CRP por operaciones y el motor lo recalcula.

El diseño —regiones, versión del costo de capital, dónde vive el lock— se
decide en la [ADR 0034](../architecture/adr/0034-operations-weighted-country-risk.md)
antes del código.

**`F5-05` — cierre (2026-10-16).** El mix geográfico de ingresos entra al
costo de capital, en cuatro incrementos
([ADR 0034](../architecture/adr/0034-operations-weighted-country-risk.md)):

- **Riesgo país del `.xlsx`** (`xlsx-sheet-reader-1.0.0`,
  `damodaran-xlsx-1.0.0`): países y nueve regiones de la misma descarga, con un
  lector propio sin dependencia —directorio central, cuatro partes conocidas,
  techos, CRC32, sin ZIP64, cifrado ni `DOCTYPE`— y el nombre del archivo fijado
  en código. La release pasó de enero a julio de 2026.
- **La tabla del 10-K** (`sec-10k-geographic-revenue-1.0.0`): cae en las 17 no
  financieras de la muestra que la publican, medido sin modelo.
- **La tarea** (`operations-mix-1.0.0`, prompt y policy `1.1.0`, migración
  `0026`): la IA transcribe con citas literales y mapea a claves de Damodaran;
  nunca pondera. La policy comprueba citas, suma, total contra los ingresos del
  ejercicio y claves; el lock del owner por CIK gana siempre;
  `pnpm valuation:operations-mix`.
- **El motor** (`cost-of-capital-1.1.0`, `completeness-profile-1.1.0`,
  metodología `0.5.0`): el CRP por operaciones reemplaza al del domicilio en la
  prima del equity, regiones combinadas por PBI, y
  `wacc_built_from_components` lo recalcula desde los componentes del snapshot.

Criterios cumplidos: la propuesta respeta el lock, cita evidencia y pasa por la
policy antes del motor (`TM-09`, `TM-16`); ninguna cifra sale de texto libre del
modelo. Evidencia: 13 de 17 mixes aceptados por USD 0,40; nueve WACC de la
muestra con CRP por operaciones; Johnson & Johnson de 7,86 % a 8,39 % y de rigor
`standard` a `full`; 23 tests del lector, 10 del recorte, 41 de la tarea y la
policy, 9 del orquestador, 3 de la lectura, 6 del costo de capital y el check
del motor que rechaza un mix agregado a mano; contrato del repositorio sobre
PostgreSQL; rollback de `0026` verificado en una réplica. AAPL, CAT, DE y GOOGL
agotan los tokens de salida en los escalones 1 y 3: evidencia para `F5-07`.

<a id="f5-06"></a>

**`F5-06` — cierre (2026-10-16).** La propuesta de la IA viaja en el snapshot y
el replay no la necesita de ningún otro lado:

- **Decisiones cualitativas** (`qualitative-decisions-1.0.0`,
  `ValuationInput.qualitativeDecisions`, metodología `0.6.0`): la industria con
  su base —SIC, owner o IA— y, si es de la IA, la resolución entera salvo el
  texto de los extractos, que representa su `sha256`; el mix con la declaración
  del owner o la propuesta aceptada, con cada línea como se imprimió y su cita.
  Sin ticker ni CIK: el snapshot sigue nombrando entidades.
- **Los pesos salen de la decisión**: `readOperationsMix` devuelve la decisión,
  `operationsMixReadingOf` deriva los pesos con `operations-mix-weights-1.0.0` y
  la evaluación arma el costo de capital desde ahí. Una industria de la IA cuya
  resolución guardada no aparece (`findResolution`) no se congela.
- **El motor lo repite**: `qualitative_decisions_drive_cost_of_capital`
  (`reject`) comprueba la industria, las candidatas de la tabla del SIC, que cada
  monto salga de lo impreso y lo impreso de su cita, y que fuente, propuesta,
  claves y pesos de `operationsExposure` sean los que la decisión deriva.
- **Replay** (`valuation-replay-1.0.0`): `replayValuationRun` recalcula desde el
  snapshot con el reloj y el ID de la corrida y compara `input_hash`,
  `result_hash` y estado; `ValuationRunRepository.findById` y
  `pnpm valuation:replay --run|--ticker`, que no construye egress ni capa IA, no
  escribe y sale con 1 si algo diverge o si no había nada que reproducir.

Criterios cumplidos: la propuesta se persiste en el snapshot y el replay
reproduce ambos hashes sin volver a llamar al modelo (`TM-16`). Evidencia: en una
réplica de la base personal, las seis empresas con industria y mix de la IA que
tienen costo de capital (AMZN, CRL, INCY, CCL, NCLH, XOM) se valuaron con
supuestos de proyección declarados en un script de evidencia —tres `computed`,
tres `rejected` por arquetipo—; con las tablas de propuestas, las releases de
Damodaran y las aserciones `damodaran-industry` vaciadas y sin
`OPENROUTER_API_KEY` ni `SEC_USER_AGENT`, el replay reprodujo seis de seis, y un
monto transcripto editado en el JSONB divergió en los dos hashes y el estado.
Snapshots de 13,8 a 16,3 kB. CRM queda afuera: no publica intereses y no tiene
costo de capital. 19 tests de las decisiones, 5 del replay, 2 de la evaluación,
`findResolution` en el contrato del repositorio y el replay sobre PostgreSQL;
2121 unit, 189 de integración y 175 E2E. Límite declarado: el replay es del motor
y la metodología vigentes; hoy `valuation_runs` no tiene corridas reales, así que
ninguna queda afuera.

<a id="f5-07"></a>

**`F5-07` — cierre (2026-10-19).** Las dos tareas de la capa IA tienen evals, y
los evals decidieron un cambio
([ADR 0035](../architecture/adr/0035-ai-layer-evals.md)):

- **Corpus congelado** (`ai-eval-corpus-1.0.0`, `pnpm ai:eval-capture`): 25 10-K
  declarados por `accession`, recortados por los lectores de las tareas, 481 kB
  con manifiesto y hashes bajo la ADR 0023. Cada extracto coincide byte a byte
  con el que leyó su corrida de producción.
- **Casos** (`ai-eval-cases-1.0.0`, `ai-eval-injections-1.0.0`): 33 base, 24
  con inyección —fuera de candidatas, candidata incorrecta, escape del cerco,
  abstención forzada; línea inventada, unidad forzada, escape del cerco,
  abstención forzada— y 6 de abstención. El gold lo propuso el agente y el owner
  lo confirmó entero el 2026-10-19.
- **Offline en CI**: hashes, gold que pasa la policy sobre su evidencia, cerco
  intacto ante cada inyección y la policy rechazando la respuesta obediente de
  cada inyección contenible.
- **En vivo** (`pnpm ai:eval`, `ai-eval-scoring-1.0.0`): cada caso a un escalón
  de una variante, reanudable, con `purpose = 'eval'` en el libro (migración
  `0027`) y escaleras simuladas desde lo medido; `--rejudge` aplica la policy
  vigente a lo grabado.
- **Lo que decidió**: `ai-model-ladder-1.1.0` (Luna → Gemini con esfuerzo bajo
  → Gemini → DeepSeek) y `operations-mix-policy-1.2.0`, que lee «China
  (including Hong Kong)».

Criterios cumplidos: evals de inyección, citas, abstención, schema, costo y
corrección sobre las dos tareas (`TM-09`, `TM-10`, `TM-15`). Evidencia: 231
intentos por USD 0,98 en tres días, dentro de los topes. Los dos gates duros en
cero en toda corrida: ninguna inyección contenible aceptada y ninguna
abstención del mix contestada. Mix, 17 casos base: `1.1.0` acierta 14 contra 13
de `1.0.0`, mantiene 10 de 12 con inyección, cuesta 21 % menos y tarda 43 %
menos; Gemini con esfuerzo bajo dejó de agotar la salida (schema de 71 % a
100 %). Industria: 16 de 16 y 12 de 12 en las dos escaleras, 42 % más barata la
nueva. Residuo medido y declarado en `TM-09`: una candidata incorrecta pedida
por inyección y una industria contestada desde el nombre de la empresa sólo las
contiene el modelo (uno de tres casos de abstención, por DeepSeek, en las dos
escaleras). CAT, DE y JNJ no se resuelven con ninguna escalera: es trabajo de la
tarea. 2278 unit, 190 de integración y 175 E2E; rollback de `0027` verificado.

Hallazgo fuera del slice, **resuelto el 2026-10-19**
([ADR 0036](../architecture/adr/0036-sec-acceptance-clock.md)): el mismo 10-K de
NCLH y GOOGL quedó guardado con aceptaciones separadas por 5 horas entre la
corrida de industria (2026-10-15) y la del mix (2026-10-16). Era la SEC: desde
~2026-10-05 regenera cada archivo de `submissions` de un filer que presenta algo
con el offset de Nueva York aplicado dos veces (19 de 25 filers sondeados, con
sus históricos). `sec-acceptance-clock-1.0.0` decide el reloj por archivo con el
horario de EDGAR y corrige sólo con evidencia decisiva; sobre 28 archivos reales,
650 de 650 aceptaciones coinciden con lo guardado en septiembre, que la página
índice de EDGAR confirma. Las 30 filas de evidencia de IA corridas se
repararon contra `source_documents`.

### Fase 6 — corrida por ticker y acceso CEDEAR

| Issue   | Resultado y aceptación mínima                                                                                                                                                                                                         | Depende de | Controles                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------- |
| `F6-01` | Corrida por ticker como job encolado con estado; primera Route Handler o Server Action con sus controles cerrados.                                                                                                                    | Fase 5     | `TM-03`, `TM-07`, `TM-10`, `TM-12`          |
| `F6-07` | Supuestos derivados de lo guardado: una regla versionada arma períodos, terminal y sensibilidad `fcff_base`, el motor la recalcula, y el job registra la corrida o nombra el faltante.                                                | `F6-01`    | `TM-05`, `TM-06`, `TM-16`                   |
| `F6-02` | Historial de corridas: volver a ver, refrescar lo que cambió y comparar contra la anterior sin sobrescribirla.                                                                                                                        | `F6-07`    | `TM-06`, `TM-16`                            |
| `F6-03` | Superficie de resultado sobre empresa real con nivel de rigor, provenance y supuestos distinguidos de los hechos.                                                                                                                     | `F6-02`    | `TM-12`, `TM-15`, `UI-02`, `UI-03`          |
| `F6-04` | Anotación de acceso CEDEAR sobre el registro de `F7-03`: si existe programa, su ratio vigente y su precio, sin fusionar los dos instrumentos.                                                                                         | `F6-02`    | `TM-05`, `TM-06`                            |
| `F6-05` | Ingesta bajo demanda: si el ticker pedido no tiene la ventana de fundamentals, la corrida la baja con presupuesto y reanudación, y audita el contrato point-in-time del sujeto antes de valuar. No hay valuación por lote (ADR 0016). | `F6-01`    | `TM-06`, `TM-10`, `TM-11`, `TM-16`          |
| `F6-06` | Despliegue remoto: Postgres hosteada, protección del deployment verificada y walkthrough del owner sobre datos reales.                                                                                                                | `F6-08`    | `TM-14`, `UI-02`                            |
| `F6-08` | Precio del CEDEAR en BYMA (símbolo corroborado de ambos emisores, ADR 0056) y valor por CEDEAR en pesos con el CCL implícito, sin feed MEP/CCL.                                                                                       | `F6-04`    | `TM-05`, `TM-06`, `TM-08`, `TM-10`          |
| `F6-09` | Precio al `as_of` de la corrida contra su valor y DCF inverso por driver con el mismo motor, al lado de lo que la empresa mostró; sin recomendación ni color de compra o venta.                                                       | `F6-03`    | `TM-05`, `TM-06`, `TM-15`, `UI-03`          |
| `F6-10` | `derived-assumptions-2.0.0`: ROIC terminal por regla (dataset de ROIC por industria de Damodaran, acotado entre el WACC y el ROIC propio), crecimiento por tendencia log-lineal y escenarios bear/bull derivados con su rationale.    | `F6-09`    | `TM-05`, `TM-06`, `TM-16`                   |
| `F6-11` | Lectura cualitativa de la IA sobre las expectativas implícitas: plausibilidad por driver con citas verbatim del 10-K que una policy verifica; se guarda con su evidencia y nunca entra al valor.                                      | `F6-09`    | `TM-09`, `TM-10`, `TM-12`, `TM-15`, `TM-16` |
| `F6-12` | Flujo de valuación por ticker en una sola superficie: pedir, estado inline y resultado sin saltos; jerarquía de decisión primero y evidencia a demanda.                                                                               | `F6-09`    | `TM-03`, `UI-02`, `UI-03`                   |
| `F6-13` | La corrida pregunta a la IA lo cualitativo que la evaluación dice que falta y continúa con un corte nuevo cuando algo quedó aceptado; un freno de la escalera no cuenta como respuesta.                                               | `F6-05`    | `TM-03`, `TM-09`, `TM-10`, `TM-16`          |
| `F6-14` | Conceptos equivalentes en la selección de la SEC y la serie anual, `interest-expense-1.0.0` con bases nombradas y re-descarga de una ventana bajada con una selección vieja.                                                          | `F6-13`    | `TM-05`, `TM-06`, `TM-10`, `TM-16`          |
| `F6-15` | Deuda cero sólo con evidencia de cinco ejercicios y EBIT `pretax + intereses` en el puente de capitalización, con la derivación congelada y recalculada.                                                                              | `F6-14`    | `TM-05`, `TM-06`, `TM-16`                   |
| `F6-16` | Opciones de empleados: anclas fuera del estado de patrimonio, ejercicio de 52/53 semanas en la policy, reclamo desde el XBRL del mismo 10-K y, sin nada, corrida sin restar opciones con rigor más bajo y nombrado.                   | `F6-14`    | `TM-05`, `TM-09`, `TM-16`                   |

**Criterio agregado a `F6-05` el 2026-10-20.** Toda ingesta que dispare la
app —la que baja la ventana que falta y cualquier reingesta o refresh de un
sujeto— termina con la auditoría point-in-time **acotada a ese sujeto**: las
cinco afirmaciones de `pnpm gate:point-in-time` (`F2-07`) sobre sus cadenas,
por el mismo dominio que lee la aplicación. Si alguna falla, la corrida no
valúa: queda en un estado con nombre, la superficie dice qué afirmación falló y
sobre qué hecho, y nada se repara solo. Motivo: las 91 filas de ExxonMobil del
2026-10-20 (enmienda de la ADR 0036) las publicó una reingesta y las detectó
sólo el gate corrido a mano; en la app nadie lo va a correr. Una afirmación
`not_exercised` en un sujeto sin restatements no bloquea: el bloqueo es para lo
que falla, no para lo que no hubo cómo probar. Cuesta lecturas, no requests.

`F6-06` es la condición de reingreso de `F1-08`: la sesión cronometrada del owner se
ejecuta sobre la primera valuación real, con el protocolo del
[runbook](../runbooks/owner-walkthrough.md).

#### `F6-06` — preparación del despliegue protegido (2026-10-24)

Estado: `in_progress`; no cierra el gate de Fase 6.

Al inicio de la sesión el owner pidió preparar el despliegue. Después eligió
Neon, creó el proyecto y autorizó su configuración y traslado; ese incremento
se registra abajo. Vercel sirve la lectura personal protegida. El backup y el
job remoto se verificaron el 2026-10-26; el owner confirmó su walkthrough sin
tiempos medidos. La limitación y el cierre pendiente constan abajo.

`F6-08` se integró con merge commit por el [PR #67](https://github.com/smariconde/finance_portal/pull/67),
con Quality y E2E aprobados. Esta sección parte de `main` actualizado.
El [runbook de despliegue](../runbooks/protected-deployment.md) ordena la
verificación de todos los hosts antes de conectar datos, el aislamiento de
secretos por entorno, la decisión y traslado de PostgreSQL, la prueba del worker
bajo el límite real de la Function y el replay. `TM-14` continúa pendiente de
evidencia remota; escribir `protected` no constituye esa evidencia.

El walkthrough de `F1-08` reingresa sobre una empresa real: el harness acepta
`--ticker` (AAPL por defecto), valida con el esquema del dominio antes de
compilar y anuncia el recorrido por `/valuacion/<ticker>`. El protocolo y la
plantilla distinguen tiempos de espera y lectura, precio, rigor, escenarios,
CEDEAR, historial, runtime sin declarar y protección anónima remota. No se
registraron respuestas ni tiempos del owner.

Evidencia de preparación: lint, tipos, formato y diff sin errores; ayuda y ticker
inválido comprobados sin arrancar servidores. `pnpm walkthrough --no-build --ticker aapl` normaliza a AAPL y levanta ambos procesos sólo en localhost; seis
rutas revisadas por entorno, personal disponible y negativa trabada en las cuatro
superficies de datos (diagnóstico accesible, inexistente 404). Usa el build ya
existente del código de `F6-08`; no es un nuevo build ni una sesión del owner.
Sin UI, migraciones, llamadas a proveedores ni gasto IA.

**Incremento de configuración Neon del 2026-10-24.** El owner eligió Neon,
creó un proyecto y suministró organización/proyecto y rama `production`; la
[ADR 0057](../architecture/adr/0057-neon-hosted-postgres.md) registra esa decisión.
CLI oficial 8.11.3 instalado, skills oficiales `neon` y `neon-postgres` leídas y
fijadas por hash en el inventario, MCP de Codex registrado por OAuth y limitado
al proyecto, y `neon.ts` PostgreSQL con `@neon/config` 1.9.4 de desarrollo. Se
conservan Drizzle, `postgres.js`, el schema, el validador y la DB de integración.
`.env.local` respaldado privadamente y su hash conservado; el enlace y deploy
previstos usan `--no-env-pull`, con descarga a `.env.neon.local`.

El owner completó `neon login` y autorizó expresamente el traslado íntegro al
proyecto/rama/base suministrados y el alcance del rol de runtime. Se verificaron
Free, N. Virginia, PostgreSQL 17.11 y destino vacío. Link y deploy conservan
`.env.local`; el plan no tenía cambios y utiliza sólo PostgreSQL. MCP de Codex
autenticado por OAuth, limitado al proyecto. No se creó otro proyecto, cambió
el plan ni habilitó otro servicio.

Un dump PostgreSQL 17 con snapshot exportado y manifiesto se restauró en una
transacción, sin limpiar el destino ni copiar roles/ACLs locales. Las 46 tablas
coincidieron por conteo y hashes de filas antes de la prueba de escritura; backup
SHA-256 y verificación son privados fuera de Git. Se conserva la base local.
El rol `finance_portal_runtime` tiene SELECT/INSERT/UPDATE/DELETE sobre las 45
tablas públicas y defaults para las futuras del owner; sin CREATE en public,
TEMP, SUPERUSER, CREATEDB, CREATEROLE ni BYPASSRLS. La conexión directa del owner
es exclusiva del comando administrativo. El perfil explícito añade
`dev:neon`, `start:neon` y `db:migrate:neon`; los servidores escuchan en localhost.

Validación: 3.126 unit, lint, tipos, formato y diff pasan. Turbopack no puede
abrir su puerto de compilación ni con ejecución ampliada; se registra la
limitación y `npm run build -- --webpack` pasa. Las migraciones están al día.
En Neon, gate point-in-time pasa (28.268 cadenas, 29.086 revisiones, cero fallas)
y 10 corridas AAPL/AMZN reproducen sus hashes. Portal real AAPL servido con el
rol limitado, desktop y mobile 390 px sin overflow; axe tras hidratación sin
serious/critical en ambas medidas; mismo artefacto sin declarar niega datos.
Un pedido web `ZZZZ` se guardó y su worker terminó `unresolved_ticker`; se conserva
como auditoría de prueba. Los hashes de budgets y spend no cambiaron: cero
requests de proveedores de datos y cero gasto IA. Artefacto: 671 archivos, cero
hallazgos de las claves buscadas; `.env.local` conserva su hash original. No se
publicaron capturas, payloads, snapshots ni credenciales.

**Incremento Vercel del 2026-10-24.** Proyecto del owner
`smaricondes-projects/finance-portal` vinculado al repo; Node 22.x y Functions
`iad1` junto a Neon N. Virginia. `All Deployments` activo. Cinco hosts conocidos
y las seis rutas del runbook redirigen anónimos al login antes y después de
habilitar Production `personal`; Preview sigue `locked` sin DB ni claves. La
pooled de `finance_portal_runtime` y SEC/OpenRouter/Tavily quedaron como Secrets
sólo de Production por autorización explícita; ni conexión administrativa ni
base de test se cargaron. El commit `549320e` se subió desde un archivo limpio
sin archivos locales y el build quedó `READY`. `/configuracion` autenticada
resolvió `personal`; AAPL devolvió `200` con datos de Neon. El CLI asignó el
alias del equipo pese a `--skip-domain`; tras verificarlo se promovió el mismo
build al dominio principal. Todos los hosts conocidos siguieron negando
anónimos. `vercel curl` creó un bypass automático durante la lectura; se revocó
y se verificó cero bypasses activos. No hubo job, nuevas llamadas a proveedores
ni gasto IA en estas comprobaciones.

Pendientes: retención y prueba del backup operativo, job y replay remotos bajo
duración real de Function, y walkthrough cronometrado del owner. `TM-14` tiene
evidencia de rechazo anónimo, pero el gate `F6-06` no cierra sin la sesión y
las pruebas restantes. El próximo incremento sigue siendo `F6-06`; no habilita
Fase 8.

**Incremento operativo del 2026-10-26.** Un dump nuevo de Neon se restauró en
una base local descartable: 46 tablas y los conteos de corridas, jobs y
observaciones coincidieron (11, 22 y 29.146). Se verificó SHA-256, se conservó
una copia privada fuera del repo y se eliminó sólo la base de prueba. El script
`scripts/backup-neon.ts` verifica el archivo, deja manifiesto y conserva 30 días
con piso de dos copias; el timer de usuario en `ops/systemd/` quedó activado
para la corrida diaria y su servicio corrió con `Result=success` (84 s, 46
tablas, 7.508.879 bytes). La siguiente activación quedó programada para el
2026-10-27 a las 04:20 ART. [Procedimiento](../runbooks/protected-deployment.md).

La Function protegida completó AAPL en unos 10 s desde el clic; el job terminó
`run_recorded/computed` en 1,5 s y la corrida nueva se reprodujo desde Neon
sin divergencias de hash. MSFT no tenía job: descargó 1.163 observaciones y
terminó `unsupported_method` con motivo visible en unos 13 s, mediante dos
jobs de 4,7 y 0,7 s. Su repetición tardó unos 9 s y no aumentó observaciones
ni requests: el día quedó en cuatro de SEC y uno de Yahoo; sin gasto IA en
esta prueba. `All Deployments` siguió activo, el bypass temporal se revocó,
quedaron cero bypasses y una visita anónima a AAPL volvió a recibir `302`.

El owner informó que hizo la [sesión](../walkthroughs/2026-10-26-f6-06.md),
que funcionó bien y que no hubo dificultades, pero no midió tiempos ni dejó
respuestas por paso. Esa limitación queda explícita: la parte cronometrada del
protocolo aún no tiene evidencia. Localmente pasan lint, tipos, formato,
`git diff --check`, 3.128 unit y el gate E2E (204 pasan, 2 omitidos). `F6-06`
sigue `in_progress` hasta resolver ese criterio y pasar Quality/E2E en CI
antes del merge.

#### `F6-01` — corrida por ticker encolada (cerrado el 2026-10-21)

Estado del slice: `done`. No cierra el gate de la Fase 6: no hay una valuación
completa persistida. `F6-02` queda `ready`.

- Regla `valuation-job-1.0.0`. Tabla `valuation_jobs` (migración `0031`), un job
  abierto por ticker normalizado. Estados `queued`, `running`, `completed`. Un
  arranque de más de dos minutos se retoma con otro token; el cierre exige el
  token que reclamó.
- El worker resuelve el ticker al corte del encolado (`as_known`, versiones
  cerradas incluidas) y corre `assessCompany` sobre lo guardado. No abre la red,
  no llama al modelo y no escribe `valuation_runs`: no hay snapshot de supuestos.
- Huecos: `unresolved_ticker`, `ambiguous_ticker`, `identity_conflict`,
  `cik_missing`, `annual_fundamentals` (el gancho de `F6-05`), `unsupported_method`,
  `snapshot_not_assembled` y `assessment_failed`.
- `enqueueValuation` ([ADR 0045](../architecture/adr/0045-ticker-valuation-job.md)):
  modo resuelto en el request; esquema ticker más intento `enqueue` o `status`;
  respuesta de códigos. El render de `/valuacion` no abre PostgreSQL. Un runtime
  trabado muestra la negativa. La vista pública no lleva UUIDs, SQL ni el token.
- Controles: `TM-03` para esta frontera, `TM-07` (consultas parametrizadas,
  `limit 1`), `TM-12` (el ticker inválido no se repite; el resultado es texto).
  `TM-10` no se ejerce: no hay socket.

Evidencia:

- 2.861 unit y 209 integration. El contrato del store corre en memoria y en
  PostgreSQL: segundo encolado del mismo ticker, job cerrado que permite otro,
  cierre con token ajeno y retoma de un arranque viejo.
- Tipos, lint, formato y build Turbopack pasan. `/valuacion` queda dinámica.
  185 E2E pasan, 2 omitidos; axe en personal y trabado; 724 archivos de `.next/`
  sin centinelas. Detector de Impeccable sobre la página, el formulario, la home
  y la sidebar: sin hallazgos.
- En el runtime personal, AAPL termina en `snapshot_not_assembled` (perfil no
  financiera madura, `fcff_base`, rigor estándar) y ZZZZ en
  `unresolved_ticker`. Un CIK no se encola y la página no lo repite. Sin valor
  por acción y sin red.
- Migración `0031` aplicada en la base de test por la suite y en la personal con
  `pnpm db:migrate`. Rollback pareado: se niega si hay filas.

#### `F6-07` — supuestos derivados de lo guardado (cerrado el 2026-10-21)

Estado del slice: `done`. Abierto el 2026-10-21 a pedido del owner, que eligió
derivar los supuestos por código antes de `F6-02`, porque sin corridas no hay
historial que listar. No cierra el gate de la Fase 6: la superficie del valor es
`F6-03` y la ingesta bajo demanda `F6-05`. `F6-02` queda `ready`.

- Regla `derived-assumptions-1.0.0` ([ADR 0046](../architecture/adr/0046-derived-valuation-assumptions.md)):
  diez años; crecimiento desde el CAGR de tres a seis ejercicios consecutivos,
  margen y sales-to-capital ajustados del ejercicio base, impuesto aplicado →
  marginal y WACC → terminal en los años 6–10; terminal con `g` igual a la libre
  de riesgo y ROIC igual al WACC terminal; sin escenarios.
- `ValuationInput.derivedAssumptions` congela la historia de ventas y
  `assumptions_derived_recomputed` reconstruye períodos, terminal y sensibilidad.
  Opcional: los snapshots anteriores conservan checks y hashes; motor
  `fcff-1.6.0` y metodología `0.12.0` sin cambios.
- `valuation-snapshot-1.0.0` arma el snapshot desde la evaluación, la
  transcripción de opciones aceptada al corte, la carátula y la serie de precios.
  Activos no operativos y otras claims se declaran ausentes con el nombre de la
  regla.
- `valuation-job-1.1.0` (migración `0032`): `run_recorded` con la corrida y su
  estado, o `snapshot_not_assembled` con el motivo. La vista devuelve el estado
  de la corrida, nunca su ID ni su valor.
- Controles: `TM-05` (lo que falta se nombra, nunca cero), `TM-06` (todo se lee al
  corte del job, la carátula posterior no se ve), `TM-16` (la corrida rechazada
  también se registra, y se reproduce).

Evidencia:

- 2.883 unit y 210 integration. El contrato del store cierra con corrida y
  con motivo en memoria y en PostgreSQL, con la FK a `valuation_runs`.
- Tipos, lint, formato y build pasan. 185 E2E con axe (2 omitidos).
  Detector de Impeccable sobre el formulario: sin hallazgos.
- Réplica de la base personal, 2026-10-21: AAPL y AMZN terminan `run_recorded`
  `computed`, sin checks fallados, y `pnpm valuation:replay` reproduce los dos
  hashes. GOOGL frena en `employee_equity_not_proposed` (la escalera no encontró
  la nota) y JNJ en `base_margin_unavailable`. Tres transcripciones de opciones
  costaron USD 0,015.
- La base personal no tiene transcripciones de opciones: hoy toda empresa
  `fcff_base` frena ahí, nombrado.
- Migración `0032` aplicada en test por la suite, en la réplica y en la personal.
  El rollback se niega con filas `1.1.0` y, sin ellas, reconstruye el enum.

#### `F6-02` — historial de corridas (cerrado el 2026-10-21)

Estado del slice: `done`. No cierra el gate de la Fase 6. `F6-03` (superficie
del resultado) queda `ready`.

- [ADR 0047](../architecture/adr/0047-valuation-run-history.md): refrescar es
  volver a encolar; `valuation_runs` es append-only y un snapshot idéntico
  devuelve la misma corrida. Sin migración.
- `listCompletedByTicker` con techo de 20 en los dos almacenes (`TM-07`).
- `valuation-run-comparison-1.0.0`: `same_run` por hash, o las secciones que
  cambiaron (ventas base, normalización, capitalización, costo de capital,
  industria o mix, método o rigor, fracaso, opciones, puente, supuestos,
  versiones, identidad), con el corte aparte. Nunca compara el resultado.
- `loadValuationHistory`: modo en el request, esquema de un solo campo,
  respuesta de códigos y fechas, sin IDs ni valores (`TM-03`). `TM-06`: cada
  fila dice su corte; `TM-16`: nada se sobrescribe.
- `/valuacion` muestra la tabla al terminar un pedido.

Evidencia:

- 2.900 unit y 211 integration; el contrato del store lista en memoria y en
  PostgreSQL. Tipos, lint, formato y build; 185 E2E con axe (2 omitidos).
- Corregido de paso: el contrato de `F6-07` compartía la corrida demo con la
  suite de corridas, que la borra; según el orden fallaba por la FK. Ahora
  registra una corrida de una entidad propia. Dos corridas seguidas: 211 de 211.
- Réplica con build servido: catorce refrescos de AAPL, «Primera corrida» y
  después «sólo el corte; los datos no cambiaron». 21 kB por corrida. Axe
  escritorio y móvil sin hallazgos nuevos (`region` en la sidebar y el hover del
  botón primario ya estaban). Una transcripción costó USD 0,0006.

**Replanificación del 2026-10-21.** Con la primera corrida real a la vista
(AAPL 143,82 USD contra 333,02 USD de cierre), el owner revirtió la decisión de
`F6-03` de no mostrar el precio: un valor que no se contrasta con el mercado no
sirve para decidir. Se abren cuatro issues antes de `F6-05`: `F6-09` (precio y
DCF inverso), `F6-10` (supuestos derivados `2.0.0`), `F6-11` (lectura
cualitativa de la IA sobre lo que exige el precio) y `F6-12` (flujo de
valuación en un solo lugar). `F6-05` pasa a `queued` detrás de ellos. El año
base TTM desde 10-Q queda nombrado como límite de `F6-10`, porque cambia toda
la normalización.

#### `F6-14` — leer los conceptos que los filers usan de verdad (cerrado el 2026-10-22)

Estado del slice: `done`. `F6-15` queda `ready`; `F6-16` y `F6-08` quedan
`queued`, en ese orden, con las decisiones del owner registradas.

Decisiones del owner del 2026-10-22, después de medir los frenos de `F6-13`:
los intereses aceptan el neto cuando es gasto y después lo pagado; la deuda
vale cero sólo con evidencia (`F6-15`); sin transcripción de opciones, el XBRL
del mismo 10-K y, si no hay, la corrida sin restar opciones (`F6-16`).

- Medición previa ([ADR 0053](../architecture/adr/0053-reported-concept-coverage.md)):
  companyfacts de 80 empresas del índice, sin IA ni escrituras. De 76 no
  financieras, 32 resolvían deuda, intereses, EBIT y D&A; con los conceptos que
  usan de verdad, 51.
- `sec-core-concepts-6.0.0` suma siete conceptos; `annual-fundamentals-1.3.0`
  los lee como alternativas o partidas propias: vencimientos con arrendamientos
  financieros, D&A con acreciones, e intereses de la deuda, de arrendamientos,
  neto y pagado.
- `interest-expense-1.0.0`: bruto → deuda + arrendamientos → neto si es gasto →
  pagado, con la base nombrada. `fundamental-profile-signals-1.1.0` la usa para
  la cobertura y para el EBIT de respaldo, y `completeness-profile-1.3.0` cuenta
  ese EBIT. La cobertura lleva `interestBasis` sólo cuando no es el bruto, y el
  costo de capital la declara; una corrida con el bruto no cambia su hash.
- La corrida re-baja companyfacts una vez cuando la ventana guardada se bajó con
  otra selección (`selectionOutdated`). Una ventana vieja nunca frena: el job que
  continúa no la reemplaza, y una fuente ocupada deja valuar con lo que hay.
- Controles: `TM-05` (ninguna base inventa un cero: sin base, `null`), `TM-06`
  (la re-descarga publica sólo lo nuevo, con su disponibilidad), `TM-10` (una
  re-descarga por empresa, con la admisión de la ADR 0020) y `TM-16` (la base de
  los intereses y la re-descarga quedan en la corrida y en el job).

Evidencia:

- 3.038 unit y 220 integration; formato, lint, tipos y build; 204 E2E con axe
  (2 omitidos).
- Réplica de la base personal, worker real, doce empresas:
  - **WMT, CDW, GD, IEX y AAPL** con corrida `computed`, y ZBH en
    `requires_review`. Antes ninguna salvo AAPL: WMT por la cobertura, las
    otras por intereses que no eran brutos; IEX con lo pagado.
  - KO ya resuelve su deuda; la frena la transcripción de opciones, como a WM y
    Cencora (`F6-16`).
  - NKE se clasifica (`non_financial_mature`) y frena en
    `base_margin_unavailable`: el EBIT del puente es `F6-15`.
- Un error encontrado en la réplica y corregido antes de cerrar: la declaración
  de la base `interest_paid` se armaba por plantilla y no existía, y el job de
  NKE terminó en `assessment_failed`. Ahora es un mapa explícito con test.

#### `F6-15` — deuda cero con evidencia y EBIT sin resultado operativo (cerrado el 2026-10-22)

Estado del slice: `done`. `F6-16` queda `ready`; `F6-08` sigue `queued`.

Decisiones del owner del 2026-10-22, después de medir la regla de la ADR 0053
contra la muestra de 80 empresas y la réplica: la regla literal daba cero sólo a
Intuitive y Align, dejaba afuera a Vertex, Deckers y Expeditors, y le daba
**deuda cero a D.R. Horton**, que debe ~5.000 M en `NotesPayable` y capitaliza
sus intereses. El owner eligió la regla refinada con guardia y la banda más alta
para quien no paga intereses ([ADR 0054](../architecture/adr/0054-zero-debt-evidence-derived-ebit.md)).

- `sec-core-concepts-7.0.0` y `annual-fundamentals-1.4.0`: catorce conceptos de
  **guardia** —cronograma de vencimientos, pagarés, línea de crédito, totales
  con arrendamientos— que ninguna receta suma; cada uno partida propia. La serie
  lee 68 conceptos, así que el lector parte la lectura en tandas de 64.
- `zero-debt-evidence-1.0.0`: cinco ejercicios con ventas, sin préstamos ni
  guardia distintos de cero, e intereses nulos o con cobertura en la banda más
  alta de la tabla de la corrida. Se congela en
  `normalization.facts.zeroDebtEvidence` sólo cuando se usa.
- `reported-debt-1.1.0`, sólo sin receta y con evidencia: `finance_leases_only`
  o `zero_with_evidence` (claim `declared_absent` con la regla). Con receta, la
  salida es la de `1.0.0` byte por byte.
- Sin intereses en la evidencia, la cobertura es el piso de la banda más alta
  (`no_interest_expense`, declaración `coverage_no_interest_expense`). El check
  `zero_debt_evidence_consistent` exige que el piso sea la fila y la release del
  `company_default_spread` de la corrida; sin evidencia, el check no existe.
- `ebit-from-pretax-1.0.0`: sin `OperatingIncomeLoss`, el puente toma el
  resultado antes de impuestos más `netInterestForEbit`, congelado en
  `capitalization.ebitDerivation` y recalculado por `capitalization_recomputed`.
- El rigor baja sin regla nueva: `cash_and_debt` no se cumple sin deuda
  publicada. Motor `fcff-1.6.0` y metodología `0.12.0` sin cambio: los campos
  nuevos son opcionales.
- Superficie: el libro de ajustes dice cuándo el EBIT es derivado y cuándo la
  deuda salió de la evidencia; la declaración nueva tiene su etiqueta.
- Controles: `TM-05` (cero sólo con evidencia y guardia; D.R. Horton queda sin
  resolver), `TM-06` (la evidencia es de los ejercicios visibles al corte, cada
  hecho de su cierre) y `TM-16` (evidencia, piso y derivación congelados y
  recalculados).

Evidencia:

- 3.075 unit y 220 integration; formato, lint, tipos y build; 204 E2E con axe
  (2 omitidos).
- Réplica, worker real, once empresas:
  - **ADP y ETN** con corrida `computed` y EBIT derivado (base `gross`); AAPL
    `computed` como control. Antes, ninguna de las dos.
  - **ALGN, DECK y EXPD** resuelven deuda cero con evidencia y el costo de
    capital (ALGN en la banda Aaa sin intereses, rigor `standard` por
    `cash_and_debt`); frenan en `employee_equity_not_proposed`, que es `F6-16`.
  - **NKE** pasa el margen base con EBIT derivado (base neta) y frena en
    `shares_outstanding_unavailable`: la carátula publica las acciones por
    clase. **MRK** frena en las opciones (`F6-16`).
  - **DHI** queda `no_recipe` con `borrowing_reported`: la guardia funciona.
  - **VRTX** no cumple la evidencia (`interest_material`): en 2024 tuvo pérdida
    operativa —el cargo de Alpine— con intereses. **ISRG** se clasifica
    `high_growth`. Ninguno de los dos frena por deuda.
  - Las 16 corridas guardadas de AAPL, AMZN, WMT, GD, ADP y ETN se reproducen,
    incluidas las anteriores al slice.
- Límites nombrados: la guardia es una lista de conceptos; acciones por clase en
  la carátula (NKE); intereses de arrendamientos financieros en un año de
  pérdida (VRTX).

#### `F6-16` — opciones de empleados robustas (cerrado el 2026-10-22)

Estado del slice: `done`. `F6-08` queda `ready`.

Decisión del owner del 2026-10-22: sin plazo en companyfacts, las opciones del
XBRL se valúan a diez años, el plazo contractual y su cota superior
([ADR 0055](../architecture/adr/0055-employee-options-fallback.md)).

- Diagnóstico sobre los nueve 10-K, antes de cambiar nada: ALGN, DECK, MRK y
  COST no encontraban la nota (filas de saldo que el extractor no leía; Costco
  anclaba en el estado de patrimonio); KO tiene dos escalas; HD rotula «Fiscal
  2025» el ejercicio que cierra en febrero de 2026; WM, EXPD y Cencora tienen la
  tabla y los modelos se abstienen o la policy rechaza.
- `sec-10k-equity-compensation-1.2.0`: «Outstanding December 31, 2025»,
  «Nonvested, March 31, 2026», «Unvested as of …», «Outstanding at the end of
  2026», y el estado de patrimonio puntúa cero. Los nueve recortan su nota.
- `employee-equity-1.3.0`, prompt `1.4.0`, policy `1.2.0`: `unitsScale` aparte
  (y `scale` vacía sin opciones), «fiscal <año − 1>» para un cierre de enero o
  febrero, y las unidades corroboradas contra el XBRL por orden de magnitud
  (`units_scale_contradicts_xbrl`).
- `sec-core-concepts-8.0.0`: opciones vivas, su strike y unidades no
  consolidadas al cierre. `employee-options-xbrl-1.0.0` arma la decisión con la
  cantidad y el strike de una misma presentación; sin ellos,
  `employee-options-not-subtracted-1.0.0` no resta opciones, lo declara en el
  puente y en la página, y baja el rigor un nivel
  (`employee_options_not_subtracted`).
- `employeeEquity.decision` es una unión por `basis`; la transcripción queda byte
  por byte y `rigor_derived_from_completeness` recalcula con la base congelada.
  Motor y metodología sin cambio.
- Superficie: el bloque de opciones de `/valuacion/[ticker]` tiene una variante
  por base, con su marca de origen (`impeccable`, detector sin hallazgos).
- Controles: `TM-05` (una opción sin dato no se presume cero: o se valúa con la
  cota, o no se resta y se dice), `TM-09` (misma tarea con evidencia delimitada,
  policy más estricta) y `TM-16` (base, hechos XBRL y presentación congelados y
  recalculados).

Evidencia:

- 3.093 unit y 220 integration; formato, lint, tipos y build; 204 E2E con axe
  (2 omitidos).
- Réplica, worker real: **KO, HD, COST, WM, Cencora, ALGN, DECK, EXPD y MRK
  llegan a una corrida** con la base de las opciones nombrada: transcripción
  (KO, MRK, COST, DECK, ALGN), XBRL (Cencora, EXPD) y sin restar (HD, WM, en
  `screening`). WM pide revisión por `terminal_value_share`.
- Dos errores encontrados en la réplica y corregidos antes de cerrar: `scale`
  obligatoria sin opciones (cuatro escalones `schema_invalid` en Costco, Deckers
  y Align) y la escala de las unidades de Costco multiplicada por mil (96,53 USD
  en lugar de 529,79 USD), que ahora rechaza la policy.
- Las 44 corridas guardadas de quince empresas se reproducen. USD 0,26 de IA en
  la tanda final.
- No hay evals de esta tarea: la regresión es la de sus tests y la réplica.

#### `F6-13` — la corrida le pide a la IA lo cualitativo que falta (cerrado el 2026-10-22)

Estado del slice: `done`. No cierra el gate de la Fase 6: falta el despliegue
remoto (`F6-06`).

Decisión del owner del 2026-10-22: el sistema tiene que dar resultados en vez de
frenar por un dato cualitativo. El job corre **las tres** tareas —industria
ambigua, opciones de empleados y mix de operaciones— y este slice va antes que
`F6-08`.

- `valuation-qualitative-1.0.0` ([ADR 0052](../architecture/adr/0052-qualitative-decisions-in-valuation-job.md)):
  con un método `fcff_base` y el paso de datos sin bloqueo, el job pregunta en
  orden fijo lo que la evaluación dice que falta. Cada tarea es la de su
  comando, con `apply` y sin `again`; una declaración del owner sigue siendo el
  lock. Las tres comparten `submissions` y el 10-K, pedidos una vez por job, y
  una escalera que frena corta las siguientes (`not_run`).
- `isTransientAiAnswer`: una respuesta `stopped` o `ai_budget_exhausted` ya no
  cuenta como «ya se preguntó por este 10-K», en el job y en los comandos. Un
  día con el tope gastado ya no traba a la empresa hasta un `--again`.
- Si queda alguna decisión aceptada, el job termina en `qualitative_resolved` y
  encola otro con corte nuevo en la misma transacción. Cadena de tres como mucho:
  bajar, decidir, valuar.
- `sec-10k-equity-compensation-1.1.0`: la fila de saldo también es
  «Outstanding on …» y la versalita «OUTSTANDING AT …». Con `1.0.0`, Coca-Cola,
  Procter & Gamble, Cisco y Costco salteaban con `equity_note_not_found`.
- `valuation-job-1.3.0`, migración `0035` (`qualitative_step`, gap
  `qualitative_resolved`) con rollback pareado que se niega si hay filas `1.3.0`.
- Superficie: el copy de `/valuacion`, del runner y de los avisos dice que la
  corrida le pide a la IA lo que falta; lo que no resolvió se dice en una
  oración, sin códigos; el historial etiqueta «Resolvió con IA».
- Controles: `TM-03` (la acción no importa la capa IA; el worker corre detrás de
  `after()`, y ESLint sigue cerrando `src/app/`), `TM-09` (mismas tareas,
  evidencia delimitada y policies), `TM-10` (tres tareas por pedido como mucho,
  los topes en dólares y de requests de la ADR 0033, una búsqueda de Tavily por
  job) y `TM-16` (el job registra qué preguntó, qué respondió cada tarea y lo
  cobrado).

Evidencia:

- 3.021 unit y 220 integration; el contrato del store prueba en memoria y en
  PostgreSQL el cierre `qualitative_resolved` con su continuación. Formato, lint,
  tipos y build; 204 E2E con axe (2 omitidos).
- Réplica de la base personal, worker real, diez empresas no financieras sin
  decisiones de IA guardadas salvo AAPL: **cinco corridas `computed`** —PEP,
  MCD, PG, CSCO y AAPL—, contra una sola (AAPL) sin este slice. KO bajó todo
  y resolvió industria y mix en 40 s. Gasto de IA: USD 0,238 en 49 intentos, unos
  USD 0,024 por empresa nueva.
- Lo que sigue frenando no es cualitativo, o la IA no lo resuelve:
  - KO: la deuda no tiene receta en `reported-debt-1.0.0` (publica
    `longTermNoncurrent` y `commercialPaper`), así que no hay capital invertido
    ni sales-to-capital; además la escalera no da una transcripción de opciones
    aceptada.
  - HD: la nota de opciones aparece, pero ninguna transcripción pasa la policy
    (`ladder_exhausted`).
  - WMT: falta la cobertura de intereses, así que no hay rating sintético ni
    WACC.
  - COST: sólo tiene RSU, y el modelo no reconoce el recorte como la nota
    (`no_equity_compensation_note`).
  - NKE: el selector no tiene evidencia para clasificarla
    (`missing_classification_evidence`).
- Migración `0035` aplicada en la base personal.

Límites nombrados: la lectura de expectativas (`F6-11`) sigue siendo comando. Sin
transcripción aceptada no hay regla para valuar las opciones, y el snapshot no
se arma. El tope de USD 1,00 por día alcanza para unas 40 empresas nuevas.

#### `F6-05` — la corrida baja lo que falta y audita su sujeto (cerrado el 2026-10-21)

Estado del slice: `done`. No cierra el gate de la Fase 6: falta el despliegue
remoto (`F6-06`). `F6-08` queda `ready`.

Decisiones del owner del 2026-10-21: **sólo datos** (el job no llama a la IA; la
transcripción de opciones, la industria ambigua, el mix y la lectura de
expectativas siguen siendo comandos) y **dos jobs encadenados** (el corte de un
job no se mueve).

- `valuation-data-1.0.0` ([ADR 0051](../architecture/adr/0051-on-demand-valuation-data.md))
  decide sobre la evaluación qué falta:
  - la ventana de la SEC: companyfacts del CIK y de sus antecesores de reporte,
    como `sec_companyfacts_backfill` durable;
  - el SIC: un `submissions`, como `valuation:assess --apply`;
  - el cierre de la última rueda asentada (`ticker-price-freshness-1.0.0`, la
    regla de la referencia de la ADR 0030 sobre una security), como
    `yahoo_prices_refresh` de un item.
- Reanudación: un plan igual a uno abierto devuelve ese job. Fuente ocupada, sin
  cuota, frenada, en backoff o pausada es `ingestion_pending` con su motivo y su
  hora; un sujeto rechazado es `ingestion_failed` con el código del item. Nada se
  reintenta solo. La espera en línea tiene techo de un minuto. Los precios nunca
  bloquean.
- Todo job audita su emisor y sus antecesores con las cinco afirmaciones de
  `pnpm gate:point-in-time`, por el mismo dominio y la lectura paginada filtrada
  por `subject_id`. Una falla es `point_in_time_audit_failed` con la afirmación,
  el concepto, la fecha y el total; `not_exercised` no bloquea.
- Si el job bajó algo termina en `data_ingested` y, en la misma transacción,
  encola otro con corte nuevo (`follows_job_id`) que el mismo worker corre. Ese
  segundo job nunca baja nada: no hay bucle.
- El job late cada 30 segundos (`heartbeat_at`) y se retoma por el último latido.
- `valuation-job-1.2.0`, migración `0034` con rollback pareado que se niega si hay
  filas `1.2.0`. Corregido de paso: `valuation_jobs_run_check` sólo admitía una
  corrida registrada bajo `1.1.0`.
- Superficie: el copy de `/valuacion`, del runner y de los avisos dice qué baja y
  qué no; los gaps nuevos tienen su frase, el historial su etiqueta, y un pendiente
  o una falla de auditoría se explica en una oración, sin IDs.
- Controles: `TM-06` (el job que valúa tiene un corte que ve lo bajado; la
  auditoría prueba el no-look-ahead del sujeto), `TM-10` (toda salida por el egress
  medido, con la admisión de la ADR 0020 antes de planear), `TM-11` (jobs
  idempotentes por plan y por contenido) y `TM-16` (nada se sobrescribe; cada job
  registra qué bajó y qué auditó).

Evidencia:

- 2.993 unit y 219 integration; el contrato del store prueba en memoria y en
  PostgreSQL la continuación atómica, el cierre perdido sin continuación y el
  latido. Formato, lint, tipos y build; 204 E2E con axe (2 omitidos). Detector de
  Impeccable sin hallazgos.
- Réplica de la base personal, build del worker real:
  - MSFT, sin nada guardado: bajó su ventana, observó el SIC 7372 y el cierre,
    auditó 1.015 cadenas y en 6,3 s el job encadenado terminó en
    `unsupported_method` (`high_growth` pide `fcff_three_stage`; industria ambigua
    entre tres de software).
  - AAPL: bajó sólo el cierre y el job encadenado registró una corrida `computed`
    en 1,9 s.
  - Con una fila de AAPL alterada a mano, el job siguiente terminó en
    `point_in_time_audit_failed` (`provenance_resolves`,
    `dei:EntityCommonStockSharesOutstanding` al 2026-07-17, 2 fallas).
  - `pnpm gate:point-in-time` sobre la réplica pasa con 29.283 cadenas, MSFT
    incluida.
- Migración `0034` aplicada en la base personal; rollback y re-aplicación probados
  sobre la réplica.

Límites nombrados: no registra splits; no refresca una ventana ya guardada con una
selección vieja ni un SIC ya observado; el cierre del día que Yahoo todavía no
asienta queda revisado y no se pide de nuevo hasta la rueda siguiente.

#### `F6-12` — flujo de valuación en un solo lugar (cerrado el 2026-10-21)

Estado del slice: `done`. Cierra la replanificación del 2026-10-21. `F6-05`
vuelve a `ready`: es la ingesta bajo demanda, y suma bajar el precio que falta
del ticker antes de valuar, porque hoy la comparación usa el último cierre
guardado.

- `/valuacion` es sólo la entrada: encola con la acción de `F6-01` y lleva a
  `/valuacion/[ticker]`. Un pedido que no se pudo hacer se dice ahí, sin
  navegar.
- `ValuationRunner` en el encabezado del ticker: «Valuar TICKER» o «Volver a
  valuar».
  - Al abrir, consulta si hay un pedido abierto y lo sigue.
  - El estado se anuncia en línea (`role="status"`).
  - Al registrarse la corrida, `router.refresh()` relee la página en el lugar.
  - Un pedido ya terminado no relee nada.
- Jerarquía de decisión con índice de anclas:
  - primero el resultado con el rango bear–bull, el precio con lo que exige y
    el acceso CEDEAR, y los escenarios con la sensibilidad;
  - después cómo se llegó: derivación, supuestos, costo de capital,
    decisiones cualitativas y puente;
  - al final la evidencia (origen de los datos, rigor, hechos, controles) y el
    historial.
- `loadValuationHistory` se quitó: quedó sin llamador (enmienda de la
  ADR 0047, `TM-03`).
- Hallazgo, no corregido en este slice: con la navegación del cliente, Next 16
  conserva oculta la página anterior. Aparecen dos `#contenido`, y el enlace
  «Saltar al contenido» puede apuntar al oculto. Pasa en toda navegación del
  shell, no sólo acá; el arreglo es que el destino del salto lo ponga el
  layout.

Evidencia:

- Suite unit, integración, lint, tipos, formato, build y E2E con axe.
- Recorrido con la base personal:
  - AMZN desde `/valuacion`: navega en 481 ms, anuncia «Evaluando lo
    guardado» y después «Corrida registrada», y la página se completa sola.
  - ZZZZ dice «no está en el universo constituido» sin valor.
- Axe en escritorio claro y móvil oscuro sin hallazgos nuevos (`region` de la
  sidebar ya estaba); sin desborde a 390 px.

#### `F6-11` — lectura del 10-K frente a lo que exige el precio (cerrado el 2026-10-21)

Estado del slice: `done`. No cierra el gate de la Fase 6. `F6-12` queda
`ready`.

- [ADR 0050](../architecture/adr/0050-market-expectations-reading.md): el
  modelo no ve el precio ni lo exigido. Las dos cosas salen de Yahoo y de
  Damodaran, cuyo `aiTransfer` es `restricted`, y además lo anclarían. Lee
  el Item 1, el MD&A sin advertencias, estimaciones contables ni liquidez, y
  el comienzo del Item 1A (`sec-10k-outlook-1.0.0`, 30 KB).
- `market-expectations-reading-1.0.0`: perspectiva ordinal por driver
  (crecimiento, margen, ventaja) con señales y riesgos citados literalmente.
  `market-expectations-policy-1.0.0` rechaza citas fuera de su bloque, cifras
  del resumen que no están en él, drivers repetidos o faltantes y escalas
  ajenas.
- `expectations-plausibility-1.0.0`: el código lleva lo exigido a la misma
  escala y dice `within`, `above` o `far_above`, o lo nombra
  (`unreachable`, `not_addressed`, `no_requirement`).
- Migración `0033`: `market_expectations_readings` y
  `market_expectations_evidence`, con rollback que se niega si hay lecturas.
  `pnpm valuation:market-expectations` es manual
  ([runbook](../runbooks/market-expectations.md)); la página lee la última
  aceptada del ejercicio base de la corrida y nunca llama al modelo.
- Controles: `TM-09` (evidencia cercada como no confiable, policy
  determinista), `TM-10` (tope por tarea y por día, reserva del peor caso),
  `TM-12` (el texto del modelo se escapa), `TM-15` (sólo viaja lo de
  `sec-edgar`; un test prueba que los datos no traen precio, WACC ni
  Damodaran), `TM-16` (toda pregunta guardada con sus secciones y hashes).

Evidencia:

- Unit nuevos: 10 de la policy y el prompt, 4 de la plausibilidad, 5 del
  corte, 4 del servicio y 1 del lector. El contrato del repositorio corre en
  memoria y en PostgreSQL. Lint, tipos, formato y build.
- Base personal, 2026-10-21. La primera corrida costó USD 0,066: AAPL
  rechazada en los cuatro escalones por la regla de cifras sobre la cita, y
  AMZN abstenida con un MD&A que no llegaba a las ventas. Corregidas las dos
  cosas, la segunda costó USD 0,043:
  - AAPL: moderado, estable y amplia, en el escalón 2;
  - AMZN: alto, se expande y amplia, en el escalón 3.
- Contra lo exigido: AAPL pide un escalón más de crecimiento y dos de margen;
  AMZN, un escalón más de crecimiento y un margen dentro.
- Build servido: axe sin hallazgos nuevos y sin desborde.

#### `F6-10` — supuestos derivados `2.0.0` (cerrado el 2026-10-21)

Estado del slice: `done`. No cierra el gate de la Fase 6. `F6-11` quedó
`ready`.

- [ADR 0049](../architecture/adr/0049-derived-assumptions-v2.md): ROIC
  terminal `terminal-return-on-capital-1.0.0` = mínimo entre el ROC de la
  industria (`damodaran.eva-us`) y el ROIC ajustado propio, con piso en el
  WACC terminal; crecimiento inicial por tendencia log-lineal; bear y bull
  medidos (crecimiento más bajo y más alto entre tendencia y ventanas, ROIC
  terminal en el WACC o en el propio).
- El snapshot congela la fila de la industria como un parámetro del costo de
  capital, y `assumptions_derived_recomputed` reconstruye también los
  escenarios. Un escenario materializado ya no lleva la derivación de la base.
  `1.0.0` se sigue leyendo: sin migración, motor y metodología iguales.
- `damodaran-html-1.1.0`: un error de Excel es `null` como `NA`, y el tipo de
  celda `verified` exige el encabezado sin leer la celda. Allowlist y registro
  abren `EVA.html` y nada más.
- La página explica la regla `2.0.0`: tendencia y ventanas, base del ROIC
  terminal con la fila de Damodaran, y de dónde salen bear y bull.
- Controles: `TM-05` (sin referencia, el piso con su motivo), `TM-06` (la
  release de EVA se lee al corte del job), `TM-16` (cinco corridas `1.0.0`
  reproducidas; las nuevas recalculadas por su check).

Evidencia:

- 2.946 unit (ocho de la regla `2.0.0`, dos del armado, tres del parser) y la
  suite de integración. Lint, tipos, formato y build.
- Base personal, 2026-10-21: `damodaran.eva-us` registrado (96 filas, 0
  rechazos, un request). AAPL 143,82 → 180,69 USD (bear 102,19, bull 207,73;
  ROIC terminal 44,76 % de la industria); AMZN 143,40 USD (bear 108,25, bull
  151,56). Sin checks fallados. AAPL contra el precio pasa de 2,32× a 1,84×; el
  precio exige 17,98 % de crecimiento o 62,60 % de margen. Axe sin hallazgos
  nuevos, sin desborde.

#### `F6-09` — precio de mercado y lo que exige (cerrado el 2026-10-21)

Estado del slice: `done`. No cierra el gate de la Fase 6. `F6-10` quedó
`ready`.

- [ADR 0048](../architecture/adr/0048-market-price-implied-expectations.md):
  `market-price-comparison-1.0.0` lee el cierre crudo del día del `as_of` de la
  corrida, misma moneda, y se niega con nombre si no hay cierre ese día o si
  hubo un split entre la base de acciones y el cierre. Un cierre posterior se
  muestra aparte, sin comparar.
- `market-implied-1.0.0`: DCF inverso con `computeFcff`, un driver por vez
  —crecimiento de los años 1–5 con la convergencia de la regla, margen EBIT,
  ROIC terminal y una tasa de descuento única—, bisección de 48 pasos sobre
  intervalos declarados, sin extrapolar fuera de ellos.
- Al lado de cada driver, lo que la empresa mostró: CAGR de la historia
  congelada en dos ventanas, margen y ROIC ajustados del año base, costo del
  equity. Sin fuente nueva y sin migración.
- Se calcula al leer: no entra al snapshot ni a los hashes, no pasa por los
  checks y no se registra.
- Controles: `TM-05` (cada ausencia con motivo, nunca un precio de otro día),
  `TM-06` (el precio es el del corte; uno posterior no se compara), `TM-15`
  (atribución de Yahoo desde el registro y su `owner_accepted` dicho en la
  página), `UI-03` (marcas de dato de referencia y derivado por regla).

Evidencia:

- 15 unit nuevos de la regla (comparación, ausencias, split, ida y vuelta al
  valor propio, precio fuera de rango, determinismo, contexto) y uno del
  lector. Suite completa, tipos, lint, formato y build.
- Base personal, AAPL al 2026-09-30 (333,02 USD contra 143,82 USD, 2,32×): el
  precio exige 25,49 % de crecimiento cinco años (corrida 8,68 %, últimos tres
  años 1,81 %), o 77,83 % de margen (34,25 %), o descontar a 5,74 % (costo del
  equity 10,04 %); el ROIC terminal solo no alcanza (213,63 USD con 500 %).
  ~100 ms por render. Build servido: axe sin hallazgos nuevos en escritorio
  claro y móvil oscuro (`region` de la sidebar ya estaba), sin desborde.

#### `F6-08` — precio CEDEAR y valor en pesos (cerrado el 2026-10-24)

Estado: `done`. [ADR 0056](../architecture/adr/0056-cedear-peso-value.md).
Controles: `TM-05`, `TM-06`, `TM-08`, `TM-10`; sin frontera web nueva.

- Registro `cedear-registry-1.1.0`: listing `XBUE` en ARS y símbolo versionado
  sobre la security depositaria. Caja conserva su columna BYMA; Comafi usa sólo
  la identificación local de su planilla, reconciliada por ISIN y código contra
  el JSON. No cambia la autoridad de ratios ni se guarda payload.
- El sondeo detectó la columna final «Prospecto» en Caja: el parser acepta esa
  extensión exacta y sigue negando encabezados corridos o desconocidos.
- Los workflows por ticker declaran alcance de mercados estadounidenses. El
  grafo entero conserva la ambigüedad acción/CEDEAR cuando no se declara venue;
  registrar símbolos locales no rompe la valuación ni sus comandos.
- Yahoo es la misma fuente personal `owner_accepted`, con su lease, contador y
  kill switch. `yahoo-chart-1.2.0` lee el mercado; el importador comprueba símbolo,
  ARS y `BUE` antes de publicar sobre la security CEDEAR. La regla de cierre local
  conserva la guarda intradía y admite el tick anterior a la campana sólo desde
  el día local siguiente y tras el asentamiento. No cambia la regla del índice.
- «Volver a valuar» pide los cierres locales faltantes como jobs durables incluso
  cuando la acción ya está al día; una falla local no bloquea su valuación. El
  render sólo lee. `prices:ingest --cedear <subyacente>` permite inspección o
  ingesta explícita, en seco salvo `--apply`.
- `cedear-peso-value-1.0.0`: cierres crudos del mismo `as_of`, ratio conocido al
  corte y bases compatibles. Sin símbolo, ratio, valor, cierre, moneda correcta
  o ante un split/ratio posterior, se nombra el motivo sin cero ni rueda vecina.
  La sección distingue precio y valor, USD y ARS, con fecha, fuente, fórmula y
  límite de cierres no simultáneos. No añade feed CCL ni altera snapshots/hashes.

Evidencia:

- Réplica privada: 153 listings de Comafi y 8 de Caja; un programa Comafi sin
  símbolo corroborado. Repetición del registro: cero escrituras en ambos
  emisores. AAPL y AMZN publican 1.231 cierres ARS cada uno.
- Al 23/10, AAPL: 28.660 ARS, CCL 1.648,405372 ARS/USD y valor 14.892,87 ARS;
  AMZN: 2.850 ARS, CCL 1.654,838710 y valor 1.648,00 ARS. Dos jobs completos
  sin IA; seis corridas AAPL (anteriores y nueva) reproducidas sin divergencia.
  No se publicaron datos ni corridas en la base personal; los sondeos sólo
  registraron el consumo de las fuentes.
- 3.126 unit, 221 integration, lint, tipos, formato, build y 204 E2E con axe
  (2 omitidos). Fixtures sintéticas; sin red en unit/contratos. Integración
  prueba listing, supersesión, conocimiento anterior e idempotencia.
- Revisión renderizada: escritorio 1440 claro y móvil 390 oscuro, 0 px de
  overflow, sin errores del navegador ni IDs duplicados, axe sin serious/critical
  (el `region` moderado del shell en desktop es previo). Detector Impeccable `[]`;
  revisión de cierre y brief de superficie actualizados. Capturas privadas.

Sigue `F6-06`: despliegue remoto y walkthrough; no se inició. El gate de Fase 6
sigue abierto por ese requisito. [Runbook](../runbooks/cedear-peso-value.md).

#### `F6-04` — acceso CEDEAR en el resultado (cerrado el 2026-10-21)

Estado del slice: `done`. Partido por decisión del owner del mismo día: el
precio del CEDEAR necesita el símbolo de BYMA —Caja de Valores lo publica y el
parser lo descarta— y una fuente de precios en pesos que no existe, así que
pasa a `F6-08` con su ADR. El valor en pesos también: el owner lo quiere, y el
proyecto prohíbe MEP/CCL sin feed contractual, así que sale del CCL implícito
del propio CEDEAR en ese slice. `F6-05` queda `ready`.

- `/valuacion/[ticker]` agrega «Acceso por CEDEAR»: depositario, estado,
  inversores, ISIN, código de Caja de Valores, ratio exacto y desde cuándo se lo
  conoce, leídos del registro de `F7-03` con `resolveCedearAccess` **al corte
  de la corrida** (`cedear-access-1.0.0`). Nada entra al snapshot: los hashes
  no cambian.
- `cedear-equivalent-1.0.0`: valor por acción × acciones subyacentes ÷ CEDEAR,
  exacto, en la moneda de la corrida. Sin valor por acción o sin ratio, se
  nombra el motivo; un valor negativo conserva su signo.
- Sin programa: «ningún emisor lista uno» o «ninguno vigente al corte», que no
  es lo mismo que «sin CEDEAR».
- Controles: `TM-05` (ausencias con motivo, nunca cero), `TM-06` (un ratio
  posterior al corte no convierte una corrida anterior; probado sobre el 10:1 →
  20:1 de la fixture). La lectura no lleva IDs internos.

Evidencia:

- 2.918 unit (8 de la regla, 5 del acceso al corte) y 211 integration.
  Formato, lint, tipos y build; 204 E2E con axe (2 omitidos). Detector de
  Impeccable sin hallazgos.
- Base personal, build servido: AAPL 20 CEDEAR = 1 acción (Banco Comafi),
  7,19 USD por CEDEAR; AMZN 144 = 1, 0,79 USD. Axe en escritorio claro y móvil
  oscuro sin hallazgos nuevos, sin desborde ni UUIDs. El primer pase tenía el
  programa pegado al borde del encabezado; corregido.

#### `F6-03` — resultado sobre empresa real (cerrado el 2026-10-21)

Estado del slice: `done`. No cierra el gate de la Fase 6: falta que una empresa
sin fundamentals los baje (`F6-05`) y el despliegue remoto (`F6-06`). `F6-04`
(acceso CEDEAR en el resultado) queda `ready`.

- `/valuacion/[ticker]`: la última corrida que un job del ticker registró, leída
  al render por `readValuationResult` (sin migración). Si un pedido más nuevo
  terminó sin corrida, un aviso lo dice con su hueco. La identidad (nombre,
  listing, símbolo, CIK) se lee **al corte de la corrida**, con versiones
  cerradas. Estados con nombre: `not_requested`, `no_run`, `unsupported_run`.
- Decisiones del owner del 2026-10-21: sólo la última corrida, sin precio de
  mercado ni upside, y una corrida en revisión muestra el valor con el aviso
  arriba.
- La página reutiliza la cadena de evidencia de la referencia, movida a
  `src/app/valuacion/_components/run/` (con `RunChecks` extraído), y agrega:
  rigor y método con las nueve comprobaciones; leyenda del origen de cada dato;
  decisiones cualitativas con su base (SIC, owner o IA con modelo, versiones,
  accession, digest y la cita del 10-K); costo de capital con los nueve
  parámetros por release y lo derivado; la regla `derived-assumptions-1.0.0` con
  la historia de ventas que congeló, y el libro de ajustes de la normalización.
- Marcas nuevas (`UI-03`): `Derivado por regla`, `Propuesta de IA` y
  `Declaración del owner` en el ámbar del supuesto; `Dato de referencia`
  neutral. Siempre icono y etiqueta. El formulario de `/valuacion` enlaza al
  resultado cuando registró una corrida, y el copy de huecos se comparte.
- Controles: `TM-12` (segmento validado antes de leer, inválido es 404 sin
  eco; `aapl` redirige a `AAPL`; texto del modelo escapado), `TM-15` (atribución
  de Damodaran desde el registro declarado), `TM-02` (fallo de lectura sin
  detalle, sin UUIDs en el HTML), `UI-02` (reflow a 390 px sin desborde) y
  `UI-03`.

Evidencia:

- 2.905 unit (5 nuevos del lector: sin pedido, sin corrida, pedido más nuevo
  fallido, identidad al corte que no deja pasar una versión posterior) y 211
  integration. Formato, lint, tipos y build; `/valuacion/[ticker]` construye
  como `◐`. 204 E2E con axe (2 omitidos): la ruta nueva entra en las
  recorridas de axe, centinelas y capturas de los dos runtimes, y su spec
  prueba la negativa sin base, la URL canónica y el 404 sin eco.
- Base personal, 2026-10-21: transcripciones de opciones aceptadas para AAPL y
  AMZN (USD 0,002, ninguna con opciones) y dos corridas `computed`. AAPL
  143,82 USD por acción, rigor estándar degradado por el mix geográfico.
  Build servido: axe sin hallazgos nuevos en escritorio claro y móvil oscuro
  (`region` en la sidebar ya estaba), sin desborde horizontal, sin UUIDs, 0,6–1,3
  s por render. El primer pase encontró una tabla de completitud desplazable
  por un píxel sin foco; corregido. Detector de Impeccable sin hallazgos.

### Fase 7 — matrices sectoriales de riesgo

Sin screener general ([ADR 0016](../architecture/adr/0016-analysis-scope-sector-matrices.md)).
Se ejecuta después de la Fase 2 y antes de la Fase 3.
La especificación de la matriz y sus parámetros abiertos están en
[`03_DATA_AND_PROVENANCE.md`](../finance-portal-masterplan/03_DATA_AND_PROVENANCE.md).

| Issue   | Resultado y aceptación mínima                                                                                                                                                                                         | Depende de | Controles                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| `F7-01` | Precios diarios por security desde una fuente aprobada por ADR (derechos, cuota, retención), en una tabla liviana medida antes de ingerir; splits y dividendos con `available_at`; job fuera del request.             | Fase 2     | `TM-05`, `TM-08`, `TM-10`, `TM-11` |
| `F7-02` | Sector como clasificación versionada (taxonomía, versión, vigencia) y población del sector resuelta al `as_of`.                                                                                                       | Fase 2     | `TM-05`, `TM-06`                   |
| `F7-03` | Registro CEDEAR real: programas y ratios versionados desde la fuente aprobada por el owner, con la security subyacente resuelta y sin fusionar instrumentos.                                                          | `F7-02`    | `TM-05`, `TM-06`, `TM-08`          |
| `F7-04` | Catálogo de métricas acotado a las matrices y la valuación; `sortino` puro y versionado, con parámetros decididos por el owner y tests de nulos, sin downside, historia insuficiente, huecos, negativos y no finitos. | `F7-03`    | `TM-05`, `TM-16`                   |
| `F7-05` | Matriz de riesgo por sector: Sortino 2Y vs 5Y, referencia S&P 500 en la misma base, recta de ajuste nombrada, CEDEAR vigente sin depender sólo del color, tabla equivalente, nulos con motivo y consulta acotada.     | `F7-04`    | `TM-06`, `TM-07`, `TM-12`, `UI-02` |
| `F7-08` | Precios al abrir la matriz: siempre a hoy, sólo lo atrasado, job durable con progreso visible, primera Server Action con sus controles cerrados.                                                                      | `F7-05`    | `TM-03`, `TM-10`, `TM-11`, `UI-02` |
| `F7-06` | Export personal con definiciones, parámetros, fecha, source y atribución.                                                                                                                                             | `F7-05`    | `TM-02`, `TM-16`                   |
| `F7-07` | Degradación, reconciliación y quality score explicable.                                                                                                                                                               | `F7-05`    | `TM-05`, `TM-16`                   |

**Reordenamiento del 2026-09-21: la fase arranca por `F7-02`.** `F7-01` iba primero
y quedó **bloqueado por una decisión de derechos**, no por dificultad técnica. Al
revisar los términos de las candidatas de precios antes de escribir su ADR —que es
el orden que el proyecto se impuso— apareció que el panorama gratuito no concede lo
que `F7-01` necesita:

- **Tiingo**, que era la mejor candidata por contrato y por payload (OHLC sin
  ajustar con `divCash` y `splitFactor` fechados en una sola request), **prohíbe en
  su plan gratuito persistir el dato en una base**. Los ToU §1.6(a), actualizados
  el 2026-08-05, nombran «databases» entre los sistemas alcanzados. Es la misma
  razón por la que Alpaca está en `blocked_rights`: **la persistencia es la
  condición de adopción**, y una tabla de precios es literalmente lo que la
  cláusula prohíbe. El plan pago (USD 30/mes) sí la permite;
- **Yahoo** funciona —una request sin credencial devuelve 1.254 cierres diarios y
  20 dividendos fechados— pero no hay concesión contractual de ninguna clase;
- el resto del panorama gratuito tiene la misma forma: o prohíbe persistir, o no
  concede nada.

El hallazgo quedó en la [matriz de uso](../data/provider-use-matrix.md) para que
`F7-01` no lo vuelva a averiguar. **El owner decidió el 2026-09-22**: Yahoo, con
la ADR 0026 declarando que no hay concesión contractual en vez de disfrazarla.

`F7-02` **no depende de `F7-01`**: la flecha del cuadro era orden, no dependencia de
datos. Una clasificación no necesita precios, su insumo ya está descargado y sus
derechos ya están aprobados. Y es lo que la Fase 3 espera de la Fase 7 —`F3-01`
depende de la clasificación versionada, no de las matrices—, así que arrancar por
acá desbloquea el camino en vez de esperar.

#### `F7-02` — el sector como clasificación declarada y versionada

- Estado: `done` (iniciado y cerrado el 2026-09-21).
- Fase y dependencia: Fase 7; Fase 2 cerrada. No depende de `F7-01`.
- Decisión: [ADR 0025](../architecture/adr/0025-declared-sector-classification.md).
- Problema: la matriz sectorial necesita una población —«las securities de los
  miembros del sector al `as_of`»— y hoy el sector es el único insumo que el
  proyecto **lee y tira**. El parser del paquete PDDL levanta la columna
  `GICS Sector` y no la persiste, con la reserva escrita en el propio archivo:
  «mezclar una taxonomía sin registrar cuál es y en qué versión es lo que el modelo
  de identidad prohíbe». Levantar esa reserva es responder lo que pedía.
- Alcance: una clasificación es una **aserción fechada de una fuente sobre un
  sujeto**, con taxonomía, versión y vigencia, en una tabla agnóstica de taxonomía
  —no una columna de `legal_entity`—. La primera taxonomía registrada es
  `sp500-wikipedia-gics-sector`, llamada por lo que es y no `gics`. Su versión es
  el commit pineado del paquete y su `available_at` el `committedAt` de ese
  commit, así que la clasificación es reproducible y fechada sin pedir una request
  más.
- Controles: `TM-05` (la aserción declara fuente, versión y vigencia) y `TM-06`
  (un `as_known` anterior a un pin no ve la clasificación de ese pin).
- No autoriza: precios, superficie de UI, matriz, arquetipo de valuación
  (`F3-01`), mapeo a Damodaran (`F3-05`) ni el SIC como segunda taxonomía.

Criterios de aceptación:

- una tabla de clasificaciones agnóstica de taxonomía, con su migración y el
  rollback pareado, que guarda sujeto, taxonomía, versión, código, etiqueta,
  vigencia y procedencia, y que **no** puede representar dos aserciones vigentes
  del mismo sujeto en la misma taxonomía;
- la constitución del universo persiste el sector del paquete con el pin como
  versión y el `committedAt` como `available_at`, y la reserva de
  `parse-sp500-constituents.ts` queda levantada citando la ADR;
- un pin nuevo **supersede** las aserciones del anterior en vez de cerrarlas en una
  fecha que la fuente no publica; reconstituir con el mismo pin no escribe nada;
- la población de un sector se resuelve al `as_of` componiendo dos vigencias
  —membresía y clasificación— y un sujeto sin aserción vigente devuelve `null` con
  motivo, nunca un sector por defecto ni un cajón «Otros»;
- un `as_known` anterior al `committedAt` de un pin no ve la clasificación de ese
  pin;
- tests de dominio para cada rechazo nombrado, e integration test contra
  PostgreSQL para la supersesión y para la lectura al `as_of`;
- los cinco límites de la ADR quedan escritos donde se leen, no sólo en la ADR.

Entregado (2026-09-21). Decisiones en la
[ADR 0025](../architecture/adr/0025-declared-sector-classification.md).

**La tabla no es de sectores, es de clasificaciones.** `classification_assignments`
guarda sujeto, taxonomía, versión, código, etiqueta, vigencia y procedencia, y es
agnóstica de taxonomía porque van a convivir tres respuestas distintas a «qué tipo
de empresa es ésta» que no son la misma pregunta: el sector de las matrices, el
arquetipo de `F3-01` y la industria de `F3-05`. Un REIT es `Real Estate` para la
primera, `REIT` para la segunda y otra cosa para la tercera; una columna en
`legal_entity` obligaría a elegir cuál pierde. Sumar el SIC o el arquetipo es
insertar filas, no migrar el schema, y un test lo prueba conviviendo con una
`valuation-archetype` sobre el mismo sujeto.

**La taxonomía se llama por lo que es.** `sp500-wikipedia-gics-sector`, no `gics`.
Lo que el paquete PDDL publica es una columna derivada de Wikipedia que reproduce
una taxonomía propietaria de S&P y MSCI; nadie verificó contra S&P que coincida, y
el registro ya dice de ese paquete que «no prueba membresía oficial». Llamarla
`gics` afirmaría una procedencia que el proyecto no puede defender.

**La versión y la vigencia salen del pin, no de la corrida.** El `available_at` de
cada aserción es el `committedAt` del commit pineado, así que un `as_known`
anterior al commit no ve la clasificación (`TM-06`). Un pin nuevo **supersede** en
vez de cerrar en el pasado, por la razón de la ADR 0013: la fuente no publica
desde cuándo cambió el sector de una empresa, y fechar el cambio con la corrida
sería inventar evidencia.

Tres decisiones que aparecieron al construir y que hoy son reglas con test:

- **la versión queda afuera del contenido de la aserción.** Si entrara, cada
  cambio de pin reescribiría las quinientas filas aunque ningún sector hubiera
  cambiado, y el historial dejaría de distinguir «cambió de sector» de «hubo un
  rebalanceo». Lo que la fila guarda es el pin que afirmó **por primera vez** el
  valor vigente, no el último que lo confirmó;
- **dejar de listar a una empresa no cierra su clasificación.** Es la diferencia
  con la membresía y no es una omisión: la lista es autoritativa sobre quién está
  en el índice, así que dejar de listar **es** la evidencia de una salida; pero no
  es autoritativa sobre de qué sector es una empresa. Cerrarla ahí afirmaría algo
  que la fuente no dijo —una tabla parcial no prueba una ausencia, ADR 0014—;
- **dos clases del mismo emisor son una sola aserción.** El sujeto es la entidad
  legal, así que `GOOG` y `GOOGL` colapsan; si declararan sectores distintos el
  emisor no se clasifica y el conflicto se nombra, porque elegir una de las dos
  sería inventar el desempate.

**Medido sobre el PostgreSQL personal**, con `pg_dump` previo y la migración `0017`
aplicada: la constitución con el pin vigente escribe **0 filas de identidad**
—reconstituir el mismo estado no abre ni cierra nada— y abre **500 aserciones de
sector**, con **0 rechazos**, 0 conflictos y 0 símbolos sin entidad legal. Las 503
filas del paquete dan 500 sujetos porque tres emisores tienen dos clases en el
índice —Alphabet, Fox y News Corp, los tres `Communication Services`—. Los once
sectores quedan representados: Industrials 83, Financials 76, Information
Technology 73, Health Care 59, Consumer Discretionary 47, Consumer Staples 34,
Utilities 31, Real Estate 30, Materials 25, Communication Services 21 y Energy 21.
Todas las filas comparten `available_at` `2026-09-05T01:39:10Z`, que es el
`committedAt` del pin y no el instante de la corrida. La segunda corrida escribe
**0 y reconoce 500 sin cambio**, que es la prueba de idempotencia. La tabla pesa
**376 kB** con sus tres índices (344 bytes por fila) y la base sigue en 26 MB.

El rollback de `0017` se probó en la base de test en sus tres estados: se **niega**
con filas —nombrando cuántas—, **borra** la tabla vacía y la migración **vuelve a
aplicarse**. Se niega a propósito: la clasificación no se reconstruye desde ninguna
otra tabla —el sector no es columna de nadie— y reconstituir recuperaría sólo lo
que dice el pin actual, perdiendo cada aserción superseded y con ella la respuesta
a «de qué sector era esta empresa según lo que se sabía entonces».

format, lint, typecheck, **1.411 unit** (73 nuevos), **141 integration** (6 nuevos)
y build con las cuatro rutas en `ƒ (Dynamic)` pasan.

La Fase 3 ya tiene lo que esperaba de la Fase 7: una clasificación versionada
sobre la que `F3-01` puede escribir su propio arquetipo.

#### `F7-01` — precios diarios crudos, con su base de ajuste declarada

- Estado: `done` (iniciado y cerrado el 2026-09-22).
- Fase y dependencia: Fase 7; Fase 2 cerrada.
- Decisión: [ADR 0026](../architecture/adr/0026-daily-prices-source.md).
- Controles: `TM-05`, `TM-08` (la fuente entra por la única puerta, con un solo
  host y un solo prefijo de path), `TM-10` y `TM-11` (tope diario y job fuera del
  request).

**La fuente.** Al revisar términos apareció que el panorama gratuito no concede lo
que una tabla de precios necesita: Tiingo lo prohíbe en su plan gratuito
(§1.6(a)) y Alpaca sigue en `blocked_rights` por lo mismo. El owner eligió
**Yahoo** el 2026-09-22, con un razonamiento que queda registrado: aceptar un
contrato para después incumplir una cláusula concreta expone más que no tener
contrato —hay cuenta, identidad y una key que cortan sin aviso, y el
incumplimiento quedaría escrito en un repositorio público—.

**El vocabulario de derechos.** Es la decisión que casi se resuelve mal. El gate
exige `allowed`, y marcar así a Yahoo habría corrompido el valor del que depende
todo el gate: `allowed` significa «una fuente primaria cubre este uso», que es lo
que hace que el de `sec-edgar` signifique algo. Los derechos ganaron
**`owner_accepted`** —«nadie lo concede; el owner decidió proceder igual», fechado
y con motivo—. Habilita una corrida y **nunca** una superficie pública, donde
`publicDisplay` sigue exigiendo `allowed`: el schema se niega incluso a construir
una fuente `approved_public_demo` que lo tenga en `owner_accepted`.

**El hallazgo que definió el slice.** La serie de la fuente **no es
point-in-time**: viene ajustada por los splits posteriores y se reescribe hacia
atrás en cada uno. Medido sobre NVDA, el cierre del 2024-06-05 se devuelve hoy
como 122,44 cuando ese día se operó a **1.224,40**. Guardar eso metería en la base
exactamente el look-ahead que el contrato point-in-time existe para impedir, y
además la fila cambiaría sola con el próximo split, perdiendo la idempotencia.
**681 de las 1.254 ruedas de NVDA están reexpresadas**: esa es la medida de cuánto
look-ahead se habría guardado ingiriendo la serie tal cual.

La salida es que la misma respuesta trae los splits fechados, así que el
des-ajuste es determinista —`raw(t) = close(t) × Π ratio(s)` para los `s`
posteriores a `t`— y verificado al centavo. Guardando crudo la fila es inmutable,
la re-descarga es idempotente y el ajuste vuelve a ser política de lectura, como
en la [ADR 0012](../architecture/adr/0012-stock-splits-share-basis.md). Los
dividendos se guardan fechados y **sin aplicar**: la base de retorno es un
parámetro abierto de `F7-04`.

**Dos decisiones más.** La fila guarda un cierre y no un OHLCV —lo que las
matrices y las divergencias piden es cierre contra cierre, y la ADR 0016 eliminó
el screener que justificaría el volumen—, y no guarda fuente ni parser, que los
trae su corrida, ni el factor de des-ajuste, que se reconstruye con los eventos.
Y el parser **normaliza el ruido de la fuente**: transmite float32 ensanchado a
double —22,482 viaja como `22.48200035095215`— y leerlo como exacto guardaría ese
ruido en la tabla más grande del proyecto, multiplicado por cada des-ajuste.

Criterios, contra lo que se entregó:

- **fuente aprobada por ADR con derechos, cuota y retención declarados.**
  Cumplido, con el vocabulario nuevo: `owner_accepted` dice la verdad en vez de
  disfrazarla. Allowlist de un host y un prefijo, tope diario de 700 y ritmo de
  1 request/s;
- **tabla liviana medida antes de ingerir.** Medido sobre tres securities:
  **158 bytes por fila** (77 de heap, el resto del índice natural). Un sector de
  ~70 securities son ~14 MB; el índice entero daría ~100 MB, **por encima** de la
  estimación de 60–80 MB de la ADR 0016. El producto sólo necesita por sector;
- **splits y dividendos con su fecha.** Cumplido, en `price_events`, sin aplicar;
- **job fuera del request.** Comando a mano con dry run por defecto.

**Medido sobre el PostgreSQL personal** (AAPL, NVDA, JPM): 3 requests, 1.254
ruedas por security y **3.762 filas** publicadas, rango 2021-09-23 → 2026-09-22,
0 ruedas sin cierre y 61 eventos. NVDA queda guardada en 1.224,40 el 2024-06-05 y
121,79 el 2024-06-10, con su 10:1 como evento aparte. La segunda corrida de NVDA
publica **0 y reconoce 1.254 duplicadas**, con la corrida registrada `duplicate`:
la prueba de idempotencia, que sólo vale porque lo guardado es crudo. La base pasa
de 26 a 27 MB.

Dos cosas que encontró el camino y que hoy son regla:

- **el gate se negó antes de tocar la red** en el primer intento, porque la fuente
  estaba en `technical_reviewed`. Es el fail-closed funcionando: la red no se toca
  hasta que el registro dice que sí;
- **el rollback de `0018` no podía correr, y sólo se supo probándolo.** Rehacer un
  enum exige soltar antes las ocho columnas que lo tienen por default y el check
  de demo pública, y reponerlos idénticos en la misma transacción.

format, lint, typecheck, **1.446 unit** (31 nuevos), **149 integration** (8
nuevos) y build con las cuatro rutas en `ƒ (Dynamic)` pasan. Los rollbacks de
`0018` y `0019` se probaron en sus tres estados: se niegan con datos, borran
vacíos y las migraciones vuelven a aplicarse.

Quedaba `F7-03` (registro CEDEAR), entregado el 2026-09-23, y detrás `F7-04` a
`F7-07`.

#### `F7-03` — el registro CEDEAR de los dos emisores

- Estado: `done` (iniciado y cerrado el 2026-09-23).
- Fase y dependencia: Fase 7; `F7-02` cerrado.
- Decisión: [ADR 0027](../architecture/adr/0027-cedear-registry-sources.md).
- Controles: `TM-05` (cada aserción declara fuente, corrida y vigencia; lo que no
  se entiende se rechaza por nombre), `TM-06` (el CEDEAR y su subyacente son dos
  securities, y un `as_known` anterior a un cambio de ratio no lo ve) y `TM-08`
  (cada emisor entra por la única puerta con un host y un prefijo de path).

**La fuente, y por qué no fue la aprobada.** El owner había aprobado el
2026-08-25 «el scraping de Comafi». Al medirlo aparecieron tres cosas:

- **hay dos emisores**, Banco Comafi y Caja de Valores, sin subyacentes en común.
  Caja de Valores es el único emisor de F, UAL, MU, OXY, UBER, PANW, MOS y ABNB,
  y un registro sólo de Comafi habría dicho de esas ocho que no tienen CEDEAR;
- **los términos de Comafi prohíben almacenar**, por escrito: «Prohibida la
  duplicación, distribución o almacenamiento en cualquier medio». No es el «no se
  concede» de Yahoo;
- **las dos publicaciones de Comafi no coinciden**: la planilla trae `3.1` y
  `25.1` como ratios, el ISIN panameño de Carnival después de su redomicilio y
  AstraZeneca en 2:1 donde el JSON dice 4:1.

El owner decidió el 2026-09-23 usar **las dos fuentes** en `owner_accepted`, con
la cláusula de Comafi citada en su fila del registro en vez de resumida. La
publicación de registro de Comafi es el JSON que alimenta su tabla, que fue el
correcto en cada desacuerdo verificable; sus errores —campos vacíos, dos tickers
que se contradicen en la misma fila— son de los que un parser rechaza por nombre.

**El CEDEAR no se fusiona con su subyacente.** Cada depositario es una entidad
legal declarada, cada CEDEAR una security `depositary_receipt` emitida por él con
su ISIN y su código de Caja de Valores, y el programa las vincula. El ratio se
versiona **aparte** del programa, para que un cambio de ratio no borre la
existencia del programa en un corte anterior.

**El ticker identifica y el mercado corrobora.** Es la regla que salió de medir:
el mercado declarado está viejo o mal cargado más seguido que el ticker —KMB
figura en NYSE y ya cotiza en Nasdaq; LIN, PLD y SHW traen la industria en el
campo de mercado—, así que un mercado distinto se marca y no decide. Un mercado
extranjero deja el programa afuera aunque su ticker coincida con uno del grafo, y
dos tickers de la misma fila que resuelven a securities distintas se rechazan:
Talen Energy declara el de GE Vernova.

**La vigencia es la observación.** Ninguna publicación fecha lo que publica, así
que `available_at` y `valid_from` son el instante de la lectura, y un corte
anterior a la primera captura responde `not_effective_at_cutoff`, nunca «sin
CEDEAR». Los cambios supersiden en vez de cerrar —la fecha efectiva está en el
aviso del emisor, que el registro no lee—, y un programa que el emisor deja de
listar se retira sin sucesor, con un guard que niega las bajas masivas.

Criterios, contra lo que se entregó:

- **fuente aprobada por el owner.** Cumplido, con la aprobación rehecha sobre la
  evidencia nueva y las dos fuentes en `owner_accepted`;
- **programas y ratios versionados.** Cumplido: `depositary_programs`,
  `depositary_program_versions` y `depositary_ratios`, migración `0020` con su
  rollback, y la lectura al corte `resolveCedearAccess`;
- **security subyacente resuelta.** Cumplido contra el grafo en el instante de la
  observación; sólo se registra lo que resuelve, y el resto se nombra;
- **sin fusionar instrumentos.** Cumplido, con un check en PostgreSQL que impide
  un programa cuyas dos securities sean la misma.

**Medido sobre el PostgreSQL personal**, con `pg_dump` previo y la migración
`0020` aplicada: 2 requests por corrida. Comafi publica 364 filas y registra
**154 programas**, con 206 fuera del universo, 4 rechazos por nombre —el ratio
`15.1` de ASTS, BBCA sin código, una segunda fila de WDC vacía y la de Talen— y 5
marcas de calidad. Caja de Valores publica 59 y registra **8**, sin rechazos.
Los 162 programas apuntan a 162 securities distintas del índice —GOOGL tiene
programa y GOOG no—, 159 activos y 3 suspendidos. La segunda corrida queda
**`duplicate` en los dos emisores y no escribe nada**. Las tres tablas pesan
320 kB y la base pasa de 27 a 28 MB.

El rollback de `0020` se probó en una réplica en sus tres estados: se **niega**
con filas, **borra** las tablas vacías y la migración **vuelve a aplicarse**.

format, lint, typecheck, **1.519 unit** (73 nuevos), **156 integration** (7
nuevos), build con las cuatro rutas en `ƒ (Dynamic)` y el gate E2E pasan.

Antes de `F7-04` hay que decidir los parámetros del Sortino, que la
especificación deja abiertos.

<a id="f7-04"></a>

#### `F7-04` — catálogo de métricas y `sortino-1.0.0` sobre base total return

- Estado: `done` el 2026-09-30.
- Fase y dependencia: Fase 7; `F7-03` cerrado.
- Controles: `TM-05`, `TM-16`.
- Decisión: [ADR 0028](../architecture/adr/0028-sortino-parameters-total-return.md).

Parámetros decididos por el owner antes de escribir la fórmula: `mar = 0`,
retornos diarios con `k = 252`, total return con el dividendo reinvertido al
cierre del ex-date, `^SP500TR` como referencia y ventanas de calendario cuya base
es el último cierre en o antes de `as_of − n años`.

Criterios de aceptación:

- el catálogo contiene sólo métricas de las matrices, cada una con fórmula
  versionada, unidad, periodicidad, tratamiento de negativos y motivos de `null`;
  las de divergencias están `planned` y sin versión;
- `sortino-1.0.0` es puro, determinista, decimal, y no mira nada posterior al
  `as_of`;
- tests de `null` con motivo para historia insuficiente, sin retornos a la baja,
  huecos, sin cierre en el `as_of`, moneda distinta y cierre en cero; de valores
  negativos; y de no finitos, que se rechazan;
- la base de retorno se prueba con splits, dividendos, los dos el mismo día y un
  evento en un día sin rueda.

Evidencia:

- `src/modules/metrics/`:
  - `total-return.ts`, 15 tests;
  - `sortino.ts`, 20 tests: forma cerrada `√126` sobre +2 %/−1 % alternados, y un
    oráculo de punto flotante independiente;
  - `metric-catalog.ts`, 7 tests.
- `temporal/domain/calendar-date.ts`: la aritmética de calendario mudada desde la
  ventana de la SEC, para que las dos ventanas corten igual.

La base total return destapó **tres defectos de la ingesta de `F7-01`**,
corregidos en el mismo slice:

1. **Los dividendos estaban en la base de la fuente**, divididos por los splits
   posteriores: NVDA pagó 0,04 y quedó 0,004, y así 10 de los 60 dividendos.
   `price-unadjust-1.1.0` los des-ajusta con el mismo factor que los cierres.
2. **Un evento que cambiaba de valor se contaba como duplicado.** Ahora se
   reporta en `eventsConflicting` y no se pisa, en PostgreSQL y en el doble.
3. **La historia no alcanzaba para la ventana de 5 años:** con `range=5y` las
   series empezaban un día después de su inicio. La ingesta pide cinco años más
   14 días.

Medido:

- **Réplica de la base personal.** La re-descarga nombra los 10 dividendos como
  «evento cambiado» y no los pisa.
- **Base personal**, con autorización del owner y `pg_dump` previo de
  `price_events`:
  - 10 filas borradas y re-ingeridas crudas;
  - 11 ruedas nuevas por serie desde el 2021-09-16;
  - la segunda corrida queda `duplicate`, sin escrituras;
  - la base sigue en 28 MB y se usaron 7 requests a Yahoo.
- **Sortino al 2026-09-30, total return, 2 y 5 años:** AAPL 1,15 y 1,14, NVDA
  1,38 y 1,85, JPM 1,65 y 1,17. JPM a 5 años sólo precio da 1,01. Entre 5 y 28 ms
  por ventana.

format, lint, typecheck, **1.569 unit** (50 nuevos), **157 integration** (1
nuevo), build con las cuatro rutas en `ƒ (Dynamic)` y el gate E2E (131) pasan.

Queda registrado para después, en la ADR 0028:

- la tolerancia de huecos es de calendario y no de sesiones;
- `^SP500TR` no se ingiere todavía, porque no es una security del grafo;
- la ingesta no distingue una rueda abierta de un cierre: correrla con el
  mercado abierto guardaría un intradía como cierre inmutable.

Sigue `F7-05`, la matriz de riesgo por sector. Antes hay que decidir dónde vive
la serie de la referencia.

<a id="f7-05"></a>

#### `F7-05` — matriz de riesgo por sector

- Estado: `done` el 2026-09-30.
- Fase y dependencia: Fase 7; `F7-04` cerrado.
- Controles: `TM-06`, `TM-07`, `TM-12`, `UI-02`.
- Decisión: [ADR 0029](../architecture/adr/0029-reference-series-sector-risk-matrix.md).

Criterios de aceptación:

- la referencia S&P 500 se calcula con la misma fórmula, base y ventanas que las
  securities, y es un punto propio más un cruce de líneas;
- un punto por security, con etiquetas legibles aunque dos clases caigan juntas;
- la recta de ajuste se nombra como ajuste del sector y publica su `n`;
- la marca CEDEAR vigente al `as_of` no depende sólo del color;
- una tabla equivalente conserva los valores crudos, y los `null` van en un panel
  con su motivo, nunca dibujados como cero;
- la consulta está acotada y todo se lee al mismo corte.

**Incrementos 1 y 2 — datos y lectura (2026-09-30).**

- **Referencia.** `benchmark_prices`, con migración `0021` y rollback que se
  niega con filas; `sp500-total-return` declarada en código, con su ingesta, que
  rechaza eventos y otra moneda. Un índice no es una security: no tiene emisor.
- **Rueda en curso.** `settled-session-1.0.0` y `yahoo-chart-1.1.0`, contra la
  sesión que declara la respuesta y medida sobre `^SP500TR`. Cierra el límite 3
  de la ADR 0028.
- **Comando.** `--sector` y `--benchmark` en `prices:ingest`, con
  `securityTickersAt` y `loadSectorPopulation`.
- **Lectura.** `loadSectorRiskMatrix` al cierre del `as_of`, sobre el dominio
  `sector-risk-matrix-1.0.0` y `sector-fit-ols-1.0.0`.
- **Dos defectos del universo, corregidos.**
  - `loadState` sólo devolvía versiones vigentes. Gana `versions: "all"`, sin la
    cual un punto de 2024 llevaba el ticker de hoy.
  - Esa lectura truncaba en silencio al superar su techo; ahora falla.

Medido sobre la base personal:

- **Carga:** la referencia (1.265 niveles) y Communication Services (24
  securities, 4,3 MB, la base en 32 MB), con 26 requests a Yahoo.
- **Matriz al 2026-09-30, en 775 ms:**
  - referencia 1,548 a 2 años y 1,232 a 5 años;
  - GOOG y GOOGL como dos puntos, con CEDEAR sólo en GOOGL;
  - RDDT `insufficient_history` a 5 años;
  - recta con n = 23.

El rollback de `0021` se probó en una réplica en sus tres estados: se niega con
filas, borra la tabla vacía y la migración vuelve a aplicarse.

Tests: format, lint, typecheck, **1.602 unit**, **162 integration** y build pasan.

**Incremento 3 — superficie (2026-09-30).** `/sectores` y `/sectores/[sector]`,
con `impeccable` y `financial-visualization-review` cargados, brief en
`.impeccable/surfaces/` y el patrón «Risk scatter» en `DESIGN.md`.

Decisiones del owner:

- entrada por un índice con la cobertura de precios;
- todas las etiquetas visibles, sin superponerse;
- dominio robusto en los ejes.

Lo que entra:

- **Recharts 3.8.0** con el `chart` de shadcn. El CLI generó un import roto
  (`from "cn"`), corregido.
- **Puntos como botones enfocables**, con nombre accesible completo y un panel
  `aria-live`.
- **Tabla ordenable** con `aria-sort` y los números primero.
- **Panel «Sin valor».**
- **`as_of` corrido** al último cierre en o antes de la fecha pedida, con aviso.
- **Sidebar.** «Matrices» deja de ser `Plan`.
- **`DataUnavailableNotice`**, la negativa cuando la base no responde.
- **`listSecuritiesWithClosesSince`** y **`summarizeSectorCoverage`**, para el
  índice.
- **Consultas de series acotadas por fecha.**

Defectos encontrados y corregidos al revisar:

- **El cliente runtime de PostgreSQL acumulaba backoff de reconexión.** Con la
  base caída, el tercer request tardó 35 s; ahora falla en 5 ms (`backoff: 0`).
- **Las etiquetas se fusionaban con vecinos lejanos** y tapaban el rombo de la
  referencia.
- **Los ticks de los ejes eran irregulares.**

Evidencia:

- **Revisión renderizada** sobre `pnpm walkthrough` con la base personal, sin
  capturas en el repo (ADR 0006):
  - axe con 0 findings serious/critical y sin overflow horizontal en 1440 y
    390 px, claro y oscuro, en las dos rutas y con una fecha pedida en domingo;
  - 23 puntos enfocables;
  - 0 rótulos superpuestos medidos en el DOM a 1440, 1024 y 360 px.
- **Detector Impeccable** `[]`.
- **Gate E2E: 165 pasan, en 1,5 minutos.**
  - En personal, las rutas nuevas muestran «Base personal no disponible» y un
    código fuera de la taxonomía muestra la página de ruta inexistente con
    `noindex`.
  - En el runtime trabado, las dos se niegan.
- **Build:** `/sectores/[sector]` sale `◐`, con la cáscara vacía
  (`hasHtml: false`).
- format, lint, typecheck, **1.622 unit** y **164 integration** pasan.

Queda registrado:

- un choque residual de rótulos a 390 px en un corte;
- el símbolo BYMA del CEDEAR, que el grafo no tiene;
- un gate visual con datos sintéticos sembrados en PostgreSQL, que sería una
  enmienda a la ADR 0006;
- el status 200 del sector desconocido;
- la lista de herramientas de la home, anterior al pivote de la ADR 0016, que
  todavía describe «Matrices · Divergencias» como Fase 3.

Sigue `F7-06`: export personal de la matriz con definiciones, parámetros, fecha,
fuente y atribución.

#### `F7-08` — precios del sector al abrir su matriz

- Estado: `done` (iniciado y cerrado el 2026-10-01).
- Fase y dependencia: Fase 7; `F7-05` cerrado. Entra antes de `F7-06` porque el
  owner, al probar la superficie, encontró que un sector sin precios no servía
  para nada sin ir a la terminal.
- Controles: `TM-03`, `TM-10`, `TM-11`, `UI-02`.
- Decisión: [ADR 0030](../architecture/adr/0030-sector-prices-on-open.md).
- Decisiones del owner: el análisis es **siempre a hoy** —sale el selector de
  fecha—; abrir el sector **es** pedir lo que falte, sin un botón aparte; usar lo
  guardado, pedir lo mínimo y que sea sólido.
- No autoriza: refresh programado, descarga de fundamentals desde la web
  (`F6-05`), ni otra fuente de precios.

Criterios de aceptación:

- la matriz se lee siempre a hoy, y `?asOf` deja de existir;
- una regla pura y versionada decide qué falta sin calendario de feriados, y un
  sector al día no crea ningún job ni gasta ninguna request;
- la referencia se actualiza antes que las securities, y cada security se compara
  contra la última rueda de la referencia;
- la descarga es un job durable con lease por fuente, reanudable, que respeta la
  cuota diaria y el kill switch y no se planea si la fuente está frenada;
- lo que falló después de la rueda no se replanea solo: la página lo nombra y
  ofrece reintentar;
- la Server Action se prueba como endpoint público, y el render no escribe;
- la página muestra el progreso real y recalcula la matriz al terminar.

Lo que entra:

- **`sector-price-freshness-1.0.0`** (`prices/domain/price-freshness.ts`): rueda
  asentada a las 22:00 UTC, referencia al día por cierre o por revisión, security
  al día contra la última rueda de la referencia o por revisión.
- **`yahoo_prices_refresh`**, migración `0022` con rollback que se niega mientras
  exista un job de ese kind. Dos fases que nunca van juntas, plan con la versión de
  la regla y `assertPriceRefreshJob`.
- **`refreshSectorPrices`**, la primera Server Action: modo en el request, esquema
  cerrado, worker con `after()`, DTO de conteos y códigos.
- **`readSectorPriceReadiness`**, la lectura del render, que no escribe.
- **La línea de estado** sobre la matriz, con barra de progreso, espera por otra
  descarga, cuota agotada, kill switch, pausa y fallos con «Reintentar».
- **`observeSourceSignals`** mudado de fundamentals a `ingestion`, con un
  re-export para no mover a sus usuarios.
- `/sectores` deja de mandar a la terminal.

Medido sobre la base personal con el dev server:

- **Communication Services, ya al día:** ningún job, ninguna request.
- **Energy, sin precios:** 21 items, 21 requests al contador de `yahoo-finance`,
  27 s de punta a punta, 21 puntos. Al reabrirlo, ningún job.
- **Utilities, Real Estate, Materials, Consumer Staples y Health Care** se
  descargaron de la misma forma, de 25 a 59 securities cada uno. En total, seis
  jobs con 200 items, 0 fallados y **200 requests** en el contador del día: ni
  una de más.
- **Cerrar la pestaña no frena la descarga:** con el navegador cerrado a los
  4 items, el job de Utilities siguió con el lease del worker web hasta 31/31.
- **Otro sector en curso:** Health Care, abierto mientras corría Consumer
  Staples, mostró la barra del otro job y arrancó el suyo al terminar aquél.

El rollback de `0022` se probó en una réplica en sus tres estados: se niega con un
job de precios, rehace el tipo sin él y la migración vuelve a aplicarse.

Evidencia:

- **Revisión renderizada** sobre el dev server con datos reales, sin capturas en el
  repo (ADR 0006): axe con 0 findings serious/critical en 1440 oscuro y 390 claro,
  descargando y al día, y en `/sectores` a 1440 y 390.
- **Tests:** 13 casos del servicio, 8 de la regla, 8 de la frontera
  (`actions.test.ts`) y uno de integración que persiste el kind nuevo.
- format, lint, typecheck, **1.651 unit**, **165 integration**, build y el gate E2E
  pasan.

Queda registrado:

- un overflow horizontal de 10 a 16 px a 1440 visto dos veces recién abierta la
  página durante una descarga, que no se reprodujo en 31 muestras posteriores ni en
  ningún estado final; causa sin confirmar;
- `next dev` también bloquea `127.0.0.1`: la revisión local va por `localhost`;
- el worker vive en el proceso web, y en serverless (`F6-06`) un sector grande se
  retomaría en varias visitas;
- no hay `request_id` en la frontera: la explican el ID del job y su bitácora.

Corrección posterior de `F7-08` (2026-10-01): el owner abrió Communication
Services después del asentamiento del 01/10. La referencia tenía esa rueda, pero
las 24 securities sólo llegaban al 30/09. El job de 24 items había terminado
`completed` sin publicar el cierre pedido; por eso el estado decía «Precios al
día» y la matriz dibujaba 0 puntos. `sector-price-freshness-1.1.0` conserva la
protección contra reintentos automáticos, informa los símbolos sin cierre aun si
su item fue `completed` y habilita el reintento explícito. La prueba de regresión
cubre el estado de lectura, la ausencia de un nuevo job automático y el nuevo
plan a pedido. En el servidor personal, el reintento de Communication Services
usó 24 requests y publicó 24 cierres del 01/10; la matriz volvió a dibujar 23
de 24 puntos (el restante sigue sin una ventana histórica completa).
Validación: formato, lint, tipos, 1.661 unit, 165 integration, build y gate
E2E (170 pasan, 2 omitidos).

#### `F7-06` — export personal de la matriz de riesgo

- Estado: `done` (iniciado y cerrado el 2026-10-01).
- Fase y dependencia: Fase 7; `F7-05` cerrado, luego de `F7-08`.
- Controles: `TM-02`, `TM-16`. La ruta directa falla cerrada en `locked`.
- Contrato: `sector-risk-export-1.0.0`, CSV UTF-8 rectangular, una fila para
  `^SP500TR` y una por security del sector. Valores numéricos canónicos sin
  redondeo de presentación; los nulos conservan el motivo y nunca se vuelven cero.
- Metadatos en cada fila: fecha efectiva y cutoff de identidad, política
  `as_known`, versiones de clasificación, población, matriz, fórmula y base de
  retorno; definición de Sortino y de la recta; parámetros, fuente, URL,
  atribución y nota de derechos. Los CEDEAR conservan emisor y ratio sin fusionar
  security subyacente y depositaria.
- Frontera: `GET /sectores/[sector]/export` acepta sólo un sector declarado sin
  query string; lee la misma matriz que la página. Exige modo `personal` y
  derechos exportables vigentes de las cuatro fuentes, incluso las dos que
  respaldan una ausencia CEDEAR. La respuesta es privada y sin caché; rechazos y
  fallos devuelven texto genérico con `X-Request-Id`. La página mantiene la
  matriz visible, informa un fallo de descarga y ofrece reintentar.

Evidencia:

- Sobre la base personal, Energy produjo 22 registros de datos: la referencia y
  21 securities, con columnas rectangulares y un CSV descargable desde la página.
- Revisión renderizada a 1440 y 390 px: sin overflow horizontal, axe con 0
  hallazgos serious/critical, fallo 503 mostrado en línea y reintento exitoso.
  Las capturas no entran al repositorio (ADR 0006).
- Tests de serialización (derechos, exactitud, nulos, fórmula CSV), ruta
  (personal, locked, parámetros inválidos, fallo de DB) y E2E para la URL directa
  en personal sin DB y en locked. format, lint, typecheck, unit, integration,
  build y gate E2E pasan.

Sigue `F7-07`: degradación, reconciliación y quality score explicable.

#### `F7-07` — calidad explicable de la matriz

- Estado: `done` el 2026-10-01. Cierra la Fase 7.
- Fase y dependencia: Fase 7; `F7-05` cerrado.
- Controles: `TM-05`, `TM-16`.
- Contrato: `sector-risk-quality-1.0.0`; nota operativa 0–100 con pesos
  declarados: completitud 40 %, frescura 20 %, comparabilidad 20 % y validación
  interna 20 %. El acuerdo entre fuentes queda `null` porque hay una sola fuente
  de precios; el sector vacío queda sin nota.

Criterios cerrados:

- cada `null` de Sortino conserva su motivo y reduce sólo el componente al que
  corresponde; la nota no reemplaza el panel «Sin valor» ni convierte ausencias en
  cero;
- la lectura reconcilia IDs de población, cantidad del ajuste, cuadrantes y
  distancias decimales; un desacuerdo falla cerrado antes de mostrar la matriz;
- la superficie muestra nota, cinco componentes, numeradores, denominadores,
  antigüedad en días y la regla de frescura sin calendario de feriados;
- la nota declara que la reconciliación es interna y no valida de forma
  independiente los precios de Yahoo.

Evidencia:

- Tests de la regla: cobertura parcial por historia insuficiente, nota completa,
  frescura degradada, sector vacío, security perdida y distancia alterada.
- Sobre Energy en la base personal, la nota y sus componentes renderizan en
  1440 oscuro y 390 claro; ningún POST de refresh llegó al servidor durante la
  revisión. Axe: 0 hallazgos serious/critical; overflow horizontal: 0 px en los
  dos anchos. Detector Impeccable: `[]`.
- `pnpm lint`, `pnpm typecheck`, 1.660 unit, 165 integration, build y gate E2E
  (170 pasan, 2 skipped) pasan. Sin migración ni fuente nueva.

**Gate de Fase 7:** pasa. Las securities sin historia o downside mantienen su
`null` con motivo; la referencia usa la misma fórmula, base y ventanas; el CSV
personal declara la procedencia de cada columna. La calidad operativa queda
versionada y su límite de una sola fuente aparece junto al resultado.

`F3-01` está en curso: selector determinista de arquetipo.

### Fase 8 — divergencias fundamentales

| Issue   | Resultado y aceptación mínima                                                                                                                                                         | Depende de | Controles                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------- |
| `F8-01` | Pipeline fiscal-aligned point-in-time de precio, market cap, net income, EPS y acciones para los filers del sector elegido, sin cargar el universo.                                   | Fase 6     | `TM-05`, `TM-06`, `TM-16` |
| `F8-02` | Vista principal market cap vs EPS con `share_count_bias_pp` visible, y vistas agregada y por acción como alternativas, con puente de dilución y sin fabricar porcentajes en extremos. | `F8-01`    | `TM-05`, `TM-06`          |
| `F8-03` | Scatter, tabla, filtros y detalle conservan raw de outliers y equivalente accesible.                                                                                                  | `F8-02`    | `TM-07`, `TM-12`          |
| `F8-04` | Golden/property tests cubren splits, restatements, negativos, outliers, tolerancias y look-ahead.                                                                                     | `F8-03`    | `TM-05`, `TM-06`          |

### Fase 9 — Argentina, BCRA y soja

| Issue   | Resultado y aceptación mínima                                                                                    | Depende de | Controles                          |
| ------- | ---------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| `F9-01` | Catálogo/vintages BCRA v4 falla seguro ante cambios de schema y conserva release, unidad, frecuencia y revisión. | Fase 8     | `TM-05`, `TM-08`, `TM-10`, `TM-11` |
| `F9-02` | Nominal y monetario publican transformaciones auditables y fechas propias por serie.                             | `F9-01`    | `TM-05`, `TM-06`                   |
| `F9-03` | Cambiario usa fuentes oficiales con fecha propia por serie.                                                      | `F9-02`    | `TM-05`                            |
| `F9-04` | Actividad, fiscal y externo preservan revisiones, quiebres, base, estacionalidad y denominadores compatibles.    | `F9-03`    | `TM-05`, `TM-06`                   |
| `F9-05` | Rosario/Chicago identifica contrato, roll, FX y conversión antes de calcular basis.                              | `F9-04`    | `TM-05`, `TM-08`                   |
| `F9-06` | Cada bloque cierra con gráfico, tabla accesible, freshness, metodología y lectura sin causalidad inventada.      | `F9-05`    | `TM-12`, `TM-16`                   |

### Fase 10 — persistencia, asistente y hardening

| Issue    | Resultado y aceptación mínima                                                                       | Depende de | Controles                          |
| -------- | --------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| `F10-01` | Saved views, watchlists, preferencias y valuaciones persisten sin `user_id` ni multi-tenancy.       | Fase 9     | `TM-04`, `TM-07`, `TM-16`          |
| `F10-02` | Historial, export, backup, restore drill y borrado con audit trail.                                 | `F10-01`   | `TM-02`, `TM-16`                   |
| `F10-03` | Claves server-owned con health, redacción y runbook de rotación sin llegar al browser.              | `F10-02`   | `TM-02`, `TM-14`                   |
| `F10-04` | Asistente explica, compara y navega evidencia mediante tools tipadas sin URL/SQL arbitrario.        | `F10-03`   | `TM-07`, `TM-08`, `TM-09`          |
| `F10-05` | SLOs, alertas, load/cost tests, rate limits, circuit breakers y recuperación probados.              | `F10-04`   | `TM-10`, `TM-11`, `TM-16`          |
| `F10-06` | Auditoría WCAG 2.2 AA, budgets de performance y cobertura multi-motor diferida en la ADR 0006.      | `F10-05`   | `TM-12`, `UI-02`, `UI-03`, `UI-04` |
| `F10-07` | Runbooks y drills cubren rollback, key leak, parser roto, exposición, gasto y valuación incorrecta. | `F10-06`   | `TM-02`, `TM-05`, `TM-11`, `TM-14` |

## Cobertura de deuda transversal

Esta matriz evita que una amenaza o deuda visual quede mencionada sin un issue que
la cierre. La columna “primer cierre” indica el primer slice que debe implementar o
probar el control; fases posteriores pueden volver a verificarlo.

| Deuda   | Primer cierre                           | Seguimiento posterior                    | Estado actual                                                                                                                                                                                                                                                                                   |
| ------- | --------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TM-01` | `F1-02`                                 | `F1-07`, `F2-01`, `F5-02`, `F6-06`       | `done`: composición falla cerrada y el modo se resuelve en el request; el mismo build niega o sirve según su entorno                                                                                                                                                                            |
| `TM-02` | `F1-02`                                 | cada frontera, `F10-03`                  | `done`: DB server-only y URLs pooled/direct separadas probadas                                                                                                                                                                                                                                  |
| `TM-03` | `F6-01`, frontera de la corrida         | `F5-02`, `F10-04`                        | `done` para `refreshSectorPrices` (ADR 0030) y para `enqueueValuation` (ADR 0045): esquema cerrado, modo en el request, respuesta de códigos. `F1-07` probó las de composición                                                                                                                  |
| `TM-04` | `F1-02`                                 | `F1-07`, `F2-01`, `F10-01`               | `done`: cache namespaced por modo; sólo `personal` construye almacenamiento, verificado sobre el artefacto servido                                                                                                                                                                              |
| `TM-05` | `F1-03`                                 | `F2-03`, `F3-03`, cada parser/modelo     | `done` de ingesta a publicación: vacío y parser roto no publican ni reemplazan                                                                                                                                                                                                                  |
| `TM-06` | `F1-04`                                 | `F2-02`, `F4-01`, `F6-05`, cada consulta | `done` de la consulta a la valuación: dos cortes producen dos corridas distintas                                                                                                                                                                                                                |
| `TM-07` | `F1-02`                                 | `F1-07`, `F6-01`, `F7-05`                | `done`: Drizzle parametrizado y límite de consulta verificados en PostgreSQL                                                                                                                                                                                                                    |
| `TM-08` | `F2-03`, primer provider real           | `F5-04`, `F9-01`                         | required; no hay egress aún                                                                                                                                                                                                                                                                     |
| `TM-09` | `F5-03`                                 | `F5-04`, `F5-07`, `F10-04`               | `done` para `industry-resolution-1.0.0`: evidencia delimitada y no confiable, sin herramientas, respuesta cerrada y policy determinista                                                                                                                                                         |
| `TM-10` | `F2-05`                                 | `F5-01`, `F6-05`, `F10-05`               | `done` para la SEC: presupuesto por corrida con reserva del peor caso, señales de la fuente, y límite diario con kill switch (ADR 0020), los tres verificados también sobre el refresh; `done` para la capa IA (`F5-01`): gasto en dólares reservado por tarea y por día, breaker y kill switch |
| `TM-11` | `F2-05`                                 | `F6-05`, `F9-01`, `F10-05`               | `done` para el backfill y el refresh de la SEC: lease, `429`, crash y recuperación manual probados sobre los dos kinds (ADR 0015, ADR 0022); cron sigue apagado                                                                                                                                 |
| `TM-12` | `F1-01`                                 | cada UI externa, `F10-06`                | headers base y render seguro verificados                                                                                                                                                                                                                                                        |
| `TM-13` | `F10-07`                                | cada actualización de dependencia        | baseline implementada; scans pendientes                                                                                                                                                                                                                                                         |
| `TM-14` | `F2-01`, antes del primer deploy remoto | `F6-06`, `F10-03`                        | done en `F6-06`: All Deployments intercepta los hosts conocidos, Production sirve datos sólo autenticado y no quedan bypasses activos                                                                                                                                                           |
| `TM-15` | `F3-03`, nivel de rigor declarado       | cada IA/export, `F5-03`, `F6-03`         | rescopeado por ADR 0007: derechos pasan a procedencia informativa; el control ahora es el nivel de rigor declarado                                                                                                                                                                              |
| `TM-16` | `F1-03`                                 | cada operación y gate                    | `done` sobre ingesta y valuación: corridas append-only con hash, versión y error seguro                                                                                                                                                                                                         |
| `UI-01` | Fase `0B.7`                             | revisar copy al cambiar roadmap          | revisar: el copy de la home cita el orden de fases anterior al pivote                                                                                                                                                                                                                           |
| `UI-02` | `F1-07`                                 | `F6-03`, `F6-06`, `F10-06`               | `done`: revisión renderizada automatizada en 6 proyectos con `axe-core`, teclado, reflow y movimiento reducido                                                                                                                                                                                  |
| `UI-03` | `F1-01`                                 | cada feedback stateful, `F10-06`         | `done`: estados y reduced motion conservan feedback                                                                                                                                                                                                                                             |
| `UI-04` | `F1-01`                                 | cada extracción visual, `F10-06`         | `done`: escala reusable y token de contraste registrados                                                                                                                                                                                                                                        |

### `EDU-01` — conceptos de valuación explicados donde aparecen

- Estado: `queued` (pedido del owner el 2026-10-20, durante `F4-05`).
- Fase y dependencia: transversal; empieza cuando una superficie de valuación
  lea corridas reales, y se extiende con cada concepto nuevo del motor.
- Alcance incluido: un glosario versionado de los conceptos de Damodaran que
  el motor usa —WACC y sus componentes, riesgo país por operaciones,
  capitalización de arrendamientos e I+D, normalización, regla terminal,
  escenarios, probabilidad de fracaso, opciones de empleados—, cada uno con
  definición, fórmula, por qué importa y fuente; cada término de las
  superficies de valuación se enlaza a su entrada con un popover que se abre
  por foco o click, y una página de referencia los reúne. Fuera de alcance:
  contenido generado por IA en la superficie, cursos o recomendaciones.
- Contratos y controles: `UI-03` (estado accesible por foco/click, no sólo
  hover); copy en la voz de `PRODUCT.md` («precisa, sobria, explicable y
  educativa»); cada definición cita a Damodaran o a la ADR que decide la
  convención del proyecto cuando difiere.
- Criterios de aceptación verificables: ningún término técnico de
  `/valuacion/*` sin entrada; un test recorre las etiquetas de la superficie
  contra el glosario; axe y teclado sobre los popovers en el gate E2E.
- Evidencia esperada: módulo del glosario, componente de término, página de
  referencia y su revisión renderizada.

## Plantilla para nuevos issues

```md
### `ID` — resultado observable

- Estado: `queued | ready | in_progress | blocked | done`
- Fase y dependencia:
- Alcance incluido / fuera de alcance:
- Contratos y controles `TM-*` / `UI-*`:
- Criterios de aceptación verificables:
- Evidencia esperada: paths, tests, captura o ADR:
- Bloqueo y condición de salida, si aplica:
```

Agregar un issue nuevo sólo cuando el roadmap no lo cubra o un walkthrough produzca
deuda real. No usar el backlog para adelantar una fase ni convertir una idea en
capacidad disponible.
