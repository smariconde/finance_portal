import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import type {
  AnnualFundamentals,
  FiscalYear,
  LineItemId,
  LineItemValue,
} from "./annual-fundamentals";
import {
  divide,
  formatDecimal,
  parseDecimal,
  toFixedScale,
  ZERO,
  type Dec,
} from "./decimal-policy";
import {
  profileEvidenceSchema,
  type ProfileEvidence,
  type SignalProfile,
} from "./method-selection";

/**
 * Señales de distress, pérdidas persistentes y alto crecimiento desde la serie
 * anual (`F3-01`).
 *
 * Cada umbral es parte de la versión. Dos tienen fuente externa y uno es una
 * decisión del proyecto, y la diferencia se dice:
 *
 * - **Distress**: cobertura de intereses `EBIT / intereses` menor a 1,25 en los
 *   dos últimos ejercicios. Es el borde inferior de `B-` en la tabla de rating
 *   sintético de Damodaran para empresas grandes: por debajo empiezan `CCC`, `CC`,
 *   `C` y `D`, los ratings con los que él modela la probabilidad de quiebra
 *   ([ratings.html](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ratings.html)).
 *   También es distress un patrimonio negativo con EBIT negativo.
 * - **Pérdidas persistentes**: EBIT negativo en al menos dos de los tres últimos
 *   ejercicios. El sistema de valuación pide «signo y persistencia» y no fija
 *   número: **dos de tres es una decisión del proyecto**, elegida para que un año
 *   malo aislado no cambie el método.
 * - **Alto crecimiento**: ventas que crecen al 15 % anual compuesto o más en los
 *   tres últimos ejercicios. Damodaran no publica un corte; el 15 % es una
 *   **decisión del proyecto** y la muestra del gate mide dónde cae.
 *
 * Cuando falta el EBIT se usa el resultado antes de impuestos más los intereses,
 * y la salida lo nombra. Si tampoco hay eso, la señal queda sin evidencia: nunca
 * se completa un faltante con cero (`TM-05`).
 */
export const FUNDAMENTAL_PROFILE_SIGNALS_VERSION =
  "fundamental-profile-signals-1.0.0";

/** Borde de cobertura bajo el cual el rating sintético es `CCC` o peor. */
export const DISTRESS_COVERAGE_THRESHOLD = "1.25";
/** Ejercicios con EBIT negativo, de los tres últimos, que hacen persistente la pérdida. */
export const PERSISTENT_LOSS_YEARS = 2;
export const PERSISTENT_LOSS_WINDOW = 3;
/** Crecimiento anual compuesto de ventas que separa alto crecimiento. */
export const HIGH_GROWTH_ANNUAL_RATE = "0.15";
export const HIGH_GROWTH_YEARS = 3;

export type FundamentalSignalState = "present" | "absent" | "unknown";

export type FundamentalSignal = {
  readonly profile: Extract<
    SignalProfile,
    "distressed" | "loss_making" | "high_growth"
  >;
  readonly state: FundamentalSignalState;
  /** Por qué se decidió así, en códigos estables. */
  readonly basis: readonly string[];
  /** Lo que faltó para decidir, cuando quedó sin evidencia. */
  readonly missing: readonly string[];
  /** Las medidas que la regla comparó, ya redondeadas para leer. */
  readonly measures: Readonly<Record<string, string>>;
  /** Las partidas que sostienen la decisión, con su provenance. */
  readonly inputs: readonly LineItemValue[];
};

type Ebit = {
  readonly value: Dec;
  readonly basis: "operating_income" | "pretax_plus_interest";
  readonly inputs: readonly LineItemValue[];
};

function item(year: FiscalYear | undefined, id: LineItemId) {
  return year?.items[id];
}

function sameCurrency(values: readonly LineItemValue[]): boolean {
  return new Set(values.map((value) => value.currency)).size <= 1;
}

function ebitOf(year: FiscalYear | undefined): Ebit | null {
  const operating = item(year, "operating_income");

  if (operating !== undefined) {
    return {
      value: parseDecimal(operating.value, "operating_income"),
      basis: "operating_income",
      inputs: [operating],
    };
  }

  const pretax = item(year, "pretax_income");
  const interest = item(year, "interest_expense");

  if (
    pretax === undefined ||
    interest === undefined ||
    !sameCurrency([pretax, interest])
  ) {
    return null;
  }

  return {
    value: parseDecimal(pretax.value, "pretax_income").plus(
      parseDecimal(interest.value, "interest_expense"),
    ),
    basis: "pretax_plus_interest",
    inputs: [pretax, interest],
  };
}

const COVERAGE_LIMIT = parseDecimal(DISTRESS_COVERAGE_THRESHOLD, "threshold");

function coverageOf(
  year: FiscalYear | undefined,
): { value: Dec; inputs: LineItemValue[] } | null {
  const ebit = ebitOf(year);
  const interest = item(year, "interest_expense");

  if (ebit === null || interest === undefined) {
    return null;
  }

  const interestValue = parseDecimal(interest.value, "interest_expense");
  const inputs = [...ebit.inputs, interest];

  if (interestValue.lessThanOrEqualTo(ZERO) || !sameCurrency(inputs)) {
    return null;
  }

  return {
    value: divide(ebit.value, interestValue, "interest_coverage"),
    inputs,
  };
}

function display(value: Dec, path: string): string {
  return toFixedScale(value, 4, path);
}

function unique(values: readonly LineItemValue[]): LineItemValue[] {
  return [
    ...new Map(values.map((value) => [value.observationId, value])).values(),
  ];
}

type Branch = "true" | "false" | "undecided";

/**
 * Distress se decide por dos ramas, cada una verdadera, falsa o indecidible:
 * cobertura baja dos años seguidos, o patrimonio negativo con pérdida operativa.
 * Si alguna es verdadera hay distress; si las dos son falsas, no lo hay.
 *
 * Cuando una rama no se puede decidir —típicamente porque el emisor dejó de
 * publicar intereses, como Apple desde 2024— todavía hay dos pruebas de ausencia:
 * resultado operativo positivo dos años con patrimonio positivo, o caja que cubre
 * todo el pasivo. Sin ninguna, la señal queda sin evidencia y lo dice.
 */
function distressSignal(series: AnnualFundamentals): FundamentalSignal {
  const [latest, prior] = series.fiscalYears;
  const coverageLatest = coverageOf(latest);
  const coveragePrior = coverageOf(prior);
  const ebitLatest = ebitOf(latest);
  const ebitPrior = ebitOf(prior);
  const equity = item(latest, "equity");
  const cash = item(latest, "cash");
  const liquid = item(latest, "liquid_investments");
  const liabilities = item(latest, "liabilities");
  const equityValue =
    equity === undefined ? null : parseDecimal(equity.value, "equity");

  const measures: Record<string, string> = {};
  if (coverageLatest !== null) {
    measures.coverageLatest = display(coverageLatest.value, "coverage");
  }
  if (coveragePrior !== null) {
    measures.coveragePrior = display(coveragePrior.value, "coverage");
  }

  const below = (coverage: { value: Dec } | null) =>
    coverage !== null && coverage.value.lessThan(COVERAGE_LIMIT);
  const atOrAbove = (coverage: { value: Dec } | null) =>
    coverage !== null && coverage.value.greaterThanOrEqualTo(COVERAGE_LIMIT);

  const coverageBranch: Branch =
    below(coverageLatest) && below(coveragePrior)
      ? "true"
      : atOrAbove(coverageLatest) || atOrAbove(coveragePrior)
        ? "false"
        : "undecided";

  const equityBranch: Branch =
    equityValue !== null &&
    ebitLatest !== null &&
    equityValue.lessThanOrEqualTo(ZERO) &&
    ebitLatest.value.lessThan(ZERO)
      ? "true"
      : (equityValue !== null && equityValue.greaterThan(ZERO)) ||
          (ebitLatest !== null && ebitLatest.value.greaterThanOrEqualTo(ZERO))
        ? "false"
        : "undecided";

  const coverageInputs = [
    ...(coverageLatest?.inputs ?? []),
    ...(coveragePrior?.inputs ?? []),
  ];
  const equityInputs = [
    ...(equity === undefined ? [] : [equity]),
    ...(ebitLatest?.inputs ?? []),
  ];

  if (coverageBranch === "true") {
    return {
      profile: "distressed",
      state: "present",
      basis: ["coverage_below_threshold_two_years"],
      missing: [],
      measures,
      inputs: unique(coverageInputs),
    };
  }

  if (equityBranch === "true") {
    return {
      profile: "distressed",
      state: "present",
      basis: ["negative_equity_and_operating_loss"],
      missing: [],
      measures,
      inputs: unique(equityInputs),
    };
  }

  if (coverageBranch === "false" && equityBranch === "false") {
    return {
      profile: "distressed",
      state: "absent",
      basis: [
        "coverage_not_below_threshold_two_years",
        "no_negative_equity_with_loss",
      ],
      missing: [],
      measures,
      inputs: unique([...coverageInputs, ...equityInputs]),
    };
  }

  if (
    equityValue !== null &&
    equityValue.greaterThan(ZERO) &&
    ebitLatest !== null &&
    ebitPrior !== null &&
    ebitLatest.value.greaterThan(ZERO) &&
    ebitPrior.value.greaterThan(ZERO)
  ) {
    return {
      profile: "distressed",
      state: "absent",
      basis: ["positive_equity_and_operating_income_two_years"],
      missing: [],
      measures,
      inputs: unique([equity!, ...ebitLatest.inputs, ...ebitPrior.inputs]),
    };
  }

  // Sin EBIT ni cobertura, el resultado neto: positivo dos años ya pagó los
  // intereses con lo que gana. Es una alternativa declarada y la salida la nombra.
  const netLatest = item(latest, "net_income");
  const netPrior = item(prior, "net_income");
  if (
    equityValue !== null &&
    equityValue.greaterThan(ZERO) &&
    netLatest !== undefined &&
    netPrior !== undefined &&
    parseDecimal(netLatest.value, "net_income").greaterThan(ZERO) &&
    parseDecimal(netPrior.value, "net_income").greaterThan(ZERO)
  ) {
    return {
      profile: "distressed",
      state: "absent",
      basis: ["positive_equity_and_net_income_two_years"],
      missing: [],
      measures,
      inputs: unique([equity!, netLatest, netPrior]),
    };
  }

  // Caja (y, si está publicada, inversiones líquidas) contra **todo** el pasivo.
  // Sin inversiones se compara la caja sola: subestima la liquidez, así que sólo
  // puede dejar de probar la ausencia, nunca inventarla.
  const liquidity = liquid === undefined ? [cash] : [cash, liquid];
  if (
    cash !== undefined &&
    liabilities !== undefined &&
    sameCurrency([...liquidity, liabilities] as LineItemValue[])
  ) {
    const available = parseDecimal(cash.value, "cash").plus(
      liquid === undefined ? ZERO : parseDecimal(liquid.value, "liquid"),
    );

    if (
      available.greaterThanOrEqualTo(
        parseDecimal(liabilities.value, "liabilities"),
      )
    ) {
      return {
        profile: "distressed",
        state: "absent",
        basis: ["liquid_assets_cover_liabilities"],
        missing: [],
        measures,
        inputs: unique([...(liquidity as LineItemValue[]), liabilities]),
      };
    }
  }

  const missing: string[] = [];
  if (latest === undefined) missing.push("fiscal_year");
  if (coverageBranch === "undecided") missing.push("interest_coverage");
  if (equityBranch === "undecided") missing.push("equity_and_ebit");

  return {
    profile: "distressed",
    state: "unknown",
    basis: [],
    missing: missing.length === 0 ? ["distress_rule_inconclusive"] : missing,
    measures,
    inputs: [],
  };
}

function lossSignal(series: AnnualFundamentals): FundamentalSignal {
  const window = series.fiscalYears.slice(0, PERSISTENT_LOSS_WINDOW);
  const ebits = window.map(ebitOf);
  const known = ebits.filter((ebit): ebit is Ebit => ebit !== null);
  const losses = known.filter((ebit) => ebit.value.lessThan(ZERO)).length;
  const inputs = unique(known.flatMap((ebit) => ebit.inputs));
  const bases = [...new Set(known.map((ebit) => `ebit_${ebit.basis}`))];
  const measures = {
    lossYears: String(losses),
    knownYears: String(known.length),
  };

  if (losses >= PERSISTENT_LOSS_YEARS) {
    return {
      profile: "loss_making",
      state: "present",
      basis: ["operating_losses_persist", ...bases],
      missing: [],
      measures,
      inputs,
    };
  }

  if (
    known.length === PERSISTENT_LOSS_WINDOW &&
    ebits.length === PERSISTENT_LOSS_WINDOW
  ) {
    return {
      profile: "loss_making",
      state: "absent",
      basis: ["operating_losses_not_persistent", ...bases],
      missing: [],
      measures,
      inputs,
    };
  }

  return {
    profile: "loss_making",
    state: "unknown",
    basis: [],
    missing: [`ebit.last_${PERSISTENT_LOSS_WINDOW}_fiscal_years`],
    measures,
    inputs: [],
  };
}

const GROWTH_FACTOR = (() => {
  const rate = parseDecimal(HIGH_GROWTH_ANNUAL_RATE, "growth").plus(1);
  return rate.pow(HIGH_GROWTH_YEARS);
})();

/** Tres años son entre 1.090 y 1.100 días; con semanas de 52/53, ±10 alcanza. */
const MIN_SPAN_DAYS = 365 * HIGH_GROWTH_YEARS - 10;
const MAX_SPAN_DAYS = 366 * HIGH_GROWTH_YEARS + 10;

function growthSignal(series: AnnualFundamentals): FundamentalSignal {
  const latest = series.fiscalYears[0];
  const base = series.fiscalYears[HIGH_GROWTH_YEARS];
  const latestRevenue = item(latest, "revenue");
  const baseRevenue = item(base, "revenue");

  const unknown = (missing: string): FundamentalSignal => ({
    profile: "high_growth",
    state: "unknown",
    basis: [],
    missing: [missing],
    measures: {},
    inputs: [],
  });

  if (latestRevenue === undefined || baseRevenue === undefined) {
    return unknown(`revenue.last_${HIGH_GROWTH_YEARS + 1}_fiscal_years`);
  }

  const spanDays =
    (Date.parse(`${latest!.fiscalYearEnd}T00:00:00.000Z`) -
      Date.parse(`${base!.fiscalYearEnd}T00:00:00.000Z`)) /
    86_400_000;

  if (spanDays < MIN_SPAN_DAYS || spanDays > MAX_SPAN_DAYS) {
    return unknown("revenue.consecutive_fiscal_years");
  }

  if (!sameCurrency([latestRevenue, baseRevenue])) {
    return unknown("revenue.single_currency");
  }

  const start = parseDecimal(baseRevenue.value, "revenue.base");
  const end = parseDecimal(latestRevenue.value, "revenue.latest");

  if (start.lessThanOrEqualTo(ZERO)) {
    return unknown("revenue.positive_base");
  }

  const ratio = divide(end, start, "revenue_growth_ratio");
  const present = ratio.greaterThanOrEqualTo(GROWTH_FACTOR);

  return {
    profile: "high_growth",
    state: present ? "present" : "absent",
    basis: [
      present
        ? "revenue_growth_at_or_above_threshold"
        : "revenue_growth_below_threshold",
    ],
    missing: [],
    measures: {
      revenueRatio: display(ratio, "revenue_growth_ratio"),
      thresholdRatio: display(GROWTH_FACTOR, "threshold"),
    },
    inputs: [latestRevenue, baseRevenue],
  };
}

/** Bases que no son el dato principal de su regla: la confianza las descuenta. */
const DECLARED_ALTERNATIVE_BASES: ReadonlySet<string> = new Set([
  "ebit_pretax_plus_interest",
  "positive_equity_and_net_income_two_years",
  "liquid_assets_cover_liabilities",
]);

/**
 * Cobertura de intereses para el rating sintético del costo de deuda (`F3-06`):
 * la del último ejercicio que publica EBIT e intereses. Si el último no publicó
 * intereses —Apple dejó de hacerlo en 2024—, se toma el anterior más reciente que
 * sí, y la salida lo dice: es una alternativa, no el dato del año.
 */
export function latestInterestCoverage(series: AnnualFundamentals): {
  readonly value: string;
  readonly fiscalYearEnd: string;
  readonly fromLatestFiscalYear: boolean;
  readonly availableAt: string;
} | null {
  for (const [index, year] of series.fiscalYears.entries()) {
    const coverage = coverageOf(year);

    if (coverage !== null) {
      return {
        value: formatDecimal(coverage.value, "interest_coverage"),
        fiscalYearEnd: year.fiscalYearEnd,
        fromLatestFiscalYear: index === 0,
        availableAt: latestOf(
          coverage.inputs.map((input) => input.availableAt),
        ),
      };
    }
  }

  return null;
}

export type FundamentalProfileSignals = {
  readonly version: typeof FUNDAMENTAL_PROFILE_SIGNALS_VERSION;
  readonly signals: readonly FundamentalSignal[];
  readonly evidence: readonly ProfileEvidence[];
};

function latestOf(values: readonly string[]): string {
  return [...values].sort((left, right) => right.localeCompare(left))[0]!;
}

/**
 * Evalúa las tres reglas y convierte las decididas en evidencia fechada. La
 * evidencia rige desde el cierre del último ejercicio usado y se conoce cuando la
 * última partida que la sostiene se publicó: la misma señal no puede verse antes
 * de que su dato existiera.
 */
export function assessFundamentalProfileSignals(
  legalEntityId: string,
  series: AnnualFundamentals,
  sourceId: string,
): FundamentalProfileSignals {
  const signals = [
    distressSignal(series),
    lossSignal(series),
    growthSignal(series),
  ];

  const evidence = signals
    .filter((signal) => signal.state !== "unknown")
    .map((signal) => {
      const latestInput = [...signal.inputs].sort((left, right) =>
        right.asOf.localeCompare(left.asOf),
      )[0]!;

      return profileEvidenceSchema.parse({
        legalEntityId,
        profile: signal.profile,
        present: signal.state === "present",
        rule: FUNDAMENTAL_PROFILE_SIGNALS_VERSION,
        // El EBIT reconstruido desde el resultado antes de impuestos es una
        // alternativa en cualquier regla que lo use, aunque su base no lo diga.
        derivation:
          signal.basis.some((basis) => DECLARED_ALTERNATIVE_BASES.has(basis)) ||
          signal.inputs.some((input) => input.item === "pretax_income")
            ? "declared_alternative"
            : "primary",
        validFrom: `${latestInput.asOf}T00:00:00.000Z`,
        validTo: null,
        availableAt: latestOf(signal.inputs.map((input) => input.availableAt)),
        supersededAt: null,
        recordedAt: latestOf(signal.inputs.map((input) => input.recordedAt)),
        sourceId,
        sourceDocumentId: latestInput.sourceDocumentId,
        contentHash: computeContentHash({
          rule: FUNDAMENTAL_PROFILE_SIGNALS_VERSION,
          profile: signal.profile,
          state: signal.state,
          basis: signal.basis,
          inputs: signal.inputs.map((input) => ({
            observationId: input.observationId,
            value: formatDecimal(
              parseDecimal(input.value, input.item),
              input.item,
            ),
          })),
        }),
      });
    });

  return { version: FUNDAMENTAL_PROFILE_SIGNALS_VERSION, signals, evidence };
}
