/**
 * Filer sintético con un split 4:1, con la forma del cable de la SEC.
 *
 * Ningún CIK, accession, fecha ni valor proviene de una descarga: el repositorio es
 * público. Lo que sí copia de los casos medidos el 2026-09-15 es la **forma**:
 *
 * - el ratio se declara primero en un 10-Q anterior al split, con los valores
 *   todavía en base vieja (Alphabet, abril de 2022);
 * - la primera presentación en base nueva es el 10-K, que declara el ratio con dos
 *   fechas y re-expresa EPS y acciones de los ejercicios comparativos (Apple 2020,
 *   NVIDIA 2021);
 * - el EPS re-expresado trae el redondeo de centavos: 3,10 pasa a 0,78, no a
 *   0,775;
 * - la misma presentación corrige una cantidad de acciones mal escalada en un
 *   10-Q previo, que no cierra con el ratio (Apple, 2014);
 * - un 8-K repite el ratio sin publicar hechos, y el 10-Q siguiente lo repite
 *   re-expresando tarde un trimestre del año anterior;
 * - antes del split hay un restatement contable real que no es un split.
 */
import type { SecReportedFact } from "@/modules/fundamentals/domain/parse-sec-company-facts";
import {
  identityGraphSchema,
  type IdentityGraph,
} from "@/modules/identity/domain/identity-graph";
import {
  computeObservationContentHash,
  computeRevisionGroupId,
  observationSchema,
  type Observation,
  type ObservationLogicalKey,
} from "@/modules/observations/domain/observation";
import {
  computeSourceDocumentContentHash,
  sourceDocumentSchema,
  type SourceDocument,
} from "@/modules/observations/domain/source-document";

import { SPLIT_RATIO_CONCEPT } from "../domain/share-basis";

export const SPLIT_FILER_CIK = "0000000073";
export const SPLIT_FILER_ENTITY_ID = "00000000-0000-4000-8000-00000000d073";

/** El universo sintético conoce al filer desde su constitución. */
export function buildSplitFixtureGraph(): IdentityGraph {
  const provenance = {
    validFrom: "2025-09-05T01:00:00.000Z",
    validTo: null,
    availableAt: "2025-09-05T01:00:00.000Z",
    supersededAt: null,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    contentHash: "d".repeat(64),
    recordedAt: "2025-09-05T01:00:00.000Z",
  };

  return identityGraphSchema.parse({
    legalEntities: [
      {
        ...provenance,
        legalEntityId: SPLIT_FILER_ENTITY_ID,
        legalName: "Split Sintética Corp",
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
        identifierAssignmentId: "00000000-0000-4000-8000-00000000d173",
        subjectType: "legal_entity",
        subjectId: SPLIT_FILER_ENTITY_ID,
        identifierType: "cik",
        identifierValue: SPLIT_FILER_CIK,
        normalizedValue: SPLIT_FILER_CIK,
        scope: "sec:filer",
        issuingAuthority: "U.S. Securities and Exchange Commission",
        confidence: "authoritative",
      },
    ],
  });
}

export const SPLIT_ACCESSIONS = {
  annual2022: "0000000073-23-000010",
  amendment2022: "0000000073-23-000015",
  annual2023: "0000000073-24-000010",
  quarter2024q1: "0000000073-24-000020",
  /** Declara el ratio antes del split, sin re-expresar nada. */
  quarter2024q2: "0000000073-24-000030",
  /** Primera presentación en base nueva. */
  annual2024: "0000000073-25-000010",
  /** Repite el ratio y no publica hechos. */
  currentReport: "0000000073-25-000900",
  quarter2025q1: "0000000073-25-000020",
} as const;

type AccessionKey = keyof typeof SPLIT_ACCESSIONS;

type FilingShape = {
  readonly form: string;
  readonly filed: string;
  readonly acceptedAt: string;
  readonly periodEndOn: string;
  readonly fiscalYear: number;
  readonly fiscalPeriod: string;
};

export const SPLIT_FILINGS: Readonly<
  Record<Exclude<AccessionKey, "currentReport">, FilingShape>
> = {
  annual2022: {
    form: "10-K",
    filed: "2023-02-21",
    acceptedAt: "2023-02-21T21:00:00.000Z",
    periodEndOn: "2022-12-31",
    fiscalYear: 2022,
    fiscalPeriod: "FY",
  },
  amendment2022: {
    form: "10-K/A",
    filed: "2023-06-01",
    acceptedAt: "2023-06-01T20:30:00.000Z",
    periodEndOn: "2022-12-31",
    fiscalYear: 2022,
    fiscalPeriod: "FY",
  },
  annual2023: {
    form: "10-K",
    filed: "2024-02-20",
    acceptedAt: "2024-02-20T21:00:00.000Z",
    periodEndOn: "2023-12-31",
    fiscalYear: 2023,
    fiscalPeriod: "FY",
  },
  quarter2024q1: {
    form: "10-Q",
    filed: "2024-05-01",
    acceptedAt: "2024-05-01T20:00:00.000Z",
    periodEndOn: "2024-03-31",
    fiscalYear: 2024,
    fiscalPeriod: "Q1",
  },
  quarter2024q2: {
    form: "10-Q",
    filed: "2024-08-01",
    acceptedAt: "2024-08-01T20:00:00.000Z",
    periodEndOn: "2024-06-30",
    fiscalYear: 2024,
    fiscalPeriod: "Q2",
  },
  annual2024: {
    form: "10-K",
    filed: "2025-02-20",
    acceptedAt: "2025-02-20T21:00:00.000Z",
    periodEndOn: "2024-12-31",
    fiscalYear: 2024,
    fiscalPeriod: "FY",
  },
  quarter2025q1: {
    form: "10-Q",
    filed: "2025-05-01",
    acceptedAt: "2025-05-01T20:00:00.000Z",
    periodEndOn: "2025-03-31",
    fiscalYear: 2025,
    fiscalPeriod: "Q1",
  },
};

export const SPLIT_ACCEPTED_AT = SPLIT_FILINGS.annual2024.acceptedAt;

/** La ingesta de la instalación, posterior a todo lo publicado. */
export const SPLIT_FIXTURE_RECORDED_AT = "2025-09-10T12:00:00.000Z";
const INGESTION_RUN_ID = "00000000-0000-4000-8000-00000000d0f1";

export function buildSplitFixtureDocuments(
  overrides: Partial<
    Record<Exclude<AccessionKey, "currentReport">, Partial<SourceDocument>>
  > = {},
): SourceDocument[] {
  return (
    Object.entries(SPLIT_FILINGS) as [
      Exclude<AccessionKey, "currentReport">,
      FilingShape,
    ][]
  ).map(([key, filing]) => {
    const content = {
      sourceId: "sec-edgar",
      sourceDocumentId: SPLIT_ACCESSIONS[key],
      documentType: filing.form,
      subjectType: "legal_entity" as const,
      subjectId: SPLIT_FILER_ENTITY_ID,
      publishedOn: filing.filed,
      acceptedAt: filing.acceptedAt,
      availableAt: filing.acceptedAt,
      availabilityRule: "sec_acceptance",
      periodEndOn: filing.periodEndOn,
      fiscalYear: filing.fiscalYear,
      fiscalPeriod: filing.fiscalPeriod,
      ...overrides[key],
    };

    return sourceDocumentSchema.parse({
      ...content,
      contentHash: computeSourceDocumentContentHash(content),
      ingestionRunId: INGESTION_RUN_ID,
      recordedAt: SPLIT_FIXTURE_RECORDED_AT,
    });
  });
}

type FactShape = {
  readonly concept: string;
  readonly periodType: ObservationLogicalKey["periodType"];
  readonly periodStart: string | null;
  readonly asOf: string;
  readonly unit: string;
  readonly currency: string | null;
};

type Vintage = {
  readonly value: string | null;
  readonly filing: Exclude<AccessionKey, "currentReport">;
};

let observationSequence = 0;

function nextObservationId(): string {
  observationSequence += 1;
  return `00000000-0000-4000-8000-${String(0xd0000 + observationSequence).padStart(12, "0")}`;
}

/**
 * Cadena de revisión con la forma que deja `publishObservations`: cada vintage
 * re-expresa la anterior, que queda superada desde la disponibilidad de la nueva.
 */
export function buildRevisionChain(
  fact: FactShape,
  vintages: readonly Vintage[],
  options: {
    readonly subjectId?: string;
    readonly recordedAt?: string;
  } = {},
): Observation[] {
  const key: ObservationLogicalKey = {
    subjectType: "legal_entity",
    subjectId: options.subjectId ?? SPLIT_FILER_ENTITY_ID,
    metricId: fact.concept,
    concept: fact.concept,
    asOf: fact.asOf,
    periodStart: fact.periodStart,
    periodEnd: fact.periodType === "instant" ? null : fact.asOf,
    periodType: fact.periodType,
    unit: fact.unit,
    currency: fact.currency,
    sourceId: "sec-edgar",
    datasetId: "sec.companyfacts",
    valueBasis: "reported",
  };
  const revisionGroupId = computeRevisionGroupId(key);
  const chain: Observation[] = [];

  vintages.forEach((vintage, index) => {
    const availableAt = SPLIT_FILINGS[vintage.filing].acceptedAt;
    const next = vintages[index + 1];
    const sourceDocumentId = SPLIT_ACCESSIONS[vintage.filing];
    const rawValueStatus = vintage.value === null ? "not_provided" : "stored";
    const externalId = `${SPLIT_FILER_CIK}:${fact.concept}:${fact.asOf}:${sourceDocumentId}`;

    chain.push(
      observationSchema.parse({
        observationId: nextObservationId(),
        ...key,
        parserVersion: "sec-companyfacts-1.0.0",
        rawValue: vintage.value,
        rawValueStatus,
        normalizedValue: null,
        transformationId: null,
        availableAt,
        supersededAt:
          next === undefined ? null : SPLIT_FILINGS[next.filing].acceptedAt,
        fetchedAt: options.recordedAt ?? SPLIT_FIXTURE_RECORDED_AT,
        recordedAt: options.recordedAt ?? SPLIT_FIXTURE_RECORDED_AT,
        revisionGroupId,
        revisionNumber: index + 1,
        restatementOfId: index === 0 ? null : chain[index - 1]!.observationId,
        contentHash: computeObservationContentHash({
          logicalKey: key,
          parserVersion: "sec-companyfacts-1.0.0",
          rawValue: vintage.value,
          rawValueStatus,
          normalizedValue: null,
          availableAt,
          sourceDocumentId,
          externalId,
          qualityFlags: [],
        }),
        qualityFlags: [],
        sourceDocumentId,
        externalId,
        ingestionRunId: INGESTION_RUN_ID,
      }),
    );
  });

  return chain;
}

const annual = (year: number, concept: string, unit: string): FactShape => ({
  concept,
  periodType: "annual",
  periodStart: `${year}-01-01`,
  asOf: `${year}-12-31`,
  unit,
  currency: unit === "shares" ? null : "USD",
});

export const SPLIT_FACTS = {
  epsBasic2021: annual(
    2021,
    "us-gaap:EarningsPerShareBasic",
    "monetary_per_share",
  ),
  epsBasic2022: annual(
    2022,
    "us-gaap:EarningsPerShareBasic",
    "monetary_per_share",
  ),
  epsBasic2023: annual(
    2023,
    "us-gaap:EarningsPerShareBasic",
    "monetary_per_share",
  ),
  epsBasic2024: annual(
    2024,
    "us-gaap:EarningsPerShareBasic",
    "monetary_per_share",
  ),
  epsDiluted2023: annual(
    2023,
    "us-gaap:EarningsPerShareDiluted",
    "monetary_per_share",
  ),
  epsBasicQ1: {
    concept: "us-gaap:EarningsPerShareBasic",
    periodType: "quarter",
    periodStart: "2024-01-01",
    asOf: "2024-03-31",
    unit: "monetary_per_share",
    currency: "USD",
  },
  epsBasicQ2: {
    concept: "us-gaap:EarningsPerShareBasic",
    periodType: "quarter",
    periodStart: "2024-04-01",
    asOf: "2024-06-30",
    unit: "monetary_per_share",
    currency: "USD",
  },
  sharesBasic2021: annual(
    2021,
    "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
    "shares",
  ),
  sharesBasic2023: annual(
    2023,
    "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
    "shares",
  ),
  sharesBasic2024: annual(
    2024,
    "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
    "shares",
  ),
  sharesOutstanding2023: {
    concept: "us-gaap:CommonStockSharesOutstanding",
    periodType: "instant",
    periodStart: null,
    asOf: "2023-12-31",
    unit: "shares",
    currency: null,
  },
  revenue2022: annual(2022, "us-gaap:Revenues", "monetary"),
} satisfies Record<string, FactShape>;

/** Historia sensible completa del filer, más un ingreso con restatement. */
export function buildSplitFixtureObservations(): Observation[] {
  const F = SPLIT_FACTS;

  return [
    ...buildRevisionChain(F.epsBasic2021, [
      { value: "1.6", filing: "annual2022" },
    ]),
    // Restatement contable real y, después, la re-expresión por el split.
    ...buildRevisionChain(F.epsBasic2022, [
      { value: "2", filing: "annual2022" },
      { value: "1.9", filing: "amendment2022" },
      { value: "0.48", filing: "annual2024" },
    ]),
    ...buildRevisionChain(F.epsBasic2023, [
      { value: "3.1", filing: "annual2023" },
      { value: "0.78", filing: "annual2024" },
    ]),
    ...buildRevisionChain(F.epsBasic2024, [
      { value: "0.9", filing: "annual2024" },
    ]),
    ...buildRevisionChain(F.epsDiluted2023, [
      { value: "3.05", filing: "annual2023" },
      { value: "0.76", filing: "annual2024" },
    ]),
    // El trimestre del año anterior se re-expresa tarde, en el 10-Q siguiente.
    ...buildRevisionChain(F.epsBasicQ1, [
      { value: "0.8", filing: "quarter2024q1" },
      { value: "0.2", filing: "quarter2025q1" },
    ]),
    ...buildRevisionChain(F.epsBasicQ2, [
      { value: "0.85", filing: "quarter2024q2" },
    ]),
    ...buildRevisionChain(F.sharesBasic2021, [
      { value: "96000000", filing: "annual2022" },
    ]),
    ...buildRevisionChain(F.sharesBasic2023, [
      { value: "100000000", filing: "annual2023" },
      { value: "400000000", filing: "annual2024" },
    ]),
    ...buildRevisionChain(F.sharesBasic2024, [
      { value: "404000000", filing: "annual2024" },
    ]),
    // Un 10-Q la publica en miles por error y el 10-K la corrige ya en base nueva.
    ...buildRevisionChain(F.sharesOutstanding2023, [
      { value: "99000000", filing: "annual2023" },
      { value: "99000", filing: "quarter2024q1" },
      { value: "396000000", filing: "annual2024" },
    ]),
    ...buildRevisionChain(F.revenue2022, [
      { value: "1000000000", filing: "annual2022" },
      { value: "980000000", filing: "amendment2022" },
    ]),
  ];
}

/** Sólo los conceptos sensibles: lo que el job de splits lee del repositorio. */
export function buildSplitFixtureSensitiveObservations(): Observation[] {
  return buildSplitFixtureObservations().filter(
    (observation) => observation.concept !== "us-gaap:Revenues",
  );
}

type ClaimShape = {
  readonly filing: AccessionKey;
  readonly end: string;
  readonly start?: string;
  readonly value?: string;
  readonly unit?: string;
};

const CLAIM_FORMS: Readonly<
  Record<AccessionKey, { form: string; filed: string }>
> = {
  ...Object.fromEntries(
    Object.entries(SPLIT_FILINGS).map(([key, filing]) => [
      key,
      { form: filing.form, filed: filing.filed },
    ]),
  ),
  currentReport: { form: "8-K", filed: "2025-02-21" },
} as Readonly<Record<AccessionKey, { form: string; filed: string }>>;

export function buildSplitClaim(claim: ClaimShape): SecReportedFact {
  const { form, filed } = CLAIM_FORMS[claim.filing];

  return {
    taxonomy: SPLIT_RATIO_CONCEPT.taxonomy,
    concept: SPLIT_RATIO_CONCEPT.concept,
    unit: claim.unit ?? "pure",
    start: claim.start ?? null,
    end: claim.end,
    value: claim.value ?? "4",
    accessionNumber: SPLIT_ACCESSIONS[claim.filing],
    form,
    filed,
    fiscalYear: null,
    fiscalPeriod: null,
  };
}

/** Los ratios que el filer declara, con la forma de `companyconcept`. */
export function buildSplitFixtureClaims(): SecReportedFact[] {
  return [
    buildSplitClaim({ filing: "quarter2024q2", end: "2024-05-20" }),
    buildSplitClaim({ filing: "annual2024", end: "2024-05-20" }),
    buildSplitClaim({ filing: "annual2024", end: "2024-06-14" }),
    buildSplitClaim({ filing: "currentReport", end: "2024-06-14" }),
    buildSplitClaim({ filing: "quarter2025q1", end: "2024-06-14" }),
  ];
}

/** Payload de `companyconcept` con la forma verificada del cable. */
export function buildCompanyConceptPayload(
  claims: readonly SecReportedFact[],
  cik = Number(SPLIT_FILER_CIK),
): Record<string, unknown> {
  const units: Record<string, Record<string, unknown>[]> = {};

  for (const claim of claims) {
    const point: Record<string, unknown> = {
      ...(claim.start === null ? {} : { start: claim.start }),
      end: claim.end,
      val: Number(claim.value),
      accn: claim.accessionNumber,
      fy: claim.fiscalYear,
      fp: claim.fiscalPeriod,
      form: claim.form,
      filed: claim.filed,
    };
    (units[claim.unit] ??= []).push(point);
  }

  return {
    cik,
    taxonomy: SPLIT_RATIO_CONCEPT.taxonomy,
    tag: SPLIT_RATIO_CONCEPT.concept,
    label: "Stockholders' Equity Note, Stock Split, Conversion Ratio",
    description: "Synthetic description.",
    entityName: "SPLIT SINTETICA CORP",
    units,
  };
}
