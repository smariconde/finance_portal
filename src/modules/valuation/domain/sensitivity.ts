import { formatDecimal, parseDecimal, ZERO, type Dec } from "./decimal-policy";
import { computeFcff } from "./fcff";
import { hasValidTerminalSpread } from "./policy-checks";
import {
  isValuationPolicyError,
  ValuationPolicyError,
} from "./valuation-error";
import type { SensitivityAxis, ValuationInput } from "./valuation-input";

/**
 * Sensibilidad WACC/g (`docs/valuation/methodology.md`, sección "Escenarios y
 * sensibilidad"). Mantiene constantes los demás inputs, declara unidad, rango y
 * step, y marca explícitamente las celdas donde el modelo no está definido.
 *
 * El eje de WACC reemplaza el costo de capital de **todos** los períodos
 * explícitos y del terminal: es un único costo de capital, no un shock a uno
 * solo. Por lo tanto, un snapshot cuyo WACC no sea plano tendrá un caso base
 * que no coincide con ninguna celda; el snapshot demo lo mantiene plano a
 * propósito para que la tabla no contradiga al número principal.
 *
 * No es una distribución de probabilidad: cada celda es un escenario mecánico,
 * no un resultado más o menos probable que otro.
 */
export const MAX_SENSITIVITY_AXIS_POINTS = 11;

export type SensitivityAxisResult = {
  from: string;
  to: string;
  step: string;
  values: readonly string[];
};

export type SensitivityCell =
  | { status: "computed"; valuePerShare: string }
  | { status: "rejected"; reason: string };

export type SensitivityGrid = {
  unit: "value_per_share";
  currency: string;
  wacc: SensitivityAxisResult;
  terminalGrowth: SensitivityAxisResult;
  /** Una fila por WACC; cada celda sigue el orden del eje de `g`. */
  rows: readonly { wacc: string; cells: readonly SensitivityCell[] }[];
};

function expandAxis(axis: SensitivityAxis, path: string): Dec[] {
  const from = parseDecimal(axis.from, `${path}.from`);
  const to = parseDecimal(axis.to, `${path}.to`);
  const step = parseDecimal(axis.step, `${path}.step`);

  if (step.lte(ZERO)) {
    throw new ValuationPolicyError(
      "policy_check_failed",
      "A sensitivity axis needs a strictly positive step.",
      [`${path}.step`],
    );
  }

  if (from.gt(to)) {
    throw new ValuationPolicyError(
      "policy_check_failed",
      "A sensitivity axis must not end before it starts.",
      [`${path}.from`, `${path}.to`],
    );
  }

  const values: Dec[] = [];

  for (let value = from; value.lte(to); value = value.plus(step)) {
    values.push(value);

    if (values.length > MAX_SENSITIVITY_AXIS_POINTS) {
      throw new ValuationPolicyError(
        "policy_check_failed",
        `A sensitivity axis is limited to ${MAX_SENSITIVITY_AXIS_POINTS} points.`,
        [`${path}.step`],
      );
    }
  }

  return values;
}

export function buildSensitivityGrid(input: ValuationInput): SensitivityGrid {
  if (input.sensitivity === null) {
    throw new ValuationPolicyError(
      "policy_check_failed",
      "The snapshot declares no sensitivity grid.",
      ["sensitivity"],
    );
  }

  const waccValues = expandAxis(input.sensitivity.wacc, "sensitivity.wacc");
  const growthValues = expandAxis(
    input.sensitivity.terminalGrowth,
    "sensitivity.terminalGrowth",
  );

  const rows = waccValues.map((wacc) => {
    const waccText = formatDecimal(wacc, "sensitivity.wacc");

    return {
      wacc: waccText,
      cells: growthValues.map((growth): SensitivityCell => {
        // La celda inválida se declara; no se rellena con el valor vecino ni
        // con un guion que el lector deba interpretar.
        if (!hasValidTerminalSpread(wacc, growth)) {
          return {
            status: "rejected",
            reason: "terminal_growth_versus_wacc",
          };
        }

        try {
          return {
            status: "computed",
            valuePerShare: computeFcff(input, {
              wacc: waccText,
              terminalGrowth: formatDecimal(
                growth,
                "sensitivity.terminalGrowth",
              ),
            }).valuePerShare,
          };
        } catch (error) {
          if (isValuationPolicyError(error)) {
            return { status: "rejected", reason: error.code };
          }

          throw error;
        }
      }),
    };
  });

  return {
    unit: "value_per_share",
    currency: input.currency,
    wacc: {
      from: input.sensitivity.wacc.from,
      to: input.sensitivity.wacc.to,
      step: input.sensitivity.wacc.step,
      values: waccValues.map((value) => formatDecimal(value, "sensitivity")),
    },
    terminalGrowth: {
      from: input.sensitivity.terminalGrowth.from,
      to: input.sensitivity.terminalGrowth.to,
      step: input.sensitivity.terminalGrowth.step,
      values: growthValues.map((value) => formatDecimal(value, "sensitivity")),
    },
    rows,
  };
}
