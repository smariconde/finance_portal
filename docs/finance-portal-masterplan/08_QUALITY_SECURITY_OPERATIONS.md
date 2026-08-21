# Calidad, seguridad y operacion

## Piramide de pruebas

### Dominio unitario

- CAGR, TTM, averages, ratios, FX/unit conversion y fiscal alignment.
- FCFF/DDM/excess return, bridge EV-equity, terminal value y sensitivity.
- Casos: null, cero, negativos, NaN/Infinity, restatement, split y currency mismatch.
- `fast-check` para invariantes financieras y rangos amplios.

### Contract/provider

- Zod valida fixtures reales sanitizadas.
- Parser conserva raw/provenance y rechaza schema inesperado.
- 429/5xx/timeout, paginacion, empty response y partial data.
- Sin red en unit tests; recordings solo si licencia permite guardarlas.
- Para XBRL, muestra periodica contra Arelle/EFM y DQC; un schema JSON valido no prueba semantica financiera correcta.
- Fixtures point-in-time prueban filing original, amendment/restatement y consulta `available_at` sin look-ahead.

### Integracion

- migraciones contra Postgres real en CI;
- repositorios, ingestion run atomic y dedupe/idempotencia;
- Route Handlers con guard de modo, secreto de cron cuando aplique, limites y error envelope.

### E2E

- buscar empresa, filtrar CEDEAR, abrir detail;
- alternar 2Y/5Y en fundamental gap;
- editar supuesto y recalcular sin IA;
- proveedor caido y estado degraded;
- navegacion movil/teclado y axe.
- revision manual WCAG 2.2 AA de teclado, focus, zoom/reflow, contraste y alternativa tabular para graficos.

### Evals IA

- schema compliance y evidence IDs validos;
- selector de metodo en un set estratificado;
- no inventar datos/citas;
- prompt injection en filings/web;
- abstencion cuando falta evidencia;
- costo/tokens/latencia y policy correction rate.

No testear prosa exacta. Testear hechos, estructura, citas y limites.

## CI

Orden rapido a lento:

1. format/lint;
2. typecheck;
3. unit/property;
4. build;
5. integration;
6. Playwright smoke;
7. dependency/secrets scan.

Nightly: contract tests live de bajo volumen, data freshness, full E2E y evals IA controladas. Live tests no bloquean un PR por una caida externa sin diagnostico.

## Threat model inicial

- Robo de API keys server-owned o exposicion accidental en el repositorio/browser.
- Abuso de endpoints costosos/IA.
- Prompt injection desde web, filings o nombres de empresas.
- SSRF mediante URLs entregadas a extractores.
- SQL injection y filtros de screener no acotados.
- Exposicion accidental del modo personal mediante una URL anonima.
- Exfiltracion por logs/traces/error messages.
- Supply-chain de npm y skills.
- Datos financieros falsos por parser roto o fuente comprometida.
- Confusion de identidad entre emisor, security, listing, ticker reutilizado, ADR y CEDEAR.
- Look-ahead por restatements o series macro revisadas.
- Uso fuera de los terminos personales, exports no permitidos o prompts enviados a IA sin control.

## Controles

- Secrets privados/sensibles de Vercel, `server-only` y redaccion de logs.
- CSP, headers seguros, validation Zod y DTO minimization.
- Presupuesto global por proveedor/accion, margen bajo el rate limit y max cost por request.
- Allowlist de dominios para research financiero; bloquear IPs privadas/redirections sospechosas.
- Herramientas del agente con argumentos tipados y sin SQL/URL arbitrarios.
- OpenRouter model/provider allowlist, budget guardrail, ZDR cuando corresponda.
- `CRON_SECRET` y endpoints idempotentes; lock en DB contra corridas concurrentes.
- Server Actions y Route Handlers verifican `APP_MODE`; `demo` rechaza ingesta live, mutaciones persistentes e IA.
- El modo `personal` se ejecuta en localhost o detras de proteccion de deployment. No se implementa auth de aplicacion; si la URL no esta protegida debe usar `demo`.
- Endpoints IA permanecen deshabilitados hasta contar con limite global de gasto, observabilidad y kill switch.
- Separar issuer/security/listing y exigir vigencia/identificador antes de unir proveedores.
- Consultas historicas filtran por `available_at`; revisions/restatements conservan lineage.
- Dependabot/Renovate con PR, lockfile, audit y pin de GitHub Actions a SHA.
- Skills externas auditadas y versionadas.
- Las claves viven en variables server-only, se rotan manualmente y nunca se devuelven al browser.

## Observabilidad

Logs JSON con:

- `request_id`, `app_mode`, `module`, `provider`, `operation`;
- status, latency, retries, cache hit, rows, freshness;
- AI model, prompt version, tokens, estimated cost y policy outcome;
- valuation/input/engine version IDs.

Nunca loggear prompts completos por defecto, keys, headers o documentos privados del owner. Agregar error tracking y tracing solo cuando el vertical slice lo justifique.

Para IA registrar proveedor efectivo, routing/fallback, politica ZDR/data collection, modelo, response ID y outcome del policy engine sin guardar contenido sensible. Para datos registrar contrato/plan aplicable y si raw/export/IA estan permitidos.

## Privacidad y alcance personal

No hay perfiles ni datos de terceros. Antes de telemetria o IA mantener un data map minimo: dato, finalidad, proveedor, retencion, borrado y destino. Analytics de terceros queda deshabilitado por defecto y no se envian a modelos campos innecesarios.

El portal conserva lenguaje de analisis y escenarios, no ejecuta operaciones ni publica recomendaciones para terceros. Si el alcance cambia a servicio publico, se reabre la revision regulatoria y contractual antes de habilitar datos live.

## Objetivos operativos iniciales

- Lecturas comunes p95 server < 1.5 s sin contar streaming externo.
- Ingestas esperadas exitosas o estado visible de atraso; no hay SLA publico.
- 100% de valuaciones con version/input/evidence trace.
- Degradacion parcial por proveedor no bloquea el resto de la instancia.

## Costo

Medir desde Fase 1:

- invocaciones/duracion/CPU de Vercel;
- storage/egress/queries Postgres y crecimiento del cache durable;
- requests, paginas y creditos por proveedor y por corrida;
- tokens/costo por modelo y feature;
- cache hit ratio.

Limites: max empresas por screener, max documentos/evidence, max steps de IA, timeouts y circuit breaker. No refrescar universos completos desde una request de usuario.

## Runbooks necesarios

- proveedor 429/caido;
- parser detecta cambio de schema;
- datos stale o discrepancia entre fuentes;
- cron duplicado/fallido;
- migracion fallida/rollback;
- key comprometida, exposicion accidental del deployment o rotacion;
- gasto IA anormal;
- valuacion materialmente incorrecta y retraction/audit.

## Backups y cambios de metodologia

- Backups y restore drill de Postgres antes de depender del historial personal.
- Valuation runs y source snapshots son append-only salvo datos personales.
- Cambiar formula/metodo incrementa version y changelog; no reescribir historico.
- Correcciones materiales identifican corridas afectadas y permiten recalculo.
