# Portal Financiero

Portal web personal para investigar empresas globales, entender su acceso mediante CEDEAR, comparar fundamentales y construir valuaciones reproducibles con fuentes visibles.

> Información educativa, no asesoramiento financiero. El portal no ejecuta operaciones ni publica recomendaciones personalizadas.

## Qué problema resuelve

Analizar una empresa suele exigir combinar filings, precios, ratios, instrumentos locales, supuestos de valuación y contexto macroeconómico en herramientas separadas. Portal Financiero busca reunir ese flujo en una experiencia en español, mobile-first y auditable.

La aplicación está diseñada para responder preguntas como:

- ¿Qué empresas cumplen determinados criterios de calidad, crecimiento y valuación?
- ¿Qué acciones tienen CEDEAR y cuál es la relación con su subyacente?
- ¿Las ganancias crecieron más rápido que el precio o la capitalización de mercado?
- ¿Qué método de valuación corresponde y qué supuestos explican el resultado?
- ¿Qué muestran las principales variables del régimen macroeconómico argentino?
- ¿De qué fuente, fecha, unidad y transformación proviene cada número?

## Estado actual

Las fases 0 y 1 están cerradas y la **Fase 2 — datos reales SEC y universo S&P 500** está en curso. El universo del S&P 500 está constituido con identidad completa y los hechos XBRL de la SEC se ingieren como observaciones point-in-time: `available_at` desde la aceptación de cada presentación, vintages y re-expresiones preservadas, y cuarentena ante un documento que no se entiende. Una reorganización que cambia el CIK del filer —ExxonMobil en 2026— se declara, se verifica contra la SEC y une las dos historias en la lectura sin reasignar hechos ([ADR 0011](docs/architecture/adr/0011-issuer-succession-reporting-lineage.md)). Un split se confirma con el ratio que declara el filer y la re-expresión de sus propios números en la misma presentación, y la lectura `latest_adjusted` lleva las series por acción a una sola base sin reescribir lo publicado ([ADR 0012](docs/architecture/adr/0012-stock-splits-share-basis.md)). Un traspaso de mercado, un delisting o un renombre se llevan al grafo con la presentación de la SEC que los fecha —Kraft Heinz pasa a NYSE en el instante en que NYSE certifica la admisión— y un cambio de ticker que la SEC no fecha se rechaza con nombre ([ADR 0013](docs/architecture/adr/0013-listing-events-dated-evidence.md)). Las adquisiciones y los cambios de ticker se declaran con evidencia ([ADR 0014](docs/architecture/adr/0014-declared-corporate-events.md)). La ingesta es manual, por ticker o como job durable con lease y reanudación ([ADR 0015](docs/architecture/adr/0015-durable-ingestion-jobs.md)), y guarda cinco ejercicios de historia más el cierre base ([ADR 0017](docs/architecture/adr/0017-sec-history-window.md)) en filas que no repiten lo que se puede reconstruir, a la mitad del tamaño anterior ([ADR 0018](docs/architecture/adr/0018-lighter-observation-rows.md)). La historia que una selección anterior dejó fuera de esa ventana se borra con una poda que deja registrado, por sujeto, hasta dónde llegaba lo que se borró ([ADR 0019](docs/architecture/adr/0019-observation-history-prune.md)). Cada fuente tiene además un presupuesto diario contado en PostgreSQL y un kill switch del owner, aplicados en la única puerta de salida y compartidos por todos los procesos ([ADR 0020](docs/architecture/adr/0020-source-daily-budget-kill-switch.md)). Mantener eso fresco cuesta un request por filer y por vuelta: el refresh le pregunta a `submissions` si apareció una presentación relevante nueva y sólo entonces vuelve a bajar, sobre el conjunto que se define solo —los filers que ya tienen fundamentals publicados— y contra una marca de agua propia que avanza aunque la presentación no publique ningún hecho ([ADR 0021](docs/architecture/adr/0021-refresh-followed-set.md) y [ADR 0022](docs/architecture/adr/0022-companyfacts-refresh-probe.md)). Y para que todo eso no dependa de que un fixture sintético siga pareciéndose al cable, el oráculo de regresión incorpora **extractos reales congelados**: seis filers cuyos submissions y companyfacts se bajaron una vez, se redujeron por una versión declarada y quedaron fijados por `sha256`, con números que se reconcilian contra el filing —los US$ 391.035 millones del 10-K de Apple, el EPS de NVIDIA pasando de 12,05 a 1,21 por el 10:1— ([ADR 0023](docs/architecture/adr/0023-frozen-sec-extracts-rights.md)). Con eso cierra el último casillero de la Fase 2; queda su gate: 30 empresas de arquetipos distintos reconciliadas contra su filing.

Disponible hoy:

- Next.js con App Router, React y TypeScript estricto.
- Shell responsive con navegación sólo a superficies implementadas.
- Health seguro de configuración para los modos `locked` y `personal`, con estados honestos y headers base.
- Schema y migraciones Drizzle con rollback pareado, y composición que falla cerrada cuando el runtime no puede servir datos.
- Registro de fuentes fail-closed por derecho, corridas de ingesta append-only y un provider sintético determinista.
- Egress único con allowlist por fuente, defensa SSRF, ritmo de 2 requests/s y presupuesto por corrida.
- Universo S&P 500 constituido desde fuentes reales, con issuer, security, listing, símbolo vigente y CIK separados.
- Ingesta de companyfacts de la SEC con disponibilidad desde la aceptación, vintages, re-expresiones y presentaciones como eventos inmutables, recortada a una ventana de cinco ejercicios anclada en el último ejercicio del filer.
- Jobs durables de ingesta con lease por fuente, cursor, poison policy y recuperación manual.
- Splits verificados contra la SEC y lectura de series por acción en la última base conocible, con cada re-expresión clasificada como split o restatement.
- Identidad separada en entidad legal, security, listing y símbolo, con programas depositarios y consultas `as_known` sin look-ahead.
- Motor FCFF base en dominio puro con política decimal, policy checks, sensibilidad WACC/g y corridas reproducibles por hash.
- Corrida de referencia navegable en `/valuacion/referencia`, con provenance, freshness, supuestos, sensibilidad accesible y policy checks.
- Gate E2E y de accesibilidad sobre el artefacto servido, en escritorio, mobile, tema oscuro y movimiento reducido.
- Variables de entorno documentadas sin credenciales reales.
- Tests unitarios, lint, typecheck, formato, build y CI mínima.
- Límites de módulos preparados para crecer sin mezclar dominio, framework y proveedores.
- PRD, arquitectura ejecutable, registro inicial de fuentes y metodología de valuación derivados del masterplan.
- Backlog ejecutable con dependencias, criterios de aceptación y trazabilidad de riesgos y deuda visual.

Todavía no están implementados el refresh programado, los datos de mercado, las matrices sectoriales, el tablero argentino ni las funciones de IA, y ninguna superficie de la interfaz expone aún la ingesta, la identidad ni la valuación: esos módulos existen como dominio y persistencia, no como pantallas. Esas capacidades se incorporarán por slices verificables; la interfaz no las presenta como disponibles antes de tiempo.

## Experiencia objetivo

| Área          | Capacidad prevista                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| Empresas      | Buscar y filtrar por ratios actuales e históricos de 2 y 5 años.                                              |
| CEDEAR        | Identificar programas vigentes, subyacentes y ratios de conversión historizados.                              |
| Divergencias  | Comparar crecimiento de market cap vs. net income y precio vs. EPS, incluyendo recompras y dilución.          |
| Valuación     | Ejecutar modelos deterministas con escenarios, sensibilidad, supuestos editables y fuentes.                   |
| Argentina     | Seguir inflación, actividad, liquidez, tipo de cambio, sector externo y soja con fuentes oficiales.           |
| Investigación | Usar IA únicamente para evidencia, clasificación y explicación; nunca para realizar la aritmética financiera. |

## Principios del producto

1. Todo dato importante debe mostrar fuente, fecha, unidad, moneda y calidad.
2. Los valores faltantes permanecen como `null`; nunca se convierten silenciosamente en cero.
3. Las fórmulas financieras son puras, deterministas, versionadas y cubiertas por tests.
4. Empresa, entidad legal, instrumento, listing, ticker y programa depositario son identidades distintas.
5. Las consultas históricas respetan `available_at`, vintages y restatements para evitar look-ahead.
6. Una falla de proveedor degrada un módulo sin reemplazar el último snapshot válido.
7. No hay demo pública: un runtime que no prueba ser privado se traba en vez de servir datos de reemplazo. Los datos y claves reales pertenecen únicamente al owner.

## Stack

### Implementado

- Next.js 16 con App Router y React Server Components por defecto.
- React 19 y TypeScript estricto.
- Tailwind CSS 4.
- Zod para validación en fronteras.
- Drizzle ORM y Postgres.js para schema, migraciones y runtime personal pooled.
- Vitest para tests unitarios.
- ESLint, Prettier y GitHub Actions.
- pnpm con lockfile reproducible.

### Incorporación planificada

- shadcn/ui, Recharts y TanStack Table para la experiencia financiera.
- Adaptadores reemplazables para SEC, mercado, CEDEAR y macroeconomía argentina.
- Vercel AI SDK y OpenRouter, solo después de implementar presupuestos, trazabilidad y controles de datos.

## Arquitectura

El producto evoluciona como un monolito modular. Las páginas componen casos de uso; el dominio calcula; la infraestructura conecta almacenamiento y proveedores.

```text
Browser
  -> Next.js App Router
       -> Server Components / Route Handlers
          -> Application services
             -> Pure domain
             -> Provider ports
             -> Repositories
                -> PostgreSQL
```

Reglas centrales:

- El dominio no importa React, Next.js, ORM ni SDKs de proveedores.
- Los Server Components llaman servicios de aplicación directamente, sin fetch HTTP interno.
- Las páginas leen snapshots persistidos; nunca llaman proveedores durante el render.
- El acceso a secretos, base de datos, proveedores e IA permanece server-only.
- `DATABASE_URL` es la conexión pooled de runtime; `DATABASE_DIRECT_URL` queda reservada a migraciones controladas.
- Next.js 16 usa Cache Components como capa derivada; Postgres sigue siendo la fuente durable.

La decisión y sus reglas de invalidación, pooling y migraciones están en [ADR 0001](docs/architecture/adr/0001-stack-cache-postgres.md).

Estructura actual:

```text
src/
  app/                          # rutas y composición web
  modules/
    configuration/
      domain/                   # health puro y testeable
    persistence/                # contrato, port y dobles de test en memoria
  server/
    config/                     # lectura server-only del entorno
    db/                         # schema, cliente pooled y adapter Drizzle
    persistence/                # composición por modo efectivo
drizzle/                        # migración SQL y metadata versionada
.github/workflows/quality.yml   # quality gate de CI
```

## Ejecución local

### Requisitos

- Node.js `>=22.11.0 <27`.
- pnpm `10.33.2`.

### Instalación

`corepack` hay que instalarlo aparte, porque en el rango de Node soportado falla
de dos maneras distintas y ninguna de las dos es evidente:

- Node 25 y 26 **no lo incluyen**: fue removido del runtime, así que
  `corepack enable` corta con `command not found`.
- El que trae Node `22.11.0` (0.29.4) sí existe pero tiene vencidas las claves de
  firma del registry, y `corepack prepare` corta con `Cannot find matching keyid`.

En ambos casos se resuelve igual:

```bash
npm install -g corepack@latest
```

Después de clonar el repositorio:

```bash
cd finance_portal
corepack enable
corepack prepare pnpm@10.33.2 --activate
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Abrir [http://localhost:3000](http://localhost:3000).

La configuración incluida inicia en `APP_MODE=locked` y
`APP_RUNTIME_ACCESS=public`: no necesita claves ni base, y no sirve datos. Es
una negativa deliberada, no una demo.

## Modos de ejecución

### `locked`

Es el estado por defecto y el único posible para cualquier entorno que no pueda
probar que es privado ([ADR 0004](docs/architecture/adr/0004-personal-first-runtime.md)).

- No necesita API keys ni base de datos.
- No abre PostgreSQL, no consulta proveedores y no sirve ningún dato.
- Ignora cualquier configuración live cargada por error.
- **No es una demo.** No existe un conjunto de datos de reemplazo ni una versión
  reducida del producto: la respuesta es no responder. Sólo queda disponible el
  diagnóstico de `/configuracion`, que es lo que permite salir del estado.

### `personal`

Está reservado al owner y se ejecutará en localhost o detrás de protección de plataforma.

- Usa `APP_RUNTIME_ACCESS=local` fuera de una plataforma de hosting o
  `APP_RUNTIME_ACCESS=protected` en cualquier entorno detrás de la protección de
  la plataforma, producción incluida.
- Requiere una conexión PostgreSQL pooled para el runtime.
- Las integraciones live permanecen deshabilitadas hasta superar sus gates técnicos y de licencia.
- No agrega login, cuentas, roles, multi-tenancy ni claves aportadas por usuarios.

Definir variables en `.env.local` no habilita por sí solo una integración todavía no implementada. Consultar [.env.example](.env.example) para ver el contrato completo sin secretos.

## Comandos

| Comando                                        | Uso                                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                     | Inicia el servidor local con recarga en desarrollo.                                                                                |
| `pnpm build`                                   | Genera y valida el build de producción.                                                                                            |
| `pnpm start`                                   | Sirve un build de producción ya generado.                                                                                          |
| `pnpm lint`                                    | Ejecuta ESLint sin permitir warnings.                                                                                              |
| `pnpm typecheck`                               | Verifica TypeScript sin emitir archivos.                                                                                           |
| `pnpm test`                                    | Ejecuta la suite unitaria una vez.                                                                                                 |
| `pnpm test:integration`                        | Prueba migración y repositorio contra una base PostgreSQL dedicada.                                                                |
| `pnpm test:e2e`                                | Gate E2E y de accesibilidad sobre un build servido en ambos modos.                                                                 |
| `pnpm test:watch`                              | Ejecuta tests en modo interactivo.                                                                                                 |
| `pnpm db:generate`                             | Genera SQL versionado desde el schema Drizzle.                                                                                     |
| `pnpm db:migrate`                              | Aplica migraciones con `DATABASE_DIRECT_URL`.                                                                                      |
| `pnpm db:up`                                   | Inicia el PostgreSQL local con la base personal y la de tests.                                                                     |
| `pnpm db:down`                                 | Detiene PostgreSQL local sin borrar su volumen.                                                                                    |
| `pnpm universe:constitute`                     | Constituye el universo S&P 500; dry run salvo `--apply`.                                                                           |
| `pnpm fundamentals:ingest`                     | Ingiere companyfacts de la SEC por ticker; dry run salvo `--apply`.                                                                |
| `pnpm corporate-actions:record`                | Verifica y registra las sucesiones de emisor declaradas; dry run salvo `--apply`.                                                  |
| `pnpm corporate-actions:splits`                | Verifica y registra los splits de un ticker ya ingerido; dry run salvo `--apply`.                                                  |
| `pnpm corporate-actions:listings`              | Reconcilia traspasos, delistings y renombres con evidencia fechada; dry run salvo `--apply`.                                       |
| `pnpm corporate-actions:declare --file <path>` | Verifica una declaración de adquisición o ticker; dry run salvo `--apply`. [Runbook](docs/runbooks/declared-corporate-events.md).  |
| `pnpm fundamentals:backfill`                   | Planea, crea y corre el backfill durable de companyfacts; dry run salvo `--apply`. [Runbook](docs/runbooks/ingestion-backfill.md). |
| `pnpm ingestion:jobs`                          | Inspecciona jobs y leases; pausa, reanuda, cancela, reencola o libera con `--reason`; dry run salvo `--apply`.                     |
| `pnpm fundamentals:prune`                      | Borra la historia fuera de la ventana y registra la poda; dry run salvo `--apply`. [Runbook](docs/runbooks/history-prune.md).      |
| `pnpm ingestion:sources`                       | Presupuesto diario y kill switch por fuente; dry run salvo `--apply`. [Runbook](docs/runbooks/source-budgets.md).                  |
| `pnpm format:check`                            | Comprueba el formato del repositorio.                                                                                              |
| `pnpm format`                                  | Aplica Prettier a los archivos permitidos.                                                                                         |

Antes de entregar un cambio:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

La misma secuencia se ejecuta en GitHub Actions para pushes a `main` y pull
requests. El gate E2E corre en un job aparte porque necesita compilar y levantar
dos servidores; su procedimiento está en
[`docs/runbooks/e2e-accessibility-gate.md`](docs/runbooks/e2e-accessibility-gate.md).

## Configuración y seguridad

- Nunca guardar credenciales reales en Git ni en variables `NEXT_PUBLIC_*`.
- Mantener `.env.local` fuera del repositorio.
- Producción pública debe permanecer `locked` mientras no exista protección confirmada.
- No enviar payloads financieros, prompts ni documentos privados a terceros sin una política explícita.
- No integrar una fuente antes de revisar uso personal, caché, retención, atribución y exportación.
- No reutilizar datos live capturados como fixtures ni como capturas de pantalla versionadas.

Si una clave se expone, debe revocarse en el proveedor; eliminarla del último commit no borra su historial.

## Datos y metodología

Las integraciones previstas priorizan fuentes primarias y contratos reemplazables:

- SEC EDGAR para identidad, filings y fundamentales de Estados Unidos.
- Caja de Valores y fuentes oficiales del programa CEDEAR.
- BCRA, INDEC/datos.gob.ar, BNA y Bolsa de Comercio de Rosario para Argentina.
- Proveedores de precios y datos con términos compatibles con uso personal y persistencia.
- NYU Stern/Damodaran para datasets y metodología de valuación.

Cada observación persistida conserva provenance, fecha efectiva, fecha de disponibilidad, unidad, moneda, transformación, hash y flags de calidad; las de la SEC, además, la presentación que las publicó ([ADR 0010](docs/architecture/adr/0010-sec-xbrl-ingestion.md)). Los proveedores pueden cambiar sin modificar los contratos del dominio ni la interfaz.

## Despliegue

El destino previsto es Vercel, pero el repositorio todavía no publica una URL de producción.

- No hay ni habrá una URL pública anónima con datos: cualquier entorno que no
  pruebe ser privado queda `locked`.
- La instancia personal con datos reales corre localmente o en un despliegue cuya
  protección se haya verificado fuera de la aplicación: `protected` es una
  declaración del owner, no algo que el runtime pueda comprobar.
- Un despliegue sin acceso declarado queda `locked`. En Vercel Hobby, Standard
  Protection no cubre el dominio de producción, así que ahí la declaración sólo es
  cierta con una protección adicional confirmada.
- El modo se resuelve en cada request, no al compilar
  ([ADR 0005](docs/architecture/adr/0005-request-time-runtime-boundary.md)): un
  build hecho en la máquina del owner no sirve datos al desplegarse en otro lado.
- PostgreSQL se provisionará con pooling para runtime y una conexión directa separada para migraciones.
- Las migraciones se ejecutarán como un job controlado, nunca automáticamente desde cada Function.

## Roadmap y documentación técnica

El avance de fases y la evidencia de cada slice viven en [el roadmap](docs/finance-portal-masterplan/06_PHASED_ROADMAP.md). El orden ejecutable, las dependencias y los criterios de aceptación viven en [el backlog](docs/backlog/README.md). La arquitectura, el modelo de datos, la metodología financiera y los criterios de seguridad están documentados en [docs/finance-portal-masterplan](docs/finance-portal-masterplan/README.md).

Documentos ejecutables actuales:

- [Backlog ejecutable y tracker](docs/backlog/README.md)
- [PRD](docs/product/prd.md)
- [Arquitectura del sistema](docs/architecture/system.md)
- [Registro de fuentes](docs/data/source-registry.md)
- [Matriz de uso personal, cache, retención y cuotas](docs/data/provider-use-matrix.md)
- [Modelo de identidad financiera](docs/data/identity-model.md)
- [Contrato point-in-time](docs/data/point-in-time-contract.md)
- [Metodología de valuación](docs/valuation/methodology.md)
- [Threat model](docs/security/threat-model.md)
- [Fundaciones de interfaz y evidencia](docs/design/interface-foundations.md)
- [Inventario auditado de skills](docs/agent/skills-inventory.md)
- [ADR 0001: stack, cache y PostgreSQL](docs/architecture/adr/0001-stack-cache-postgres.md)
- [ADR 0002: modos, persistencia y exposición](docs/architecture/adr/0002-runtime-modes-persistence-exposure.md)
- [ADR 0003: aritmética decimal del motor de valuación](docs/architecture/adr/0003-decimal-arithmetic-valuation-engine.md)
- [Runbook de migraciones PostgreSQL](docs/runbooks/database-migrations.md)

Los contratos de fuentes, modos, exposición y amenazas ya están registrados sin
aprobar ni conectar proveedores reales. La home es el único wireframe ejecutable;
sus tokens, autoridad y deuda abierta están reconciliados sin simular rutas futuras.
El backlog marca `F1-05` como terminado y `F1-06` como único próximo slice autorizado.

## Desarrollo y colaboración

Antes de proponer cambios, leer [AGENTS.md](AGENTS.md) y el estado actual del roadmap.

- Trabajar sobre un único slice autorizado por vez.
- Mantener una versión ejecutable al cerrar cada cambio.
- Agregar tests de bordes a toda fórmula financiera.
- Documentar cualquier dependencia estructural o proveedor mediante ADR.
- Preservar el alcance single-owner y la separación estricta entre `locked` y `personal`.

## Licencia y derechos de datos

Este repositorio todavía no incluye un archivo de licencia de software. Hasta que se agregue uno explícitamente, no se asumen permisos de reutilización o redistribución.

Los derechos sobre datasets, documentos y marcas pertenecen a sus respectivos titulares. Publicar el código no concede derechos para redistribuir datos obtenidos de proveedores.
