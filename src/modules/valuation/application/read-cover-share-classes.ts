import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import {
  buildAnnualReportUrl,
  locateLatestPeriodicReport,
} from "@/modules/fundamentals/domain/sec-annual-report";
import {
  readCoverShares,
  readXbrlShareFacts,
} from "@/modules/fundamentals/domain/sec-xbrl-instance";

import {
  DECLARED_SHARE_CLASS_CONVERSIONS,
  sumCoverShareClasses,
  type CoverShareClassesReading,
} from "../domain/cover-share-classes";
import { instanceDocumentOf } from "./read-captive-finance-filing";

export type CoverShareClassesRequest = {
  readonly cik: string;
  readonly knownAt: string;
};

/**
 * Dos lecturas medidas como mucho (`F6-32`): `submissions` y el instance del
 * último 10-Q o 10-K aceptado al corte. El documento queda en memoria; sólo el
 * conteo sumado llega al snapshot.
 */
export async function readCoverShareClassesEvidence(
  input: CoverShareClassesRequest,
  readText: (url: string, accept: string) => Promise<string | null>,
): Promise<CoverShareClassesReading | null> {
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
  const located = locateLatestPeriodicReport(payload, input.cik, input.knownAt);
  if (located.status !== "found") return null;
  const document = instanceDocumentOf(located.report.primaryDocument);
  if (document === null) return null;
  const xml = await readText(
    buildAnnualReportUrl(input.cik, located.report.accessionNumber, document),
    "application/xml",
  );
  if (xml === null) return null;
  const read = readCoverShares(xml);
  if (read.status !== "read") return null;
  // Las tasas de conversión viven en el mismo instance (`F6-49`).
  const conversion = DECLARED_SHARE_CLASS_CONVERSIONS[input.cik];
  const conversionRead =
    conversion === undefined
      ? null
      : readXbrlShareFacts(xml, {
          usGaap: [],
          extension: [conversion.conversionRate, conversion.asConvertedShares],
        });
  return sumCoverShareClasses({
    cik: input.cik,
    facts: read.facts,
    conversionFacts:
      conversionRead?.status === "read" ? conversionRead.read : null,
    accessionNumber: located.report.accessionNumber,
    acceptedAt: located.report.acceptedAt,
  });
}
