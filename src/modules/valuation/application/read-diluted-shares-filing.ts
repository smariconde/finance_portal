import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import {
  buildAnnualReportUrl,
  locateLatestAnnualReport,
} from "@/modules/fundamentals/domain/sec-annual-report";
import { readXbrlShareFacts } from "@/modules/fundamentals/domain/sec-xbrl-instance";

import {
  DILUTED_SHARES_US_GAAP_CONCEPTS,
  reconcileDilutedShares,
  type DilutedSharesReading,
} from "../domain/diluted-shares-reconciled";
import { instanceDocumentOf } from "./read-captive-finance-filing";

export type DilutedSharesFilingRequest = {
  /**
   * El CIK vigente primero y después sus antecesores declarados: el 10-K de
   * FY2025 de ExxonMobil lo presentó la sociedad anterior (0000034088), no la
   * holding nueva.
   */
  readonly ciks: readonly string[];
  readonly knownAt: string;
  readonly fiscalYearEnd: string;
};

export type DilutedSharesFilingResult =
  | DilutedSharesReading
  | {
      readonly status: "unavailable";
      readonly reason: "filing_unavailable";
    };

/**
 * Las acciones diluidas del último ejercicio cuando companyfacts no las trae
 * (`F6-49`): por CIK del linaje, `submissions` y, si su 10-K visible al corte
 * cierra el último ejercicio de la serie, su instance. El documento queda en
 * memoria; sólo la conciliación llega al snapshot.
 */
export async function readDilutedSharesFilingEvidence(
  input: DilutedSharesFilingRequest,
  readText: (url: string, accept: string) => Promise<string | null>,
): Promise<DilutedSharesFilingResult> {
  for (const cik of input.ciks) {
    const result = await readForCik(cik, input, readText);
    if (result !== null) return result;
  }
  return { status: "unavailable", reason: "filing_unavailable" };
}

/** `null` si ese CIK no tiene el 10-K del ejercicio: se prueba el siguiente. */
async function readForCik(
  cik: string,
  input: DilutedSharesFilingRequest,
  readText: (url: string, accept: string) => Promise<string | null>,
): Promise<DilutedSharesFilingResult | null> {
  const submissions = await readText(
    buildSubmissionsUrl(cik),
    "application/json",
  );
  if (submissions === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(submissions) as unknown;
  } catch {
    return null;
  }
  const located = locateLatestAnnualReport(payload, cik, input.knownAt);
  if (
    located.status !== "found" ||
    located.report.reportDate !== input.fiscalYearEnd
  )
    return null;
  const document = instanceDocumentOf(located.report.primaryDocument);
  if (document === null) return null;
  const xml = await readText(
    buildAnnualReportUrl(cik, located.report.accessionNumber, document),
    "application/xml",
  );
  if (xml === null) return null;
  const read = readXbrlShareFacts(xml, {
    usGaap: DILUTED_SHARES_US_GAAP_CONCEPTS,
    extension: [],
  });
  if (read.status !== "read") return null;
  return reconcileDilutedShares(
    {
      accessionNumber: located.report.accessionNumber,
      acceptedAt: located.report.acceptedAt,
      fiscalYearEnd: input.fiscalYearEnd,
      read: read.read,
    },
    cik,
  );
}
