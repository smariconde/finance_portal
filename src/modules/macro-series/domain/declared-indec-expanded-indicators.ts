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

function ipi(
  id: string,
  externalId: "ipi_manufacturero" | "ipi_minero",
): ArgentinaIndicator {
  const mining = externalId === "ipi_minero";
  const name = mining ? "IPI minero" : "IPI manufacturero";
  return argentinaIndicatorSchema.parse({
    id,
    externalId,
    block: "activity",
    frequency: "monthly",
    unit: mining ? "Número índice" : "Numero índice",
    scale: null,
    currency: "index",
    seasonalAdjustment: "seasonally_adjusted",
    priceBasis: "constant",
    indexBase: mining ? "2016=100" : "2004=100",
    reportingScope: `Argentina · ${name} · nivel general`,
    sourceId: "indec-api",
    filters: mining
      ? {
          indicador: "IPI Minero",
          cuadro_web: "Cuadro 1",
          codigo_ClaNAE_2010: "B",
          codigo_CPC_2_1: "-",
          serie: "Serie Desestacionalizada",
          descripcion: "Nivel General - IPI Minero",
          tipo_de_indicador: "Índice",
          unidad_de_medida: "Número índice",
        }
      : {
          indicador: "IPI manufacturero",
          cuadro_web: "Cuadro 5",
          codigo_CLaNAE_2004: "D",
          descripcion: "IPI Manufacturero - Nivel general",
          serie: "Serie desestacionalizada",
          tipo_de_indicador: "Índice",
          unidad_de_medida: "Numero índice",
        },
    sourceUrl: `https://api.indec.gob.ar/v1/${externalId}`,
    segment: mining ? "ipi-minero-2016" : "ipi-manufacturero-2004",
    methodology: `${name} desestacionalizado publicado por el INDEC. La variación intermensual del mismo cuadro se usa sólo para conciliar el último nivel; no se mezcla con la serie original.`,
  });
}

function wholesaleIndex(kind: "IPIM" | "IPIB" | "IPP"): ArgentinaIndicator {
  const descriptions = {
    IPIM: "precios internos al por mayor",
    IPIB: "precios internos básicos al por mayor",
    IPP: "precios básicos del productor",
  } as const;
  return argentinaIndicatorSchema.parse({
    id: `sipm_${kind.toLowerCase()}_general`,
    externalId: "sipm_precios_mayoristas",
    block: "prices",
    frequency: "monthly",
    unit: "Unidad",
    scale: null,
    currency: "index",
    seasonalAdjustment: "original",
    priceBasis: "current",
    indexBase: "1993; referencia diciembre 2015=100",
    reportingScope: `Argentina · SIPM · ${kind} nivel general`,
    sourceId: "indec-api",
    filters: {
      operativo: "SIPM",
      indicador: kind,
      clasificador: "SIPM 93",
      nivel: "Nivel general",
      codigo_apertura: "NG",
      descripcion: "Nivel general",
      tipo_de_indicador: "Indice",
      tipo_de_indicador_descripcion: "Nivel del período, base 1993, dic-15=100",
      region: "Total del país",
      unidad_de_medida: "Unidad",
    },
    sourceUrl: "https://api.indec.gob.ar/v1/sipm_precios_mayoristas",
    segment: `sipm-${kind.toLowerCase()}-1993-dic2015`,
    methodology: `Nivel general del índice de ${descriptions[kind]} (${kind}), dentro del SIPM del INDEC. Base 1993 y período de referencia diciembre de 2015=100; se conserva separado de los otros dos índices del sistema.`,
  });
}

function constructionCost(): ArgentinaIndicator {
  return argentinaIndicatorSchema.parse({
    id: "icc_gba_general",
    externalId: "icc_precios_construccion",
    block: "prices",
    frequency: "monthly",
    unit: "Unidad",
    scale: null,
    currency: "index",
    seasonalAdjustment: "original",
    priceBasis: "current",
    indexBase: "1993; referencia enero 2022=100",
    reportingScope: "GBA · ICC · nivel general",
    sourceId: "indec-api",
    filters: {
      indicador: "ICC",
      codigo_apertura: "0",
      codigo_CPC_1: "-",
      clasificador: "ICC 93",
      nivel: "Nivel general",
      descripcion: "Nivel general",
      tipo_de_indicador: "Indice",
      tipo_de_indicador_descripcion: "Nivel del período, base 1993, ene-22=100",
      region: "GBA",
      unidad_de_medida: "Unidad",
    },
    sourceUrl: "https://api.indec.gob.ar/v1/icc_precios_construccion",
    segment: "icc-gba-1993-ene2022",
    methodology:
      "Nivel general del índice del costo de la construcción en el Gran Buenos Aires (ICC) publicado por el INDEC. Base 1993 y período de referencia enero de 2022=100; la variación mensual publicada concilia con los niveles contiguos.",
  });
}

function wagesIndex(): ArgentinaIndicator {
  return argentinaIndicatorSchema.parse({
    id: "wages_general",
    externalId: "indice_salarios",
    block: "wages",
    frequency: "monthly",
    unit: "Unidad",
    scale: null,
    currency: "index",
    seasonalAdjustment: "original",
    priceBasis: "current",
    indexBase: "Octubre 2016=100",
    reportingScope: "Argentina · índice de salarios · nivel general",
    sourceId: "indec-api",
    filters: {
      clasificador: "IS 2001",
      nivel: "0",
      codigo: "0",
      descripcion: "Nivel general",
      indicador: "Índice de salarios (IS)",
      tipo_de_indicador: "Indice",
      tipo_de_indicador_descripcion: "Nivel del período, base octubre 2016=100",
      unidad_de_medida: "Unidad",
    },
    sourceUrl: "https://api.indec.gob.ar/v1/indice_salarios",
    segment: "wages-is2001-oct2016",
    methodology:
      "Índice de salarios de nivel general publicado por el INDEC, base octubre de 2016=100. La variación intermensual del mismo nivel se concilia con los niveles contiguos; no se mezclan sectores ni se deflacta en la ingesta.",
  });
}

/** `F9-08`: declared INDEC services kept outside the automatic dashboard refresh. */
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
    ipi("ipi_manufacturero_sa", "ipi_manufacturero"),
    ipi("ipi_minero_sa", "ipi_minero"),
    wholesaleIndex("IPIM"),
    wholesaleIndex("IPIB"),
    wholesaleIndex("IPP"),
    constructionCost(),
    wagesIndex(),
  ];

export function declaredIndecExpandedIndicator(
  id: string,
): ArgentinaIndicator | null {
  return (
    DECLARED_INDEC_EXPANDED_INDICATORS.find((item) => item.id === id) ?? null
  );
}
