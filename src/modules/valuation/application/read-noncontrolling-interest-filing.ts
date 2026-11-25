import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import {
  buildAnnualReportUrl,
  locateLatestAnnualReport,
  locateLatestPeriodicReport,
} from "@/modules/fundamentals/domain/sec-annual-report";
import { readXbrlShareFacts } from "@/modules/fundamentals/domain/sec-xbrl-instance";

import {
  NONCONTROLLING_INTEREST_US_GAAP_CONCEPTS,
  noncontrollingInterestEvidence,
  type NoncontrollingInterestEvidence,
} from "../domain/noncontrolling-interest-evidence";
import { instanceDocumentOf } from "./read-captive-finance-filing";

export type NoncontrollingInterestFilingRequest = {
  readonly cik: string;
  readonly knownAt: string;
  /** El cierre del patrimonio que usa la corrida: un 10-Q o el 10-K. */
  readonly asOf: string;
};

export type NoncontrollingInterestFilingResult =
  | NoncontrollingInterestEvidence
  | { readonly status: "unavailable"; readonly reason: "filing_unavailable" };

/**
 * El estado de patrimonio del filing cuyo cierre es el del balance de la
 * corrida (`F6-49`): el último 10-Q o 10-K visible al corte si cierra ese día,
 * si no el último 10-K. Dos lecturas medidas como mucho; el instance no se
 * guarda.
 */
export async function readNoncontrollingInterestFilingEvidence(
  input: NoncontrollingInterestFilingRequest,
  readText: (url: string, accept: string) => Promise<string | null>,
): Promise<NoncontrollingInterestFilingResult> {
  const unavailable = {
    status: "unavailable",
    reason: "filing_unavailable",
  } as const;
  const submissions = await readText(
    buildSubmissionsUrl(input.cik),
    "application/json",
  );
  if (submissions === null) return unavailable;
  let payload: unknown;
  try {
    payload = JSON.parse(submissions) as unknown;
  } catch {
    return unavailable;
  }
  const report = [
    locateLatestPeriodicReport(payload, input.cik, input.knownAt),
    locateLatestAnnualReport(payload, input.cik, input.knownAt),
  ]
    .flatMap((located) => (located.status === "found" ? [located.report] : []))
    .find((candidate) => candidate.reportDate === input.asOf);
  if (report === undefined) return unavailable;
  const document = instanceDocumentOf(report.primaryDocument);
  if (document === null) return unavailable;
  const xml = await readText(
    buildAnnualReportUrl(input.cik, report.accessionNumber, document),
    "application/xml",
  );
  if (xml === null) return unavailable;
  const read = readXbrlShareFacts(xml, {
    usGaap: NONCONTROLLING_INTEREST_US_GAAP_CONCEPTS,
    extension: [],
  });
  if (read.status !== "read") return unavailable;
  return noncontrollingInterestEvidence({
    cik: input.cik,
    asOf: input.asOf,
    accessionNumber: report.accessionNumber,
    read: read.read,
  });
}
