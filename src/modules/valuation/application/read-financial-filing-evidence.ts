import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import {
  buildAnnualReportUrl,
  locateLatestAnnualReport,
} from "@/modules/fundamentals/domain/sec-annual-report";
import { readXbrlShareFacts } from "@/modules/fundamentals/domain/sec-xbrl-instance";

import {
  deriveFinancialFilingEvidence,
  type FinancialFilingEvidence,
} from "../domain/financial-filing-evidence";
import {
  deriveFinancialXbrlEvidence,
  FINANCIAL_XBRL_US_GAAP_CONCEPTS,
} from "../domain/financial-xbrl-evidence";
import { instanceDocumentOf } from "./read-captive-finance-filing";

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
  if (html !== null) {
    const result = deriveFinancialFilingEvidence({
      html,
      report: located.report,
      fiscalYearEnd: input.fiscalYearEnd,
      priorFiscalYearEnd: input.priorFiscalYearEnd,
    });
    if (result.status === "ready") return result.evidence;
  }
  // Sin las tablas que el lector HTML reconoce, el XBRL del mismo 10-K
  // (`F6-50`): una lectura medida más.
  const document = instanceDocumentOf(located.report.primaryDocument);
  if (document === null) return null;
  const xml = await readText(
    buildAnnualReportUrl(input.cik, located.report.accessionNumber, document),
    "application/xml",
  );
  if (xml === null) return null;
  const read = readXbrlShareFacts(xml, {
    usGaap: FINANCIAL_XBRL_US_GAAP_CONCEPTS,
    extension: [],
  });
  if (read.status !== "read") return null;
  const result = deriveFinancialXbrlEvidence({
    cik: input.cik,
    read: read.read,
    report: located.report,
    fiscalYearEnd: input.fiscalYearEnd,
    priorFiscalYearEnd: input.priorFiscalYearEnd,
  });
  return result.status === "ready" ? result.evidence : null;
}
