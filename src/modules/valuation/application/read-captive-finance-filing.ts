import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import {
  buildAnnualReportUrl,
  locateLatestAnnualReport,
} from "@/modules/fundamentals/domain/sec-annual-report";
import { readXbrlInstance } from "@/modules/fundamentals/domain/sec-xbrl-instance";

import type { CaptiveFinanceFiling } from "../domain/captive-finance";

export type CaptiveFinanceFilingRequest = {
  readonly cik: string;
  readonly knownAt: string;
  readonly fiscalYearEnd: string;
};

/**
 * El instance que EDGAR extrae del iXBRL vive junto al 10-K con el nombre del
 * documento primario más `_htm.xml` (`F6-23`, ADR 0082). El nombre primario ya
 * es plano: lo validó el localizador.
 */
export function instanceDocumentOf(primaryDocument: string): string | null {
  return /\.html?$/u.test(primaryDocument)
    ? primaryDocument.replace(/\.html?$/u, "_htm.xml")
    : null;
}

/**
 * Dos lecturas medidas como mucho: `submissions` y el instance del 10-K visible
 * al corte cuyo cierre es el ejercicio base. El documento queda en memoria; sólo
 * los hechos de la apertura llegan al snapshot.
 */
export async function readCaptiveFinanceFilingEvidence(
  input: CaptiveFinanceFilingRequest,
  readText: (url: string, accept: string) => Promise<string | null>,
): Promise<CaptiveFinanceFiling | null> {
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
  const document = instanceDocumentOf(located.report.primaryDocument);
  if (document === null) return null;
  const xml = await readText(
    buildAnnualReportUrl(input.cik, located.report.accessionNumber, document),
    "application/xml",
  );
  if (xml === null) return null;
  const read = readXbrlInstance(xml);
  return read.status === "read"
    ? {
        accessionNumber: located.report.accessionNumber,
        acceptedAt: located.report.acceptedAt,
        reportDate: input.fiscalYearEnd,
        instance: read.instance,
      }
    : null;
}
