import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import {
  buildAnnualReportUrl,
  locateLatestAnnualReport,
  type SecAnnualReport,
} from "@/modules/fundamentals/domain/sec-annual-report";
import { parseSecCompanyConcept } from "@/modules/fundamentals/domain/parse-sec-company-concept";
import { readXbrlShareFacts } from "@/modules/fundamentals/domain/sec-xbrl-instance";
import { buildCompanyConceptUrl } from "@/modules/corporate-actions/application/live-split-claim-source";

import {
  deriveFinancialFilingEvidence,
  type FinancialFilingEvidence,
} from "../domain/financial-filing-evidence";
import type { ExcessReturnProfile } from "../domain/asset-profile";
import {
  deriveFinancialXbrlEvidence,
  type EarlierAnnualFact,
  FINANCIAL_XBRL_EXTENSION_CONCEPTS,
  FINANCIAL_XBRL_US_GAAP_CONCEPTS,
} from "../domain/financial-xbrl-evidence";
import { instanceDocumentOf } from "./read-captive-finance-filing";

export type FinancialFilingRequest = {
  readonly cik: string;
  readonly knownAt: string;
  readonly fiscalYearEnd: string;
  readonly priorFiscalYearEnd: string;
  /** `F6-53`: un broker-dealer va directo al XBRL; el lector HTML es de JPM y PRU. */
  readonly assetProfile?: ExcessReturnProfile;
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
  const html =
    input.assetProfile === "broker_dealer"
      ? null
      : await readText(located.report.url, "text/html");
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
  const readInstance = async (report: SecAnnualReport) => {
    const document = instanceDocumentOf(report.primaryDocument);
    if (document === null) return null;
    const xml = await readText(
      buildAnnualReportUrl(input.cik, report.accessionNumber, document),
      "application/xml",
    );
    if (xml === null) return null;
    const read = readXbrlShareFacts(xml, {
      usGaap: FINANCIAL_XBRL_US_GAAP_CONCEPTS,
      extension: FINANCIAL_XBRL_EXTENSION_CONCEPTS,
    });
    return read.status === "read" ? read.read : null;
  };
  const read = await readInstance(located.report);
  if (read === null) return null;
  const earlierFacts: EarlierAnnualFact[] = [];
  const asked = new Set<string>();
  // `F6-53`: un ejercicio del trienio que el último 10-K ya no etiqueta se
  // lee de `companyconcept` por el concepto que el 10-K usa los otros años,
  // una lectura medida más por concepto y sólo entonces (dos a lo sumo).
  for (;;) {
    const result = deriveFinancialXbrlEvidence({
      cik: input.cik,
      read,
      report: located.report,
      fiscalYearEnd: input.fiscalYearEnd,
      priorFiscalYearEnd: input.priorFiscalYearEnd,
      assetProfile: input.assetProfile,
      earlierFacts: asked.size === 0 ? undefined : earlierFacts,
    });
    if (result.status === "ready") return result.evidence;
    if (
      result.reason !== "payout_year_unpublished" ||
      asked.has(result.concept) ||
      asked.size >= 2
    ) {
      return null;
    }
    asked.add(result.concept);
    const [taxonomy, concept] = result.concept.split(":") as [string, string];
    const text = await readText(
      buildCompanyConceptUrl(input.cik, { taxonomy, concept }),
      "application/json",
    );
    if (text === null) continue;
    const parsed = parseSecCompanyConcept(text, { taxonomy, concept });
    // Un documento de otro filer no es evidencia de éste.
    if (!parsed.ok || parsed.cik !== input.cik) return null;
    earlierFacts.push(...parsed.facts);
  }
}
