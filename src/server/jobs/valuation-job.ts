import "server-only";

import { randomUUID } from "node:crypto";

import { SEC_SIC_TAXONOMY_ID } from "@/modules/classification/domain/sec-sic-classification";
import { SEC_SOURCE_ID } from "@/modules/fundamentals/application/live-company-facts-source";
import { resolveIdentity } from "@/modules/identity/domain/resolve-identity";
import { readReferenceDataset } from "@/modules/reference-data/application/read-reference-dataset";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
  type PointInTimeQuery,
} from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { assessCompany } from "@/modules/valuation/application/assess-company";
import { DECLARED_INDUSTRY_ASSIGNMENTS } from "@/modules/valuation/application/declared-industry-assignments";
import { DECLARED_OPERATIONS_MIXES } from "@/modules/valuation/application/declared-operations-mixes";
import { issuerFactsAt } from "@/modules/valuation/application/issuer-facts";
import {
  requestValuationJob,
  runValuationJob,
  type ValuationJobRequest,
  type ValuationJobRequestResult,
} from "@/modules/valuation/application/request-valuation-job";
import { readOperationsMix } from "@/modules/valuation/application/read-operations-mix";
import {
  outcomeForAssessment,
  outcomeForIdentity,
  valuationJobMethodSchema,
  type ValuationJob,
  type ValuationJobOutcome,
} from "@/modules/valuation/domain/valuation-job";
import {
  BETAS_DATASET,
  COUNTRY_RISK_DATASET,
  COUNTRY_RISK_REGIONS_DATASET,
  IMPLIED_ERP_DATASET,
  RATINGS_DATASET,
} from "@/modules/valuation/domain/cost-of-capital";
import { FAILURE_RATES_DATASET } from "@/modules/valuation/domain/failure-risk";
import { DAMODARAN_INDUSTRY_TAXONOMY } from "@/modules/valuation/domain/industry-mapping";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getIndustryResolutionRepository } from "@/server/persistence/get-industry-resolution-repository";
import { getOperationsMixRepository } from "@/server/persistence/get-operations-mix-repository";
import { getReferenceDatasetRepository } from "@/server/persistence/get-reference-dataset-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";
import { getValuationJobStore } from "@/server/persistence/get-valuation-job-store";
import { createFundamentalReaders } from "@/server/valuation/fundamental-readers";

/**
 * Raíz de composición de la corrida por ticker (`F6-01`,
 * [ADR 0045](../../../docs/architecture/adr/0045-ticker-valuation-job.md)).
 *
 * La acción ya verificó el modo. Estos getters igual lanzan
 * `RuntimeLockedError` en un runtime trabado, así que saltarse la guarda no abre
 * una base. El worker no sale a la red: evalúa lo guardado.
 */
let activeWorker: Promise<void> | null = null;

const now = () => new Date().toISOString();
const newId = () => randomUUID();

export async function requestValuationForRequest(
  input: ValuationJobRequest,
): Promise<ValuationJobRequestResult> {
  return requestValuationJob(input, {
    store: getValuationJobStore(),
    now,
    newId,
  });
}

/** Arranca el worker si este proceso no tiene uno. No espera su fin. */
export function startValuationWorker(jobId: string): Promise<void> {
  if (activeWorker !== null) {
    return activeWorker;
  }

  activeWorker = runWorker(jobId)
    .catch((error: unknown) => {
      console.error(
        "valuation job failed",
        error instanceof Error ? error.name : typeof error,
      );
    })
    .finally(() => {
      activeWorker = null;
    });

  return activeWorker;
}

async function runWorker(jobId: string): Promise<void> {
  const result = await runValuationJob(jobId, {
    store: getValuationJobStore(),
    now,
    newId,
    assess: assessValuationJob,
  });

  if (result.status === "failed") {
    console.error("valuation job failed", result.errorName);
  }
}

async function assessValuationJob(
  job: ValuationJob,
): Promise<ValuationJobOutcome> {
  const query = pointInTimeQuerySchema.parse({
    effectiveAt: job.knownAt,
    knownAt: job.knownAt,
    revisionPolicy: "as_known",
    adjustmentPolicy: "as_known",
    knowledgeBasis: "public_availability",
    sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
  });
  const state = await getUniverseRepository().loadState({
    indexId: SP500_INDEX_ID,
    versions: "all",
    limit: 50_000,
  });
  const resolution = resolveIdentity(
    state.graph,
    { symbol: job.ticker },
    query,
  );

  if (resolution.status !== "resolved" || resolution.legalEntityId === null) {
    return outcomeForIdentity(
      resolution.status === "resolved" ? "not_found" : resolution.status,
    );
  }

  const legalEntityId = resolution.legalEntityId;
  const facts = issuerFactsAt(
    state.graph,
    legalEntityId,
    resolution.listingId,
    query,
  );

  if (facts.cik === null) {
    return outcomeForAssessment({
      legalEntityId,
      securityId: resolution.securityId,
      listingId: resolution.listingId,
      cik: null,
      hasAnnualFundamentals: false,
      methodStatus: "unsupported_method",
      assetProfile: null,
      method: null,
      rigor: null,
      unsupportedReason: "missing_required_input",
    });
  }

  const cik = facts.cik;
  const assessment = await assessCompany(
    {
      legalEntityId,
      query,
      fundamentalsSourceId: SEC_SOURCE_ID,
      cik,
      industryDeclarations: DECLARED_INDUSTRY_ASSIGNMENTS,
      listingCountry: facts.listingCountry,
    },
    await assessmentReaders(cik, query, state.graph),
  );
  const selected = assessment.selection.status === "selected";

  return outcomeForAssessment({
    legalEntityId,
    securityId: resolution.securityId,
    listingId: resolution.listingId,
    cik,
    hasAnnualFundamentals: assessment.fundamentals.series !== null,
    methodStatus: assessment.selection.status,
    assetProfile: assessment.selection.assetProfile,
    method: selected
      ? valuationJobMethodSchema.parse(assessment.selection.recommendedMethod)
      : null,
    rigor: selected ? assessment.rigor.level : null,
    unsupportedReason: selected
      ? null
      : (assessment.selection.unsupportedReasons[0] ?? null),
  });
}

async function assessmentReaders(
  cik: string,
  query: PointInTimeQuery,
  graph: Parameters<typeof issuerFactsAt>[0],
) {
  const classifications = getClassificationRepository();
  const industryResolutions = getIndustryResolutionRepository();
  const operationsMixes = getOperationsMixRepository();
  const referenceDatasets = getReferenceDatasetRepository();
  const stored = await classifications.loadClassifications({
    taxonomyId: SEC_SIC_TAXONOMY_ID,
    limit: 10_000,
  });

  return {
    loadSicAssertions: async (subjectId: string) =>
      stored.filter((classification) => classification.subjectId === subjectId),
    loadIndustryResolutions: (subjectId: string) =>
      industryResolutions.assertionsForSubject(subjectId),
    loadIndustryResolution: (resolutionId: string) =>
      industryResolutions.findResolution(resolutionId),
    ...createFundamentalReaders(
      (subjectId) => issuerFactsAt(graph, subjectId, null, query).cik,
    ),
    loadFailureRates: (pointInTime: PointInTimeQuery) =>
      readReferenceDataset(
        FAILURE_RATES_DATASET,
        pointInTime,
        referenceDatasets,
      ),
    costOfCapitalReadings: async (pointInTime: PointInTimeQuery) => {
      const [betas, countryRisk, impliedErp, ratings, regions] =
        await Promise.all(
          [
            BETAS_DATASET,
            COUNTRY_RISK_DATASET,
            IMPLIED_ERP_DATASET,
            RATINGS_DATASET,
            COUNTRY_RISK_REGIONS_DATASET,
          ].map((datasetId) =>
            readReferenceDataset(datasetId, pointInTime, referenceDatasets),
          ),
        );

      return {
        betas: betas ?? null,
        countryRisk: countryRisk ?? null,
        impliedErp: impliedErp ?? null,
        ratings: ratings ?? null,
        regions: regions ?? null,
      };
    },
    loadOperationsMix: (subjectId: string, pointInTime: PointInTimeQuery) =>
      readOperationsMix(
        {
          legalEntityId: subjectId,
          cik,
          query: pointInTime,
          declarations: DECLARED_OPERATIONS_MIXES,
        },
        operationsMixes,
      ),
    industryRelease: async (pointInTime: PointInTimeQuery) => {
      const reading = await readReferenceDataset(
        DAMODARAN_INDUSTRY_TAXONOMY,
        pointInTime,
        referenceDatasets,
      );

      return reading === null
        ? null
        : new Map(reading.rows.map((row) => [row.key, row.label]));
    },
  };
}
