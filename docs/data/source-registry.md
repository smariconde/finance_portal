# Registro de fuentes

- Estado: contrato documental inicial; ningún proveedor real está integrado
- Versión: 0.1
- Fecha de revisión técnica: 2026-08-21
- Próximo gate relacionado: matriz de uso personal, cache, retención y cuotas

## Propósito

Este registro identifica datasets y proveedores antes de que se conviertan en una
dependencia del producto. Separa viabilidad técnica de autorización contractual:
que una URL sea pública o que un endpoint responda no prueba que el plan concreto
permita automatización, persistencia, exportación o exposición a una IA.

Las filas de este documento son candidatas. Ninguna tiene estado
`approved_for_spike` o `active`; por lo tanto, este registro no autoriza llamadas,
creación de cuentas, uso de credenciales, compras ni persistencia de payloads.

## Estados

### Estado técnico

- `proposed`: fuente identificada, todavía sin revisión primaria actual.
- `technical_reviewed`: documentación primaria, dataset o endpoint comprobado.
- `spike_ready`: contrato técnico, schema esperado y fixture planificada.
- `integrated`: adaptador y contract tests aprobados para la fase activa.
- `suspended`: integración detenida por schema, calidad, licencia o seguridad.

### Estado de aprobación

- `rights_unreviewed`: no se revisó el plan o aviso legal aplicable.
- `rights_review_pending`: existe evidencia inicial, pero faltan condiciones
  concretas de automatización, cache, retención, derivados o exportación.
- `approved_for_spike`: el owner aprobó una prueba pequeña y su presupuesto.
- `approved_personal`: permitido para la instancia personal dentro de límites
  registrados.
- `approved_public_demo`: permitido para una demo anónima; por defecto ningún
  dataset live recibe este estado.
- `rejected`: no cumple derechos, cobertura, calidad, costo o seguridad.

El estado técnico no eleva el estado de aprobación automáticamente.

## Schema requerido

Cada entrada ejecutable del futuro `source_registry` debe contener como mínimo:

```ts
type SourceRegistryEntry = {
  sourceId: string;
  displayName: string;
  owner: string;
  canonicalUrl: string;
  documentationUrls: string[];
  datasets: string[];
  endpoints: string[];
  authentication: "none" | "api_key" | "account" | "other";
  applicablePlan: string | null;
  rateLimit: string | null;
  attribution: string | null;
  expectedCadence: string;
  freshnessTarget: string;
  timezone: string | null;
  units: string[];
  currencies: string[];
  parserVersion: string | null;
  fixturePolicy: string;
  fallbackSourceIds: string[];
  rights: {
    personalUse: "unknown" | "allowed" | "restricted";
    automatedAccess: "unknown" | "allowed" | "restricted";
    rawStorage: "unknown" | "allowed" | "restricted";
    normalizedStorage: "unknown" | "allowed" | "restricted";
    derivedStorage: "unknown" | "allowed" | "restricted";
    publicDisplay: "unknown" | "allowed" | "restricted";
    export: "unknown" | "allowed" | "restricted";
    aiTransfer: "unknown" | "allowed" | "restricted";
  };
  technicalStatus: string;
  approvalStatus: string;
  reviewedAt: string | null;
  reviewEvidence: string[];
  ownerNotes: string;
};
```

`unknown` falla cerrado. No equivale a permiso. Si el raw no puede persistirse,
las observaciones usan `raw_value_status=license_restricted` y conservan hash,
identificador y transformación permitidos; nunca se omite el hecho silenciosamente.

## Inventario prioritario

| Source ID                 | Dataset y uso previsto                                  | Fase | Estado técnico       | Aprobación              | Observaciones                                                                                                         |
| ------------------------- | ------------------------------------------------------- | ---- | -------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `sec-edgar`               | identidad CIK, submissions, filings y XBRL/companyfacts | 2    | `technical_reviewed` | `rights_review_pending` | APIs JSON sin key y bulk nocturno; requiere User-Agent responsable, Fair Access y validación semántica de muestra     |
| `caja-valores-cedear`     | listado, ISIN, subyacente, ratio y alcance CEDEAR       | 2    | `technical_reviewed` | `rights_review_pending` | la página oficial publica campos útiles y descarga; faltan condiciones de automatización, cache e historial           |
| `datahub-sp500-pddl`      | snapshot versionado del universo de desarrollo          | 2    | `technical_reviewed` | `rights_review_pending` | el paquete declara PDDL, se actualiza desde Wikipedia y no prueba membresía oficial; pin obligatorio por hash/fecha   |
| `alpaca-market-data`      | precios y barras históricas EOD del modo personal       | 2    | `technical_reviewed` | `rights_review_pending` | candidato, no integración; plan Basic y retención deben revisarse antes del spike                                     |
| `bcra-monetarias-v4`      | catálogo, observaciones y metodología monetaria         | 6    | `technical_reviewed` | `rights_review_pending` | v4 es la versión vigente publicada; la antigua Principales Variables v3 figura deprecada desde 2026-02-28             |
| `argentina-series-tiempo` | indicadores oficiales de distintos organismos           | 6    | `technical_reviewed` | `rights_review_pending` | catálogo dinámico, metadata y transformaciones requieren revisión por serie                                           |
| `bna-fx`                  | cotización divisa comprador/vendedor e histórico        | 6    | `technical_reviewed` | `rights_review_pending` | fuente de referencia para conversiones; timezone, calendario y método de extracción deben formalizarse                |
| `bcr-cac-pizarra`         | precios Rosario en ARS/t y metadata de pizarra          | 6    | `technical_reviewed` | `rights_review_pending` | la publicación indica condiciones spot y conversión informativa con BNA; automatización y retención siguen pendientes |
| `damodaran-current-data`  | ERP, CRP, beta y agregados sectoriales versionados      | 4    | `technical_reviewed` | `rights_review_pending` | snapshots fechados; registrar workbook, hoja, fecha, hash y convención antes de usar                                  |

## Inventario diferido

| Source ID          | Uso posible                                      | Fase | Estado técnico       | Aprobación              | Condición de entrada                                                                 |
| ------------------ | ------------------------------------------------ | ---- | -------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `indec-direct`     | releases y series cuya fuente primaria sea INDEC | 6    | `proposed`           | `rights_unreviewed`     | elegir datasets y contratos concretos, no tratar el portal completo como un endpoint |
| `comafi-cedear`    | contraste de programas CEDEAR                    | 2    | `proposed`           | `rights_unreviewed`     | documentar dataset, vigencia y rol de fallback                                       |
| `byma-cedear`      | contexto oficial de negociación CEDEAR           | 2    | `proposed`           | `rights_unreviewed`     | definir si aporta datos estructurados o evidencia documental                         |
| `openfigi`         | reconciliación secundaria de identificadores     | 2    | `proposed`           | `rights_unreviewed`     | nunca decidir matches ambiguos sin revisión                                          |
| `chicago-soy-feed` | contrato/futuro de soja Chicago                  | 6    | `proposed`           | `rights_unreviewed`     | seleccionar feed con licencia y política de roll; no hay candidato aprobado          |
| `mep-ccl-feed`     | referencias MEP/CCL                              | 6    | `proposed`           | `rights_unreviewed`     | exige fuente contractual y metodología visible                                       |
| `openrouter`       | modelos para research y supuestos estructurados  | 7    | `technical_reviewed` | `rights_review_pending` | ZDR, data collection, routing y logging deben aplicarse y verificarse por request    |
| `tavily`           | búsqueda/extracción cualitativa con allowlist    | 7    | `proposed`           | `rights_unreviewed`     | revisar plan, retención, dominios, costos y contenido transferido                    |

## Evidencia primaria revisada

### SEC EDGAR

La [documentación oficial de EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
describe submissions, XBRL company facts, frames y archivos bulk; indica que las
APIs públicas no requieren key y que el acceso automatizado debe cumplir la
política de la SEC. El diseño usará CIK como identidad, accession y fechas de
filing/acceptance como lineage, y validará una muestra XBRL con Arelle/EFM y DQC.

### Alpaca

La [comparación oficial de planes](https://docs.alpaca.markets/us/docs/about-market-data-api)
publica para Trading API Basic cobertura de acciones y ETF de EE.UU., históricos
desde 2016 y 200 llamadas históricas por minuto. Basic ofrece IEX en tiempo real;
el [endpoint de barras](https://docs.alpaca.markets/us/reference/stockbarsingle-1)
acepta `iex` y `sip`, paginación, `asof` y ajustes.

El repositorio conserva `ALPACA_DATA_FEED=iex` como default seguro de configuración.
El uso de SIP demorado para EOD, los derechos de retención y el presupuesto del
plan concreto quedan abiertos para la matriz contractual. Ningún documento debe
confundir el default del endpoint con el entitlement de la cuenta.

### CEDEAR y universo

El [listado de Caja de Valores](https://cajadevalores.com.ar/Servicios/Cedears)
expone, entre otros campos, símbolo BYMA, ticker e ISIN del subyacente, mercado de
origen y ratio. Una ingesta futura debe tomar un snapshot fechado y detectar
cambios; la vista actual no sustituye un historial.

El [dataset S&P 500](https://github.com/datasets/s-and-p-500-companies)
declara PDDL y campos como ticker, sector y CIK, pero su fuente operativa es
Wikipedia. Se acepta sólo como universo de desarrollo versionado, no como prueba
de membresía oficial ni fuente de fundamentales.

### Argentina

El [catálogo de APIs del BCRA](https://www.bcra.gob.ar/apis-banco-central/)
publica Estadísticas Monetarias v4 y la deprecación de Principales Variables v3.
La [API Series de Tiempo](https://www.argentina.gob.ar/datos-abiertos/api-series-de-tiempo)
agrega indicadores oficiales de múltiples organismos; la fuente y metodología de
cada serie siguen siendo parte de su identidad.

El [histórico de divisas del BNA](https://www.bna.com.ar/Cotizador/MonedasHistorico)
y la [pizarra de la Cámara Arbitral de Cereales](https://www.cac.bcr.com.ar/es/precios-de-pizarra)
son referencias candidatas para FX y Rosario. La pizarra expresa precios spot en
ARS/t y explica que su conversión informativa usa divisa comprador BNA; el portal
persistirá ambos insumos y el descalce de fecha si existiera.

### Riesgo e IA

Los [datasets actuales de Damodaran](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html)
publican fecha de actualización y datasets de ERP, riesgo país, betas y costos de
capital. Cada descarga futura se guarda como snapshot versionado, no como un
valor global sin fecha.

OpenRouter documenta [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs),
[routing con ZDR](https://openrouter.ai/docs/guides/routing/provider-selection) y
[controles de data collection](https://openrouter.ai/docs/guides/privacy/data-collection).
Esas capacidades técnicas no aprueban transferir datos del owner: la Fase 7
requiere data map, plan, allowlist, budget y policy tests.

## Contrato de observación

Toda observación persistida incluye:

- `source_id` y URL o identificador documental;
- `as_of`, `available_at`, `fetched_at` y fecha de publicación/filing si aplica;
- período, frecuencia, timezone, unidad y moneda;
- `raw_value`, `normalized_value` y `raw_value_status`;
- concepto original, taxonomía o campo de origen;
- transformación y parser versionados;
- vintage, restatement y relación con la versión anterior;
- content hash, flags de calidad e `ingestion_run_id`.

La ausencia de un campo obligatorio produce rechazo, quarantine o quality flag
según el metric catalog. Nunca se repara con cero o una estimación silenciosa.

## Fixtures y modo demo

- Fixtures de demo son sintéticas, deterministas, sanitizadas y versionadas.
- No son recordings ni copias de payloads del modo personal.
- Un fixture conserva formas y edge cases necesarios, no términos o marcas
  innecesarios del proveedor.
- Unit tests no usan red.
- Contract tests live futuros son pequeños, explícitos y no reemplazan fixtures.
- Si una licencia no permite conservar raw, tampoco se usa ese raw como fixture.

## Gate para elevar una fuente

Antes de `approved_for_spike` se debe:

1. elegir dataset, endpoint y plan concretos;
2. registrar términos, licencia, atribución, cache, retención, derivados, export y
   transferencia a IA;
3. definir presupuesto, rate limit interno, timeout, paginación y backoff;
4. especificar schema Zod, fixture, identidad y contrato point-in-time;
5. documentar fallback, freshness, reconciliación y failure modes;
6. obtener aprobación del owner para la prueba y cualquier costo o cuenta externa.

Después del spike, una ADR decide adopción, presupuesto y estrategia de salida.
Si los datos live fueran a mostrarse en una URL anónima, se abre un gate nuevo de
display, redistribución y alcance regulatorio.

## Decisiones abiertas

- Alpaca IEX versus SIP demorado para el job EOD y los derechos del plan concreto.
- Método oficial y automatizable para historizar cambios de ratios CEDEAR.
- Cobertura point-in-time de foreign filers, ADRs e IFRS.
- Feed licenciado y política de roll para Chicago.
- Fuente contractual para MEP/CCL.
- Política de raw, cache y export por fuente argentina.
- Datos exactos que podrían transferirse a OpenRouter o Tavily en Fase 7.
