# Roadmap incremental y estado

Este archivo es la fuente unica de avance. Todas las secciones forman parte de la vision, pero se implementan de a una fase y, dentro de cada fase, mediante slices verticales pequenos. La existencia de una ruta, mockup o documento no significa que una feature este terminada.

Supuesto operativo vigente: un unico owner, repositorio publico y runtime live personal. No se construyen cuentas, login propio, multi-tenancy ni BYOK. Los datos reales corren en localhost o deployment protegido; un entorno que no prueba ser privado queda trabado y no sirve datos de ningun tipo (ADR 0004).

## Estados

- `not_started`: no hay implementacion aprobada.
- `in_progress`: existe un slice activo con alcance acotado.
- `blocked`: falta una decision, credencial, contrato o accion externa identificada.
- `done`: todos los checks y el gate tienen evidencia.
- `deferred`: se pospone con motivo y condicion de reingreso.

Solo una fase puede estar `in_progress`. No marcar `done` por porcentaje, esfuerzo realizado o archivos creados.

## Estado actual

| Etapa | Estado | Ultima evidencia |
|---|---|---|
| Masterplan y auditoria | done | Replanteo single-owner, datos y persistencia revisado el 2026-08-20 |
| Fase 0 - Fundacion | done | Fase 0A y contratos 0B.1-0B.7 validados el 2026-08-21; gate completo sin integrar proveedores reales |
| Fase 1 - Vertical slice personal | done | Gate verificado end-to-end en Arch el 2026-09-04: 338 unit, 24 integration, build dinamico y 131 E2E. `F1-08` queda `deferred` por la ADR 0007, con reingreso en `F6-06` |
| Fase 2 - Datos reales SEC y universo S&P 500 | in_progress | `F2-01` cerrado el 2026-09-04. `F2-02` entrego el motor de constitucion y el grafo de identidad persistido (migracion `0004`, 380 unit, 31 integration); falta constituir el universo real, que necesita el egress de `F2-03` |
| Fase 3 - Arquetipo, admisibilidad y costo de capital | not_started | - |
| Fase 4 - Motor Damodaran y arquetipos | not_started | - |
| Fase 5 - Capa IA acotada bajo policy engine | not_started | - |
| Fase 6 - Corrida por ticker y acceso CEDEAR | not_started | - |
| Fase 7 - Screener y catalogo de metricas | not_started | - |
| Fase 8 - Divergencias fundamentales | not_started | - |
| Fase 9 - Argentina, BCRA y soja | not_started | - |
| Fase 10 - Persistencia, asistente y hardening | not_started | - |

**Reordenamiento del 2026-09-04.** La [ADR 0007](../architecture/adr/0007-ticker-driven-valuation-pivot.md) reordena las fases alrededor del objetivo real del owner: escribir un ticker y obtener una valuacion rigurosa, persistida y refrescable. El orden anterior —capas de capacidad— dejaba ese resultado despues de la Fase 5 y la capa IA en la Fase 7, detras del bloque de Argentina. Nada se elimina: screener, divergencias, macro y soja conservan su alcance y sus gates, corridos hacia abajo. La [ADR 0008](../architecture/adr/0008-remote-personal-access.md) habilita el acceso remoto en produccion, que hoy el codigo niega.

**Slice excepcional cerrado:** `F1-UI-01`, fundación shadcn/Base UI y migración del shell, home y configuración conforme a [`docs/backlog/README.md`](../backlog/README.md#f1-ui-01). No agregó datos ni capacidades.

**Alcance de `F1-06`:** `/valuacion/referencia` publica la corrida de referencia del motor `fcff_base` con toda su evidencia: contrato point-in-time, hechos reportados con freshness versionada, ausencias declaradas con motivo, supuestos separados de los hechos, proyeccion y descuento, puente EV-equity, sensibilidad WACC/g accesible, transformaciones aplicadas y policy checks. La empresa es sintetica y se declara como tal; no hay recomendacion, precio objetivo, dato live ni persistencia personal simulada. Los escenarios bear/base/bull siguen siendo Fase 4 y la superficie los nombra como planificados. El render no abre reloj, red ni base, asi que su contenido es identico en cualquier instalacion. Desde `F1-07` la ruta ya no prerenderiza: consultar el modo efectivo la vuelve dinamica a proposito ([ADR 0005](../architecture/adr/0005-request-time-runtime-boundary.md)).

**Alcance de `F1-05`:** el motor `fcff_base` (`engine fcff-1.0.0`) valua el snapshot sintetico de `FixtureCo` en dominio puro, con politica decimal explicita, hash reproducible, policy checks y sensibilidad WACC/g. La aritmetica decimal entro por [ADR 0003](../architecture/adr/0003-decimal-arithmetic-valuation-engine.md). Escenarios bear/base/bull, normalizacion reported/adjusted y seleccion automatica de metodo siguen siendo Fase 4. Ninguna fuente real quedo aprobada, ninguna ruta abre red y la UI todavia no expone estas superficies: eso corresponde a `F1-06`, el proximo slice autorizado.

**Alcance de `F1-07`:** el gate `pnpm test:e2e` compila una vez y sirve ese mismo artefacto desde dos servidores locales —uno personal y uno trabado— para probar que el modo decide en el request y no en el build. Al construirlo se corrigio un defecto de fondo: hasta este slice el modo efectivo quedaba horneado en el HTML prerenderizado, asi que un build hecho en la maquina del owner servia datos sin importar el entorno del runtime ([ADR 0005](../architecture/adr/0005-request-time-runtime-boundary.md)). El harness entro por [ADR 0006](../architecture/adr/0006-e2e-accessibility-harness.md) y cierra `UI-02`: la revision renderizada dejo de ejecutarse a mano.

**Alcance de `F1-08`:** `pnpm walkthrough` no es un gate y no mide nada por si mismo. Prepara la sesion manual del owner —un mismo build servido con su `.env.local` real y con las variables de modo vaciadas, ambos solo en `127.0.0.1`— para que tres tareas fijas y cronometradas produzcan un registro escrito con hallazgos. Lo que falta medir en Fase 1 es cuanto tarda el owner en obtener una respuesta y donde duda, y eso no lo produce un test; lo reproducible es la sesion, no el resultado. El protocolo esta en [el runbook](../runbooks/owner-walkthrough.md) y el registro en `docs/walkthroughs/`. La tarea mobile es emulacion a 390x844: exponer a la red local un runtime que sirve datos reales contradiria la ADR 0004, y ese limite queda declarado para `F10-06`.

**Alcance de `F2-02`:** el modulo `src/modules/universe/` decide, en dominio puro, que versiones abre y cuales cierra una constitucion de universo, y la migracion `0004` persiste el grafo de identidad que `F1-04` habia dejado diferido: registro y versiones separados por nivel, clave primaria `(id, valid_from)` e indices unicos parciales que espejan las invariantes. Constituir dos veces no duplica identidades; un renombre y una salida del indice se historizan sin reescribir la fila anterior. Lo que las dos fuentes no alcanzan a decidir —un simbolo nuevo de un emisor conocido, un ticker asignado a dos CIK, un mercado sin MIC unico— queda rechazado y nombrado en vez de adivinado. Falta la mitad que necesita red: constituir el universo real del S&P 500, que se cierra con el provider de `F2-03`.

**Bloqueos actuales:** ninguno. `F1-08` depende de una sesion manual del owner, que es parte de su definicion y no un bloqueo. `F2-02` depende del egress de `F2-03` para su ultimo criterio, que es una secuencia decidida y no un bloqueo.

## Protocolo por sesion

1. Leer este estado y elegir el primer check pendiente de la fase activa.
2. Definir un resultado demostrable que entre en una sesion; no agrupar secciones no dependientes.
3. Mantener build ejecutable y usar fake/fixture antes de una API real.
4. Ejecutar solo los checks relevantes y guardar evidencia: paths, comandos, preview o ADR.
5. Actualizar checkboxes, estado, bloqueos y registro de sesiones.
6. Especificar el proximo slice; no iniciarlo automaticamente si el actual ya cumplio su objetivo.

Una fase grande puede ocupar muchas sesiones. Una excepcion al orden requiere ADR con impacto, riesgo y condicion de retorno.

## Fase 0 - Fundacion y decisiones

### Fase 0A: bootstrap

- [x] Crear Next.js estable, TypeScript estricto, pnpm y Node LTS compatible.
- [x] Configurar lint, format, typecheck, unit test, build y CI minima.
- [x] Crear estructura modular y aliases sin implementar dominios futuros.
- [x] Crear `.env.example` y health de configuracion sin secretos.

### Fase 0B: contratos y gobierno

- [x] ADR de stack, modelo de cache Next.js y Postgres/pooling.
- [x] PRD, arquitectura, source registry y metodologia derivados.
- [x] Modelo entity/security/listing/depositary y contrato point-in-time.
- [x] Matriz de uso personal, cache, retencion y cuotas antes de cualquier spike tecnico.
- [x] ADR de modos `personal | demo`, persistencia durable y limite de exposicion de datos.
- [x] Threat model, wireframes, design tokens e inventario de skills.
- [x] Backlog y tracker enlazados desde el repo implementado.

**Gate:** lint, typecheck, unit y build pasan; CI corre; no hay secrets; arquitectura, cache durable, identidad, modos y restricciones de proveedor estan registradas. No se compra ni integra una API real.

## Fase 1 - Vertical slice sin proveedor real

Implementar en sesiones separadas: shell/health, persistencia base, fake provider, motor FCFF y UI.

- [x] Shell, navegacion y estados honestos `ready | degraded | disabled | planned`.
- [x] Postgres/Drizzle, migracion y repositorios base.
- [x] Reemplazar la dirección visual provisional por un workspace shadcn/Base UI estándar sin agregar capacidades.
- [x] `source_registry`, `ingestion_runs` y fake provider deterministico.
- [x] Una empresa fixture con identidad completa y provenance point-in-time.
- [x] FCFF base calculado por dominio puro con sensibilidad.
- [x] UI de fuentes, freshness, supuestos y resultado.
- [x] Unit, contract y un E2E del flujo personal y del runtime trabado.
- [ ] Walkthrough reproducible del owner sobre el runtime personal, con hallazgos documentados.

**Gate:** el mismo snapshot produce el mismo hash/resultado; un runtime que no prueba ser privado no sirve datos; no hay llamada LLM ni proveedor real; feedback de uso queda en backlog.

## Fase 2 - Datos reales SEC y universo S&P 500

Primera fase con datos reales. El objetivo es que una empresa real del indice llegue al motor con su identidad resuelta y su historia point-in-time intacta.

- [ ] Constituir el universo S&P 500 con identidad completa: issuer, security, listing, simbolo vigente y CIK.
- [ ] Integrar SEC XBRL como fuente de fundamentals, con `available_at` del filing y no la fecha de descarga.
- [ ] Reconstruir la serie por concepto contable preservando vintages, restatements y unidades.
- [ ] Corporate actions con vigencia: splits, cambios de simbolo, delistings y fusiones.
- [ ] Cache durable en Postgres con cursor, checkpoint, reintentos y poison policy; ningun page view llama al proveedor.
- [ ] Golden fixtures a partir de extractos reales congelados, en reemplazo de `FixtureCo` como oraculo de regresion.

**Gate:** 30 empresas de arquetipos distintos reconciliadas contra su filing; 100% de filas con source/as-of/available-at; splits, restatements y un cambio de simbolo probados; una consulta `as_known` anterior a un restatement no devuelve el valor enmendado.

## Fase 3 - Arquetipo, admisibilidad y costo de capital

Lo que decide si una empresa se puede valuar y con que rigor. Va antes del motor porque el motor sin esto solo sabe tratar a una empresa como si fuera todas.

- [ ] Selector determinista de arquetipo con reglas, inputs requeridos, confianza y `unsupported_method`.
- [ ] Perfil de completitud medido por empresa sobre los datos que existen de verdad.
- [ ] Nivel de rigor declarado —`full`, `standard`, `screening`, `unsupported`— derivado de la completitud, nunca elegido.
- [ ] Datasets de parametros Damodaran versionados y fechados: ERP implicita, betas desapalancadas por industria y country risk premium.
- [ ] Mapeo de la empresa a la industria del dataset, con el caso ambiguo declarado y no adivinado.
- [ ] Costo de capital bottom-up: beta desapalancada reapalancada a estructura objetivo, costo de deuda por spread, convergencia terminal.

**Gate:** cada empresa del universo recibe arquetipo y nivel de rigor, o un `unsupported_method` con el input que falta nombrado; el WACC deja de ser un input crudo y se construye con componentes fechados; una empresa sin mix geografico cae a `standard` y lo declara.

## Fase 4 - Motor Damodaran y arquetipos

Extiende el motor `fcff-1.0.0` hasta cubrir la metodologia escrita, y agrega un arquetipo por slice llevandolo a gate antes del siguiente.

- [ ] Capitalizacion de leases e I+D con puente auditable sobre EBIT, capital invertido y deuda.
- [ ] Regla terminal `g <= risk_free_rate` ademas del buffer aritmetico; incrementa `engine_version`.
- [ ] Normalizador reported/adjusted con evidencia y regla por ajuste.
- [ ] Escenarios bear/base/bull como conjuntos coherentes de supuestos.
- [ ] Probabilidad de fracaso y overhang de opciones en la dilucion.
- [ ] Arquetipos por slice: 4.1 bancos y aseguradoras (excess return/DDM); 4.2 ciclicas y commodities (normalizacion de ciclo); 4.3 perdidas y high growth (revenue-to-margin y supervivencia); 4.4 REIT (AFFO/NAV); 4.5 holdings/SOTP y distress solo con demanda observada.

**Gate por arquetipo:** selector, inputs, formulas, fixtures independientes, diagnosticos y estado `experimental | reviewed | production`; comparacion documentada contra la spreadsheet publica correspondiente; metodos no soportados devuelven `unsupported_method`. Recalcular no requiere IA.

## Fase 5 - Capa IA acotada bajo policy engine

Primero el limite de costo y datos, despues la propuesta. La IA decide solo las filas de la tabla cualitativa de la metodologia.

- [ ] Budget por corrida y por dia, limite global, timeout, breaker, kill switch y metricas antes de la primera llamada.
- [ ] Extraccion cualitativa con schema cerrado, evidence IDs obligatorios y disciplina de contexto: secciones dirigidas, no documentos completos.
- [ ] Busqueda web sobre dominios primarios allowlisted, con defensa SSRF y contenido tratado como no confiable.
- [ ] Propuesta estructurada de supuestos que respeta locks y siempre pasa por el policy engine.
- [ ] Persistencia de la propuesta dentro del snapshot de entrada; el replay no vuelve a llamar al modelo.
- [ ] Evals de injection, citas, abstencion, schema, costo y correccion.

**Gate:** ninguna cifra del resultado se origina en texto libre del modelo; un replay reproduce `input_hash` y `result_hash` sin red; una propuesta sin evidencia citada es rechazada por el policy engine; costo por corrida y tasa de rechazo son visibles.

## Fase 6 - Corrida por ticker y acceso CEDEAR

La espina del producto, ya con todas sus piezas construidas.

- [ ] Corrida por ticker como job encolado con estado, no como request; primera Route Handler o Server Action del proyecto (`TM-03`).
- [ ] Persistencia de la corrida y su historial: volver a verla, refrescar lo que cambio y comparar contra la anterior.
- [ ] Superficie de resultado sobre una empresa real, con nivel de rigor declarado, provenance y supuestos propuestos distinguidos de los hechos.
- [ ] Anotacion de acceso CEDEAR: si la empresa tiene programa, su ratio vigente y su precio.
- [ ] Corrida por lote sobre el universo, con presupuesto y reanudacion.
- [ ] Despliegue remoto: Postgres hosteada, proteccion del deployment y `personal` en produccion segun la [ADR 0008](../architecture/adr/0008-remote-personal-access.md).

**Gate:** un ticker escrito produce una valuacion completa, persistida y reproducible; el resultado declara su nivel de rigor; una empresa sin datos suficientes se niega nombrando el faltante; ninguna URL sin proteccion sirve datos.

## Fase 7 - Screener y catalogo de metricas

- [ ] Metric catalog versionado con definiciones y unidades.
- [ ] Screener 2Y/5Y con limites, filtros allowlisted, nulos honestos y metricas sectoriales.
- [ ] Export personal con definiciones, fecha, source y atribucion.
- [ ] Degradacion, reconciliacion y quality score explicable.

**Gate:** un filtro sobre un campo nulo no lo trata como cero; el export declara de donde salio cada columna.

## Fase 8 - Divergencias fundamentales

- [ ] Pipeline fiscal-aligned de precio, market cap, EPS, net income y shares.
- [ ] Vista agregada `net income vs market cap` y vista por accion `EPS vs price` con puente de dilucion.
- [ ] Categorias de EPS no comparable y ventanas con tolerancia.
- [ ] Scatter, tabla, filtros y detail drawer accesibles.
- [ ] Tests de splits, restatements, negativos, outliers y look-ahead.

**Gate:** golden dataset revisado manualmente; formulas y limitaciones publicadas; ninguna UI presenta un gap aislado como senal de compra.

## Fase 9 - Argentina, BCRA y soja

Un bloque por sesion, empezando por catalogo/vintages.

- [ ] BCRA Estadisticas Monetarias v4 con catalogo dinamico y fallo seguro ante cambio de schema.
- [ ] Datos.gob.ar/INDEC/BNA con metadata, revisions y quiebres.
- [ ] Transformaciones nominal/real y seasonal-adjustment auditables.
- [ ] Cambiario con fuentes oficiales y fechas propias por serie.
- [ ] Rosario/Chicago con contrato, conversion, FX y roll policy antes de calcular basis.
- [ ] Graficos, tabla accesible, freshness y lectura sin causalidad inventada.

**Gate por bloque:** ultima publicacion oficial reconciliada, cambio de schema falla seguro y metodologia visible. La fase termina cuando los bloques priorizados estan `done`; los restantes pueden quedar `deferred` explicitamente.

## Fase 10 - Persistencia, asistente y hardening

- [ ] Saved views, watchlists y preferencias del unico owner sin `user_id`.
- [ ] Historial, exportacion, backup, restore drill y borrado manual.
- [ ] Claves server-owned con health, rotacion manual y redaccion de logs.
- [ ] Asistente con acciones acotadas y tool calls tipadas sin URL/SQL arbitrario.
- [ ] SLOs, alertas, load/cost tests, rate limits y circuit breakers.
- [ ] Auditoria WCAG 2.2 AA y performance budgets, incluida la cobertura multi-motor diferida en la [ADR 0006](../architecture/adr/0006-e2e-accessibility-harness.md).
- [ ] Runbooks, rollback y changelog de metodologia.

**Gate:** una key nunca llega al browser; backup/restore probado; incident drill completado; secretos ausentes del repo; ninguna URL sin proteccion sirve datos.

## Definicion global de terminado

Una feature esta `done` cuando pregunta y criterio estan claros; schema, identidad, formula, fuente y version estan documentados; happy path, bordes y degradacion tienen tests; la UI muestra source/as-of/available-at/quality; seguridad, uso personal y modo de despliegue fueron revisados; es usable por teclado y movil; observabilidad/costo/rollback existen; preview y diff fueron verificados.

## Registro de sesiones

Agregar una fila al cerrar cada sesion. No borrar historia; corregir con una fila nueva.

| Fecha | Fase/slice | Resultado | Estado | Evidencia | Proximo slice/bloqueo |
|---|---|---|---|---|---|
| 2026-08-20 | Masterplan | Auditoria externa y endurecimiento documental | done | `docs/finance-portal-masterplan/` | Fase 0A: bootstrap; implementacion aun no iniciada |
| 2026-08-20 | Masterplan | Replanteo single-owner: SEC/Caja/Alpaca, cache Postgres, sin auth/BYOK y demo fixture | done | `00`, `01`, `02`, `03`, `04`, `06`, `07`, `08`, `09`, `10`, `README`, `AGENTS.md` | Fase 0A: bootstrap; implementacion aun no iniciada |
| 2026-08-21 | Fase 0A | Bootstrap Next.js 16, toolchain, CI y health seguro `demo \| personal` | done | `package.json`, `pnpm-lock.yaml`, `.github/workflows/quality.yml`, `src/app/`, `src/modules/configuration/`; format, lint, typecheck, 5 unit tests, build y smoke HTTP 200 | Fase 0B.1: ADR de stack, cache de Next.js 16 y Postgres/pooling |
| 2026-08-21 | Fase 0 / README publico | Presentacion profesional del producto, estado real, setup, arquitectura, seguridad y despliegue | done | `README.md`; enlaces relativos y scripts verificados, format y diff check | Fase 0B.1: ADR de stack, cache de Next.js 16 y Postgres/pooling |
| 2026-08-21 | Fase 0 / skill UI | Impeccable instalada y auditada para direccion visual no generica, con red, hooks y updates deshabilitados por defecto | done | `.agents/skills/impeccable/`, `.impeccable/config.json`, `docs/agent/skills-inventory.md`, `AGENTS.md`; source pin `f88b283` | Fase 0B.1; definir `DESIGN.md` antes del proximo cambio visual |
| 2026-08-21 | Fase 0 / sistema visual | Mundo “Mesa de calibracion” aplicado a la portada y documentado como sistema adaptable para home, empresas, valuacion, matrices, series y macro | done | `DESIGN.md`, `.impeccable/design.json`, `.impeccable/surfaces/src-app-page-tsx.md`, `src/app/`; format, lint, typecheck, 5 unit tests, build, detector Impeccable y capturas 1440/390; review `ship` | Fase 0B.1: ADR de stack, cache de Next.js 16 y Postgres/pooling |
| 2026-08-21 | Fase 0B.1 | ADR de stack, Cache Components de Next.js 16 y contrato PostgreSQL pooled/direct | done | `docs/architecture/adr/0001-stack-cache-postgres.md`, `next.config.ts`; fuentes primarias revisadas; lint, typecheck, 5 unit tests y build con Cache Components habilitado | Fase 0B.2: derivar PRD, arquitectura ejecutable, source registry y metodologia |
| 2026-08-21 | Fase 0B.2 | PRD, arquitectura ejecutable, registro inicial de fuentes y metodología de valuación derivados sin integrar proveedores ni adelantar aprobaciones | done | `docs/product/prd.md`, `docs/architecture/system.md`, `docs/data/source-registry.md`, `docs/valuation/methodology.md`; fuentes primarias revisadas; format, lint, typecheck, 5 unit tests, build, referencias y diff check | Fase 0B.3: modelo entity/security/listing/depositary y contrato point-in-time |
| 2026-08-21 | Fase 0B.3 | Modelo entity/security/listing/depositary y contrato point-in-time con vigencia efectiva, conocimiento público, registro local y revisiones reproducibles | done | `docs/data/identity-model.md`, `docs/data/point-in-time-contract.md`, `docs/architecture/system.md`, `docs/data/source-registry.md`, `AGENTS.md`; fuentes primarias revisadas; format, enlaces, diff check, lint, typecheck, 5 unit tests y build | Fase 0B.4: matriz de uso personal, cache, retencion y cuotas |
| 2026-08-21 | Fase 0B.4 | Matriz por fuente de uso personal, cache, retencion, export/IA y cuotas con desconocidos cerrados; ningun proveedor, cuenta, gasto o spike aprobado | done | `docs/data/provider-use-matrix.md`, `docs/data/source-registry.md`, `README.md`, masterplan `README`; fuentes primarias revisadas; format, enlaces, referencias obsoletas, diff check, lint, typecheck, 5 unit tests y build | Fase 0B.5: ADR de modos `personal \| demo`, persistencia durable y limite de exposicion de datos |
| 2026-08-21 | Fase 0B.5 | ADR de modos efectivos, persistencia durable y limite de exposicion con fallback seguro a demo; Production queda publica/demo y el personal live se limita a local o Preview protegido | done | `docs/architecture/adr/0002-runtime-modes-persistence-exposure.md`, `src/modules/configuration/domain/config-health.ts`, `.env.example`, arquitectura y deploy; fuentes primarias revisadas; format, enlaces, referencias obsoletas, diff check, lint, typecheck, 10 unit tests y build | Fase 0B.6: threat model y reconciliacion de wireframes, design tokens e inventario de skills |
| 2026-08-21 | Fase 0B.6 | Threat model consolidado y evidencia de interfaz/skills reconciliada; la home queda como unico wireframe ejecutable y la deuda visual se mantiene explicita | done | `docs/security/threat-model.md`, `docs/design/interface-foundations.md`, `docs/agent/skills-inventory.md`, enlaces en arquitectura/README/AGENTS; OWASP, Next.js, Vercel y GitHub revalidados; detector Impeccable con 14 advisories y sin findings blocking/major; format, enlaces, secrets patterns, diff check, lint, typecheck, 10 unit tests y build | Fase 0B.7: backlog ejecutable y tracker enlazado; incorporar `TM-*` y `UI-01` a `UI-04`; no comenzar Fase 1 |
| 2026-08-21 | Fase 0B.7 | Backlog por fases ejecutable, trazabilidad completa `TM-01..16`/`UI-01..04` y copy de fases reconciliado; gate de Fase 0 cerrado | done | `docs/backlog/README.md`, enlaces en `README.md`, masterplan, threat model, interface foundations y `AGENTS.md`, `src/app/page.tsx`; format, enlaces, secret patterns, diff check, lint, typecheck, 10 unit tests y build | `F1-01`: shell, navegacion y health; no iniciar `F1-02` |
| 2026-08-21 | Fase 1 / `F1-01` | Shell compartido, navegacion a superficies reales, health honesto y headers base con review desktop/mobile | done | `src/app/`, `src/server/security/`, `next.config.ts`, brief y capturas en `.impeccable/`; format, lint, typecheck, 12 unit tests, build, HTTP 200 y verdict Impeccable `ship` | `F1-02`: Postgres/Drizzle y repositorios base; no iniciar `F1-03` |
| 2026-08-21 | Fase 1 / `F1-02` | Schema y migración Drizzle, runtime pooled, job directo, repositories demo/personal y cache aislados; falta PostgreSQL real | in_progress | `drizzle/`, `src/modules/persistence/`, `src/server/db/`, `scripts/migrate.ts`, `docs/runbooks/database-migrations.md`; generate, format, lint, typecheck y build pasan; 20 unit tests pasan; guards sin URLs fallan seguro | Proveer base PostgreSQL dedicada, ejecutar migration up y `pnpm test:integration`; no iniciar `F1-03` |
| 2026-08-21 | Fase 1 / `F1-02` | PostgreSQL local reproducible y gate real de persistencia completado | done | `compose.test.yaml`, `.env.docker.example`, PostgreSQL `17.11` healthy en `127.0.0.1:55432`, tablas `drizzle.__drizzle_migrations` y `public.dataset_snapshots`; format, lint, typecheck, 20 unit tests, 1 integration test y build pasan | `F1-03`: source registry, ingestion runs y fake provider; no iniciar `F1-04` |
| 2026-08-23 | Fase 1 / `F1-UI-01` | Review desktop/mobile del workspace shadcn cerrada: jerarquia de encabezados corregida, tabla de health navegable por teclado y con reflow, nombres de control en español, badges de estado anunciados y drift de tipografia eliminado | done | `src/app/page.tsx`, `src/app/configuracion/page.tsx`, `src/app/_components/status-mark.tsx`, `src/components/ui/{table,sidebar,button}.tsx`, capturas `.impeccable/review/{desktop,mobile}.png` regeneradas desde build de produccion; `detect.mjs` sin findings; medicion CDP 1440/390 en claro y oscuro sin overflow horizontal, sin controles sin nombre ni targets <24px fuera del rail duplicado; format, lint, typecheck, 20 unit tests y build pasan | `F1-03`: source registry, ingestion runs y fake provider; no iniciar `F1-04` |
| 2026-08-23 | Fase 1 / `F1-03` | Modulo de ingesta con contrato ejecutable: source registry fail-closed por derecho, corridas append-only con estado/counts/hash/error redactado, fake provider deterministico con cursor y fixtures sinteticas de FixtureCo para lote completo, parcial, vacio, parser roto y fuente caida | done | `src/modules/ingestion/{domain,application,infrastructure}`, `src/server/db/{schema,postgres-source-registry-repository,postgres-ingestion-run-repository}.ts`, `src/server/persistence/get-{source-registry,ingestion-run}-repository.ts`, `drizzle/0001_workable_lethal_legion.sql` y su rollback pareado, `tests/integration/{global-setup,ingestion-run-repository}.ts`, `docs/runbooks/database-migrations.md`; el gate de derechos corre antes del provider y el spy de `fetchDataset` no se invoca para `sec-edgar`; `vi.spyOn(globalThis, "fetch")` sin llamadas; checks de PostgreSQL `source_registry_public_display_check`, `ingestion_runs_counts_balance_check` e indice unico parcial `ingestion_runs_publishable_idempotency_uidx` verificados; format, lint, typecheck, 96 unit tests, 7 integration tests contra PostgreSQL `17.11` y build pasan | `F1-04`: empresa fixture con identidad completa y provenance point-in-time; no iniciar `F1-05` |
| 2026-08-24 | Fase 1 / `F1-04` | Empresa fixture con identidad completa y provenance point-in-time: entidad legal, security, listing, simbolo vigente y programa depositario separados; publicacion atomica con cadena de revision, `recorded_at` e `ingestion_run_id`; consulta `as_known` sin look-ahead bajo ambas knowledge bases | done | `src/modules/temporal/domain/`, `src/modules/identity/{domain,application,infrastructure}`, `src/modules/observations/{domain,application,infrastructure}`, `src/server/db/{schema,postgres-observation-repository}.ts`, `src/server/persistence/get-observation-repository.ts`, `drizzle/0002_fresh_redwing.sql` y su rollback pareado, `tests/integration/observation-repository.test.ts`; golden fixtures de `FixtureCo` para ticker ambiguo (`FIXA` sin MIC devuelve dos candidatos), ticker reutilizado por otro emisor en 2025, cambio de vigencia `FIXA -> FXCO` anunciado el 2024-05-10 y efectivo el 2024-06-01, ratio depositario 10:1 -> 20:1 anunciado el 2024-07-15 y efectivo el 2024-09-01, y restatement del revenue FY2024 (`as_known(2025-03-01)=100000000`, `as_known(2025-06-01)=96000000`, `latest_restated=96000000`); una corrida `quarantined` no publica ni reemplaza el ultimo lote valido y los checks `observations_raw_value_status_check`, `observations_current_revision_uidx` y la foreign key a `ingestion_runs` quedan verificados en PostgreSQL; `vi.spyOn(globalThis, "fetch")` sin llamadas; format, lint, typecheck, 167 unit tests, 16 integration tests contra PostgreSQL `17.11` y build pasan | `F1-05`: FCFF base determinista con sensibilidad; no iniciar `F1-06` |
| 2026-08-24 | Fase 1 / `F1-05` | Motor FCFF base determinista: politica decimal explicita, snapshot de entrada con provenance, NOPAT/reinversion/descuento/terminal/puente EV-equity en dominio puro, policy checks `reject` y `require_review`, sensibilidad WACC/g con celdas invalidas declaradas y corridas append-only en `valuation_runs` | done | `docs/architecture/adr/0003-decimal-arithmetic-valuation-engine.md`, `src/modules/valuation/{domain,application,infrastructure}`, `src/server/db/{schema,postgres-valuation-run-repository}.ts`, `src/server/persistence/get-valuation-run-repository.ts`, `drizzle/0003_typical_maximus.sql` y su rollback pareado, `tests/integration/valuation-run-repository.test.ts`; `decimal.js` clonado con `precision=34` y `ROUND_HALF_EVEN` e importado solo desde `decimal-policy.ts`; el mismo snapshot canonico produce `input_hash = fb0277d0...8c25`, `result_hash = b0c831f0...4169` y `valuePerShare = 13.54613115387460161790309586190624` bajo otro run id, y reordenar sus claves no cambia el hash; el mismo modelo con corte `as_known(2025-03-01)` usa revenue `100000000` y da `14.170553285286043351982391522819`, otra corrida con otro hash; rechazos verificados para no finitos, division por cero, acciones no positivas, `WACC <= g + 0.005`, moneda distinta, claim `missing`, convenciones de reinversion mezcladas sin puente y perfil no implementado (`unsupported_method`); una corrida rechazada tambien se persiste y `valuation_runs_replay_uidx` hace que un replay exacto devuelva la corrida existente; checks `valuation_runs_outcome_check` y `valuation_runs_hash_check` verificados en PostgreSQL; `vi.spyOn(globalThis, "fetch")` sin llamadas; format, lint, typecheck, 252 unit tests, 24 integration tests contra PostgreSQL `17.11` y build pasan | `F1-06`: resultado demo con fuentes, freshness, supuestos y sensibilidad accesibles; no iniciar `F1-07` |
| 2026-08-25 | Fase 1 / `F1-06` | Superficie de resultado y trazabilidad: `/valuacion/demo` muestra el valor por accion junto al contrato point-in-time, la evidencia con freshness versionada, las ausencias declaradas, los supuestos separados de los hechos, la proyeccion, el puente EV-equity, la sensibilidad WACC/g accesible y los policy checks | in_progress | `src/app/valuacion/demo/` y sus componentes, `src/modules/valuation/domain/{display-format,valuation-report}.ts`, `toFixedScale` en `decimal-policy.ts`, `src/modules/valuation/infrastructure/demo-valuation-run.ts`, `.impeccable/surfaces/src-app-valuacion-demo-page-tsx.md`, `DESIGN.md` y `docs/design/interface-foundations.md`; formato `es-AR` determinista sin `Intl` para que el mismo numero salga igual del servidor y del navegador; freshness `valuation-freshness-1.0.0` con bordes probados en 180, 181, 365 y 366 dias; hechos, supuestos y ausencias declaradas con marcas distintas y sin fila de valor cero; `as_known(2025-03-01)` da `14,17` y `as_known(2025-06-01)` da `13,55` con dos `result_hash` distintos; bear/base/bull declarados `planned` de Fase 4 en vez de fabricados; las 2 celdas con `WACC <= g + buffer` muestran `No definido` con su motivo; el tinte de la grilla se asigna por posicion en el orden (distribucion medida `10/8/10/8/10`) y nunca es el unico canal; contraste en oklab para ambos temas con peor caso `4.68:1`; el render no abre reloj, red ni base y `build` prerenderiza la ruta como estatica; format, lint, typecheck, 282 unit tests, 24 integration tests contra PostgreSQL `17.11`, build y detector Impeccable `[]` pasan | Cierre de `F1-06`: falta la revision renderizada desktop/mobile a 1440x900 y 390x844; no hay navegador disponible y los scripts `live` no estan aprobados |
| 2026-08-25 | Fase 1 / `F1-06` + ADR 0004 | Superficie de resultado y trazabilidad cerrada, y pivote a runtime personal-first: el eje `demo | personal` pasa a `locked | personal` con fallo cerrado, las fixtures dejan de ser producto y quedan como dobles de test, y `/valuacion/demo` pasa a `/valuacion/referencia` como verificacion del motor | done | `docs/architecture/adr/0004-personal-first-runtime.md`, `src/modules/configuration/domain/{config-health,runtime-lock}.ts`, `src/app/_components/runtime-locked-notice.tsx`, `src/app/valuacion/referencia/`, los cinco selectores de repositorio y sus raices de composicion, `in-memory-*` reemplazando a `demo-*`, CLAUDE.md, AGENTS.md, backlog y este roadmap; un runtime sin declarar o que no prueba ser privado queda `locked`, no construye repositorio y no abre la conexion personal ni para averiguarlo; `personal` exige ademas `DATABASE_URL` pooled; format, lint, typecheck, 283 unit tests y build pasan | `F1-07`: gate automatizado del flujo personal y del runtime trabado |
| 2026-08-26 | Fase 1 / `F1-07` + ADR 0005 y 0006 | Gate automatizado del flujo personal y del runtime trabado, y correccion de la frontera de modo: hasta ahora se resolvia en `next build` y quedaba horneada en el HTML, asi que el artefacto servia datos sin importar el entorno del runtime. Ahora se resuelve en el request y **un mismo build** sirve o niega segun su entorno | done | `docs/architecture/adr/000{5,6}-*.md`, `playwright.config.ts`, `scripts/run-e2e.ts`, `tests/e2e/`, `tests/setup/no-network.ts` y su test, `src/server/persistence/runtime-composition.test.ts`, `src/server/config/app-environment.ts`, `src/app/not-found.tsx`, `docs/runbooks/e2e-accessibility-gate.md`, job `e2e` en `.github/workflows/quality.yml`; las cuatro rutas pasan a `f (Dynamic)` y los `.html` prerenderizados quedan en 0 bytes; el servidor trabado no expone `FixtureCo`, `13,55`, el valor exacto ni ninguno de los dos hashes, tampoco en el payload RSC; los cinco selectores de composicion lanzan `RuntimeLockedError` en seis entornos trabados sin llegar a pedir la base; un centinela por variable de `.env.example` no aparece en health, body, headers ni RSC en ningun modo; guard de red que hace fallar `fetch`, `http`, `https` y socket TCP en toda la suite unitaria, con su propio test; `DATABASE_URL` del servidor personal apunta a un puerto sin escucha, asi que abrir la base rompe el gate; 131 tests E2E en 6 proyectos con `axe-core` sin findings `serious` ni `critical`; tres defectos reales corregidos —contraste de la cifra de antiguedad por `opacity-80`, `disabled` consumido por el `TooltipTrigger` de Base UI en los items planificados, y `Escape` capturado por el tooltip en mobile que impedia cerrar el drawer por teclado— mas el rail de la sidebar fuera del arbol de accesibilidad; format, lint, typecheck, 338 unit tests, 24 integration tests contra PostgreSQL `17.11` y build pasan | `F1-08`: walkthrough del owner sobre el runtime personal y cierre del gate de Fase 1 |
| 2026-09-03 | Fase 1 / `F1-08` | Harness y protocolo del walkthrough del owner: `pnpm walkthrough` sirve un mismo build en `127.0.0.1:3120` con el `.env.local` real del owner y en `127.0.0.1:3121` con modo, acceso y `DATABASE_URL` vaciados, con tres tareas fijas y cronometradas —desktop, mobile y entorno sin declarar— y plantilla de registro. Falta la sesion del owner | in_progress | `scripts/run-walkthrough.ts`, script `walkthrough` en `package.json`, `docs/runbooks/owner-walkthrough.md`, `docs/walkthroughs/TEMPLATE.md`, `CLAUDE.md` y `AGENTS.md`; a diferencia del gate E2E el servidor personal no se fabrica con centinelas ni base inalcanzable, porque lo que se mide es el producto y no la frontera; ambos servidores escuchan solo en `127.0.0.1` y la tarea mobile es emulacion a 390x844 en vez de exponer a la red local un runtime con datos reales (ADR 0004); format, lint y typecheck pasan; `test`, `build` y la corrida del harness no se pudieron ejecutar en la sesion del agente porque `node_modules` esta instalado para Windows y faltan los binarios nativos de Linux | Correr `pnpm walkthrough` en el host del owner, registrar la sesion en `docs/walkthroughs/2026-09-03-f1-08.md` y cerrar el gate de Fase 1; no iniciar Fase 2 |
| 2026-09-04 | Fase 1 / pivote | Checkout Arch verificado end-to-end y reordenamiento del roadmap alrededor de la corrida por ticker | done | `docs/architecture/adr/0007-ticker-driven-valuation-pivot.md`, `0008-remote-personal-access.md`, `docs/valuation/methodology.md` v0.2.0, este roadmap y `docs/backlog/README.md`; format, lint, typecheck, 338 unit, 24 integration, build y 131 E2E pasan en Arch Linux | `F2-01`: habilitar acceso personal remoto en produccion |
| 2026-09-04 | Fase 2 / `F2-01` | Acceso personal remoto en produccion; frontera invertida a proposito y caveat de Hobby documentado donde se declara la variable | done | `src/modules/configuration/domain/config-health.ts`, sus tests, `runtime-composition.test.ts`, `.env.example`, `README.md`, `09_ENVIRONMENT_AND_DEPLOY.md`, `10_DECISIONS_AND_SOURCES.md`; format, lint, typecheck, 345 unit, build y 131 E2E pasan | `F2-02`: universo S&P 500 con identidad completa |
| 2026-09-04 | Fase 2 / `F2-02` | Motor de constitucion del universo y grafo de identidad persistido: issuer, security, listing, simbolo vigente y CIK separados, con membresia de indice versionada. Falta constituir el universo real | in_progress | `src/modules/universe/{domain,application,infrastructure}`, ocho tablas nuevas en `src/server/db/schema.ts`, `drizzle/0004_common_proteus.sql` y su rollback pareado, `src/server/db/postgres-universe-repository.ts`, `src/server/persistence/get-universe-repository.ts`, `tests/integration/universe-repository.test.ts`, `docs/data/identity-model.md` v0.2; registro y versiones separados por nivel para que la foreign key apunte a la identidad y no a una fila que cambia con cada renombre, con clave primaria `(id, valid_from)`; tres emisores producen cuatro instrumentos y dos clases del mismo CIK son dos securities con el mismo issuer, con el CIK como unica asignacion de `subject_type = legal_entity`; repetir la constitucion no escribe una fila mas y el conteo de tablas no cambia; un renombre cierra la version anterior en el mismo instante en que abre la nueva y la fila historica conserva su nombre; una salida del indice cierra la membresia sin borrarla y sin deslistar el instrumento; un lote sin miembros resueltos no se aplica, para que una lista rota no vacie el universo por omision; ocho codigos de rechazo nombrados, incluido `unresolved_share_class` porque estas dos fuentes no distinguen un cambio de ticker de una clase nueva; convencion `constituent-match-1.0.0` para `BRK.B` frente a `BRK-B`, aceptada solo si es univoca y declarada en el resultado; `legal_entity_versions_open_uidx`, `identifier_assignments_authoritative_uidx` e `index_memberships_content_hash_check` verificados en PostgreSQL; el hash cubre el contenido y no el instante de registro; seis selectores de composicion en vez de cinco, todos fallando cerrado; format, lint, typecheck, 380 unit tests, 31 integration tests contra PostgreSQL `17.11`, build con las cuatro rutas en `f (Dynamic)` y 131 E2E pasan | Cierre de `F2-02`: constituir el universo real del S&P 500 con el provider de `F2-03` y sus controles `TM-08` |
