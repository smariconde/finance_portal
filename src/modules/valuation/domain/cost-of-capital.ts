import { z } from "zod";

import type {
  ReferenceRelease,
  ReferenceRow,
} from "@/modules/reference-data/domain/reference-release";
import {
  calendarDateSchema,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

import {
  divide,
  engineDecimalSchema,
  formatDecimal,
  ONE,
  parseDecimal,
  ZERO,
  type Dec,
} from "./decimal-policy";
import {
  businessExposureSchema,
  resolveBusinessExposure,
  type BusinessExposure,
  type BusinessMixReading,
} from "./business-exposure";
import { declaredRatingSchema } from "./declared-rating";
import { netCashCoverageSchema } from "./net-cash-coverage";
import type { CoverageFloor } from "./zero-debt-evidence";

/**
 * Costo de capital bottom-up (`F3-06`): el WACC deja de ser un input crudo y se
 * construye con componentes fechados de las releases de Damodaran (ADR 0032).
 *
 * - **Libre de riesgo**: la tasa del bono del Tesoro menos el default spread del
 *   soberano de la moneda. Es el método de Damodaran para un gobierno que no es
 *   Aaa, y EE. UU. es Aa1 desde 2025: su tabla de países ya le asigna spread.
 * - **Costo del equity**: libre de riesgo más la beta reapalancada por la ERP
 *   madura (la implícita de inicio de año) y el riesgo país del domicilio.
 * - **Beta**: la desapalancada y corregida por caja de la industria, reapalancada
 *   con Hamada `βL = βU × (1 + (1 − t) × D/E)` a la estructura objetivo, que es
 *   la D/E de mercado de la industria.
 * - **Costo de deuda**: libre de riesgo más el spread del rating sintético que da
 *   la cobertura de intereses (tabla de no financieras grandes) más el default
 *   spread del país, con escudo fiscal a la tasa marginal del país.
 * - **Convergencia**: en estado estable la beta va a 1 con la misma estructura.
 *
 * Todo en decimal: ningún componente pasa por `number`.
 *
 * `1.1.0` (`F5-05`, [ADR 0034](../../../../docs/architecture/adr/0034-operations-weighted-country-risk.md)):
 * con un mix de operaciones —declarado por el owner o propuesto por la IA y
 * aceptado por la policy—, la prima del equity lleva el CRP **ponderado por
 * operaciones** en lugar del del domicilio: cada exposición toma el CRP de su
 * fila, varias filas se combinan por el PBI de cada una en la misma release, y
 * el resto del mundo es la combinación de las nueve regiones. El default spread
 * y la tasa marginal siguen siendo del domicilio. Sin mix, todo queda como en
 * `1.0.0`: la falta de mix nunca es un CRP cero.
 */
/**
 * `1.2.0` (`F6-48`, [ADR 0086](../../../../docs/architecture/adr/0086-business-mix-beta.md)):
 * con una mezcla de dos o más negocios —declarada por el owner o propuesta por
 * la IA y aceptada— la beta desapalancada y la D/E objetivo son las de cada
 * industria ponderadas por el valor estimado del negocio (ventas × EV/Sales de
 * la industria). Los nueve parámetros no cambian: la beta y la D/E de la
 * industria propia quedan como referencia. Sin mezcla, la corrida queda como
 * en `1.1.0`, versión incluida.
 */
export const COST_OF_CAPITAL_VERSION = "cost-of-capital-1.2.0";
const WITHOUT_BUSINESS_MIX_VERSION = "cost-of-capital-1.1.0";
/**
 * `1.3.0` (`F6-55`, ADR 0087): una corrida en la moneda de sus estados. El libre
 * de riesgo es la curva soberana de esa moneda al `as_of` —el dato del día o el
 * último publicado antes, dentro de lo que la curva declara—, neto del
 * diferencial del soberano de referencia (Alemania para el EUR, Aaa en cero).
 * La beta, la ERP implícita y la tabla de ratings son las de siempre, y el
 * domicilio es el país **declarado** del emisor, no el de su listing (decisión
 * del owner). Sólo una corrida en otra moneda que el USD lleva `1.3.0`.
 */
export const COST_OF_CAPITAL_CURRENCY_VERSION = "cost-of-capital-1.3.0";
const COST_OF_CAPITAL_VERSIONS = [
  "cost-of-capital-1.0.0",
  WITHOUT_BUSINESS_MIX_VERSION,
  COST_OF_CAPITAL_VERSION,
  COST_OF_CAPITAL_CURRENCY_VERSION,
] as const;

export const BETAS_DATASET = "damodaran.betas-us";
export const COUNTRY_RISK_DATASET = "damodaran.country-risk";
export const COUNTRY_RISK_REGIONS_DATASET = "damodaran.country-risk-regions";
export const IMPLIED_ERP_DATASET = "damodaran.implied-erp";
export const RATINGS_DATASET = "damodaran.synthetic-ratings";
export const EV_SALES_DATASET = "damodaran.ev-sales-us";

/** La beta de estado estable hacia la que converge la empresa. */
export const TERMINAL_BETA = "1";

/** La moneda cuyo libre de riesgo publica la tabla de ERP implícita. */
const SUPPORTED_CURRENCY = "USD";
/** Las monedas con curva declarada (`1.3.0`). */
const CURVE_CURRENCIES = ["EUR"] as const;
const RUN_CURRENCIES = [SUPPORTED_CURRENCY, ...CURVE_CURRENCIES] as const;
const CURRENCY_SOVEREIGN: Readonly<Record<string, string>> = {
  USD: "united-states",
  // Damodaran toma el Bund como libre de riesgo del euro: Aaa, diferencial 0.
  EUR: "germany",
};

/**
 * País de la tabla de Damodaran para cada país ISO del listing primario o del
 * domicilio declarado (`1.3.0`).
 */
const COUNTRY_KEYS: Readonly<Record<string, string>> = {
  US: "united-states",
  LU: "luxembourg",
  DK: "denmark",
};

export const costOfCapitalParameterNameSchema = z.enum([
  "treasury_bond_rate",
  "sovereign_default_spread",
  "implied_erp",
  "country_risk_premium",
  "country_default_spread",
  "marginal_tax_rate",
  "unlevered_beta",
  "target_debt_to_equity",
  "company_default_spread",
]);

export type CostOfCapitalParameterName = z.infer<
  typeof costOfCapitalParameterNameSchema
>;

/** Un parámetro con la release, la fila y el campo de donde salió. */
export const costOfCapitalParameterSchema = z.object({
  name: costOfCapitalParameterNameSchema,
  value: engineDecimalSchema,
  datasetId: z.string().max(64),
  releaseId: z.uuid(),
  rowKey: z.string().max(128),
  field: z.string().max(48),
  publishedLabel: z.string().max(64).nullable(),
  availableAt: utcTimestampSchema,
});

export type CostOfCapitalParameter = z.infer<
  typeof costOfCapitalParameterSchema
>;

export const coverageEvidenceSchema = z.object({
  /** `EBIT / intereses` del ejercicio usado. */
  value: engineDecimalSchema,
  fiscalYearEnd: calendarDateSchema,
  /** `false` cuando el último ejercicio no publicó intereses y se usó uno anterior. */
  fromLatestFiscalYear: z.boolean(),
  availableAt: utcTimestampSchema,
  /**
   * De dónde salió el gasto de intereses cuando no es el bruto publicado
   * (`interest-expense-1.0.0`, `F6-14`). Ausente es el bruto: una corrida
   * anterior conserva su hash.
   */
  interestBasis: z
    .enum([
      "debt_plus_finance_leases",
      "net_nonoperating",
      "interest_paid",
      /**
       * Sin gasto de intereses en los cinco ejercicios de la evidencia de deuda
       * cero (`F6-15`, ADR 0054): la cobertura es el piso de la banda más alta,
       * la convención de Damodaran para quien no paga intereses.
       */
      "no_interest_expense",
      /**
       * El interés de la parte industrial de una empresa con financiera
       * cautiva (`F6-23`, ADR 0082), con su propia base congelada en
       * `normalization.facts.captiveFinance.industrialInterest`.
       */
      "captive_industrial",
      /**
       * EBIT no positivo con caja neta y flujo operativo positivo (`F6-41`):
       * la cobertura es el piso de la banda más alta, con la evidencia en
       * `netCash`.
       */
      "net_cash_operating_loss",
      /**
       * Rating declarado por el owner (`F6-42`): la cobertura es el piso de
       * la banda declarada, con la declaración en `declaredRating`.
       */
      "owner_declared_rating",
    ])
    .optional(),
  /** Sólo con `net_cash_operating_loss`: los hechos que la regla leyó. */
  netCash: netCashCoverageSchema.optional(),
  /** Sólo con `owner_declared_rating`: la declaración y su banda. */
  declaredRating: declaredRatingSchema.optional(),
});

export type CoverageEvidence = z.infer<typeof coverageEvidenceSchema>;

/** Cómo declara la corrida un gasto de intereses que no es el bruto. */
export const COVERAGE_INTEREST_DECLARATION = {
  debt_plus_finance_leases: "coverage_interest_debt_plus_finance_leases",
  net_nonoperating: "coverage_interest_net_nonoperating",
  interest_paid: "coverage_interest_paid",
  no_interest_expense: "coverage_no_interest_expense",
  captive_industrial: "coverage_interest_industrial_only",
  net_cash_operating_loss: "coverage_net_cash_operating_loss",
  owner_declared_rating: "coverage_owner_declared_rating",
} as const satisfies Record<
  NonNullable<CoverageEvidence["interestBasis"]>,
  string
>;

export const costOfCapitalDerivedSchema = z.object({
  riskFree: engineDecimalSchema,
  leveredBeta: engineDecimalSchema,
  costOfEquity: engineDecimalSchema,
  syntheticRating: z.string().max(32),
  preTaxCostOfDebt: engineDecimalSchema,
  afterTaxCostOfDebt: engineDecimalSchema,
  equityWeight: engineDecimalSchema,
  debtWeight: engineDecimalSchema,
  wacc: engineDecimalSchema,
  terminalBeta: engineDecimalSchema,
  terminalCostOfEquity: engineDecimalSchema,
  terminalWacc: engineDecimalSchema,
});

export type CostOfCapitalDerived = z.infer<typeof costOfCapitalDerivedSchema>;

export const costOfCapitalDeclarationSchema = z.enum([
  "riskfree_net_of_sovereign_default_spread",
  "erp_implied_at_start_of_year",
  "industry_beta_us",
  "target_structure_industry_average",
  "country_risk_by_primary_listing",
  "synthetic_rating_large_nonfinancial",
  "coverage_from_earlier_fiscal_year",
  "coverage_interest_debt_plus_finance_leases",
  "coverage_interest_net_nonoperating",
  "coverage_interest_paid",
  "coverage_no_interest_expense",
  "coverage_interest_industrial_only",
  "coverage_net_cash_operating_loss",
  "coverage_owner_declared_rating",
  "terminal_beta_converges_to_one",
  "country_risk_by_operations",
  "regions_combined_by_gdp",
  "rest_of_world_as_global",
  "beta_by_business_mix",
  "target_structure_business_mix",
  "riskfree_from_currency_government_curve",
  "country_risk_by_declared_domicile",
]);

/** Una fila de riesgo país o de región que entra al CRP de una exposición. */
export const exposureComponentSchema = z.object({
  datasetId: z.string().max(64),
  releaseId: z.uuid(),
  rowKey: z.string().max(128),
  countryRiskPremium: engineDecimalSchema,
  /** PBI de la fila: pesa sólo cuando la exposición combina varias. */
  gdpMillions: engineDecimalSchema.nullable(),
});

export type ExposureComponent = z.infer<typeof exposureComponentSchema>;

/**
 * El mix de operaciones con el que se ponderó el CRP: de dónde salió y, por
 * exposición, su peso y las filas que la componen. El motor recalcula el CRP
 * desde acá.
 */
export const operationsExposureSchema = z
  .object({
    source: z.enum(["owner_declaration", "ai_proposal"]),
    /** La propuesta aceptada; `null` para una declaración del owner. */
    proposalId: z.uuid().nullable(),
    weightsVersion: z.string().min(1).max(64),
    exposures: z
      .array(
        z.object({
          /** Vacías: el resto del mundo, las nueve regiones. */
          exposureKeys: z.array(z.string().max(64)).max(12),
          weight: engineDecimalSchema,
          components: z.array(exposureComponentSchema).min(1).max(200),
        }),
      )
      .min(1)
      .max(40),
  })
  .superRefine((exposure, context) => {
    const total = exposure.exposures.reduce(
      (sum: Dec, item) => sum.plus(parseDecimal(item.weight, "weight")),
      ZERO,
    );

    // Pesos calculados por división a precisión del motor: suman 1 salvo el
    // último dígito.
    if (total.minus(ONE).abs().greaterThan("1e-24")) {
      context.addIssue({
        code: "custom",
        path: ["exposures"],
        message: "Operations weights add up to one.",
      });
    }
  });

export type OperationsExposure = z.infer<typeof operationsExposureSchema>;

export const costOfCapitalSchema = z.object({
  version: z.enum(COST_OF_CAPITAL_VERSIONS),
  currency: z.enum(RUN_CURRENCIES),
  industryKey: z.string().max(128),
  countryKey: z.string().max(128),
  parameters: z.array(costOfCapitalParameterSchema).length(9),
  coverage: coverageEvidenceSchema,
  derived: costOfCapitalDerivedSchema,
  declarations: z.array(costOfCapitalDeclarationSchema).max(12),
  /** Ausente en `1.0.0`; `null` en `1.1.0` cuando no hubo mix. */
  operationsExposure: operationsExposureSchema.nullable().optional(),
  /**
   * La mezcla de negocios (`1.2.0`). Ausente sin mezcla, así una corrida de
   * una sola industria conserva la forma de `1.1.0`.
   */
  businessExposure: businessExposureSchema.optional(),
});

export type CostOfCapital = z.infer<typeof costOfCapitalSchema>;

/** La tasa marginal fechada del costo de capital: la del terminal y del escudo. */
export function marginalTaxRateOf(costOfCapital: CostOfCapital): string {
  const found = costOfCapital.parameters.find(
    (parameter) => parameter.name === "marginal_tax_rate",
  );

  if (found === undefined) {
    throw new Error("cost of capital parameter marginal_tax_rate is missing");
  }

  return found.value;
}

export type ReferenceReading = {
  readonly release: ReferenceRelease;
  readonly rows: readonly ReferenceRow[];
};

export type CostOfCapitalRequest = {
  readonly currency: string;
  /** Industria mapeada de la empresa (`F3-05`), o `null`. */
  readonly industryKey: string | null;
  /** País ISO del listing primario, que aproxima el domicilio. */
  readonly listingCountry: string | null;
  /**
   * País ISO de incorporación de un emisor extranjero declarado (`1.3.0`). Si
   * está, manda sobre el del listing.
   */
  readonly domicileCountry?: string | null;
  /**
   * La curva soberana de la moneda, visible al corte, y el `as_of` de la
   * corrida (`1.3.0`). Sólo en una corrida que no es en USD.
   */
  readonly currencyRiskFree?: {
    readonly reading: ReferenceReading | null;
    readonly asOf: string;
    /** Días que puede tener el dato frente al `as_of`. */
    readonly maxAgeDays: number;
    readonly frequency: "daily" | "monthly";
    readonly field: string;
  } | null;
  readonly betas: ReferenceReading | null;
  readonly countryRisk: ReferenceReading | null;
  readonly impliedErp: ReferenceReading | null;
  readonly ratings: ReferenceReading | null;
  readonly coverage: CoverageEvidence | null;
  /** Las nueve regiones de la misma descarga que el riesgo país (`1.1.0`). */
  readonly regions?: ReferenceReading | null;
  /** El mix de operaciones visible al corte, o `null` (`1.1.0`). */
  readonly operationsMix?: OperationsMixReading | null;
  /** La mezcla de negocios de dos o más industrias, o `null` (`1.2.0`). */
  readonly businessMix?: BusinessMixReading | null;
  /** EV/Sales por industria de la misma fecha que las betas (`1.2.0`). */
  readonly evToSales?: ReferenceReading | null;
};

/** El mix que entra al costo de capital, ya con sus pesos calculados. */
export type OperationsMixReading = {
  readonly source: "owner_declaration" | "ai_proposal";
  readonly proposalId: string | null;
  readonly weightsVersion: string;
  readonly exposures: readonly {
    readonly exposureKeys: readonly string[];
    readonly weight: string;
  }[];
};

export type CostOfCapitalResult =
  | { readonly status: "computed"; readonly costOfCapital: CostOfCapital }
  | {
      readonly status: "unsupported";
      readonly version: typeof COST_OF_CAPITAL_VERSION;
      /** Lo que faltó, con nombre estable. */
      readonly missing: readonly string[];
    };

function parameter(
  name: CostOfCapitalParameterName,
  reading: ReferenceReading,
  row: ReferenceRow,
  field: string,
): CostOfCapitalParameter | null {
  const value = row.values[field];

  if (
    value === null ||
    value === undefined ||
    !engineDecimalSchema.safeParse(value).success
  ) {
    return null;
  }

  return {
    name,
    value,
    datasetId: reading.release.datasetId,
    releaseId: reading.release.releaseId,
    rowKey: row.key,
    field,
    publishedLabel: reading.release.publishedLabel,
    availableAt: reading.release.availableAt,
  };
}

function rowOf(
  reading: ReferenceReading | null,
  key: string,
): ReferenceRow | null {
  return reading?.rows.find((row) => row.key === key) ?? null;
}

function largeNonfinancialBands(ratings: ReferenceReading) {
  return ratings.rows
    .filter((row) => row.key.startsWith("large-nonfinancial-"))
    .map((row) => ({ row, floor: row.values.coverage_above }))
    .filter(
      (entry): entry is { row: ReferenceRow; floor: string } =>
        typeof entry.floor === "string" &&
        engineDecimalSchema.safeParse(entry.floor).success,
    )
    .sort((left, right) =>
      parseDecimal(left.floor, "floor").cmp(parseDecimal(right.floor, "floor")),
    );
}

/**
 * El piso de la banda más alta de la tabla de ratings al corte, con su release
 * y su fila (`F6-15`): la cobertura desde la que los intereses no son el
 * servicio de una deuda material. `null` sin tabla.
 */
export function topCoverageFloor(
  ratings: ReferenceReading | null,
): CoverageFloor | null {
  const top =
    ratings === null ? undefined : largeNonfinancialBands(ratings).at(-1);

  return ratings === null || top === undefined
    ? null
    : {
        value: top.floor,
        datasetId: ratings.release.datasetId,
        releaseId: ratings.release.releaseId,
        rowKey: top.row.key,
        availableAt: ratings.release.availableAt,
      };
}

/**
 * El piso de la banda con esa etiqueta («Ba1/BB+») en la tabla al corte, con
 * su release y su fila (`F6-42`). `null` sin tabla o sin esa fila.
 */
export function ratingBandFloor(
  ratings: ReferenceReading | null,
  rating: string,
): CoverageFloor | null {
  const band =
    ratings === null
      ? undefined
      : largeNonfinancialBands(ratings).filter(
          (entry) => entry.row.values.rating === rating,
        );

  return ratings === null || band === undefined || band.length !== 1
    ? null
    : {
        value: band[0]!.floor,
        datasetId: ratings.release.datasetId,
        releaseId: ratings.release.releaseId,
        rowKey: band[0]!.row.key,
        availableAt: ratings.release.availableAt,
      };
}

/** La banda cuyo piso es el mayor que no supera la cobertura: `≥ piso`. */
function ratingBand(
  ratings: ReferenceReading,
  coverage: Dec,
): ReferenceRow | null {
  const bands = largeNonfinancialBands(ratings);

  let selected: ReferenceRow | null = null;

  for (const band of bands) {
    if (
      parseDecimal(band.floor, "coverage_above").lessThanOrEqualTo(coverage)
    ) {
      selected = band.row;
    }
  }

  return selected;
}

/** El año más reciente de la ERP implícita con ERP y bono publicados. */
function latestMarketYear(reading: ReferenceReading): ReferenceRow | null {
  return (
    [...reading.rows]
      .filter(
        (row) =>
          /^[0-9]{4}$/u.test(row.key) &&
          row.values.implied_erp != null &&
          row.values.treasury_bond_rate != null,
      )
      .sort((left, right) => right.key.localeCompare(left.key))[0] ?? null
  );
}

function componentOf(
  reading: ReferenceReading,
  row: ReferenceRow,
): ExposureComponent | null {
  const crp = row.values.country_risk_premium;
  const gdp = row.values.gdp_millions;

  if (typeof crp !== "string" || !engineDecimalSchema.safeParse(crp).success) {
    return null;
  }

  return {
    datasetId: reading.release.datasetId,
    releaseId: reading.release.releaseId,
    rowKey: row.key,
    countryRiskPremium: crp,
    gdpMillions:
      typeof gdp === "string" && engineDecimalSchema.safeParse(gdp).success
        ? gdp
        : null,
  };
}

/**
 * Las filas de cada exposición: un país, una región o —sin claves— las nueve
 * regiones. Una clave que la release no tiene, o una fila sin CRP o sin PBI, se
 * nombra en `missing`: nunca se completa con el domicilio.
 */
export function resolveOperationsExposure(
  mix: OperationsMixReading,
  countries: ReferenceReading | null,
  regions: ReferenceReading | null,
): { exposure: OperationsExposure | null; missing: string[] } {
  const missing: string[] = [];

  if (countries === null || regions === null) {
    return { exposure: null, missing: ["country_risk_regions"] };
  }

  const exposures = mix.exposures.map((item) => {
    const keys =
      item.exposureKeys.length === 0
        ? regions.rows.map((row) => row.key)
        : item.exposureKeys;
    const components = keys.flatMap((key) => {
      const country = rowOf(countries, key);
      const region = country === null ? rowOf(regions, key) : null;
      const component =
        country !== null
          ? componentOf(countries, country)
          : region !== null
            ? componentOf(regions, region)
            : null;

      if (component === null) {
        missing.push(`operations_exposure.${key}`);
        return [];
      }

      return [component];
    });

    // Combinar filas pide el PBI de cada una: sin él no hay ponderación.
    if (components.length > 1) {
      for (const component of components) {
        if (component.gdpMillions === null) {
          missing.push(`operations_exposure_gdp.${component.rowKey}`);
        }
      }
    }

    return {
      exposureKeys: [...item.exposureKeys],
      weight: item.weight,
      components,
    };
  });

  if (missing.length > 0) {
    return { exposure: null, missing };
  }

  return {
    exposure: operationsExposureSchema.parse({
      source: mix.source,
      proposalId: mix.proposalId,
      weightsVersion: mix.weightsVersion,
      exposures,
    }),
    missing,
  };
}

/** El CRP ponderado por operaciones: Σ peso × CRP de la exposición. */
export function operationsCountryRiskPremium(
  exposure: OperationsExposure,
): Dec {
  return exposure.exposures.reduce((total: Dec, item) => {
    const gdpOf = (component: ExposureComponent) => {
      if (component.gdpMillions === null) {
        throw new Error(`exposure row ${component.rowKey} has no GDP`);
      }
      return parseDecimal(component.gdpMillions, "gdp_millions");
    };
    const crp =
      item.components.length === 1
        ? parseDecimal(item.components[0]!.countryRiskPremium, "crp")
        : divide(
            item.components.reduce(
              (sum: Dec, component) =>
                sum.plus(
                  gdpOf(component).times(
                    parseDecimal(component.countryRiskPremium, "crp"),
                  ),
                ),
              ZERO,
            ),
            item.components.reduce(
              (sum: Dec, component) => sum.plus(gdpOf(component)),
              ZERO,
            ),
            "operations_crp",
          );

    return total.plus(parseDecimal(item.weight, "weight").times(crp));
  }, ZERO);
}

export function buildCostOfCapital(
  request: CostOfCapitalRequest,
): CostOfCapitalResult {
  const missing: string[] = [];
  const need = <T>(value: T | null, name: string): T | null => {
    if (value === null) missing.push(name);
    return value;
  };

  const curveCurrency = (CURVE_CURRENCIES as readonly string[]).includes(
    request.currency,
  );

  if (request.currency !== SUPPORTED_CURRENCY && !curveCurrency) {
    missing.push("currency_usd");
  }

  const sovereignKey = CURRENCY_SOVEREIGN[request.currency] ?? null;
  const domicile = request.domicileCountry ?? null;
  const countryIso = domicile ?? request.listingCountry;
  const countryKey =
    countryIso === null ? null : (COUNTRY_KEYS[countryIso] ?? null);
  const curveRow = curveCurrency
    ? currencyCurveRow(request.currencyRiskFree ?? null, missing)
    : null;

  const industryRow = need(
    request.industryKey === null
      ? null
      : rowOf(request.betas, request.industryKey),
    request.industryKey === null ? "industry_mapping" : "industry_beta",
  );
  const domicileRow = need(
    countryKey === null ? null : rowOf(request.countryRisk, countryKey),
    "domicile_country_risk",
  );
  const sovereignRow = need(
    sovereignKey === null ? null : rowOf(request.countryRisk, sovereignKey),
    "currency_sovereign_risk",
  );
  const marketRow = need(
    request.impliedErp === null ? null : latestMarketYear(request.impliedErp),
    "implied_erp",
  );
  const coverage = need(request.coverage, "interest_coverage");
  const band = need(
    request.ratings === null || coverage === null
      ? null
      : ratingBand(request.ratings, parseDecimal(coverage.value, "coverage")),
    "synthetic_rating",
  );

  const operations =
    request.operationsMix === undefined || request.operationsMix === null
      ? null
      : resolveOperationsExposure(
          request.operationsMix,
          request.countryRisk,
          request.regions ?? null,
        );

  missing.push(...(operations?.missing ?? []));

  const business =
    request.businessMix === undefined || request.businessMix === null
      ? null
      : resolveBusinessExposure(
          request.businessMix,
          request.betas,
          request.evToSales ?? null,
        );

  missing.push(...(business?.missing ?? []));

  if (
    missing.length > 0 ||
    industryRow === null ||
    domicileRow === null ||
    sovereignRow === null ||
    marketRow === null ||
    coverage === null ||
    band === null ||
    (curveCurrency && curveRow === null)
  ) {
    return { status: "unsupported", version: COST_OF_CAPITAL_VERSION, missing };
  }

  const candidates = [
    curveRow !== null
      ? parameter(
          "treasury_bond_rate",
          request.currencyRiskFree!.reading!,
          curveRow,
          request.currencyRiskFree!.field,
        )
      : parameter(
          "treasury_bond_rate",
          request.impliedErp!,
          marketRow,
          "treasury_bond_rate",
        ),
    parameter(
      "sovereign_default_spread",
      request.countryRisk!,
      sovereignRow,
      "default_spread",
    ),
    parameter("implied_erp", request.impliedErp!, marketRow, "implied_erp"),
    parameter(
      "country_risk_premium",
      request.countryRisk!,
      domicileRow,
      "country_risk_premium",
    ),
    parameter(
      "country_default_spread",
      request.countryRisk!,
      domicileRow,
      "default_spread",
    ),
    parameter(
      "marginal_tax_rate",
      request.countryRisk!,
      domicileRow,
      "corporate_tax_rate",
    ),
    parameter(
      "unlevered_beta",
      request.betas!,
      industryRow,
      "unlevered_beta_cash_corrected",
    ),
    parameter(
      "target_debt_to_equity",
      request.betas!,
      industryRow,
      "debt_to_equity",
    ),
    parameter("company_default_spread", request.ratings!, band, "spread"),
  ];

  const absent = candidates.flatMap((candidate, index) =>
    candidate === null
      ? [costOfCapitalParameterNameSchema.options[index]!]
      : [],
  );

  if (absent.length > 0) {
    return {
      status: "unsupported",
      version: COST_OF_CAPITAL_VERSION,
      missing: absent,
    };
  }

  const parameters = candidates as CostOfCapitalParameter[];
  const rating =
    typeof band.values.rating === "string" ? band.values.rating : "unrated";
  const exposure = operations?.exposure ?? null;
  const businessExposure = business?.exposure ?? null;

  return {
    status: "computed",
    costOfCapital: costOfCapitalSchema.parse({
      // Sin mezcla la corrida es `1.1.0` byte a byte, versión incluida: su
      // hash no se mueve por una regla que no la tocó.
      version: curveCurrency
        ? COST_OF_CAPITAL_CURRENCY_VERSION
        : businessExposure === null
          ? WITHOUT_BUSINESS_MIX_VERSION
          : COST_OF_CAPITAL_VERSION,
      currency: request.currency,
      industryKey: industryRow.key,
      countryKey: domicileRow.key,
      parameters,
      coverage,
      derived: deriveCostOfCapital(
        parameters,
        rating,
        exposure,
        businessExposure,
      ),
      operationsExposure: exposure,
      ...(businessExposure === null ? {} : { businessExposure }),
      declarations: [
        "riskfree_net_of_sovereign_default_spread",
        ...(curveCurrency ? ["riskfree_from_currency_government_curve"] : []),
        "erp_implied_at_start_of_year",
        ...(businessExposure === null
          ? ["industry_beta_us", "target_structure_industry_average"]
          : ["beta_by_business_mix", "target_structure_business_mix"]),
        ...(exposure === null
          ? [
              domicile === null
                ? "country_risk_by_primary_listing"
                : "country_risk_by_declared_domicile",
            ]
          : [
              "country_risk_by_operations",
              ...(exposure.exposures.some((item) => item.components.length > 1)
                ? ["regions_combined_by_gdp"]
                : []),
              ...(exposure.exposures.some(
                (item) => item.exposureKeys.length === 0,
              )
                ? ["rest_of_world_as_global"]
                : []),
            ]),
        "synthetic_rating_large_nonfinancial",
        ...(coverage.fromLatestFiscalYear
          ? []
          : ["coverage_from_earlier_fiscal_year"]),
        ...(coverage.interestBasis === undefined
          ? []
          : [COVERAGE_INTEREST_DECLARATION[coverage.interestBasis]]),
        "terminal_beta_converges_to_one",
      ],
    }),
  };
}

const DAY_MS = 86_400_000;

/** El último día de un período `aaaa-mm-dd` o `aaaa-mm`. */
function periodEnd(key: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(key)) return key;
  if (!/^\d{4}-\d{2}$/u.test(key)) return null;

  const [year, month] = key.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * La fila de la curva para el `as_of` (`1.3.0`): la última cuyo período cerró
 * en o antes del `as_of` y no tiene más días que los que la curva declara.
 * Nunca una posterior: el dato del día siguiente no se conocía.
 */
function currencyCurveRow(
  curve: NonNullable<CostOfCapitalRequest["currencyRiskFree"]> | null,
  missing: string[],
): ReferenceRow | null {
  if (curve === null || curve.reading === null) {
    missing.push("currency_risk_free");
    return null;
  }

  const candidates = curve.reading.rows
    .map((row) => ({ row, end: periodEnd(row.key) }))
    .filter(
      (entry): entry is { row: ReferenceRow; end: string } =>
        entry.end !== null && entry.end <= curve.asOf,
    )
    .sort((left, right) => right.end.localeCompare(left.end));
  const latest = candidates[0];

  if (latest === undefined) {
    missing.push("currency_risk_free");
    return null;
  }

  const age =
    (Date.parse(`${curve.asOf}T00:00:00.000Z`) -
      Date.parse(`${latest.end}T00:00:00.000Z`)) /
    DAY_MS;

  if (age > curve.maxAgeDays) {
    missing.push("currency_risk_free_stale");
    return null;
  }

  return latest.row;
}

/**
 * La aritmética, sólo desde los parámetros. Es lo que el motor recalcula desde
 * el snapshot de la corrida: un WACC escrito a mano que no coincide se rechaza.
 */
export function deriveCostOfCapital(
  parameters: readonly CostOfCapitalParameter[],
  syntheticRating: string,
  /** El mix de `1.1.0`: reemplaza el CRP del domicilio en la prima del equity. */
  operationsExposure: OperationsExposure | null = null,
  /** La mezcla de `1.2.0`: reemplaza la beta y la D/E de la industria propia. */
  businessExposure: BusinessExposure | null = null,
): CostOfCapitalDerived {
  const value = (name: CostOfCapitalParameterName): Dec => {
    const found = parameters.find((candidate) => candidate.name === name);

    if (found === undefined) {
      throw new Error(`cost of capital parameter ${name} is missing`);
    }

    return parseDecimal(found.value, name);
  };

  const riskFree = value("treasury_bond_rate").minus(
    value("sovereign_default_spread"),
  );
  const tax = value("marginal_tax_rate");
  const debtToEquity =
    businessExposure === null
      ? value("target_debt_to_equity")
      : parseDecimal(businessExposure.debtToEquity, "business_debt_to_equity");
  const unleveredBeta =
    businessExposure === null
      ? value("unlevered_beta")
      : parseDecimal(businessExposure.unleveredBeta, "business_unlevered_beta");
  const premium = value("implied_erp").plus(
    operationsExposure === null
      ? value("country_risk_premium")
      : operationsCountryRiskPremium(operationsExposure),
  );
  const leveredBeta = unleveredBeta.times(
    ONE.plus(ONE.minus(tax).times(debtToEquity)),
  );
  const costOfEquity = riskFree.plus(leveredBeta.times(premium));
  const preTaxCostOfDebt = riskFree
    .plus(value("company_default_spread"))
    .plus(value("country_default_spread"));
  const afterTaxCostOfDebt = preTaxCostOfDebt.times(ONE.minus(tax));
  const debtWeight = divide(
    debtToEquity,
    ONE.plus(debtToEquity),
    "debt_weight",
  );
  const equityWeight = ONE.minus(debtWeight);
  const terminalBeta = parseDecimal(TERMINAL_BETA, "terminal_beta");
  const terminalCostOfEquity = riskFree.plus(terminalBeta.times(premium));
  const blend = (equity: Dec) =>
    equityWeight.times(equity).plus(debtWeight.times(afterTaxCostOfDebt));

  if (debtToEquity.lessThan(ZERO)) {
    throw new Error("target debt to equity cannot be negative");
  }

  return {
    riskFree: formatDecimal(riskFree, "risk_free"),
    leveredBeta: formatDecimal(leveredBeta, "levered_beta"),
    costOfEquity: formatDecimal(costOfEquity, "cost_of_equity"),
    syntheticRating,
    preTaxCostOfDebt: formatDecimal(preTaxCostOfDebt, "pre_tax_cost_of_debt"),
    afterTaxCostOfDebt: formatDecimal(
      afterTaxCostOfDebt,
      "after_tax_cost_of_debt",
    ),
    equityWeight: formatDecimal(equityWeight, "equity_weight"),
    debtWeight: formatDecimal(debtWeight, "debt_weight"),
    wacc: formatDecimal(blend(costOfEquity), "wacc"),
    terminalBeta: formatDecimal(terminalBeta, "terminal_beta"),
    terminalCostOfEquity: formatDecimal(
      terminalCostOfEquity,
      "terminal_cost_of_equity",
    ),
    terminalWacc: formatDecimal(blend(terminalCostOfEquity), "terminal_wacc"),
  };
}
