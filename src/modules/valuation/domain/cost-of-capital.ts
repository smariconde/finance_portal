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
 */
export const COST_OF_CAPITAL_VERSION = "cost-of-capital-1.0.0";

export const BETAS_DATASET = "damodaran.betas-us";
export const COUNTRY_RISK_DATASET = "damodaran.country-risk";
export const IMPLIED_ERP_DATASET = "damodaran.implied-erp";
export const RATINGS_DATASET = "damodaran.synthetic-ratings";

/** La beta de estado estable hacia la que converge la empresa. */
export const TERMINAL_BETA = "1";

/** La moneda cuyo libre de riesgo publica la tabla de ERP implícita. */
const SUPPORTED_CURRENCY = "USD";
const CURRENCY_SOVEREIGN: Readonly<Record<string, string>> = {
  USD: "united-states",
};

/** País de la tabla de Damodaran para cada país ISO del listing primario. */
const COUNTRY_KEYS: Readonly<Record<string, string>> = { US: "united-states" };

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
});

export type CoverageEvidence = z.infer<typeof coverageEvidenceSchema>;

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
  "terminal_beta_converges_to_one",
]);

export const costOfCapitalSchema = z.object({
  version: z.literal(COST_OF_CAPITAL_VERSION),
  currency: z.literal(SUPPORTED_CURRENCY),
  industryKey: z.string().max(128),
  countryKey: z.string().max(128),
  parameters: z.array(costOfCapitalParameterSchema).length(9),
  coverage: coverageEvidenceSchema,
  derived: costOfCapitalDerivedSchema,
  declarations: z.array(costOfCapitalDeclarationSchema).max(8),
});

export type CostOfCapital = z.infer<typeof costOfCapitalSchema>;

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
  readonly betas: ReferenceReading | null;
  readonly countryRisk: ReferenceReading | null;
  readonly impliedErp: ReferenceReading | null;
  readonly ratings: ReferenceReading | null;
  readonly coverage: CoverageEvidence | null;
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

/** La banda cuyo piso es el mayor que no supera la cobertura: `≥ piso`. */
function ratingBand(
  ratings: ReferenceReading,
  coverage: Dec,
): ReferenceRow | null {
  const bands = ratings.rows
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

export function buildCostOfCapital(
  request: CostOfCapitalRequest,
): CostOfCapitalResult {
  const missing: string[] = [];
  const need = <T>(value: T | null, name: string): T | null => {
    if (value === null) missing.push(name);
    return value;
  };

  if (request.currency !== SUPPORTED_CURRENCY) missing.push("currency_usd");

  const sovereignKey = CURRENCY_SOVEREIGN[request.currency] ?? null;
  const countryKey =
    request.listingCountry === null
      ? null
      : (COUNTRY_KEYS[request.listingCountry] ?? null);

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

  if (
    missing.length > 0 ||
    industryRow === null ||
    domicileRow === null ||
    sovereignRow === null ||
    marketRow === null ||
    coverage === null ||
    band === null
  ) {
    return { status: "unsupported", version: COST_OF_CAPITAL_VERSION, missing };
  }

  const candidates = [
    parameter(
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

  return {
    status: "computed",
    costOfCapital: costOfCapitalSchema.parse({
      version: COST_OF_CAPITAL_VERSION,
      currency: SUPPORTED_CURRENCY,
      industryKey: industryRow.key,
      countryKey: domicileRow.key,
      parameters,
      coverage,
      derived: deriveCostOfCapital(parameters, rating),
      declarations: [
        "riskfree_net_of_sovereign_default_spread",
        "erp_implied_at_start_of_year",
        "industry_beta_us",
        "target_structure_industry_average",
        "country_risk_by_primary_listing",
        "synthetic_rating_large_nonfinancial",
        ...(coverage.fromLatestFiscalYear
          ? []
          : ["coverage_from_earlier_fiscal_year"]),
        "terminal_beta_converges_to_one",
      ],
    }),
  };
}

/**
 * La aritmética, sólo desde los parámetros. Es lo que el motor recalcula desde
 * el snapshot de la corrida: un WACC escrito a mano que no coincide se rechaza.
 */
export function deriveCostOfCapital(
  parameters: readonly CostOfCapitalParameter[],
  syntheticRating: string,
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
  const debtToEquity = value("target_debt_to_equity");
  const premium = value("implied_erp").plus(value("country_risk_premium"));
  const leveredBeta = value("unlevered_beta").times(
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
