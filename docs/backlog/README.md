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

| Orden | Issue      | Estado        | Resultado verificable                                                                                                | Dependencias  |
| ----: | ---------- | ------------- | -------------------------------------------------------------------------------------------------------------------- | ------------- |
|     1 | `F1-01`    | `done`        | Shell y health navegables con estados honestos, sin DB, proveedor real, mutación ni rutas que simulen datos.         | Fase 0 `done` |
|     2 | `F1-02`    | `done`        | PostgreSQL/Drizzle y repositorios base con aislamiento explícito entre fixture demo y storage personal.              | `F1-01`       |
|     3 | `F1-UI-01` | `done`        | Fundación shadcn/Base UI y superficies existentes migradas a un workspace financiero estándar.                       | `F1-02`       |
|     4 | `F1-03`    | `done`        | Registro de fuentes, corridas de ingesta y fake provider determinista cubiertos por contratos.                       | `F1-UI-01`    |
|     5 | `F1-04`    | `done`        | Una empresa fixture recorre identidad completa, provenance y consulta point-in-time sin look-ahead.                  | `F1-03`       |
|     6 | `F1-05`    | `done`        | FCFF base y sensibilidad se calculan en dominio puro con snapshot y hash reproducibles.                              | `F1-04`       |
|     7 | `F1-06`    | `done`        | Superficie de resultado y trazabilidad con fuentes, freshness, supuestos y sensibilidad accesibles.                  | `F1-05`       |
|     8 | `F1-07`    | `done`        | Unit, contract y E2E prueban el flujo personal, runtime trabado, teclado y mobile.                                   | `F1-06`       |
|     9 | `F1-08`    | `deferred`    | Walkthrough del owner sobre el runtime personal registra hallazgos y cierra el gate de Fase 1.                       | `F1-07`       |
|    10 | `F2-01`    | `done`        | Acceso personal remoto habilitado en produccion, con los tests de frontera invertidos a proposito.                   | ADR 0008      |
|    11 | `F2-02`    | `done`        | Universo S&P 500 con identidad completa: issuer, security, listing, simbolo vigente y CIK.                           | `F2-01`       |
|    12 | `F2-03`    | `done`        | SEC EDGAR integrada: companyfacts publicado como observaciones point-in-time, con aceptación, vintages y cuarentena. | `F2-02`       |
|    13 | `F2-04`    | `in_progress` | Corporate actions con vigencia: splits, cambios de símbolo, sucesiones de CIK, delistings y fusiones.                | `F2-03`       |

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

- Estado: `in_progress` (desde 2026-09-14)
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

##### Incremento 3 — símbolos, traspasos, delistings y fusiones (especificado el 2026-09-15; 3a entregado el 2026-09-15, 3b no iniciado)

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

##### Incremento 3b — vínculos de adquisición y cambios de ticker declarados (especificado el 2026-09-15, no iniciado)

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

| Issue   | Resultado y aceptación mínima                                                                                       | Depende de | Controles                 |
| ------- | ------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------- |
| `F2-03` | SEC XBRL integrada con `available_at` del filing, vintages y restatements preservados; cuarentena ante schema roto. | `F2-02`    | `TM-05`, `TM-06`, `TM-08` |
| `F2-04` | Corporate actions con vigencia: splits, cambios de símbolo, delistings y fusiones sin sobrescribir historia.        | `F2-03`    | `TM-05`, `TM-06`          |
| `F2-05` | Backfill y refresh durable con presupuesto, cursor, lease, replay, `429`, crash y recuperación manual probados.     | `F2-04`    | `TM-10`, `TM-11`, `TM-16` |
| `F2-06` | Golden fixtures desde extractos reales congelados, en reemplazo de `FixtureCo` como oráculo de regresión.           | `F2-03`    | `TM-05`, `TM-16`          |

### Fase 3 — arquetipo, admisibilidad y costo de capital

| Issue   | Resultado y aceptación mínima                                                                                       | Depende de | Controles        |
| ------- | ------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------- |
| `F3-01` | Selector determinista de arquetipo con reglas activadas, inputs requeridos, confianza y `unsupported_method`.       | Fase 2     | `TM-05`          |
| `F3-02` | Perfil de completitud medido por empresa sobre los datos que existen, sin estimar lo ausente.                       | `F3-01`    | `TM-05`, `TM-16` |
| `F3-03` | Nivel de rigor `full \| standard \| screening \| unsupported` derivado de la completitud y declarado en la corrida. | `F3-02`    | `TM-05`, `TM-15` |
| `F3-04` | Datasets Damodaran versionados y fechados: ERP implícita, betas por industria y country risk premium.               | Fase 2     | `TM-05`, `TM-16` |
| `F3-05` | Mapeo empresa → industria del dataset, con el caso ambiguo declarado y no adivinado.                                | `F3-04`    | `TM-05`, `TM-06` |
| `F3-06` | Costo de capital bottom-up: beta desapalancada reapalancada, costo de deuda por spread y convergencia terminal.     | `F3-05`    | `TM-06`, `TM-16` |

### Fase 4 — motor Damodaran y arquetipos

| Issue   | Resultado y aceptación mínima                                                                                | Depende de | Controles                 |
| ------- | ------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------- |
| `F4-01` | Capitalización de leases e I+D con puente auditable sobre EBIT, capital invertido y deuda.                   | Fase 3     | `TM-05`, `TM-06`, `TM-16` |
| `F4-02` | Regla terminal `g <= risk_free_rate` además del buffer; incrementa `engine_version` sin reescribir corridas. | Fase 3     | `TM-16`                   |
| `F4-03` | Normalizador reported/adjusted con evidencia, regla y transformación versionada por ajuste.                  | `F4-01`    | `TM-05`, `TM-06`, `TM-16` |
| `F4-04` | Escenarios bear/base/bull como conjuntos coherentes de supuestos, no multiplicadores sobre el resultado.     | `F4-03`    | `TM-16`                   |
| `F4-05` | Probabilidad de fracaso y overhang de opciones incorporados a la dilución y al puente EV-equity.             | `F4-03`    | `TM-05`, `TM-16`          |
| `F4-06` | Arquetipos por slice: bancos/aseguradoras, cíclicas, pérdidas/high growth, REIT, holdings/SOTP.              | `F4-04`    | `TM-05`, `TM-06`, `TM-15` |

Cada arquetipo de `F4-06` es un slice propio con selector, inputs, fórmulas,
fixtures independientes, diagnósticos y estado `experimental | reviewed | production`,
llevado a gate antes del siguiente. Ninguno agrega IA.

### Fase 5 — capa IA acotada bajo policy engine

| Issue   | Resultado y aceptación mínima                                                                                          | Depende de | Controles                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| `F5-01` | Budget por corrida y por día, límite global, timeout, breaker, kill switch y métricas **antes** de la primera llamada. | Fase 4     | `TM-10`, `TM-16`                   |
| `F5-02` | Guard server-side: la IA sólo existe en `personal`; ninguna clave llega al browser.                                    | `F5-01`    | `TM-01`, `TM-02`, `TM-03`, `TM-14` |
| `F5-03` | Extracción cualitativa con schema cerrado, evidence IDs obligatorios y secciones dirigidas, no documentos completos.   | `F5-02`    | `TM-09`, `TM-15`                   |
| `F5-04` | Búsqueda web sobre dominios primarios allowlisted, con defensa SSRF y contenido tratado como no confiable.             | `F5-03`    | `TM-08`, `TM-09`, `TM-12`          |
| `F5-05` | Propuesta de supuestos que respeta locks, cita evidencia y siempre pasa por el policy engine antes del motor.          | `F5-04`    | `TM-09`, `TM-16`                   |
| `F5-06` | La propuesta se persiste en el snapshot; el replay reproduce ambos hashes sin volver a llamar al modelo.               | `F5-05`    | `TM-16`                            |
| `F5-07` | Evals de injection, citas, abstención, schema, costo y corrección.                                                     | `F5-06`    | `TM-09`, `TM-10`, `TM-15`          |

### Fase 6 — corrida por ticker y acceso CEDEAR

| Issue   | Resultado y aceptación mínima                                                                                          | Depende de | Controles                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| `F6-01` | Corrida por ticker como job encolado con estado; primera Route Handler o Server Action con sus controles cerrados.     | Fase 5     | `TM-03`, `TM-07`, `TM-10`, `TM-12` |
| `F6-02` | Historial de corridas: volver a ver, refrescar lo que cambió y comparar contra la anterior sin sobrescribirla.         | `F6-01`    | `TM-06`, `TM-16`                   |
| `F6-03` | Superficie de resultado sobre empresa real con nivel de rigor, provenance y supuestos distinguidos de los hechos.      | `F6-02`    | `TM-12`, `TM-15`, `UI-02`, `UI-03` |
| `F6-04` | Anotación de acceso CEDEAR: si existe programa, su ratio vigente y su precio, sin fusionar los dos instrumentos.       | `F6-02`    | `TM-05`, `TM-06`                   |
| `F6-05` | Corrida por lote sobre el universo, con presupuesto, reanudación y recuperación de fallos parciales.                   | `F6-03`    | `TM-10`, `TM-11`, `TM-16`          |
| `F6-06` | Despliegue remoto: Postgres hosteada, protección del deployment verificada y walkthrough del owner sobre datos reales. | `F6-03`    | `TM-14`, `UI-02`                   |

`F6-06` es la condición de reingreso de `F1-08`: la sesión cronometrada del owner se
ejecuta sobre la primera valuación real, con el protocolo del
[runbook](../runbooks/owner-walkthrough.md).

### Fase 7 — screener y catálogo de métricas

| Issue   | Resultado y aceptación mínima                                                           | Depende de | Controles                 |
| ------- | --------------------------------------------------------------------------------------- | ---------- | ------------------------- |
| `F7-01` | Metric catalog versionado con definiciones, unidades y método de cálculo.               | Fase 6     | `TM-05`, `TM-16`          |
| `F7-02` | Screener 2Y/5Y con límites, filtros allowlisted, nulos honestos y métricas sectoriales. | `F7-01`    | `TM-05`, `TM-07`, `TM-12` |
| `F7-03` | Export personal con definiciones, fecha, source y atribución.                           | `F7-02`    | `TM-02`, `TM-16`          |
| `F7-04` | Degradación, reconciliación y quality score explicable.                                 | `F7-02`    | `TM-05`, `TM-16`          |

### Fase 8 — divergencias fundamentales

| Issue   | Resultado y aceptación mínima                                                                     | Depende de | Controles                 |
| ------- | ------------------------------------------------------------------------------------------------- | ---------- | ------------------------- |
| `F8-01` | Pipeline fiscal-aligned point-in-time de precio, market cap, net income, EPS y acciones.          | Fase 7     | `TM-05`, `TM-06`, `TM-16` |
| `F8-02` | Vista agregada y vista por acción con puente de dilución, sin fabricar porcentajes en extremos.   | `F8-01`    | `TM-05`, `TM-06`          |
| `F8-03` | Scatter, tabla, filtros y detalle conservan raw de outliers y equivalente accesible.              | `F8-02`    | `TM-07`, `TM-12`          |
| `F8-04` | Golden/property tests cubren splits, restatements, negativos, outliers, tolerancias y look-ahead. | `F8-03`    | `TM-05`, `TM-06`          |

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

| Deuda   | Primer cierre                           | Seguimiento posterior                | Estado actual                                                                                                        |
| ------- | --------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `TM-01` | `F1-02`                                 | `F1-07`, `F2-01`, `F5-02`, `F6-06`   | `done`: composición falla cerrada y el modo se resuelve en el request; el mismo build niega o sirve según su entorno |
| `TM-02` | `F1-02`                                 | cada frontera, `F10-03`              | `done`: DB server-only y URLs pooled/direct separadas probadas                                                       |
| `TM-03` | `F6-01`, primera Route Handler real     | `F5-02`, `F10-04`                    | required: la corrida por ticker es la primera frontera real; `F1-07` probó las de composición                        |
| `TM-04` | `F1-02`                                 | `F1-07`, `F2-01`, `F10-01`           | `done`: cache namespaced por modo; sólo `personal` construye almacenamiento, verificado sobre el artefacto servido   |
| `TM-05` | `F1-03`                                 | `F2-03`, `F3-03`, cada parser/modelo | `done` de ingesta a publicación: vacío y parser roto no publican ni reemplazan                                       |
| `TM-06` | `F1-04`                                 | `F2-02`, `F4-01`, cada consulta      | `done` de la consulta a la valuación: dos cortes producen dos corridas distintas                                     |
| `TM-07` | `F1-02`                                 | `F1-07`, `F6-01`, `F7-02`            | `done`: Drizzle parametrizado y límite de consulta verificados en PostgreSQL                                         |
| `TM-08` | `F2-03`, primer provider real           | `F5-04`, `F9-01`                     | required; no hay egress aún                                                                                          |
| `TM-09` | `F5-03`                                 | `F5-04`, `F5-07`, `F10-04`           | required; no hay IA aún                                                                                              |
| `TM-10` | `F2-05`                                 | `F5-01`, `F6-05`, `F10-05`           | contracted; no hay gasto live aún                                                                                    |
| `TM-11` | `F2-05`                                 | `F6-05`, `F9-01`, `F10-05`           | idempotencia y replay probados en `F1-03`; lease, `429` y crash siguen abiertos                                      |
| `TM-12` | `F1-01`                                 | cada UI externa, `F10-06`            | headers base y render seguro verificados                                                                             |
| `TM-13` | `F10-07`                                | cada actualización de dependencia    | baseline implementada; scans pendientes                                                                              |
| `TM-14` | `F2-01`, antes del primer deploy remoto | `F6-06`, `F10-03`                    | required: `F2-01` habilita produccion; la proteccion del deployment es su precondicion                               |
| `TM-15` | `F3-03`, nivel de rigor declarado       | cada IA/export, `F5-03`, `F6-03`     | rescopeado por ADR 0007: derechos pasan a procedencia informativa; el control ahora es el nivel de rigor declarado   |
| `TM-16` | `F1-03`                                 | cada operación y gate                | `done` sobre ingesta y valuación: corridas append-only con hash, versión y error seguro                              |
| `UI-01` | Fase `0B.7`                             | revisar copy al cambiar roadmap      | revisar: el copy de la home cita el orden de fases anterior al pivote                                                |
| `UI-02` | `F1-07`                                 | `F6-03`, `F6-06`, `F10-06`           | `done`: revisión renderizada automatizada en 6 proyectos con `axe-core`, teclado, reflow y movimiento reducido       |
| `UI-03` | `F1-01`                                 | cada feedback stateful, `F10-06`     | `done`: estados y reduced motion conservan feedback                                                                  |
| `UI-04` | `F1-01`                                 | cada extracción visual, `F10-06`     | `done`: escala reusable y token de contraste registrados                                                             |

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
