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

| Orden | Issue   | Estado   | Resultado verificable                                                                                        | Dependencias  |
| ----: | ------- | -------- | ------------------------------------------------------------------------------------------------------------ | ------------- |
|     1 | `F1-01` | `ready`  | Shell y health navegables con estados honestos, sin DB, proveedor real, mutación ni rutas que simulen datos. | Fase 0 `done` |
|     2 | `F1-02` | `queued` | PostgreSQL/Drizzle y repositorios base con aislamiento explícito entre fixture demo y storage personal.      | `F1-01`       |
|     3 | `F1-03` | `queued` | Registro de fuentes, corridas de ingesta y fake provider determinista cubiertos por contratos.               | `F1-02`       |
|     4 | `F1-04` | `queued` | Una empresa fixture recorre identidad completa, provenance y consulta point-in-time sin look-ahead.          | `F1-03`       |
|     5 | `F1-05` | `queued` | FCFF base y sensibilidad se calculan en dominio puro con snapshot y hash reproducibles.                      | `F1-04`       |
|     6 | `F1-06` | `queued` | Resultado demo muestra fuentes, freshness, supuestos, escenarios y sensibilidad accesibles.                  | `F1-05`       |
|     7 | `F1-07` | `queued` | Unit, contract y E2E prueban el flujo demo, degradación, aislamiento, teclado y mobile.                      | `F1-06`       |
|     8 | `F1-08` | `queued` | Walkthrough reproducible del owner registra hallazgos y cierra el gate de Fase 1.                            | `F1-07`       |

No se inicia `F1-01` dentro del cierre de Fase 0. Su alcance exacto se vuelve a
confirmar contra el roadmap al comenzar la próxima sesión.

## Issues por fase

### Fase 1 — vertical slice demo

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

#### `F1-04` — Empresa fixture point-in-time

Criterios de aceptación:

- entidad legal, security, listing, símbolo vigente y programa depositario no se
  colapsan;
- cada observación declara tiempo efectivo, conocimiento público, registro local,
  unidad, moneda, source y quality flags;
- consultas `as_known` excluyen revisiones posteriores;
- fixtures golden cubren ticker ambiguo, cambio de vigencia y restatement.

Controles: `TM-05`, `TM-06`, `TM-16`.

#### `F1-05` — FCFF demo determinista

Criterios de aceptación:

- la política decimal y la serialización canónica producen el mismo hash y resultado;
- NOPAT, reinversión, descuento, terminal y puente EV-equity viven en dominio puro;
- checks rechazan no finitos, shares no positivas y `WACC <= g + buffer`;
- tests incluyen `null`, cero, negativos, mismatch de moneda y sensibilidad;
- recalcular no usa red ni IA.

Controles: `TM-06`, `TM-16`.

#### `F1-06` — Resultado demo y trazabilidad

Criterios de aceptación:

- fuentes, `as_of`, `available_at`, freshness, calidad y transformaciones son visibles;
- supuestos y bear/base/bull se distinguen de hechos reportados;
- sensitivity cuenta con equivalente tabular y estados faltantes honestos;
- la ruta no presenta recomendación, datos live ni persistencia personal simulada;
- revisión desktop/mobile y accesibilidad queda registrada.

Controles: `TM-02`, `TM-12`, `TM-15`, `UI-02`, `UI-03`, `UI-04`.

#### `F1-07` — Gate automatizado del flujo demo

Criterios de aceptación:

- unit y contract tests corren sin red;
- un E2E recorre shell, empresa fixture, valuación y proveedor degradado;
- se prueban invocación directa de fronteras existentes, aislamiento de modos y no
  exposición de secretos;
- teclado, foco, mobile, reduced motion y chequeo automatizado de accesibilidad
  generan evidencia reproducible;
- los scripts `test:integration` o `test:e2e` sólo se anuncian si existen.

Controles: `TM-01`, `TM-02`, `TM-03`, `TM-04`, `TM-07`, `TM-12`, `UI-02`.

#### `F1-08` — Walkthrough y cierre de Fase 1

Criterios de aceptación:

- el owner completa una tarea desktop y una mobile desde una sesión limpia;
- tiempo, bloqueos, confusiones y hallazgos quedan anexados como evidencia;
- los hallazgos se convierten en issues o se difieren con motivo;
- el gate de Fase 1 y el próximo slice quedan actualizados sin iniciar Fase 2.

Controles: `UI-02`.

### Fase 2 — empresas, CEDEAR y screener

| Issue   | Resultado y aceptación mínima                                                                                             | Depende de       | Controles                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------- |
| `F2-01` | Aprobar derechos y ADR del stack SEC/Caja/snapshot S&P/Alpaca, con plan, cache, retención, cuota y salida documentados.   | Fase 1           | `TM-08`, `TM-10`, `TM-15` |
| `F2-02` | Persistir issuer/security/listing/identifier/corporate actions con vigencia, candidatos ambiguos y decisiones trazadas.   | `F2-01`          | `TM-06`, `TM-16`          |
| `F2-03` | Integrar SEC con CIK, filings/lineage, cuarentena y muestra validada mediante Arelle/EFM/DQC.                             | `F2-02`          | `TM-05`, `TM-06`, `TM-08` |
| `F2-04` | Ingerir CEDEARs y ratios exactos historizados sin sobrescribir programas ni confundir ADR/subyacente.                     | `F2-02`          | `TM-05`, `TM-06`          |
| `F2-05` | Ejecutar backfill/refresh durable con presupuesto, cursor, lease, replay, `429`, crash y recuperación manual probados.    | `F2-03`, `F2-04` | `TM-10`, `TM-11`, `TM-16` |
| `F2-06` | Publicar metric catalog versionado y screener 2Y/5Y con límites, filtros allowlisted, nulos y métricas sectoriales.       | `F2-05`          | `TM-05`, `TM-07`, `TM-12` |
| `F2-07` | Exportar sólo campos autorizados, con definiciones, fecha, source y atribución; bloquear fuentes sin derechos de salida.  | `F2-06`          | `TM-02`, `TM-15`, `TM-16` |
| `F2-08` | Cerrar reconciliación, quality score explicable y gate sobre 30 empresas, splits, delistings, ADRs y provenance completa. | `F2-07`          | `TM-05`, `TM-06`, `TM-16` |

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

| Deuda   | Primer cierre                                           | Seguimiento posterior                      | Estado actual                                            |
| ------- | ------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `TM-01` | `F1-02`                                                 | `F1-07`, `F7-01`, `F9-06`                  | contrato fail-closed implementado; aislamiento pendiente |
| `TM-02` | `F1-02`                                                 | cada frontera, `F8-03`, `F9-06`            | baseline implementada; pruebas por frontera pendientes   |
| `TM-03` | primer slice con frontera; gate en `F1-07`              | `F4-04`, `F7-01`, `F8-06`                  | contracted                                               |
| `TM-04` | `F1-02`                                                 | `F1-07`, `F7-01`, `F8-04`                  | contracted                                               |
| `TM-05` | `F1-03`                                                 | `F2-03`, `F3-05`, cada parser/modelo       | contracted                                               |
| `TM-06` | `F1-04`                                                 | `F2-02`, `F3-05`, cada consulta histórica  | contratos implementados; persistencia pendiente          |
| `TM-07` | `F1-02`                                                 | `F1-07`, `F2-06`, `F8-05`                  | contracted                                               |
| `TM-08` | `F2-01` antes del primer provider                       | `F6-01`, `F7-04`, `F8-05`                  | required; no hay egress aún                              |
| `TM-09` | `F7-04`                                                 | `F7-06`, `F8-05`, `F8-06`                  | required; no hay IA aún                                  |
| `TM-10` | `F2-01`                                                 | `F2-05`, `F7-02`, `F9-02`                  | contracted; no hay gasto live aún                        |
| `TM-11` | `F2-05`                                                 | `F6-01`, `F9-01`, `F9-05`                  | contracted; cron live deshabilitado                      |
| `TM-12` | `F1-01`                                                 | cada UI externa, `F9-03`                   | React escaping implementado; headers/tests pendientes    |
| `TM-13` | `F9-06`                                                 | cada actualización de dependencia/skill    | baseline implementada; scans pendientes                  |
| `TM-14` | antes del primer preview personal (`F7-01` como máximo) | `F8-03`, `F9-06`                           | contracted; no hay deployment personal                   |
| `TM-15` | `F1-03` para fixtures                                   | cada proveedor/export/IA, `F8-02`, `F9-04` | unknowns fail-closed implementados                       |
| `TM-16` | `F1-03`                                                 | cada operación y gate                      | contracted                                               |
| `UI-01` | Fase `0B.7`                                             | revisar copy al cambiar roadmap            | `done`: registro de home alineado con Fases 2, 3, 4 y 6  |
| `UI-02` | `F1-07`                                                 | `F1-08`, `F9-03`                           | pendiente                                                |
| `UI-03` | `F1-01`                                                 | cada feedback stateful, `F9-03`            | pendiente                                                |
| `UI-04` | `F1-01`                                                 | cada extracción visual, `F9-03`            | pendiente                                                |

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
