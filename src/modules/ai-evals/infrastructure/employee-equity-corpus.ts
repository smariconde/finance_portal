import type { EmployeeEquityInput } from "@/modules/valuation/domain/employee-equity-task";

import type { EvalCorpusManifest } from "./eval-corpus";

/** Same unique-value rule as xbrlValueAtYearEnd, over frozen selected rows. */
export function readEmployeeEquityCorroboration(
  manifest: EvalCorpusManifest,
  declared: { cik: string; accessionNumber: string; fiscalYearEnd: string },
): EmployeeEquityInput["xbrl"] {
  const read = (field: "optionsOutstanding" | "weightedStrike") => {
    const rows = manifest.employeeEquityXbrl.filter(
      (row) => row.cik === declared.cik && row.field === field,
    );
    const [row] = rows;
    if (
      rows.length !== 1 ||
      row === undefined ||
      row.accessionNumber !== declared.accessionNumber ||
      row.fiscalYearEnd !== declared.fiscalYearEnd
    )
      throw new Error(
        `Missing or inconsistent frozen ${field} for ${declared.cik}.`,
      );
    const values = new Set(row.values);
    return values.size === 1 ? [...values][0]! : null;
  };
  return {
    optionsOutstanding: read("optionsOutstanding"),
    weightedStrike: read("weightedStrike"),
  };
}
