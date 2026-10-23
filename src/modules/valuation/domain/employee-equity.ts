import { z } from "zod";

import { calendarDaysBetween } from "@/modules/temporal/domain/calendar-date";

import {
  divide,
  engineDecimalSchema,
  formatDecimal,
  parseDecimal,
  sum,
  ZERO,
  type Dec,
} from "./decimal-policy";
import {
  employeeEquityAbstainReasonSchema,
  employeeEquityOutputSchema,
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
 * - Con la vida impresa sólo por tramos de strike (Incyte), el plazo es el
 *   promedio de las vidas ponderado por la cantidad de cada tramo.
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
        maturityBasis: "remaining_years" | "expiration_year" | "range_rows";
      };
  /** RSU y PSU no consolidadas, en acciones. `0` sólo si la nota no tiene. */
  unvestedUnits: string;
  unitsBasis: "outstanding" | "none_disclosed";
};

function maturityOf(
  output: EmployeeEquityOutput,
  fiscalYearEnd: string,
  printed: (value: string, path: string) => Dec,
): Dec {
  if (output.optionsLifeBasis === "range_rows") {
    const counts = output.optionsRanges.map((range, index) =>
      printed(range.count, `options.ranges.${index}.count`),
    );
    const weighted = sum(
      output.optionsRanges.map((range, index) =>
        counts[index]!.times(
          parseDecimal(range.life.trim(), `options.ranges.${index}.life`),
        ),
      ),
    );

    return divide(weighted, sum(counts), "options.maturity");
  }

  const life = parseDecimal(output.optionsLife!.trim(), "options.life");

  if (output.optionsLifeBasis === "remaining_years") {
    return life;
  }

  return divide(
    parseDecimal(
      String(calendarDaysBetween(fiscalYearEnd, `${life.toFixed(0)}-12-31`)),
      "options.days",
    ),
    parseDecimal(DAYS_PER_YEAR, "daysPerYear"),
    "options.maturity",
  );
}

export function readEmployeeEquity(
  output: EmployeeEquityOutput,
  fiscalYearEnd: string,
): EmployeeEquityReading {
  if (output.decision !== "proposed") {
    throw new TypeError("Only an accepted proposal can be read.");
  }

  // Sin opciones vivas la tarea `1.3.0` puede no dar `scale`: sólo la usan
  // las opciones y, en una transcripción anterior, las unidades.
  const scaleOf = (scale: EmployeeEquityOutput["scale"], path: string) =>
    parseDecimal(SCALE_FACTOR[scale!], path);
  const printed = (value: string, path: string) => {
    const amount = parsePrintedAmount(value);

    if (amount === null) {
      throw new TypeError(`${path} is not a printed amount.`);
    }

    return amount;
  };

  let options: EmployeeEquityReading["options"] = { status: "none_disclosed" };

  if (output.optionsStatus === "outstanding") {
    const maturity = maturityOf(output, fiscalYearEnd, printed);

    options = {
      status: "outstanding",
      count: formatDecimal(
        printed(output.optionsCount!, "options.count").times(
          scaleOf(output.scale, "scale"),
        ),
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

  // Las unidades con su propia escala si la tarea la dio (`employee-equity-1.3.0`).
  const unitsScale =
    output.unitsScale === undefined || output.unitsScale === null
      ? output.scale
      : output.unitsScale;
  const units =
    output.unitsStatus === "outstanding"
      ? sum(
          output.units.map((unit, index) =>
            printed(unit.count, `units.${index}`).times(
              scaleOf(unitsScale, "unitsScale"),
            ),
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

/**
 * Lo que se guarda de cada vez que se le preguntó a la escalera (`F4-05`):
 * la propuesta, con la transcripción aceptada tal cual la validó la policy, y
 * la nota que se le mandó al modelo. La lectura no se guarda: se recalcula de
 * la transcripción, siempre igual. Los intentos y su costo están en el libro
 * de gasto bajo el mismo `proposalId`, que es el `task_run_id` de la escalera.
 */
export const employeeEquityEvidenceRecordSchema = z.object({
  sourceId: z.string().min(3).max(64),
  documentUrl: z.url(),
  accessionNumber: z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
  documentAcceptedAt: z.iso.datetime({ offset: true }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  byteLength: z.number().int().min(1),
  truncated: z.boolean(),
  excerpt: z.string().min(1),
});

export type EmployeeEquityEvidenceRecord = z.infer<
  typeof employeeEquityEvidenceRecordSchema
>;

export const employeeEquityOutcomeSchema = z.enum([
  "accepted",
  "abstained",
  "stopped",
]);

export const KNOWN_EMPLOYEE_EQUITY_ABSTAIN_REASONS = [
  ...employeeEquityAbstainReasonSchema.options,
  "low_confidence",
  "ai_budget_exhausted",
  "ladder_exhausted",
] as const;

export const employeeEquityProposalSchema = z
  .object({
    proposalId: z.uuid(),
    legalEntityId: z.uuid(),
    cik: z.string().regex(/^[0-9]{10}$/u),
    accessionNumber: z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
    fiscalYearEnd: z.iso.date(),
    taskVersion: z.string().min(1).max(64),
    promptVersion: z.string().min(1).max(64),
    policyVersion: z.string().min(1).max(64),
    ladderVersion: z.string().min(1).max(64),
    extractVersion: z.string().min(1).max(64),
    /**
     * Lo que el XBRL publicaba al corte para el cierre, sin dimensiones: con
     * qué se corroboró la transcripción. `null` es que el filer no lo publicó.
     */
    xbrlOptionsOutstanding: engineDecimalSchema.nullable(),
    xbrlWeightedStrike: engineDecimalSchema.nullable(),
    outcome: employeeEquityOutcomeSchema,
    /** La respuesta aceptada, validada por la policy; `null` si no se aceptó. */
    transcription: employeeEquityOutputSchema.nullable(),
    reason: z.string().max(64).nullable(),
    acceptedRung: z.number().int().min(1).max(16).nullable(),
    respondedModel: z.string().max(128).nullable(),
    proposedAt: z.iso.datetime({ offset: true }),
    recordedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((proposal, context) => {
    const accepted = proposal.outcome === "accepted";

    if (accepted === (proposal.reason !== null)) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A reason is recorded exactly when not accepted.",
      });
    }

    if (
      accepted !==
      (proposal.transcription !== null &&
        proposal.transcription.decision === "proposed")
    ) {
      context.addIssue({
        code: "custom",
        path: ["transcription"],
        message: "A transcription is recorded exactly when accepted.",
      });
    }
  });

export type EmployeeEquityProposal = z.infer<
  typeof employeeEquityProposalSchema
>;

export function employeeEquityDocumentId(proposalId: string): string {
  return `employee-equity/${proposalId}`;
}
