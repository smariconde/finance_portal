import {
  argentinaIndicatorSchema,
  type ArgentinaIndicator,
} from "./argentina-indicator";
import { MAGYP_SOY_TOTAL_CROP } from "./magyp-estimaciones-parser";

const CAC_URL = "https://www.cac.bcr.com.ar/es/precios-de-pizarra";
const BNA_URL = "https://www.bna.com.ar/Cotizador/MonedasHistorico";
const ZS_URL = "https://finance.yahoo.com/quote/ZS%3DF/";
const ESTIMACIONES_URL =
  "https://datosestimaciones.magyp.gob.ar/reportes.php?reporte=Estimaciones";

function estimate(
  id: string,
  variable: string,
  unit: string,
  what: string,
): ArgentinaIndicator {
  return argentinaIndicatorSchema.parse({
    id,
    externalId: MAGYP_SOY_TOTAL_CROP.id,
    block: "agro",
    frequency: "annual",
    unit,
    scale: "unit",
    currency: "physical",
    seasonalAdjustment: "original",
    priceBasis: "not_applicable",
    indexBase: null,
    reportingScope: "Argentina · soja total, por campaña",
    sourceId: "magyp-estimaciones",
    filters: { cultivo: MAGYP_SOY_TOTAL_CROP.label, variable },
    sourceUrl: ESTIMACIONES_URL,
    segment: "magyp-estimaciones",
    methodology: `${what} de soja total de las Estimaciones Agrícolas del Ministerio de Agricultura, Ganadería y Pesca, conciliada en cada corrida con la serie CC BY 4.0 de datos.magyp.gob.ar. La campaña aaaa/aa se fecha el 1 de julio de aaaa (convención del proyecto); la campaña en curso se revisa mes a mes.`,
  });
}

/**
 * The soy set of `F9-05` (ADR 0071): the three daily legs of the basis and the
 * campaign estimates. Kept apart from the `F9-04` set so the dashboard's read of
 * its own series does not carry twenty thousand daily points it does not draw.
 */
export const DECLARED_SOY_INDICATORS: readonly ArgentinaIndicator[] = [
  argentinaIndicatorSchema.parse({
    id: "soy_rosario_pizarra",
    externalId: "13",
    block: "agro",
    frequency: "daily",
    unit: "$/Tn",
    scale: "unit",
    currency: "ARS",
    seasonalAdjustment: "original",
    priceBasis: "current",
    indexBase: null,
    reportingScope:
      "Rosario · soja, entrega inmediata, pago contado, sobre camión o vagón",
    sourceId: "bcr-cac-pizarra",
    filters: { producto: "Soja", tipo: "pizarra" },
    sourceUrl: CAC_URL,
    segment: "cac-pizarra",
    methodology:
      "Precio pizarra de la Cámara Arbitral de Cereales de la Bolsa de Comercio de Rosario: pesos corrientes por tonelada, entrega inmediata, pago contado, puesto sobre camión o vagón en zona Rosario. Un día «S/C» no tuvo cotización y queda nulo.",
  }),
  argentinaIndicatorSchema.parse({
    id: "usd_bna_divisas_buyer",
    externalId: "55",
    block: "agro",
    frequency: "daily",
    unit: "Pesos por dólar",
    scale: "unit",
    currency: "ARS",
    seasonalAdjustment: "original",
    priceBasis: "current",
    indexBase: null,
    reportingScope: "Banco de la Nación Argentina · dólar divisa, comprador",
    sourceId: "bna-fx",
    filters: { moneda: "Dolar U.S.A", lado: "Compra" },
    sourceUrl: BNA_URL,
    segment: "bna-divisas",
    methodology:
      "Cotización de divisas del Banco de la Nación Argentina al cierre, tipo comprador: la que usa la Cámara Arbitral de Cereales para pasar la pizarra a dólares. No es el mayorista de la Comunicación A 3500.",
  }),
  argentinaIndicatorSchema.parse({
    id: "soy_cbot_front",
    externalId: "ZS=F",
    block: "agro",
    frequency: "daily",
    unit: "US cents/bushel",
    scale: "unit",
    currency: "USD",
    seasonalAdjustment: "original",
    priceBasis: "current",
    indexBase: null,
    reportingScope: "CBOT · soja, contrato más cercano",
    sourceId: "yahoo-finance",
    filters: { exchange: "CBT", currency: "USX" },
    sourceUrl: ZS_URL,
    segment: "yahoo-zs-front",
    methodology:
      "Cierre diario del contrato más cercano de soja de CBOT según Yahoo (ZS=F), en centavos de dólar por bushel. Yahoo rueda al último día de negociación; el contrato de cada día se deduce con cbot-soy-front-contract-1.0.0 y los días en período de entrega se marcan. Es el cierre de Yahoo, no el precio de ajuste de CME.",
  }),
  estimate("soy_area_sown", "Sup. Sembrada", "ha", "Superficie sembrada"),
  estimate(
    "soy_area_harvested",
    "Sup. Cosechada",
    "ha",
    "Superficie cosechada",
  ),
  estimate("soy_production", "Producción", "t", "Producción"),
  estimate("soy_yield", "Rendimiento", "kg/ha", "Rendimiento"),
];

export function declaredSoyIndicator(id: string): ArgentinaIndicator | null {
  return DECLARED_SOY_INDICATORS.find((item) => item.id === id) ?? null;
}
