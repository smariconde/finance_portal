/**
 * Sucesión sintética con la forma del cable de la SEC.
 *
 * Ningún CIK, accession, fecha ni nombre proviene de una descarga: el repositorio
 * es público. Lo que sí copia del caso real medido el 2026-09-14 es la **forma**:
 *
 * - el antecesor presenta 10-K y 10-Q hasta la reorganización;
 * - el sucesor aparece con una `8-K12B` el día del evento, sin reportes propios
 *   anteriores;
 * - el 10-Q del trimestre que cerró **antes** de la vigencia se presenta después y
 *   figura en los dos índices, porque es conjunto;
 * - el antecesor presenta un `25-NSE` al día siguiente.
 */
import type { SecFiling } from "@/modules/fundamentals/domain/parse-sec-submissions";
import {
  identityGraphSchema,
  type IdentityGraph,
} from "@/modules/identity/domain/identity-graph";

import {
  declaredSuccessionSchema,
  type DeclaredSuccession,
} from "../domain/reporting-succession";

export const FIXTURE_PREDECESSOR_CIK = "0000000071";
export const FIXTURE_SUCCESSOR_CIK = "0000000072";
export const FIXTURE_PREDECESSOR_NAME = "PREDECESORA SINTETICA CORP";
export const FIXTURE_SUCCESSOR_NAME = "Sucesora Sintética Holdings";
export const FIXTURE_SUCCESSOR_ENTITY_ID =
  "00000000-0000-4000-8000-00000000c072";

export const FIXTURE_UNIVERSE_CONSTITUTED_AT = "2025-09-05T01:00:00.000Z";

export const FIXTURE_SUCCESSION_ACCESSIONS = {
  predecessorAnnual: "0000000071-25-000010",
  predecessorQuarter: "0000000071-25-000020",
  succession: "0000000900-25-000001",
  jointQuarter: "0000000071-25-000030",
  delisting: "0000000901-25-000002",
} as const;

/** Vigencia declarada por la 8-K12B: un día de horario de verano en Nueva York. */
export const FIXTURE_EFFECTIVE_ON = "2025-07-01";
export const FIXTURE_EFFECTIVE_FROM = "2025-07-01T04:00:00.000Z";
export const FIXTURE_SUCCESSION_ACCEPTED_AT = "2025-07-01T15:10:00.000Z";

const predecessorAnnual: SecFiling = {
  accessionNumber: FIXTURE_SUCCESSION_ACCESSIONS.predecessorAnnual,
  form: "10-K",
  filingDate: "2025-02-20",
  reportDate: "2024-12-31",
  acceptedAt: "2025-02-20T21:05:00.000Z",
};

const predecessorQuarter: SecFiling = {
  accessionNumber: FIXTURE_SUCCESSION_ACCESSIONS.predecessorQuarter,
  form: "10-Q",
  filingDate: "2025-05-05",
  reportDate: "2025-03-31",
  acceptedAt: "2025-05-05T20:30:00.000Z",
};

const succession: SecFiling = {
  accessionNumber: FIXTURE_SUCCESSION_ACCESSIONS.succession,
  form: "8-K12B",
  filingDate: "2025-07-01",
  reportDate: FIXTURE_EFFECTIVE_ON,
  acceptedAt: FIXTURE_SUCCESSION_ACCEPTED_AT,
};

const jointQuarter: SecFiling = {
  accessionNumber: FIXTURE_SUCCESSION_ACCESSIONS.jointQuarter,
  form: "10-Q",
  filingDate: "2025-08-04",
  reportDate: "2025-06-30",
  acceptedAt: "2025-08-04T20:00:00.000Z",
};

const delisting: SecFiling = {
  accessionNumber: FIXTURE_SUCCESSION_ACCESSIONS.delisting,
  form: "25-NSE",
  filingDate: "2025-07-02",
  reportDate: null,
  acceptedAt: "2025-07-02T14:30:00.000Z",
};

export const FIXTURE_SUCCESSOR_FILINGS: readonly SecFiling[] = [
  jointQuarter,
  succession,
];

export const FIXTURE_PREDECESSOR_FILINGS: readonly SecFiling[] = [
  jointQuarter,
  delisting,
  predecessorQuarter,
  predecessorAnnual,
];

export function buildFixtureDeclaration(
  overrides: Partial<DeclaredSuccession> = {},
): DeclaredSuccession {
  return declaredSuccessionSchema.parse({
    predecessorCik: FIXTURE_PREDECESSOR_CIK,
    successorCik: FIXTURE_SUCCESSOR_CIK,
    successionAccession: FIXTURE_SUCCESSION_ACCESSIONS.succession,
    decidedBy: "owner",
    decidedOn: "2025-09-10",
    rationale: "Reorganización sintética en holding.",
    ...overrides,
  });
}

/** Grafo en el que sólo el sucesor existe, igual que el universo real ante XOM. */
export function buildSuccessionFixtureGraph(): IdentityGraph {
  const provenance = {
    validFrom: FIXTURE_UNIVERSE_CONSTITUTED_AT,
    validTo: null,
    availableAt: FIXTURE_UNIVERSE_CONSTITUTED_AT,
    supersededAt: null,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    contentHash: "d".repeat(64),
    recordedAt: FIXTURE_UNIVERSE_CONSTITUTED_AT,
  };

  return identityGraphSchema.parse({
    legalEntities: [
      {
        ...provenance,
        legalEntityId: FIXTURE_SUCCESSOR_ENTITY_ID,
        legalName: FIXTURE_SUCCESSOR_NAME,
        entityType: "other",
        jurisdiction: null,
        status: "active",
      },
    ],
    securities: [],
    listings: [],
    listingSymbols: [],
    depositaryPrograms: [],
    depositaryRatios: [],
    identifierAssignments: [
      {
        ...provenance,
        sourceId: "sec-edgar",
        identifierAssignmentId: "00000000-0000-4000-8000-00000000c172",
        subjectType: "legal_entity",
        subjectId: FIXTURE_SUCCESSOR_ENTITY_ID,
        identifierType: "cik",
        identifierValue: FIXTURE_SUCCESSOR_CIK,
        normalizedValue: FIXTURE_SUCCESSOR_CIK,
        scope: "sec:filer",
        issuingAuthority: "U.S. Securities and Exchange Commission",
        confidence: "authoritative",
      },
    ],
  });
}

/** Payload de `submissions` con columnas paralelas, como lo publica la SEC. */
export function buildSubmissionsPayload(input: {
  readonly cik: string;
  readonly name: string | null;
  readonly filings: readonly SecFiling[];
  readonly files?: readonly {
    name: string;
    filingFrom: string;
    filingTo: string;
  }[];
}): Record<string, unknown> {
  return {
    cik: input.cik,
    name: input.name,
    filings: {
      recent: buildFilingColumns(input.filings),
      files: (input.files ?? []).map((file) => ({ ...file, filingCount: 1 })),
    },
  };
}

export function buildFilingColumns(
  filings: readonly SecFiling[],
): Record<string, unknown[]> {
  return {
    accessionNumber: filings.map((filing) => filing.accessionNumber),
    form: filings.map((filing) => filing.form),
    filingDate: filings.map((filing) => filing.filingDate),
    reportDate: filings.map((filing) => filing.reportDate ?? ""),
    acceptanceDateTime: filings.map((filing) => filing.acceptedAt ?? ""),
  };
}
