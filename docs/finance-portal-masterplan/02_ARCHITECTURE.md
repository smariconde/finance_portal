# Arquitectura propuesta

## Decision principal

Un monolito modular Next.js para un solo owner, con PostgreSQL como almacenamiento y cache durable. Puede ejecutarse localmente o en un deployment Vercel protegido. El mismo repositorio ofrece un modo demo con fixtures, sin secretos ni acceso a proveedores.

```text
Browser
  -> Next.js App Router
       -> Server Components (lecturas y composicion)
       -> Route Handlers (API, cron, IA streaming)
       -> Server Actions (mutaciones UI)
          -> Application services
             -> Pure domain (ratios, growth, valuation, policies)
             -> Provider ports
                -> SEC / market data / BCRA / INDEC / CEDEAR / Tavily / OpenRouter
             -> Repositories
                -> Postgres
```

## Estructura sugerida

```text
src/
  app/
    (portal)/
    api/
  components/
    ui/
    charts/
  modules/
    companies/
      domain/
      application/
      infrastructure/
      ui/
    screeners/
    growth-gap/
    valuation/
    argentina/
    research/
  server/
    db/
    providers/
    ai/
    observability/
    security/
  shared/
    domain/
    contracts/
    utils/
drizzle/
tests/
  fixtures/
  contract/
  e2e/
docs/
.agents/skills/
```

`domain/` no importa React, Next, Drizzle ni SDKs externos. `infrastructure/` implementa ports. `ui/` consume DTOs de aplicacion, no respuestas crudas.

## Contratos centrales

```ts
type Provenance = {
  sourceId: string;
  sourceUrl?: string;
  asOf: string;
  availableAt: string;
  reportedAt?: string;
  filedAt?: string;
  acceptedAt?: string;
  fetchedAt: string;
  unit: string;
  currency?: string;
  period?: "instant" | "quarter" | "annual" | "ttm" | "daily" | "monthly";
  vintage?: string;
  restatementOf?: string;
  originalConcept?: string;
  taxonomyVersion?: string;
  transformationId?: string;
  transformationVersion?: string;
  contentHash: string;
  qualityFlags: string[];
  ingestionRunId: string;
};

type Observation = {
  value: string | null;
  rawValue: string | null;
  rawValueStatus: "stored" | "not_provided" | "license_restricted";
  provenance: Provenance;
};

interface FundamentalsProvider {
  searchCompanies(query: string): Promise<CompanyRef[]>;
  getStatements(symbol: string, options: PeriodOptions): Promise<StatementSet>;
  getMetrics(symbol: string, options: PeriodOptions): Promise<MetricSeries[]>;
}

interface MarketDataProvider {
  getPriceHistory(symbol: string, range: DateRange): Promise<PricePoint[]>;
  getMarketCapHistory(symbol: string, range: DateRange): Promise<MarketCapPoint[]>;
}

interface MacroSeriesProvider {
  listSeries(): Promise<SeriesDefinition[]>;
  getSeries(id: string, range: DateRange): Promise<MacroObservation[]>;
}
```

Los schemas Zod reales son la fuente de verdad de runtime. Los tipos anteriores expresan la intencion.

`availableAt` define desde cuando una observacion podia conocerse y evita look-ahead. Un recalculo historico consulta por esa fecha, no por el ultimo valor restated disponible. `rawValue` siempre tiene estado explicito: una restriccion contractual no se representa omitiendo el campo.

## Limite web/backend

- Server Components llaman application services directamente.
- Route Handlers existen para clientes externos, interaccion client-side, cron o streaming.
- Server Actions mutan watchlists, configuracion o supuestos; no se usan para lecturas generales porque se serializan/encolan.
- Route Handlers y Server Actions siguen siendo endpoints alcanzables por red: Zod, limites de payload y errores seguros en cada frontera. El modo personal confia en localhost o en la proteccion del deployment, no en un sistema de cuentas propio.
- En modo `demo`, los endpoints de proveedor, ingesta, mutacion e IA quedan deshabilitados aunque alguien conozca su URL.
- Una API para terceros requiere versionado, politica de compatibilidad y ADR; hasta entonces, `/api/*` es BFF interno sin promesa publica.
- Toda importacion de DB, API key o proveedor comienza con `import "server-only"`.
- DTOs de salida minimizan campos y remueven secretos y prompts internos. El modo demo nunca sirve payloads capturados del modo personal.

## Persistencia minima

- `source_registry`: fuente, owner, URL, licencia, redistribucion, auth, SLA esperado.
- `ingestion_runs`: fuente, version de parser, estado, cursor, counts, errores, timestamps.
- `legal_entities`: emisor/filer con nombre legal, CIK/LEI cuando exista y vigencia.
- `securities`: clase o instrumento emitido, tipo, ISIN/FIGI cuando exista y moneda economica.
- `listings`: security, MIC/exchange, moneda de cotizacion y vigencia.
- `security_identifiers`: identificador, tipo, valor, fuente y `valid_from/valid_to`; los tickers no son claves estables.
- `depositary_programs`: CEDEAR/ADR, security depositaria, subyacente, depositario, alcance y vigencia.
- `depositary_ratios`: numerador/denominador exactos, anuncio, `valid_from/valid_to` y snapshot fuente.
- `corporate_actions`: split, reverse split, cambio de ticker, merger, spin-off y ajustes aplicados.
- `company_snapshots`: perfil y clasificacion con `valid_from/valid_to`.
- `financial_facts`: metrica canonica, periodo, valor, unidad, moneda y provenance.
- `market_cap_points` y `price_points`: series normalizadas.
- `macro_series` y `macro_observations`.
- `source_documents`: URL, hash, fecha de publicacion/extraccion y metadata.
- `valuation_runs`: input snapshot, engine version, method, status y result JSON.
- `valuation_assumptions`: valor, origen, evidencia, override y validaciones.
- `research_evidence`: fragmento pequeno, titulo, URL, fecha y hash.
- `app_settings`, `saved_views` y `watchlists`: estado opcional del unico owner, sin `user_id` ni aislamiento multi-tenant.

Usar claves naturales solo para lookup. Las relaciones internas usan IDs estables porque tickers, listings, ratios CEDEAR y nombres cambian. OpenFIGI puede reconciliar identificadores como fuente secundaria; una coincidencia automatica ambigua exige revision.

Las tablas revisables conservan tiempo efectivo (`valid_from/valid_to`) y tiempo de conocimiento (`available_at/superseded_at`). No sobreescribir un filing, serie macro o mapping historico al recibir una revision.

## Ingesta y caching

- Request path: leer siempre Postgres; no consultar un proveedor durante el render de una pagina.
- Refresh: accion explicita del owner o job programado que escribe staging y publica atomicamente.
- Cron: descargar, validar, guardar staging, comparar y publicar atomicamente.
- Cada job es idempotente por `(source, dataset, as_of, parser_version)`.
- Backfills y refresh de universo usan lotes acotados, cursor persistido, lease/claim, heartbeat y checkpoint. Nunca recorren todo el universo dentro de una request de usuario.
- Guardar ultimo snapshot valido. Un parser roto no reemplaza datos buenos por vacio.
- Vercel Cron dispara el scheduler, no constituye una cola. Para Fase 2 elegir mediante ADR entre job table durable, Vercel Workflow/Queues u otra alternativa; exigir entrega at-least-once, idempotencia, poison-message policy y recuperacion manual. No depender de una beta sin fallback.
- Freshness inicial: precios EOD una vez despues del cierre; SEC al detectar filing nuevo; CEDEAR semanal o ante anuncio; BCRA/BNA/BCR diario; Damodaran mensual o ante nueva publicacion. No se ofrece tiempo real.

Postgres conserva snapshots entre navegadores y sesiones. El cache de Next.js es una capa derivada y descartable: se elige un solo modelo para la version instalada y cada lectura declara freshness e invalidacion. `localStorage` se limita a preferencias visuales y borradores; claves y datos financieros autoritativos permanecen en servidor. `sessionStorage` no es persistencia.

La decision ejecutable vive en [`../architecture/adr/0001-stack-cache-postgres.md`](../architecture/adr/0001-stack-cache-postgres.md): Next.js 16 usa Cache Components, las descargas de proveedores no dependen de esa cache y el runtime separa estrictamente la URL pooled de la conexion directa de migraciones.

## Escalabilidad sin sobreingenieria

Extraer un worker cuando una ingesta no quepa de forma confiable en el limite de Function, necesite fan-out/retries fuertes o consuma CPU sostenida. Opciones futuras: QStash, Inngest, DBOS o Vercel Workflow, evaluadas con una ADR. No introducir Kafka, Kubernetes ni una segunda base para el MVP.

## Regiones

Elegir la region de Functions junto con la region del Postgres. Como hay un solo owner, priorizar cercania a la base y proveedores; la latencia global no es un requisito.

El runtime usa una URL con connection pooling compatible con serverless. Migraciones y tareas administrativas usan una conexion directa separada y controlada; ninguna Function abre pools sin limite.
