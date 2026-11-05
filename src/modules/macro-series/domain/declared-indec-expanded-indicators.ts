import {
  argentinaIndicatorSchema,
  type ArgentinaIndicator,
} from "./argentina-indicator";

/** Values and column names observed from the INDEC services on 2026-11-05. */
const IPC_REGIONS = [
  "Nacional",
  "GBA",
  "Pampeana",
  "Noreste",
  "Noroeste",
  "Cuyo",
  "Patagonia",
] as const;

const IPC_DIVISIONS = [
  ["01", "Alimentos y bebidas no alcohólicas"],
  ["02", "Bebidas alcohólicas y tabaco"],
  ["03", "Prendas de vestir y calzado"],
  ["04", "Vivienda, agua, electricidad, gas y otros combustibles"],
  ["05", "Equipamiento y mantenimiento del hogar"],
  ["06", "Salud"],
  ["07", "Transporte"],
  ["08", "Comunicación"],
  ["09", "Recreación y cultura"],
  ["10", "Educación"],
  ["11", "Restaurantes y hoteles"],
  ["12", "Bienes y servicios varios"],
] as const;

const IPC_SERVICE_URL = "https://api.indec.gob.ar/v1/ipc_nacional";
const BASKET_SERVICE_URL =
  "https://api.indec.gob.ar/v1/valorizacion_canastas_cba_cbt";

function ipc(
  id: string,
  region: string,
  code: string,
  description: string,
): ArgentinaIndicator {
  const general = code === "0";
  return argentinaIndicatorSchema.parse({
    id,
    externalId: "ipc_nacional",
    block: "prices",
    frequency: "monthly",
    unit: "Unidad",
    scale: null,
    currency: "index",
    seasonalAdjustment: "original",
    priceBasis: "current",
    indexBase: "Diciembre 2016=100",
    reportingScope: `Argentina · IPC ${description} · ${region}`,
    sourceId: "indec-api",
    filters: {
      clasificador: general ? "IPC" : "COICOP Argentina 2019",
      nivel: general ? "Nivel General" : "División",
      codigo: code,
      descripcion: description,
      indicador: "IPC base Dic16=100",
      tipo_de_indicador: "Indice",
      tipo_de_indicador_descripcion:
        "Nivel del período, base Diciembre 2016 = 100",
      region,
      unidad_de_medida: "Unidad",
    },
    sourceUrl: IPC_SERVICE_URL,
    segment: "ipc-dic2016-coicop2019",
    methodology:
      "Nivel mensual original del IPC publicado por el INDEC; el índice regional o de división conserva su apertura. No reemplaza la cadena histórica del BCRA.",
  });
}

function basket(code: "CBA" | "CBT", description: string): ArgentinaIndicator {
  return argentinaIndicatorSchema.parse({
    id: `basket_${code.toLowerCase()}`,
    externalId: "valorizacion_canastas_cba_cbt",
    block: "living_cost",
    frequency: "monthly",
    unit: "Pesos argentinos",
    scale: "unit",
    currency: "ARS",
    seasonalAdjustment: "original",
    priceBasis: "current",
    indexBase: null,
    reportingScope: `GBA · ${description} · adulto equivalente`,
    sourceId: "indec-api",
    filters: {
      clasificador: "CBA y CBT",
      nivel: "Adulto equivalente",
      codigo: code,
      descripcion: description,
      indicador: "Canasta",
      tipo_de_indicador: code,
      tipo_de_indicador_descripcion:
        "Valores mensuales por adulto equivalente, expresados en pesos",
      region: "GBA",
      unidad_de_medida: "Pesos argentinos",
    },
    sourceUrl: BASKET_SERVICE_URL,
    segment: "cba-cbt-adulto-equivalente",
    methodology:
      "Valor mensual por adulto equivalente publicado por el INDEC para el Gran Buenos Aires; no es el costo de un hogar sin aplicar su composición.",
  });
}

/** First `F9-08` increment: IPC geography and divisions, plus CBA/CBT. */
export const DECLARED_INDEC_EXPANDED_INDICATORS: readonly ArgentinaIndicator[] =
  [
    ...IPC_REGIONS.map((region) =>
      ipc(`ipc_${region.toLowerCase()}`, region, "0", "Nivel general"),
    ),
    ...IPC_DIVISIONS.map(([code, description]) =>
      ipc(`ipc_division_${code}`, "Nacional", code, description),
    ),
    basket("CBA", "Canasta Basica Alimentaria"),
    basket("CBT", "Canasta Basica Total"),
  ];

export function declaredIndecExpandedIndicator(
  id: string,
): ArgentinaIndicator | null {
  return (
    DECLARED_INDEC_EXPANDED_INDICATORS.find((item) => item.id === id) ?? null
  );
}
