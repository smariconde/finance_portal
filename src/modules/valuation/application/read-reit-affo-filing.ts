import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import {
  locateLatestAnnualReport,
  type SecAnnualReport,
} from "@/modules/fundamentals/domain/sec-annual-report";
import {
  extractTenKReitAffo,
  type ReitAffoExtract,
} from "@/modules/fundamentals/domain/sec-10k-reit-affo";

export type ReitAffoFilingRequest = {
  readonly cik: string;
  readonly knownAt: string;
  readonly fiscalYearEnd: string;
};

export type ReitAffoFilingReading =
  | {
      readonly status: "ready";
      readonly sourceDocumentId: string;
      readonly availableAt: string;
      readonly extract: ReitAffoExtract;
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "submissions_unavailable"
        | "annual_report_unavailable"
        | "filing_year_mismatch"
        | "filing_unavailable"
        | "annual_reconciliation_missing";
    };

/** The same deterministic reader serves the metered probe and AI proposal. */
export function readReitAffoFromReport(
  report: SecAnnualReport,
  fiscalYearEnd: string,
  html: string,
): ReitAffoFilingReading {
  if (report.reportDate !== fiscalYearEnd)
    return { status: "unavailable", reason: "filing_year_mismatch" };
  const extract = extractTenKReitAffo(html, fiscalYearEnd);
  if (extract === null)
    return { status: "unavailable", reason: "annual_reconciliation_missing" };
  return {
    status: "ready",
    sourceDocumentId: report.accessionNumber,
    availableAt: report.acceptedAt,
    extract,
  };
}

/** Two metered SEC reads at most. The filing stays in memory. */
export async function readReitAffoFilingEvidence(
  input: ReitAffoFilingRequest,
  readText: (url: string, accept: string) => Promise<string | null>,
): Promise<ReitAffoFilingReading> {
  const submissions = await readText(
    buildSubmissionsUrl(input.cik),
    "application/json",
  );
  if (submissions === null)
    return { status: "unavailable", reason: "submissions_unavailable" };
  let payload: unknown;
  try {
    payload = JSON.parse(submissions) as unknown;
  } catch {
    return { status: "unavailable", reason: "submissions_unavailable" };
  }
  const located = locateLatestAnnualReport(payload, input.cik, input.knownAt);
  if (located.status !== "found")
    return { status: "unavailable", reason: "annual_report_unavailable" };
  if (located.report.reportDate !== input.fiscalYearEnd)
    return { status: "unavailable", reason: "filing_year_mismatch" };
  const html = await readText(located.report.url, "text/html");
  if (html === null)
    return { status: "unavailable", reason: "filing_unavailable" };
  return readReitAffoFromReport(located.report, input.fiscalYearEnd, html);
}
