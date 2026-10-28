import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import { locateLatestAnnualReport } from "@/modules/fundamentals/domain/sec-annual-report";

import {
  deriveFinancialFilingEvidence,
  type FinancialFilingEvidence,
} from "../domain/financial-filing-evidence";

export type FinancialFilingRequest = {
  readonly cik: string;
  readonly knownAt: string;
  readonly fiscalYearEnd: string;
  readonly priorFiscalYearEnd: string;
};

/** The source boundary supplies a rights-checked, metered text reader. */
export async function readFinancialFilingEvidence(
  input: FinancialFilingRequest,
  readText: (url: string, accept: string) => Promise<string | null>,
): Promise<FinancialFilingEvidence | null> {
  const submissions = await readText(
    buildSubmissionsUrl(input.cik),
    "application/json",
  );
  if (submissions === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(submissions) as unknown;
  } catch {
    return null;
  }
  const located = locateLatestAnnualReport(payload, input.cik, input.knownAt);
  if (
    located.status !== "found" ||
    located.report.reportDate !== input.fiscalYearEnd
  )
    return null;
  const html = await readText(located.report.url, "text/html");
  if (html === null) return null;
  const result = deriveFinancialFilingEvidence({
    html,
    report: located.report,
    fiscalYearEnd: input.fiscalYearEnd,
    priorFiscalYearEnd: input.priorFiscalYearEnd,
  });
  return result.status === "ready" ? result.evidence : null;
}
