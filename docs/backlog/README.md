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

| Orden | Issue      | Estado  | Resultado verificable                                                                                        | Dependencias  |
| ----: | ---------- | ------- | ------------------------------------------------------------------------------------------------------------ | ------------- |
|     1 | `F1-01`    | `done`  | Shell y health navegables con estados honestos, sin DB, proveedor real, mutación ni rutas que simulen datos. | Fase 0 `done` |
|     2 | `F1-02`    | `done`  | PostgreSQL/Drizzle y repositorios base con aislamiento explícito entre fixture demo y storage personal.      | `F1-01`       |
|     3 | `F1-UI-01` | `done`  | Fundación shadcn/Base UI y superficies existentes migradas a un workspace financiero estándar.               | `F1-02`       |
|     4 | `F1-03`    | `done`  | Registro de fuentes, corridas de ingesta y fake provider determinista cubiertos por contratos.               | `F1-UI-01`    |
|     5 | `F1-04`    | `done`  | Una empresa fixture recorre identidad completa, provenance y consulta point-in-time sin look-ahead.          | `F1-03`       |
|     6 | `F1-05`    | `done`  | FCFF base y sensibilidad se calculan en dominio puro con snapshot y hash reproducibles.                      | `F1-04`       |
|     7 | `F1-06`    | `done`  | Superficie de resultado y trazabilidad con fuentes, freshness, supuestos y sensibilidad accesibles.          | `F1-05`       |
|     8 | `F1-07`    | `done`  | Unit, contract y E2E prueban el flujo personal, runtime trabado, teclado y mobile.                           | `F1-06`       |
|     9 | `F1-08`    | `ready` | Walkthrough del owner sobre el runtime personal registra hallazgos y cierra el gate de Fase 1.               | `F1-07`       |

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
corresponden a `F9-03`; el harness usa un solo motor por decisión registrada en la
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

### Fase 2 — empresas, CEDEAR y screener

| Issue   | Resultado y aceptación mínima                                                                                                                        | Depende de       | Controles                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------- |
| `F2-01` | ADR del stack gratuito de uso personal —SEC, snapshot S&P PDDL, Comafi y Yahoo Finance— con cuota, cache, retención y política de roll documentadas. | Fase 1           | `TM-08`, `TM-10`, `TM-15` |
| `F2-02` | Persistir issuer/security/listing/identifier/corporate actions con vigencia, candidatos ambiguos y decisiones trazadas.                              | `F2-01`          | `TM-06`, `TM-16`          |
| `F2-03` | Integrar SEC con CIK, filings/lineage, cuarentena y muestra validada mediante Arelle/EFM/DQC.                                                        | `F2-02`          | `TM-05`, `TM-06`, `TM-08` |
| `F2-04` | Ingerir CEDEARs y ratios exactos historizados sin sobrescribir programas ni confundir ADR/subyacente.                                                | `F2-02`          | `TM-05`, `TM-06`          |
| `F2-05` | Ejecutar backfill/refresh durable con presupuesto, cursor, lease, replay, `429`, crash y recuperación manual probados.                               | `F2-03`, `F2-04` | `TM-10`, `TM-11`, `TM-16` |
| `F2-06` | Publicar metric catalog versionado y screener 2Y/5Y con límites, filtros allowlisted, nulos y métricas sectoriales.                                  | `F2-05`          | `TM-05`, `TM-07`, `TM-12` |
| `F2-07` | Exportar sólo campos autorizados, con definiciones, fecha, source y atribución; bloquear fuentes sin derechos de salida.                             | `F2-06`          | `TM-02`, `TM-15`, `TM-16` |
| `F2-08` | Cerrar reconciliación, quality score explicable y gate sobre 30 empresas, splits, delistings, ADRs y provenance completa.                            | `F2-07`          | `TM-05`, `TM-06`, `TM-16` |

### Fase 3 — divergencias fundamentales

| Issue   | Resultado y aceptación mínima                                                                                         | Depende de | Controles                 |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------- |
| `F3-01` | Pipeline fiscal-aligned point-in-time de precio, market cap, net income, EPS y acciones, con tolerancias versionadas. | Fase 2     | `TM-05`, `TM-06`, `TM-16` |
| `F3-02` | Vista agregada calcula CAGRs válidos y clasifica extremos no positivos sin fabricar porcentajes.                      | `F3-01`    | `TM-05`                   |
| `F3-03` | Vista por acción y puente de shares separan precio/EPS de market cap/net income.                                      | `F3-02`    | `TM-05`, `TM-06`          |
| `F3-04` | Scatter, tabla, filtros y detalle conservan raw de outliers y equivalente accesible.                                  | `F3-03`    | `TM-07`, `TM-12`          |
| `F3-05` | Golden/property tests cubren splits, restatements, negativos, outliers, tolerancias y look-ahead.                     | `F3-04`    | `TM-05`, `TM-06`          |
| `F3-06` | Gate manual confirma metodología publicada y ausencia de un gap presentado como señal de compra.                      | `F3-05`    | `TM-15`, `TM-16`          |

### Fase 4 — valuación no financiera V1

| Issue   | Resultado y aceptación mínima                                                                                | Depende de | Controles                          |
| ------- | ------------------------------------------------------------------------------------------------------------ | ---------- | ---------------------------------- |
| `F4-01` | Normalizador reported/adjusted conserva puente, motivo, evidencia y versión de cada ajuste.                  | Fase 3     | `TM-05`, `TM-06`, `TM-16`          |
| `F4-02` | Selector determinista madura/high-growth devuelve método, reglas, inputs faltantes y `unsupported_method`.   | `F4-01`    | `TM-05`                            |
| `F4-03` | FCFF multi-etapa produce bear/base/bull, sensitivity y puente EV-equity bajo política decimal.               | `F4-02`    | `TM-16`                            |
| `F4-04` | Workbench permite editar/bloquear supuestos con rangos y audit trace, sin IA.                                | `F4-03`    | `TM-03`, `TM-07`, `TM-12`, `TM-16` |
| `F4-05` | Snapshots Damodaran registran fuente, versión, fecha y derechos antes de ser consumidos.                     | `F4-03`    | `TM-05`, `TM-15`                   |
| `F4-06` | Fixtures independientes, properties y comparación contra spreadsheets documentan convenciones y tolerancias. | `F4-05`    | `TM-05`, `TM-06`                   |
| `F4-07` | Gate confirma replay determinista, rango/incertidumbre visibles y lenguaje educativo sin recomendación.      | `F4-06`    | `TM-12`, `TM-15`, `TM-16`          |

### Fase 5 — arquetipos deterministas

Cada arquetipo es un issue secuencial: `F5-01` bancos/aseguradoras, `F5-02`
cíclicas/commodities, `F5-03` pérdidas/high growth, `F5-04` REIT y `F5-05`
holding/SOTP/distress sólo con demanda observada. Cada issue exige selector, inputs,
fórmulas, fixtures independientes, diagnósticos, estado de revisión y
`unsupported_method` para lo no cubierto. Dependen del gate de Fase 4 y cierran
`TM-05`, `TM-06`, `TM-15` y `TM-16` sobre su superficie.

### Fase 6 — Argentina y soja

| Issue   | Resultado y aceptación mínima                                                                                    | Depende de | Controles                          |
| ------- | ---------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| `F6-01` | Catálogo/vintages BCRA v4 falla seguro ante cambios de schema y conserva release, unidad, frecuencia y revisión. | Fase 5     | `TM-05`, `TM-08`, `TM-10`, `TM-11` |
| `F6-02` | Nominal y monetario publican transformaciones auditables y fechas propias por serie.                             | `F6-01`    | `TM-05`, `TM-06`                   |
| `F6-03` | Cambiario usa fuentes oficiales/licenciadas y no introduce MEP/CCL sin rights row aprobada.                      | `F6-02`    | `TM-05`, `TM-15`                   |
| `F6-04` | Actividad, fiscal y externo preservan revisiones, quiebres, base, estacionalidad y denominadores compatibles.    | `F6-03`    | `TM-05`, `TM-06`                   |
| `F6-05` | Rosario/Chicago identifica feed, contrato, roll, FX, conversión y licencia antes de calcular basis.              | `F6-04`    | `TM-05`, `TM-08`, `TM-15`          |
| `F6-06` | Cada bloque cierra con gráfico, tabla accesible, freshness, metodología y lectura sin causalidad inventada.      | `F6-05`    | `TM-12`, `TM-16`                   |

### Fase 7 — IA personal acotada

| Issue   | Resultado y aceptación mínima                                                                                              | Depende de | Controles                                   |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------- |
| `F7-01` | Guard server-side mantiene IA ausente en demo y habilitable sólo en personal protegido.                                    | Fase 6     | `TM-01`, `TM-02`, `TM-03`, `TM-04`, `TM-14` |
| `F7-02` | Presupuesto por request/día, límite global, timeout, breaker, kill switch y métricas bloquean costo antes del modelo.      | `F7-01`    | `TM-10`, `TM-16`                            |
| `F7-03` | Data map y política OpenRouter verifican ZDR, collection, provider/routing y retención efectivos por corrida.              | `F7-02`    | `TM-02`, `TM-15`, `TM-16`                   |
| `F7-04` | Research sólo acepta evidence IDs y dominios primarios allowlisted con defensa SSRF y contenido tratado como no confiable. | `F7-03`    | `TM-08`, `TM-09`, `TM-12`                   |
| `F7-05` | Propuesta estructurada de supuestos opera sobre un método validado, respeta locks y siempre pasa por policy engine.        | `F7-04`    | `TM-09`, `TM-16`                            |
| `F7-06` | Evals prueban injection, citas, abstención, schema, costo y corrección; replay usa el output persistido.                   | `F7-05`    | `TM-09`, `TM-10`, `TM-15`, `TM-16`          |

### Fase 8 — persistencia personal y asistente

| Issue   | Resultado y aceptación mínima                                                                               | Depende de | Controles                          |
| ------- | ----------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| `F8-01` | Saved views, watchlists, preferencias y valuaciones persisten sin `user_id` ni multi-tenancy.               | Fase 7     | `TM-04`, `TM-07`, `TM-16`          |
| `F8-02` | Historial, export, backup, restore y borrado respetan clasificación, licencia y audit trail.                | `F8-01`    | `TM-02`, `TM-15`, `TM-16`          |
| `F8-03` | Claves server-owned tienen health, redacción y runbook de rotación sin llegar al browser.                   | `F8-02`    | `TM-02`, `TM-14`                   |
| `F8-04` | Preferencias y borradores se restauran desde Postgres; storage del browser queda limitado a UX no sensible. | `F8-03`    | `TM-04`, `TM-15`                   |
| `F8-05` | Asistente explica, compara y navega evidencia mediante tools tipadas sin URL/SQL arbitrario.                | `F8-04`    | `TM-07`, `TM-08`, `TM-09`          |
| `F8-06` | Aprobación humana, evals y aislamiento demo cierran el gate del asistente personal.                         | `F8-05`    | `TM-01`, `TM-03`, `TM-09`, `TM-10` |

### Fase 9 — hardening y publicación

| Issue   | Resultado y aceptación mínima                                                                                              | Depende de | Controles                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------- |
| `F9-01` | SLOs, alertas, backups y restore drill tienen owners, umbrales y evidencia.                                                | Fase 8     | `TM-10`, `TM-11`, `TM-16`                            |
| `F9-02` | Load/cost tests prueban límites, rate limits, circuit breakers y recuperación.                                             | `F9-01`    | `TM-07`, `TM-10`, `TM-11`                            |
| `F9-03` | Auditoría WCAG 2.2 AA y budgets de performance cierran desktop, mobile, teclado, zoom, contraste y alternativas tabulares. | `F9-02`    | `TM-12`, `UI-02`, `UI-03`, `UI-04`                   |
| `F9-04` | Revisión legal/editorial cubre términos, atribuciones, secretos, datos live y lenguaje metodológico.                       | `F9-03`    | `TM-02`, `TM-14`, `TM-15`                            |
| `F9-05` | Runbooks y drills cubren rollback, key leak, parser roto, exposición, gasto y valuación incorrecta.                        | `F9-04`    | `TM-02`, `TM-05`, `TM-10`, `TM-11`, `TM-14`, `TM-16` |
| `F9-06` | README/setup seguro, scans y checklist firmado prueban que ninguna URL anónima sirve live data.                            | `F9-05`    | `TM-01`, `TM-02`, `TM-12`, `TM-13`, `TM-14`, `TM-15` |

## Cobertura de deuda transversal

Esta matriz evita que una amenaza o deuda visual quede mencionada sin un issue que
la cierre. La columna “primer cierre” indica el primer slice que debe implementar o
probar el control; fases posteriores pueden volver a verificarlo.

| Deuda   | Primer cierre                                           | Seguimiento posterior                      | Estado actual                                                                                                        |
| ------- | ------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `TM-01` | `F1-02`                                                 | `F1-07`, `F7-01`, `F9-06`                  | `done`: composición falla cerrada y el modo se resuelve en el request; el mismo build niega o sirve según su entorno |
| `TM-02` | `F1-02`                                                 | cada frontera, `F8-03`, `F9-06`            | `done`: DB server-only y URLs pooled/direct separadas probadas                                                       |
| `TM-03` | primer slice con frontera; gate en `F1-07`              | `F4-04`, `F7-01`, `F8-06`                  | contracted: no hay Route Handler ni Server Action; `F1-07` probó las fronteras existentes y su fallo cerrado         |
| `TM-04` | `F1-02`                                                 | `F1-07`, `F7-01`, `F8-04`                  | `done`: cache namespaced por modo; sólo `personal` construye almacenamiento, verificado sobre el artefacto servido   |
| `TM-05` | `F1-03`                                                 | `F2-03`, `F3-05`, cada parser/modelo       | `done` de ingesta a publicación: vacío y parser roto no publican ni reemplazan                                       |
| `TM-06` | `F1-04`                                                 | `F2-02`, `F3-05`, cada consulta histórica  | `done` de la consulta a la valuación: dos cortes producen dos corridas distintas                                     |
| `TM-07` | `F1-02`                                                 | `F1-07`, `F2-06`, `F8-05`                  | `done`: Drizzle parametrizado y límite de consulta verificados en PostgreSQL                                         |
| `TM-08` | `F2-01` antes del primer provider                       | `F6-01`, `F7-04`, `F8-05`                  | required; no hay egress aún                                                                                          |
| `TM-09` | `F7-04`                                                 | `F7-06`, `F8-05`, `F8-06`                  | required; no hay IA aún                                                                                              |
| `TM-10` | `F2-01`                                                 | `F2-05`, `F7-02`, `F9-02`                  | contracted; no hay gasto live aún                                                                                    |
| `TM-11` | `F2-05`                                                 | `F6-01`, `F9-01`, `F9-05`                  | idempotencia y replay probados en `F1-03`; lease, `429` y crash siguen abiertos                                      |
| `TM-12` | `F1-01`                                                 | cada UI externa, `F9-03`                   | headers base y render seguro verificados                                                                             |
| `TM-13` | `F9-06`                                                 | cada actualización de dependencia/skill    | baseline implementada; scans pendientes                                                                              |
| `TM-14` | antes del primer preview personal (`F7-01` como máximo) | `F8-03`, `F9-06`                           | contracted; no hay deployment personal                                                                               |
| `TM-15` | `F1-03` para fixtures                                   | cada proveedor/export/IA, `F8-02`, `F9-04` | `done`: gate de derechos ejecutable antes del provider y fixtures sintéticas                                         |
| `TM-16` | `F1-03`                                                 | cada operación y gate                      | `done` sobre ingesta y valuación: corridas append-only con hash, versión y error seguro                              |
| `UI-01` | Fase `0B.7`                                             | revisar copy al cambiar roadmap            | `done`: registro de home alineado con Fases 2, 3, 4 y 6                                                              |
| `UI-02` | `F1-07`                                                 | `F1-08`, `F9-03`                           | `done`: revisión renderizada automatizada en 6 proyectos con `axe-core`, teclado, reflow y movimiento reducido       |
| `UI-03` | `F1-01`                                                 | cada feedback stateful, `F9-03`            | `done`: estados y reduced motion conservan feedback                                                                  |
| `UI-04` | `F1-01`                                                 | cada extracción visual, `F9-03`            | `done`: escala reusable y token de contraste registrados                                                             |

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
