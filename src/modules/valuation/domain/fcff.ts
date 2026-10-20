import { adjustForFailure, type FailureAdjustment } from "./failure-adjustment";
import { failureProbability } from "./failure-risk";
import {
  divide,
  formatDecimal,
  ONE,
  parseDecimal,
  sum,
  ZERO,
  type Dec,
} from "./decimal-policy";
import {
  BRIDGE_ITEM_KEYS,
  type BridgeItemKey,
  type ClaimStatus,
  type ValuationInput,
} from "./valuation-input";
import { ValuationPolicyError } from "./valuation-error";

/**
 * Motor FCFF base para no financieras maduras
 * (`docs/valuation/methodology.md`, sección "FCFF no financiera").
 *
 * Es una función pura de su snapshot: no lee repositorios, no consulta
 * proveedores, no invoca IA y no observa el reloj. El redondeo ocurre sólo al
 * serializar el resultado; entre pasos se conserva la precisión del motor.
 */
export type PeriodProjection = {
  periodIndex: number;
  periodEnd: string;
  revenue: string;
  revenueChange: string;
  ebit: string;
  nopat: string;
  reinvestmentConvention: "sales_to_capital" | "return_on_capital";
  /** Sólo existe bajo la convención `return_on_capital`. */
  reinvestmentRate: string | null;
  reinvestment: string;
  fcff: string;
  wacc: string;
  discountFactor: string;
  presentValue: string;
};

export type TerminalProjection = {
  growth: string;
  wacc: string;
  revenue: string;
  ebit: string;
  nopat: string;
  reinvestmentRate: string;
  fcff: string;
  terminalValue: string;
  discountFactor: string;
  presentValue: string;
};

export type BridgeComponent = {
  key: BridgeItemKey;
  status: ClaimStatus;
  sign: "add" | "subtract";
  /** Un `declared_absent` vale cero **y lo dice**; un faltante no llega acá. */
  value: string;
  rationale: string | null;
};

export type FcffComputation = {
  periods: readonly PeriodProjection[];
  terminal: TerminalProjection;
  enterpriseValue: string;
  failureAdjustment: FailureAdjustment;
  bridgeComponents: readonly BridgeComponent[];
  equityValue: string;
  /** Acciones en circulación más unidades no consolidadas (`F4-05`). */
  shareCount: string;
  valuePerShare: string;
  /** `null` cuando el enterprise value es cero y la proporción no existe. */
  terminalValueShare: string | null;
};

/** Escenario de sensibilidad: reemplaza WACC y `g` dejando lo demás fijo. */
export type FcffOverride = {
  wacc?: string;
  terminalGrowth?: string;
  /** Current-margin comparison for normalized FCFF, explicitly held constant. */
  ebitMargin?: string;
};

const BRIDGE_SIGNS: Record<BridgeItemKey, "add" | "subtract"> = {
  excessCash: "add",
  nonOperatingAssets: "add",
  debt: "subtract",
  leaseDebt: "subtract",
  minorityInterest: "subtract",
  otherClaims: "subtract",
  employeeOptions: "subtract",
};

export function computeFcff(
  input: ValuationInput,
  override: FcffOverride = {},
): FcffComputation {
  const overrideWacc =
    override.wacc === undefined
      ? null
      : parseDecimal(override.wacc, "override.wacc");
  const terminalGrowth = parseDecimal(
    override.terminalGrowth ?? input.terminal.growth,
    "terminal.growth",
  );

  let revenue = parseDecimal(input.baseRevenue.value, "baseRevenue.value");
  let discountFactor = ONE;
  const periods: PeriodProjection[] = [];
  const presentValues: Dec[] = [];

  for (const period of input.periods) {
    const path = `periods.${period.periodIndex - 1}`;
    const growth = parseDecimal(period.revenueGrowth, `${path}.revenueGrowth`);
    const wacc = overrideWacc ?? parseDecimal(period.wacc, `${path}.wacc`);

    const previousRevenue = revenue;
    revenue = previousRevenue.times(ONE.plus(growth));
    const revenueChange = revenue.minus(previousRevenue);

    const ebit = revenue.times(
      parseDecimal(
        override.ebitMargin ?? period.ebitMargin,
        `${path}.ebitMargin`,
      ),
    );
    // The cycle method never grants an immediate tax credit for an operating
    // loss. Carryforwards need a separate, evidenced model; mature FCFF is frozen.
    const nopat =
      input.method === "normalized_fcff" && ebit.lte(ZERO)
        ? ebit
        : ebit.times(
            ONE.minus(parseDecimal(period.taxRate, `${path}.taxRate`)),
          );

    let reinvestment: Dec;
    let reinvestmentRate: Dec | null = null;

    if (period.reinvestment.convention === "sales_to_capital") {
      // `reinvestment_t = revenue_change_t / sales_to_capital_t`.
      reinvestment = divide(
        revenueChange,
        parseDecimal(
          period.reinvestment.salesToCapital,
          `${path}.reinvestment.salesToCapital`,
        ),
        `${path}.reinvestment.salesToCapital`,
      );
    } else {
      // `reinvestment_rate = growth / roic` y `reinvestment = nopat * rate`.
      reinvestmentRate = divide(
        growth,
        parseDecimal(
          period.reinvestment.returnOnCapital,
          `${path}.reinvestment.returnOnCapital`,
        ),
        `${path}.reinvestment.returnOnCapital`,
      );
      reinvestment = nopat.times(reinvestmentRate);
    }

    const fcff = nopat.minus(reinvestment);
    // `discount_factor_t = product(1 + wacc_i)`: acumulado, no una potencia de
    // una tasa promedio, para que un WACC por período sea representable.
    discountFactor = discountFactor.times(ONE.plus(wacc));
    const presentValue = divide(fcff, discountFactor, `${path}.discountFactor`);

    presentValues.push(presentValue);
    periods.push({
      periodIndex: period.periodIndex,
      periodEnd: period.periodEnd,
      revenue: formatDecimal(revenue, `${path}.revenue`),
      revenueChange: formatDecimal(revenueChange, `${path}.revenueChange`),
      ebit: formatDecimal(ebit, `${path}.ebit`),
      nopat: formatDecimal(nopat, `${path}.nopat`),
      reinvestmentConvention: period.reinvestment.convention,
      reinvestmentRate:
        reinvestmentRate === null
          ? null
          : formatDecimal(reinvestmentRate, `${path}.reinvestmentRate`),
      reinvestment: formatDecimal(reinvestment, `${path}.reinvestment`),
      fcff: formatDecimal(fcff, `${path}.fcff`),
      wacc: formatDecimal(wacc, `${path}.wacc`),
      discountFactor: formatDecimal(discountFactor, `${path}.discountFactor`),
      presentValue: formatDecimal(presentValue, `${path}.presentValue`),
    });
  }

  const terminalWacc =
    overrideWacc ?? parseDecimal(input.terminal.wacc, "terminal.wacc");
  const terminalRevenue = revenue.times(ONE.plus(terminalGrowth));
  const terminalEbit = terminalRevenue.times(
    parseDecimal(
      override.ebitMargin ?? input.terminal.ebitMargin,
      "terminal.ebitMargin",
    ),
  );
  const terminalNopat =
    input.method === "normalized_fcff" && terminalEbit.lte(ZERO)
      ? terminalEbit
      : terminalEbit.times(
          ONE.minus(parseDecimal(input.terminal.taxRate, "terminal.taxRate")),
        );
  const terminalReinvestmentRate = divide(
    terminalGrowth,
    parseDecimal(input.terminal.returnOnCapital, "terminal.returnOnCapital"),
    "terminal.returnOnCapital",
  );
  const terminalFcff = terminalNopat.times(ONE.minus(terminalReinvestmentRate));
  const terminalValue = divide(
    terminalFcff,
    terminalWacc.minus(terminalGrowth),
    "terminal.wacc",
  );
  const terminalPresentValue = divide(
    terminalValue,
    discountFactor,
    "terminal.discountFactor",
  );

  const goingConcernValue = sum(presentValues).plus(terminalPresentValue);
  const capital = input.normalization.investedCapital;
  if (capital.status !== "resolved")
    throw new ValuationPolicyError(
      "policy_check_failed",
      "Recovery requires reported book capital.",
      ["normalization.investedCapital"],
    );
  const failureAdjustment = adjustForFailure({
    goingConcernValue: formatDecimal(goingConcernValue, "goingConcernValue"),
    probability: failureProbability(input.failureRisk),
    bookCapital: capital.reported,
  });
  const enterpriseValue = parseDecimal(
    failureAdjustment.adjustedOperatingValue,
    "enterpriseValue",
  );

  const bridgeComponents: BridgeComponent[] = [];
  let equityValue = enterpriseValue;

  for (const key of BRIDGE_ITEM_KEYS) {
    const item = input.bridge[key];

    if (item.status === "missing") {
      // Defensa en profundidad: `checkValuationInput` ya rechaza este caso, y
      // llegar acá igual falla en vez de asumir cero (`TM-05`).
      throw new ValuationPolicyError(
        "policy_check_failed",
        "A missing claim cannot be valued as zero.",
        [`bridge.${key}`],
      );
    }

    const sign = BRIDGE_SIGNS[key];
    const value =
      item.amount === null
        ? ZERO
        : parseDecimal(item.amount.value, `bridge.${key}.amount.value`);

    equityValue =
      sign === "add" ? equityValue.plus(value) : equityValue.minus(value);

    bridgeComponents.push({
      key,
      status: item.status,
      sign,
      value: formatDecimal(value, `bridge.${key}`),
      rationale: item.rationale,
    });
  }

  const shareCount = parseDecimal(
    input.employeeEquity.derived.shareCount,
    "employeeEquity.derived.shareCount",
  );
  const valuePerShare = divide(
    equityValue,
    shareCount,
    "employeeEquity.derived.shareCount",
  );

  return {
    periods,
    terminal: {
      growth: formatDecimal(terminalGrowth, "terminal.growth"),
      wacc: formatDecimal(terminalWacc, "terminal.wacc"),
      revenue: formatDecimal(terminalRevenue, "terminal.revenue"),
      ebit: formatDecimal(terminalEbit, "terminal.ebit"),
      nopat: formatDecimal(terminalNopat, "terminal.nopat"),
      reinvestmentRate: formatDecimal(
        terminalReinvestmentRate,
        "terminal.reinvestmentRate",
      ),
      fcff: formatDecimal(terminalFcff, "terminal.fcff"),
      terminalValue: formatDecimal(terminalValue, "terminal.terminalValue"),
      discountFactor: formatDecimal(discountFactor, "terminal.discountFactor"),
      presentValue: formatDecimal(
        terminalPresentValue,
        "terminal.presentValue",
      ),
    },
    enterpriseValue: formatDecimal(enterpriseValue, "enterpriseValue"),
    failureAdjustment,
    bridgeComponents,
    equityValue: formatDecimal(equityValue, "equityValue"),
    shareCount: formatDecimal(shareCount, "shareCount"),
    valuePerShare: formatDecimal(valuePerShare, "valuePerShare"),
    terminalValueShare: goingConcernValue.isZero()
      ? null
      : formatDecimal(
          terminalPresentValue.div(goingConcernValue),
          "terminalValueShare",
        ),
  };
}
