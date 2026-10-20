import { calendarDaysBetween } from "@/modules/temporal/domain/calendar-date";

import {
  divide,
  formatDecimal,
  parseDecimal,
  sum,
  ZERO,
} from "./decimal-policy";
import {
  SCALE_FACTOR,
  type EmployeeEquityOutput,
} from "./employee-equity-task";
import { parsePrintedAmount } from "./operations-mix-task";

/**
 * Lectura de una transcripción aceptada (`F4-05`, ADR 0040,
 * `employee-equity-reading-1.0.0`): lo que el código deriva de las cifras que
 * la IA copió. La IA no convierte nada; esto sí, y siempre igual.
 *
 * - Las cantidades se llevan a unidades con la escala de la nota.
 * - El plazo en años es el impreso; un año de vencimiento («will expire in
 *   2030») se lleva al 31 de diciembre de ese año desde el cierre, en años de
 *   365,25 días. Elegir el último día da más valor temporal a la opción, que
 *   es el lado conservador para el valor por acción.
 * - Sin strike impreso, la opción se valúa con strike cero: su valor máximo,
 *   el precio descontado. Nunca hace parecer la acción más valiosa de lo que
 *   es, y queda nombrado (`strike_unknown_upper_bound`).
 * - Las RSU y las PSU no consolidadas se suman: las dos se pagan en acciones.
 */
export const EMPLOYEE_EQUITY_READING_VERSION = "employee-equity-reading-1.0.0";

const DAYS_PER_YEAR = "365.25";

export type EmployeeEquityReading = {
  version: typeof EMPLOYEE_EQUITY_READING_VERSION;
  options:
    | { status: "none_disclosed" }
    | {
        status: "outstanding";
        count: string;
        strike: string;
        strikeBasis: "printed" | "strike_unknown_upper_bound";
        maturityYears: string;
        maturityBasis: "remaining_years" | "expiration_year";
      };
  /** RSU y PSU no consolidadas, en acciones. `0` sólo si la nota no tiene. */
  unvestedUnits: string;
  unitsBasis: "outstanding" | "none_disclosed";
};

export function readEmployeeEquity(
  output: EmployeeEquityOutput,
  fiscalYearEnd: string,
): EmployeeEquityReading {
  if (output.decision !== "proposed") {
    throw new TypeError("Only an accepted proposal can be read.");
  }

  const factor = parseDecimal(SCALE_FACTOR[output.scale!], "scale");
  const printed = (value: string, path: string) => {
    const amount = parsePrintedAmount(value);

    if (amount === null) {
      throw new TypeError(`${path} is not a printed amount.`);
    }

    return amount;
  };

  let options: EmployeeEquityReading["options"] = { status: "none_disclosed" };

  if (output.optionsStatus === "outstanding") {
    const life = parseDecimal(output.optionsLife!.trim(), "options.life");
    const maturity =
      output.optionsLifeBasis === "remaining_years"
        ? life
        : divide(
            parseDecimal(
              String(
                calendarDaysBetween(fiscalYearEnd, `${life.toFixed(0)}-12-31`),
              ),
              "options.days",
            ),
            parseDecimal(DAYS_PER_YEAR, "daysPerYear"),
            "options.maturity",
          );

    options = {
      status: "outstanding",
      count: formatDecimal(
        printed(output.optionsCount!, "options.count").times(factor),
        "options.count",
      ),
      strike:
        output.optionsStrike === null
          ? "0"
          : formatDecimal(
              printed(output.optionsStrike, "options.strike"),
              "options.strike",
            ),
      strikeBasis:
        output.optionsStrike === null
          ? "strike_unknown_upper_bound"
          : "printed",
      maturityYears: formatDecimal(maturity, "options.maturity"),
      maturityBasis: output.optionsLifeBasis!,
    };
  }

  const units =
    output.unitsStatus === "outstanding"
      ? sum(
          output.units.map((unit, index) =>
            printed(unit.count, `units.${index}`).times(factor),
          ),
        )
      : ZERO;

  return {
    version: EMPLOYEE_EQUITY_READING_VERSION,
    options,
    unvestedUnits: formatDecimal(units, "units"),
    unitsBasis: output.unitsStatus!,
  };
}
