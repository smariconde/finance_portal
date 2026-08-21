# Decisiones, riesgos y fuentes

Investigacion revisada el 20 de agosto de 2026. Los enlaces y condiciones comerciales deben revalidarse al iniciar el repo y antes del lanzamiento.

## Decisiones tomadas

### ADR-001 resumido

| Tema | Decision | Motivo | Revisar cuando |
|---|---|---|---|
| Arquitectura | monolito modular Next.js | deploy simple y limites claros | jobs excedan Functions |
| Runtime | TypeScript/Node en Vercel | una sola toolchain; dominio portable | calculo requiera stack cientifico no viable |
| DB | Postgres serverless + Drizzle | series/lineage/relaciones y SQL | escala analitica lo justifique |
| UI | shadcn + Tailwind | componentes editables y accesibles | no aplica |
| Charts | Recharts/shadcn primero | menor complejidad | scatter real no rinda |
| Table | TanStack Table | filtros/columnas controlables | no aplica |
| IA | Vercel AI SDK + OpenRouter | provider abstraction, streaming y modelos multiples | SLA/costo aconseje directo |
| Research | Tavily acotado | search/extract con dominios | fuentes directas cubran todo |
| Market data | Alpaca Basic para precios EOD personales; SEC para fundamentales | gratis, batching, historico y limites adecuados al owner | terminos, cobertura o cuota cambien |
| Universo | Caja de Valores + snapshot S&P 500 PDDL versionado | fuentes simples, auditables y sin scraping por request | se necesite membership oficial garantizada |
| Identidad | entity/security/listing/depositary separados | CIK, ISIN, FIGI, ticker y CEDEAR identifican niveles distintos | nunca colapsar por conveniencia |
| Tiempo de datos | efectivo + `available_at`/vintage | evita look-ahead y conserva restatements | nunca reemplazar por ultimo valor |
| Acceso | sin auth propia; `personal` local/protegido y `demo` publico con fixtures | un solo owner y codigo publico sin exponer datos/keys | el producto incorpore terceros |
| Persistencia | Postgres durable; cache Next.js derivada | conserva snapshots y preferencias entre sesiones | nunca reemplazar por session storage |
| Valuacion | formulas puras + IA para supuestos | reproducibilidad y control | nunca invertir esta regla |
| Entrega | una fase/slice por sesion con tracker | mantiene version demostrable y evita secciones a medias | excepcion solo con ADR |

## Conocimiento rescatado del repo actual

El repo `portfolio_analyzer` confirma que estas ideas son viables y ya tiene pruebas conceptuales:

- BCRA Estadisticas Monetarias v4 con series, fechas y ajustes;
- balanza comercial INDEC con parser tolerante a layouts;
- dashboard argentino con EMAE, salarios, ITCRM, fiscal, inflacion/REM y liquidez;
- spread soja con Rosario, FX BNA, conversion y control de outliers;
- scanner sectorial/CEDEAR a 2/5 anos;
- valuacion V2 deterministica con FCFF, DDM, residual income, normalizacion ciclica, escenarios y Monte Carlo.

No copiar automaticamente esos modulos Python. Usarlos como inventario de requisitos y fixtures conceptuales; redisenar contratos, fuentes y formulas en TypeScript con la metodologia de este plan.

## Fuentes de plataforma

- Next.js, Backend for Frontend: https://nextjs.org/docs/app/guides/backend-for-frontend
- Next.js, caching/revalidation: https://nextjs.org/docs/app/getting-started/revalidating
- Next.js, Cache Components: https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents
- Next.js, auth y seguridad: https://nextjs.org/docs/app/guides/authentication
- Vercel Functions: https://vercel.com/docs/functions
- Vercel max duration: https://vercel.com/docs/functions/configuring-functions/duration
- Vercel Cron: https://vercel.com/docs/cron-jobs y https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Vercel Storage/Marketplace: https://vercel.com/docs/storage y https://vercel.com/docs/marketplace-storage
- Vercel Queues: https://vercel.com/docs/queues
- Vercel environment variables: https://vercel.com/docs/environment-variables
- Sensitive environment variables: https://vercel.com/docs/environment-variables/sensitive-environment-variables
- Vercel Deployment Protection: https://vercel.com/docs/deployment-protection

Hechos relevantes: Route Handlers son endpoints alcanzables aunque no haya links; Functions no deben asumir filesystem persistente ni memoria compartida; cron llama un endpoint HTTP, usa UTC, no reintenta una falla y comparte limites de Function. Postgres se provisiona mediante Marketplace y el runtime serverless requiere pooling. Vercel Authentication protege previews/deployment URLs en Hobby, pero Standard Protection no cubre el production domain: production permanece en modo demo salvo proteccion confirmada. Para la version Next.js instalada se elige explicitamente Cache Components o el modelo anterior.

## IA e investigacion

- OpenRouter + Vercel AI SDK: https://openrouter.ai/docs/guides/community/vercel-ai-sdk
- Structured outputs: https://openrouter.ai/docs/guides/features/structured-outputs
- Provider routing: https://openrouter.ai/docs/guides/routing/provider-selection
- Zero Data Retention: https://openrouter.ai/docs/guides/features/zdr
- Provider logging/data policies: https://openrouter.ai/docs/guides/privacy/provider-logging/
- Guardrails/budgets: https://openrouter.ai/docs/guides/features/guardrails/overview
- Tavily JS: https://docs.tavily.com/sdk/javascript/quick-start
- Tavily Search: https://docs.tavily.com/documentation/api-reference/endpoint/search

Structured output depende del modelo/provider; usar `require_parameters`, schema estricto y fallback controlado. Aplicar ZDR/data collection por request o guardrail y registrar proveedor/routing efectivo; una env no lo demuestra. Tavily permite filtros de dominio y fechas, pero la app debe conservar fuentes primarias y no tratar su answer sintetica como dato financiero.

## Datos corporativos y mercado

- SEC EDGAR APIs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- SEC Developer Resources/Fair Access: https://www.sec.gov/about/developer-resources
- Alpaca Market Data plans: https://docs.alpaca.markets/us/docs/about-market-data-api
- Alpaca multi-symbol historical bars: https://docs.alpaca.markets/us/reference/stockbars
- Alpaca customer agreement: https://files.alpaca.markets/disclosures/library/AcctAppMarginAndCustAgmt.pdf
- DataHub S&P 500 dataset/PDDL: https://github.com/datasets/s-and-p-500-companies
- Finviz Elite/API: https://finviz.com/elite
- Finviz API limits and usage: https://finviz.com/knowledge-base/market-data-research/api/usage-limits
- FMP docs: https://site.financialmodelingprep.com/developer/docs
- FMP terms: https://site.financialmodelingprep.com/developer/docs/terms-of-service
- Twelve Data fundamentals: https://twelvedata.com/fundamentals
- Twelve Data commercial use: https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage
- Financial Datasets: https://www.financialdatasets.ai/ y https://www.financialdatasets.ai/pricing
- Financial Datasets terms: https://www.financialdatasets.ai/terms-of-use
- Intrinio pricing/licensing: https://intrinio.com/pricing

SEC ofrece submissions y XBRL/companyfacts sin API key y bulk nightly, pero no soporta CORS directo y exige Fair Access. Alpaca Basic publica 200 requests/minuto, mas de siete anos de historico y barras multi-symbol; se usa solo en modo personal, con un limite interno menor y cache Postgres. El plan concreto debe permitir la retencion implementada. Finviz gratuito queda como validacion manual: la API oficial pertenece a Elite, limita frecuencia y no es fuente automatizada del portal. FMP/Twelve Data permanecen como alternativas si Alpaca no cubre un caso, no como agregadores llamados en paralelo.

## Identidad y calidad XBRL

- SEC ticker/CIK mappings: https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
- SEC IFRS taxonomy: https://www.sec.gov/data-research/standard-taxonomies/ifrs-taxonomy
- OpenFIGI API: https://www.openfigi.com/api/documentation
- Arelle: https://github.com/Arelle/Arelle
- DQC US Rules: https://github.com/DataQualityCommittee/dqc_us_rules/releases

SEC advierte que sus asociaciones ticker/CIK no garantizan exactitud o alcance. OpenFIGI ayuda a reconciliar instrumentos, no reemplaza fuentes oficiales ni revision de ambiguedades. Arelle/EFM y DQC sirven como oracle de validacion semantica de muestras XBRL; Zod solo cubre el contrato JSON.

## CEDEAR y Argentina

- Caja de Valores, listado CEDEAR/ratios: https://cajadevalores.com.ar/Servicios/Cedears
- Banco Comafi, programas: https://www.comafi.com.ar/Programas-CEDEARs-2483.note.aspx
- BYMA CEDEAR: https://www.byma.com.ar/productos/productos-financieros/cedears
- BCRA APIs: https://www.bcra.gob.ar/apis-banco-central/
- Portal y manual vigente de Estadisticas Monetarias v4: https://www.bcra.gob.ar/apis-banco-central/
- API Series de Tiempo Argentina: https://www.argentina.gob.ar/datos-abiertos/api-series-de-tiempo
- Camara Arbitral/BCR pizarra: https://www.cac.bcr.com.ar/es/precios-de-pizarra
- BCR mercado disponible: https://www.bcr.com.ar/es/mercados/mercado-de-granos/cotizaciones/cotizaciones-locales/mercado-fisico-de-rosario
- MAGyP historicos de precios camara: https://www.magyp.gob.ar/sitio/areas/ss_mercados_agropecuarios/areas/granos/

Estadisticas Monetarias v4 es la API vigente a usar; no confundirla con Principales Variables v3, deprecada el 28/02/2026. El catalogo real manda sobre IDs hardcodeados. CEDEAR ratios deben historizarse porque cambian. La pizarra Rosario se publica en ARS/t y su conversion informativa usa BNA comprador.

## Regulacion, privacidad y accesibilidad

- Ley de Mercado de Capitales 26.831: https://www.argentina.gob.ar/normativa/nacional/ley-26831-206592/actualizacion
- Agentes asesores CNV: https://www.argentina.gob.ar/normativa/recurso/219405/TituloVII-CapV/htm
- Proteccion de datos personales: https://www.argentina.gob.ar/aaip/datospersonales
- Transferencias internacionales: https://www.argentina.gob.ar/transferencias-internacionales
- WCAG 2.2: https://www.w3.org/TR/WCAG22/

La instancia es una herramienta personal sin ejecucion de operaciones ni servicio a terceros. Publicar el codigo no publica los datos. Si se habilita una URL anonima con datos live, se reabre antes el gate contractual y regulatorio; mientras tanto la demo usa fixtures. Prompts y telemetria entran en un data map minimo con retencion, borrado y terceros. El objetivo accesible sigue siendo WCAG 2.2 AA.

## Damodaran y valuacion

- Portal/clase de valuacion: https://pages.stern.nyu.edu/~adamodar/New_Home_Page/equity.html
- Materiales y model chooser: https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valuation/val.htm
- Spreadsheets por metodo: https://pages.stern.nyu.edu/~adamodar/New_Home_Page/eqspread.htm
- Numbers and Narrative: https://pages.stern.nyu.edu/~adamodar/New_Home_Page/numbers%26narrative.htm
- Normalizing earnings: https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valquestions/normearn.htm
- Commodity value drivers: https://pages.stern.nyu.edu/adamodar/New_Home_Page/littlebook/commodityvaluedrivers.htm
- Financial services value drivers: https://pages.stern.nyu.edu/adamodar/New_Home_Page/littlebook/bankvaluedriver.htm
- Current datasets: https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html
- Country risk premiums: https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html
- Historical implied ERP: https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histimpl.html

Principios incorporados: metodo segun empresa/lifecycle; normalizacion a lo largo de un ciclo; excess return para financieras; conexion narrativa-numeros; riesgo, reinversion y terminal coherentes; ERP/CRP con fecha.

## Skills y operacion del agente

- skills.sh docs: https://www.skills.sh/docs
- skills CLI: https://www.skills.sh/docs/cli
- Vercel Next skills: https://github.com/vercel-labs/next-skills
- Vercel React best practices: https://www.skills.sh/vercel-labs/agent-skills/react-best-practices
- Vercel AI SDK skill: https://github.com/vercel/ai/blob/main/skills/use-ai-sdk/SKILL.md

El CLI soporta instalacion por skill y lockfile. La documentacion de skills.sh dice expresamente que no garantiza todos los paquetes: revisar antes de instalar y preferir fuentes oficiales/versionadas.

## Riesgos abiertos

1. Confirmacion de uso personal, retencion/cache y exportacion en el plan Alpaca concreto.
2. Feed estable/licenciado de Chicago y politica de contrato continuo.
3. Cobertura de foreign filers/ADRs y reconciliacion IFRS/US-GAAP.
4. MEP/CCL con fuente contractual, no agregador fragil.
5. Precision/frescura real de CEDEAR downloads y cambios de ratio.
6. Resolucion de identidad y corporate actions entre CIK/ISIN/FIGI/ticker/ADR/CEDEAR.
7. Modelo point-in-time para filings restated y series macro revisadas.
8. Exposicion accidental de datos live al usar un production domain no protegido.
9. Privacidad y transferencias internacionales de IA/telemetria del owner.
10. Freshness y exactitud del snapshot S&P 500 no oficial.
11. Region optima DB/Functions medida con el owner y proveedores reales.
12. Limites/costos del plan Vercel y mecanismo durable de refresh elegido.

Estos puntos tienen ADR/spike antes de convertirse en dependencia productiva.
