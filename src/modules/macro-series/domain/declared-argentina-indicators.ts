import {
  argentinaIndicatorSchema,
  type ArgentinaIndicator,
} from "./argentina-indicator";

const EMAE_METHODOLOGY_URL =
  "https://www.indec.gob.ar/ftp/cuadros/economia/metodologia_emae_ago_16.pdf";
const EMAE_GENERAL = "estimador-mensual-de-actividad-economica-nivel-general";
const EMAE_SECTORS = "estimador-mensual-de-actividad-economica-sectores";
const ICA_URL =
  "https://datos.gob.ar/dataset/sspm-intercambio-comercial-argentino/archivo/sspm_74.3";

function emaeGeneral(
  id: string,
  description: string,
  seasonalAdjustment: ArgentinaIndicator["seasonalAdjustment"],
): ArgentinaIndicator {
  return argentinaIndicatorSchema.parse({
    id,
    externalId: EMAE_GENERAL,
    block: "activity",
    frequency: "monthly",
    unit: "Índice 2004=100",
    scale: null,
    currency: "index",
    seasonalAdjustment,
    priceBasis: "constant",
    indexBase: "2004=100",
    reportingScope: "Argentina · EMAE nivel general",
    sourceId: "indec-api",
    filters: {
      tipo_de_indicador_descripcion: description,
      tipo_de_indicador: "Índice base 2004=100",
    },
    sourceUrl: EMAE_METHODOLOGY_URL,
    segment: "emae-2004",
    methodology: `EMAE del INDEC, «${description}»; el ajuste es el que publica el INDEC, nunca uno del portal.`,
  });
}

/** ClaNAE 2004 letters as the sectors service prints them (2026-11-03). */
const EMAE_SECTOR_LABELS: readonly (readonly [string, string])[] = [
  ["A", "Agricultura, ganadería, caza y silvicultura"],
  ["B", "Pesca"],
  ["C", "Explotación de minas y canteras"],
  ["D", "Industria manufacturera"],
  ["E", "Electricidad, gas y agua"],
  ["F", "Construcción"],
  ["G", "Comercio mayorista, minorista y reparaciones"],
  ["H", "Hoteles y restaurantes"],
  ["I", "Transporte y comunicaciones"],
  ["J", "Intermediación financiera"],
  ["K", "Actividades inmobiliarias, empresariales y de alquiler"],
  [
    "L",
    "Administración pública y defensa; planes de seguridad social de afiliación obligatoria",
  ],
  ["M", "Enseñanza"],
  ["N", "Servicios sociales y de salud"],
  ["O", "Otras actividades de servicios comunitarios, sociales y personales"],
  ["T_S", "Impuestos netos de subsidios"],
];

function emaeSector(code: string, label: string): ArgentinaIndicator {
  return argentinaIndicatorSchema.parse({
    id: `emae_sector_${code.toLowerCase()}`,
    externalId: EMAE_SECTORS,
    block: "activity",
    frequency: "monthly",
    unit: "Índice 2004=100",
    scale: null,
    currency: "index",
    seasonalAdjustment: "original",
    priceBasis: "constant",
    indexBase: "2004=100",
    reportingScope: `Argentina · EMAE ${code} ${label}`,
    sourceId: "indec-api",
    // The label is a filter too: a renamed sector returns no rows and stops
    // the run by name instead of recording another series under the same ID.
    filters: {
      codigo: code,
      descripcion: label,
      tipo_de_indicador: "Índice base 2004=100",
    },
    sourceUrl: EMAE_METHODOLOGY_URL,
    segment: "emae-2004",
    methodology:
      "Índice original por sector del EMAE del INDEC; el INDEC no publica sectores desestacionalizados.",
  });
}

function seriesTiempo(
  fields: Omit<
    ArgentinaIndicator,
    "sourceId" | "filters" | "priceBasis" | "seasonalAdjustment" | "indexBase"
  >,
): ArgentinaIndicator {
  return argentinaIndicatorSchema.parse({
    ...fields,
    sourceId: "argentina-series-tiempo",
    filters: {},
    seasonalAdjustment: "original",
    priceBasis: "current",
    indexBase: null,
  });
}

/**
 * The declared set of `F9-04` (ADR 0069). Activity comes from INDEC itself;
 * trade totals, fiscal results and nominal GDP from the Series de Tiempo
 * distributor, which carries the published totals INDEC's API does not.
 */
export const DECLARED_ARGENTINA_INDICATORS: readonly ArgentinaIndicator[] = [
  emaeGeneral("emae_original", "Índice serie original", "original"),
  emaeGeneral(
    "emae_sa",
    "Índice serie desestacionalizada",
    "seasonally_adjusted",
  ),
  emaeGeneral("emae_trend", "Índice serie tendencia-ciclo", "trend_cycle"),
  ...EMAE_SECTOR_LABELS.map(([code, label]) => emaeSector(code, label)),
  seriesTiempo({
    id: "exports_goods",
    externalId: "74.3_IET_0_M_16",
    block: "external",
    frequency: "monthly",
    unit: "Millones de dólares",
    scale: "million",
    currency: "USD",
    reportingScope: "Argentina · comercio de bienes FOB",
    sourceUrl: ICA_URL,
    segment: "ica-fob-cif",
    methodology:
      "Exportaciones de bienes FOB del Intercambio Comercial Argentino.",
  }),
  seriesTiempo({
    id: "imports_goods",
    externalId: "74.3_IIT_0_M_25",
    block: "external",
    frequency: "monthly",
    unit: "Millones de dólares",
    scale: "million",
    currency: "USD",
    reportingScope: "Argentina · comercio de bienes CIF",
    sourceUrl: ICA_URL,
    segment: "ica-fob-cif",
    methodology:
      "Importaciones de bienes CIF del Intercambio Comercial Argentino.",
  }),
  seriesTiempo({
    id: "trade_balance_reported",
    externalId: "74.3_ISC_0_M_19",
    block: "external",
    frequency: "monthly",
    unit: "Millones de dólares",
    scale: "million",
    currency: "USD",
    reportingScope: "Argentina · saldo comercial FOB-CIF",
    sourceUrl: ICA_URL,
    segment: "ica-fob-cif",
    methodology:
      "Saldo comercial publicado; se compara con exportaciones menos importaciones.",
  }),
  seriesTiempo({
    id: "fiscal_primary_result",
    externalId: "452.3_RESULTADO_RIO_0_M_18_54",
    block: "fiscal",
    frequency: "monthly",
    unit: "Millones de pesos",
    scale: "million",
    currency: "ARS",
    reportingScope:
      "Sector Público Nacional no financiero · base caja (IMIG, Secretaría de Hacienda)",
    sourceUrl:
      "https://apis.datos.gob.ar/series/api/series/?ids=452.3_RESULTADO_RIO_0_M_18_54&metadata=full",
    segment: "imig-2016",
    methodology:
      "Resultado primario mensual del Informe Mensual de Ingresos y Gastos de la Secretaría de Hacienda.",
  }),
  seriesTiempo({
    id: "fiscal_net_interest",
    externalId: "452.3_INTERESES_TOS_0_M_15_62",
    block: "fiscal",
    frequency: "monthly",
    unit: "Millones de pesos",
    scale: "million",
    currency: "ARS",
    reportingScope:
      "Sector Público Nacional no financiero · base caja (IMIG, Secretaría de Hacienda)",
    sourceUrl:
      "https://apis.datos.gob.ar/series/api/series/?ids=452.3_INTERESES_TOS_0_M_15_62&metadata=full",
    segment: "imig-2016",
    methodology:
      "Intereses netos mensuales del IMIG. El resultado financiero publicado viene vacío en el distribuidor (medido el 2026-11-03).",
  }),
  seriesTiempo({
    id: "gdp_nominal_annual",
    externalId: "9.1_PPC_2004_A_22",
    block: "fiscal",
    frequency: "annual",
    unit: "Millones de pesos corrientes",
    scale: "million",
    currency: "ARS",
    reportingScope: "Argentina · PIB a precios de mercado",
    sourceUrl:
      "https://apis.datos.gob.ar/series/api/series/?ids=9.1_PPC_2004_A_22&metadata=full",
    segment: "pib-2004",
    methodology:
      "PIB anual a precios corrientes, base 2004 (INDEC y Secretaría de Política Económica); denominador del resultado fiscal del mismo año.",
  }),
];

export function declaredArgentinaIndicator(
  id: string,
): ArgentinaIndicator | null {
  return DECLARED_ARGENTINA_INDICATORS.find((item) => item.id === id) ?? null;
}
