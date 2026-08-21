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

El proyecto se encuentra en **Fase 0 — Fundación**. El bootstrap técnico está terminado y la aplicación ya puede ejecutarse localmente.

Disponible hoy:

- Next.js con App Router, React y TypeScript estricto.
- Interfaz inicial responsive con tema claro y oscuro.
- Health seguro de configuración para los modos `demo` y `personal`.
- Variables de entorno documentadas sin credenciales reales.
- Tests unitarios, lint, typecheck, formato, build y CI mínima.
- Límites de módulos preparados para crecer sin mezclar dominio, framework y proveedores.
- PRD, arquitectura ejecutable, registro inicial de fuentes y metodología de valuación derivados del masterplan.

Todavía no están implementados los datos financieros, el screener, las valuaciones, el tablero argentino ni las funciones de IA. Esas capacidades se incorporarán por slices verificables; la interfaz no las presenta como disponibles antes de tiempo.

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
7. La demo pública usa fixtures; los datos y claves reales pertenecen únicamente al owner.

## Stack

### Implementado

- Next.js 16 con App Router y React Server Components por defecto.
- React 19 y TypeScript estricto.
- Tailwind CSS 4.
- Zod para validación en fronteras.
- Vitest para tests unitarios.
- ESLint, Prettier y GitHub Actions.
- pnpm con lockfile reproducible.

### Incorporación planificada

- PostgreSQL serverless y Drizzle ORM para persistencia durable.
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
  server/
    config/                     # lectura server-only del entorno
.github/workflows/quality.yml   # quality gate de CI
```

## Ejecución local

### Requisitos

- Node.js `>=22.11.0 <27`.
- pnpm `10.33.2`.

### Instalación

Después de clonar el repositorio:

```bash
cd finance_portal
corepack enable
corepack prepare pnpm@10.33.2 --activate
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

En PowerShell, copiar el entorno con:

```powershell
Copy-Item .env.example .env.local
```

Abrir [http://localhost:3000](http://localhost:3000).

La configuración incluida inicia en `APP_MODE=demo` y no necesita claves de proveedores.

## Modos de ejecución

### `demo`

Es el modo seguro por defecto y el único apropiado para una URL pública anónima.

- No necesita API keys.
- Ignora cualquier configuración live cargada por error.
- No habilita ingestas, IA ni mutaciones persistentes.
- Usará exclusivamente fixtures deterministas cuando se incorporen en la siguiente fase.

### `personal`

Está reservado al owner y se ejecutará en localhost o detrás de protección de plataforma.

- Requiere una conexión PostgreSQL pooled para el runtime.
- Las integraciones live permanecen deshabilitadas hasta superar sus gates técnicos y de licencia.
- No agrega login, cuentas, roles, multi-tenancy ni claves aportadas por usuarios.

Definir variables en `.env.local` no habilita por sí solo una integración todavía no implementada. Consultar [.env.example](.env.example) para ver el contrato completo sin secretos.

## Comandos

| Comando             | Uso                                                 |
| ------------------- | --------------------------------------------------- |
| `pnpm dev`          | Inicia el servidor local con recarga en desarrollo. |
| `pnpm build`        | Genera y valida el build de producción.             |
| `pnpm start`        | Sirve un build de producción ya generado.           |
| `pnpm lint`         | Ejecuta ESLint sin permitir warnings.               |
| `pnpm typecheck`    | Verifica TypeScript sin emitir archivos.            |
| `pnpm test`         | Ejecuta la suite unitaria una vez.                  |
| `pnpm test:watch`   | Ejecuta tests en modo interactivo.                  |
| `pnpm format:check` | Comprueba el formato del repositorio.               |
| `pnpm format`       | Aplica Prettier a los archivos permitidos.          |

Antes de entregar un cambio:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

La misma secuencia se ejecuta en GitHub Actions para pushes a `main` y pull requests.

## Configuración y seguridad

- Nunca guardar credenciales reales en Git ni en variables `NEXT_PUBLIC_*`.
- Mantener `.env.local` fuera del repositorio.
- Producción pública debe permanecer en modo `demo` mientras no exista protección confirmada.
- No enviar payloads financieros, prompts ni documentos privados a terceros sin una política explícita.
- No integrar una fuente antes de revisar uso personal, caché, retención, atribución y exportación.
- No reutilizar datos live capturados como fixtures de la demo pública.

Si una clave se expone, debe revocarse en el proveedor; eliminarla del último commit no borra su historial.

## Datos y metodología

Las integraciones previstas priorizan fuentes primarias y contratos reemplazables:

- SEC EDGAR para identidad, filings y fundamentales de Estados Unidos.
- Caja de Valores y fuentes oficiales del programa CEDEAR.
- BCRA, INDEC/datos.gob.ar, BNA y Bolsa de Comercio de Rosario para Argentina.
- Proveedores de precios y datos con términos compatibles con uso personal y persistencia.
- NYU Stern/Damodaran para datasets y metodología de valuación.

Cada observación persistida deberá conservar provenance, fecha efectiva, fecha de disponibilidad, unidad, moneda, transformación, hash y flags de calidad. Los proveedores pueden cambiar sin modificar los contratos del dominio ni la interfaz.

## Despliegue

El destino previsto es Vercel, pero el repositorio todavía no publica una URL de producción.

- Una demo pública deberá ejecutarse con `APP_MODE=demo` y fixtures.
- La instancia personal con datos reales deberá ejecutarse localmente o en un deployment protegido.
- PostgreSQL se provisionará con pooling para runtime y una conexión directa separada para migraciones.
- Las migraciones se ejecutarán como un job controlado, nunca automáticamente desde cada Function.

## Roadmap y documentación técnica

El avance operativo y la evidencia de cada slice viven en [el roadmap](docs/finance-portal-masterplan/06_PHASED_ROADMAP.md). La arquitectura, el modelo de datos, la metodología financiera y los criterios de seguridad están documentados en [docs/finance-portal-masterplan](docs/finance-portal-masterplan/README.md).

Documentos ejecutables actuales:

- [PRD](docs/product/prd.md)
- [Arquitectura del sistema](docs/architecture/system.md)
- [Registro de fuentes](docs/data/source-registry.md)
- [Modelo de identidad financiera](docs/data/identity-model.md)
- [Contrato point-in-time](docs/data/point-in-time-contract.md)
- [Metodología de valuación](docs/valuation/methodology.md)
- [ADR 0001: stack, cache y PostgreSQL](docs/architecture/adr/0001-stack-cache-postgres.md)

La siguiente entrega autorizada registrará la matriz de uso personal, cache, retención y cuotas antes de cualquier spike técnico. No se conectará un proveedor real antes de aprobar contratos y fixtures.

## Desarrollo y colaboración

Antes de proponer cambios, leer [AGENTS.md](AGENTS.md) y el estado actual del roadmap.

- Trabajar sobre un único slice autorizado por vez.
- Mantener una versión ejecutable al cerrar cada cambio.
- Agregar tests de bordes a toda fórmula financiera.
- Documentar cualquier dependencia estructural o proveedor mediante ADR.
- Preservar el alcance single-owner y la separación estricta entre `demo` y `personal`.

## Licencia y derechos de datos

Este repositorio todavía no incluye un archivo de licencia de software. Hasta que se agregue uno explícitamente, no se asumen permisos de reutilización o redistribución.

Los derechos sobre datasets, documentos y marcas pertenecen a sus respectivos titulares. Publicar el código no concede derechos para redistribuir datos obtenidos de proveedores.
