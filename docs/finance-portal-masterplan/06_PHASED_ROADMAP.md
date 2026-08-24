# Roadmap incremental y estado

Este archivo es la fuente unica de avance. Todas las secciones forman parte de la vision, pero se implementan de a una fase y, dentro de cada fase, mediante slices verticales pequenos. La existencia de una ruta, mockup o documento no significa que una feature este terminada.

Supuesto operativo vigente: un unico owner, repositorio publico y runtime live personal. No se construyen cuentas, login propio, multi-tenancy ni BYOK. Los datos reales corren en localhost o deployment protegido; una URL anonima solo usa fixtures.

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
| Fase 1 - Vertical slice demo | in_progress | `F1-03` cerrado el 2026-08-23 con source registry, ingestion runs y fake provider deterministico; sigue `F1-04` |
| Fase 2 - Empresas y CEDEAR | not_started | - |
| Fase 3 - Divergencias | not_started | - |
| Fase 4 - Valuacion no financiera V1 | not_started | - |
| Fase 5 - Arquetipos deterministas | not_started | - |
| Fase 6 - Argentina y soja | not_started | - |
| Fase 7 - IA personal acotada | not_started | - |
| Fase 8 - Persistencia personal y asistente | not_started | - |
| Fase 9 - Hardening y publicacion del proyecto | not_started | - |

**Slice excepcional cerrado:** `F1-UI-01`, fundación shadcn/Base UI y migración del shell, home y configuración conforme a [`docs/backlog/README.md`](../backlog/README.md#f1-ui-01). No agregó datos ni capacidades.

**Alcance de `F1-03`:** el registro de fuentes y las corridas de ingesta existen como contrato ejecutable y persistencia, con un unico proveedor sintetico. Ninguna fuente real quedo aprobada ni integrada, ninguna ruta abre red y la UI todavia no expone estas superficies: eso corresponde a `F1-06`. `F1-04` es el proximo slice autorizado.

**Bloqueos actuales:** ninguno.

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
- [ ] Una empresa fixture con identidad completa y provenance point-in-time.
- [ ] FCFF base calculado por dominio puro con sensibilidad.
- [ ] UI de fuentes, freshness, supuestos y resultado.
- [ ] Unit, contract y un E2E del flujo demo.
- [ ] Walkthrough reproducible del owner con hallazgos documentados.

**Gate:** preview reproducible; el mismo snapshot produce el mismo hash/resultado; no hay llamada LLM ni proveedor real; feedback de uso queda en backlog.

## Fase 2 - Empresas, CEDEAR y screener

- [ ] Registrar terminos del plan personal y aprobar SEC + Caja + snapshot S&P + Alpaca Basic como stack inicial, o documentar su reemplazo.
- [ ] Implementar issuer/security/listing/identifier/corporate-action mapping.
- [ ] Integrar SEC identity/audit y validacion de muestra Arelle/DQC.
- [ ] Ingesta historica de CEDEAR, ratios y vigencia.
- [ ] Cache Postgres durable, refresh manual/EOD, batching, presupuesto de cuota, cursor/checkpoint, reintentos y poison policy.
- [ ] Metric catalog versionado y screener 2Y/5Y.
- [ ] Export personal con metadata y atribucion dentro de los terminos aplicables.
- [ ] Degradacion, reconciliacion y quality score explicable.

**Gate:** 30 empresas representativas reconciliadas; 100% de filas con source/as-of/available-at; delistings/splits/ADRs probados; ningun page view llama proveedores; uso/cache personal y presupuesto de cuota quedan verificados.

## Fase 3 - Divergencias fundamentales

- [ ] Pipeline fiscal-aligned de precio, market cap, EPS, net income y shares.
- [ ] Vista agregada `net income vs market cap`.
- [ ] Vista por accion `EPS vs price` y puente de dilucion/recompras.
- [ ] Categorias de EPS no comparable y ventanas con tolerancia.
- [ ] Scatter, tabla, filtros y detail drawer accesibles.
- [ ] Tests de splits, restatements, negativos, outliers y look-ahead.

**Gate:** golden dataset revisado manualmente; formulas y limitaciones publicadas; ninguna UI presenta un gap aislado como senal de compra.

## Fase 4 - Valuacion no financiera V1

- [ ] Normalizador reported/adjusted con puentes auditables.
- [ ] Selector madura/high-growth inicial.
- [ ] FCFF multi-etapa, bear/base/bull y sensitivity.
- [ ] Assumptions workbench con locks y audit trace.
- [ ] Snapshots de parametros Damodaran con version.
- [ ] Fixtures independientes y revision contra spreadsheets.
- [ ] Labels de escenarios, limitaciones y ausencia de recomendacion revisados para uso personal.

**Gate:** invariantes con precondiciones y tolerancias pasan; replay de snapshot es deterministico; recalcular no requiere IA; output muestra rango e incertidumbre.

Un MVP util termina aqui. Validar uso antes de ampliar profundidad.

## Fase 5 - Arquetipos deterministas

Implementar un arquetipo por slice y llevarlo a gate antes del siguiente:

1. bancos/aseguradoras: excess return/DDM;
2. ciclicas/commodities: normalizacion de ciclo;
3. perdidas/high growth: revenue-to-margin y supervivencia;
4. REIT: AFFO/NAV;
5. holding/SOTP y distress solo con demanda observada.

Cada slice exige selector, inputs, formulas, fixtures, diagnosticos y estado `experimental | reviewed | production`. No agregar IA en esta fase.

**Gate:** casos por arquetipo, revision independiente y limites visibles; metodos no soportados devuelven `unsupported_method`.

## Fase 6 - Argentina y soja

Construir un bloque por sesion, empezando por catalogo/vintages y luego nominal, monetario, cambiario, actividad, fiscal/externo y agro.

- [ ] BCRA Estadisticas Monetarias v4 con catalogo dinamico.
- [ ] Datos.gob.ar/INDEC/BNA con metadata, revisions y quiebres.
- [ ] Transformaciones nominal/real y seasonal-adjustment auditables.
- [ ] Rosario/Chicago con licencia, contrato, conversion y roll policy.
- [ ] Graficos, tabla accesible, freshness y lectura sin causalidad inventada.

**Gate por bloque:** ultima publicacion oficial reconciliada, cambio de schema falla seguro y metodologia visible. La fase termina cuando todos los bloques priorizados estan `done`; los restantes pueden quedar `deferred` explicitamente.

## Fase 7 - IA personal acotada

Primero proteger costo y datos; despues habilitar una sola feature IA. No se implementa identidad de usuario: el limite de acceso es localhost o la proteccion del deployment.

- [ ] Guard de modo: IA disponible en `personal` y deshabilitada en `demo`.
- [ ] Budget por request/dia, limite global, kill switch y observabilidad.
- [ ] Data map/transferencias y politica OpenRouter ZDR/data collection verificadas.
- [ ] Research sobre documentos primarios con evidence IDs y allowlist.
- [ ] Propuesta estructurada de supuestos para un metodo ya validado.
- [ ] Policy engine, abstencion, prompt-injection tests y evals.

**Gate:** no hay endpoint IA en modo demo; proveedor/routing/politica quedan trazados; replay usa output persistido; costo y tasa de rechazo/correccion son visibles.

## Fase 8 - Persistencia personal y asistente

- [ ] Saved views, watchlists, preferencias y valuaciones del unico owner sin `user_id`.
- [ ] Historial, exportacion, backup y borrado manual de datos locales.
- [ ] Claves server-owned por entorno con health, rotacion manual y redaccion de logs.
- [ ] Restauracion de preferencias y borradores entre sesiones desde Postgres; `localStorage` solo para UX no sensible.
- [ ] Asistente con acciones acotadas: explicar, comparar y navegar evidencia.
- [ ] Tool calls tipadas sin URL/SQL arbitrario y aprobacion humana para acciones sensibles.

**Gate:** una key nunca llega al browser; backup/restore personal probado; assistant eval suite factual/financiera pasa; el modo demo no accede a datos live.

## Fase 9 - Hardening y publicacion del proyecto

- [ ] SLOs, alertas, backups y restore drill.
- [ ] Load/cost tests, rate limits y circuit breakers.
- [ ] Auditoria WCAG 2.2 AA y performance budgets.
- [ ] Terminos de uso personal, atribuciones, secretos y copy metodologico revisados.
- [ ] Runbooks, rollback y changelog de metodologia.
- [ ] README publico con setup seguro; demo fixture opcional y runtime live local/protegido verificados.

**Gate:** checklist firmado, presupuesto/alertas activos, incident drill completado, secretos ausentes del repo y ninguna URL anonima sirve datos live.

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
