import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import { locateLatestAnnualReport } from "@/modules/fundamentals/domain/sec-annual-report";

import {
  deriveGrowthTaxEvidence,
  type GrowthTaxReading,
} from "../domain/growth-tax-evidence";

export type GrowthTaxFilingRequest = {
  readonly cik: string;
  readonly knownAt: string;
  readonly fiscalYearEnd: string;
};

/** Two metered reads at most; the 10-K stays in memory only. */
export async function readGrowthTaxFilingEvidence(
  input: GrowthTaxFilingRequest,
  readText: (url: string, accept: string) => Promise<string | null>,
): Promise<GrowthTaxReading> {
  const submissions = await readText(
    buildSubmissionsUrl(input.cik),
    "application/json",
  );
  if (submissions === null)
    return { status: "unavailable", reason: "tax_note_missing" };
  let payload: unknown;
  try {
    payload = JSON.parse(submissions) as unknown;
  } catch {
    return { status: "unavailable", reason: "tax_note_missing" };
  }
  const located = locateLatestAnnualReport(payload, input.cik, input.knownAt);
  if (located.status !== "found")
    return { status: "unavailable", reason: "tax_note_missing" };
  if (located.report.reportDate !== input.fiscalYearEnd)
    return { status: "unavailable", reason: "filing_year_mismatch" };
  const html = await readText(located.report.url, "text/html");
  if (html === null)
    return { status: "unavailable", reason: "tax_note_missing" };
  return deriveGrowthTaxEvidence({
    html,
    report: located.report,
    fiscalYearEnd: input.fiscalYearEnd,
  });
}
