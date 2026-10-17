import {
  buildCostOfCapital,
  COUNTRY_RISK_REGIONS_DATASET,
} from "../domain/cost-of-capital";
import { lineRecordsOf } from "../domain/operations-mix";
import {
  operationsMixReadingOf,
  QUALITATIVE_DECISIONS_VERSION,
  qualitativeDecisionsSchema,
} from "../domain/qualitative-decisions";
import {
  valuationInputSchema,
  type ValuationInput,
} from "../domain/valuation-input";

import {
  DEMO_COST_OF_CAPITAL_REQUEST,
  DEMO_VALUATION_INPUT,
} from "./demo-valuation-fixtures";

/**
 * `FixtureCo` valuada con industria y mix **propuestos por la IA** (`F5-06`):
 * la misma corrida de referencia, con el SIC 3576 —ambiguo entre equipos de
 * telecomunicaciones y computadoras— resuelto por una resolución, y un mix
 * transcripto de una tabla geográfica sintética. Todas las filas de riesgo país
 * tienen CRP cero, así que el WACC sigue en el 9 % y el valor por acción no se
 * mueve: lo que cambia es lo que el snapshot explica, y por eso su hash.
 *
 * Los IDs, modelos y hashes son de fixture; ninguna cifra es de una fuente.
 */
export const DEMO_AI_RESOLUTION_ID = "6f2a1c58-0d94-4d1b-9c3f-2b7a5e10c4a1";
export const DEMO_AI_PROPOSAL_ID = "6f2a1c58-0d94-4d1b-9c3f-2b7a5e10c4a2";

const DOCUMENT_URL =
  "https://www.sec.gov/Archives/edgar/data/42/000000004225000007/fixco-20241231.htm";
const ACCESSION = "0000000042-25-000007";
const ACCEPTED_AT = "2025-02-14T21:05:00.000Z";

export const DEMO_AI_QUALITATIVE_DECISIONS = qualitativeDecisionsSchema.parse({
  version: QUALITATIVE_DECISIONS_VERSION,
  industry: {
    basis: "ai_resolution",
    mappingVersion: "sic-damodaran-industry-1.1.0",
    industryKey: "computers-peripherals",
    sic: "3576",
    candidates: ["telecom-equipment", "computers-peripherals"],
    resolution: {
      resolutionId: DEMO_AI_RESOLUTION_ID,
      taskVersion: "industry-resolution-1.0.0",
      promptVersion: "industry-resolution-prompt-1.0.0",
      ladderVersion: "ai-model-ladder-1.0.0",
      sectionsVersion: "sec-10k-sections-1.0.0",
      respondedModel: "fixture/model-a",
      acceptedRung: 1,
      confidence: "high",
      rationale:
        "Item 1 describes servers and storage arrays sold to data centers.",
      citedEvidenceIds: ["E1"],
      resolvedAt: "2025-05-20T12:00:00.000Z",
      evidence: [
        {
          evidenceId: "E1",
          sourceId: "sec-edgar",
          section: "item_1_business",
          documentUrl: DOCUMENT_URL,
          accessionNumber: ACCESSION,
          documentAcceptedAt: ACCEPTED_AT,
          sha256: "1".repeat(64),
          byteLength: 18_204,
          truncated: false,
        },
      ],
    },
  },
  operationsMix: {
    source: "ai_proposal",
    weightsVersion: "operations-mix-weights-1.0.0",
    proposal: {
      proposalId: DEMO_AI_PROPOSAL_ID,
      taskVersion: "operations-mix-1.0.0",
      promptVersion: "operations-mix-prompt-1.1.0",
      policyVersion: "operations-mix-policy-1.1.0",
      ladderVersion: "ai-model-ladder-1.0.0",
      extractVersion: "sec-10k-geographic-revenue-1.0.0",
      accessionNumber: ACCESSION,
      fiscalYearEnd: "2024-12-31",
      countryReleaseId: "00000000-0000-4000-8000-0000000000b2",
      regionReleaseId: "00000000-0000-4000-8000-0000000000b5",
      unit: "thousands",
      printedTotal: "$ 1,000,000",
      expectedRevenue: "1000000000",
      confidence: "high",
      respondedModel: "fixture/model-b",
      acceptedRung: 2,
      proposedAt: "2025-05-20T12:05:00.000Z",
    },
    lines: lineRecordsOf([
      {
        label: "United States",
        amount: "$ 700,000",
        quote: "United States $ 700,000",
        evidenceId: "E1",
        basis: "name_match",
        exposureKeys: ["united-states"],
        definitionQuote: null,
      },
      {
        label: "Rest of world",
        amount: "300,000",
        quote: "Rest of world 300,000",
        evidenceId: "E1",
        basis: "rest_of_world",
        exposureKeys: [],
        definitionQuote: null,
      },
    ]),
    evidence: [
      {
        evidenceId: "E1",
        sourceId: "sec-edgar",
        section: "geographic_revenue",
        documentUrl: DOCUMENT_URL,
        accessionNumber: ACCESSION,
        documentAcceptedAt: ACCEPTED_AT,
        sha256: "2".repeat(64),
        byteLength: 96,
        truncated: false,
      },
    ],
  },
});

const REGIONS = {
  release: {
    ...DEMO_COST_OF_CAPITAL_REQUEST.countryRisk.release,
    datasetId: COUNTRY_RISK_REGIONS_DATASET,
    releaseId: "00000000-0000-4000-8000-0000000000b5",
  },
  rows: [
    ["north-america", "North America", "30000"],
    ["western-europe", "Western Europe", "22000"],
    ["asia", "Asia", "34000"],
  ].map(([key, label, gdp]) => ({
    key: key!,
    label: label!,
    values: { country_risk_premium: "0", gdp_millions: gdp! },
  })),
};

const RESULT = buildCostOfCapital({
  ...DEMO_COST_OF_CAPITAL_REQUEST,
  regions: REGIONS,
  operationsMix: operationsMixReadingOf(
    DEMO_AI_QUALITATIVE_DECISIONS.operationsMix!,
  ),
});

if (RESULT.status !== "computed") {
  throw new Error(`the AI demo cost of capital must build: ${RESULT.missing}`);
}

export const DEMO_AI_COST_OF_CAPITAL = RESULT.costOfCapital;

export const DEMO_AI_VALUATION_INPUT: ValuationInput =
  valuationInputSchema.parse({
    ...DEMO_VALUATION_INPUT,
    costOfCapital: DEMO_AI_COST_OF_CAPITAL,
    qualitativeDecisions: DEMO_AI_QUALITATIVE_DECISIONS,
  });
