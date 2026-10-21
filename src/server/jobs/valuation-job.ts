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
  assembleValuationSnapshot,
  type ValuationSnapshotResult,
} from "@/modules/valuation/application/assemble-valuation-snapshot";
import { runValuation } from "@/modules/valuation/application/run-valuation";
import {
  readValuationHistory,
  type ValuationHistoryView,
} from "@/modules/valuation/application/read-valuation-history";
import {
  readValuationResult,
  type ValuationResultReading,
} from "@/modules/valuation/application/read-valuation-result";
import { SHARES_OUTSTANDING_CONCEPT } from "@/modules/valuation/domain/employee-equity-claim";
import { readLineageObservations } from "@/modules/corporate-actions/application/read-lineage-observations";
import { PRICES_SOURCE_ID } from "@/modules/prices/application/live-price-source";
import {
  subtractCalendarYears,
  subtractDays,
} from "@/modules/temporal/domain/calendar-date";
import { getCedearRegistryRepository } from "@/server/persistence/get-cedear-registry-repository";
import { getCorporateActionRepository } from "@/server/persistence/get-corporate-action-repository";
import { getEmployeeEquityRepository } from "@/server/persistence/get-employee-equity-repository";
import { getObservationRepository } from "@/server/persistence/get-observation-repository";
import { getPriceRepository } from "@/server/persistence/get-price-repository";
import { getValuationRunRepository } from "@/server/persistence/get-valuation-run-repository";
import {
  outcomeForAssessment,
  outcomeForIdentity,
  valuationJobMethodSchema,
  type ValuationAssessmentReading,
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

/** El historial del ticker (`F6-02`): sólo lee jobs y corridas. */
export async function readValuationHistoryForRequest(
  ticker: string,
): Promise<ValuationHistoryView> {
  return readValuationHistory(
    { ticker },
    { jobs: getValuationJobStore(), runs: getValuationRunRepository() },
  );
}

/**
 * La última corrida registrada del ticker, para la página del resultado
 * (`F6-03`). Sólo lee jobs, corridas, el grafo de identidad y la serie de
 * precios guardada (`F6-09`).
 */
export async function readValuationResultForRequest(
  ticker: string,
): Promise<ValuationResultReading> {
  return readValuationResult(
    { ticker },
    {
      jobs: getValuationJobStore(),
      runs: getValuationRunRepository(),
      universe: getUniverseRepository(),
      cedears: getCedearRegistryRepository(),
      prices: getPriceRepository(),
    },
  );
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
  const prepared = await prepareValuationRun(job);

  if (prepared.kind === "outcome") {
    return prepared.outcome;
  }

  if (prepared.snapshot.status === "not_assembled") {
    return outcomeForAssessment(prepared.reading, {
      gap: prepared.snapshot.gap,
    });
  }

  const run = runValuation(prepared.snapshot.input, {
    now,
    newValuationRunId: newId,
  });
  // Idempotente por clave de replay: el mismo snapshot devuelve la corrida
  // que ya estaba, sin duplicarla.
  const recorded = await getValuationRunRepository().record(run);

  return outcomeForAssessment(prepared.reading, {
    valuationRunId: recorded.valuationRunId,
    runStatus: recorded.status,
  });
}

export type PreparedValuationRun =
  | { readonly kind: "outcome"; readonly outcome: ValuationJobOutcome }
  | {
      readonly kind: "snapshot";
      readonly reading: ValuationAssessmentReading;
      readonly snapshot: ValuationSnapshotResult;
    };

/**
 * Resuelve, evalúa y arma el snapshot sin escribir nada (`F6-07`). El worker
 * corre el motor y registra la corrida; un script de medición puede llamar a
 * esto sin tocar `valuation_runs`.
 */
export async function prepareValuationRun(
  job: Pick<ValuationJob, "ticker" | "knownAt">,
): Promise<PreparedValuationRun> {
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
    return {
      kind: "outcome",
      outcome: outcomeForIdentity(
        resolution.status === "resolved" ? "not_found" : resolution.status,
      ),
    };
  }

  const legalEntityId = resolution.legalEntityId;
  const facts = issuerFactsAt(
    state.graph,
    legalEntityId,
    resolution.listingId,
    query,
  );

  if (facts.cik === null) {
    return {
      kind: "outcome",
      outcome: outcomeForAssessment({
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
      }),
    };
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
  const reading: ValuationAssessmentReading = {
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
  };

  if (!selected || !reading.hasAnnualFundamentals) {
    return { kind: "outcome", outcome: outcomeForAssessment(reading) };
  }

  const securityId = resolution.securityId;
  const [employeeEquity, shareCounts, prices] = await Promise.all([
    getEmployeeEquityRepository().acceptedAsKnown(legalEntityId, job.knownAt),
    readShareCounts(legalEntityId, query),
    securityId === null
      ? Promise.resolve({ closes: [], events: [] })
      : readPrices(securityId, job.knownAt),
  ]);

  return {
    kind: "snapshot",
    reading,
    snapshot: assembleValuationSnapshot({
      subject: {
        legalEntityId,
        securityId,
        listingId: resolution.listingId,
      },
      query,
      assessment,
      fundamentalsSourceId: SEC_SOURCE_ID,
      employeeEquity,
      shareCounts,
      prices: { sourceId: PRICES_SOURCE_ID, ...prices },
    }),
  };
}

/** Las acciones de la carátula al corte, por el linaje del emisor. */
async function readShareCounts(legalEntityId: string, query: PointInTimeQuery) {
  const selection = await readLineageObservations(
    { legalEntityId, metricIds: [SHARES_OUTSTANDING_CONCEPT] },
    query,
    {
      corporateActions: getCorporateActionRepository(),
      observations: getObservationRepository(),
    },
  );

  // Un valor nulo no es un conteo: queda afuera y, sin otro, el snapshot lo
  // nombra.
  return selection.rows.flatMap((row) =>
    row.value === null
      ? []
      : [
          {
            concept: row.observation.concept,
            asOf: row.observation.asOf,
            availableAt: row.observation.availableAt,
            value: row.value,
            observationId: row.observation.observationId,
            sourceDocumentId: row.observation.sourceDocumentId,
          },
        ],
  );
}

/**
 * Cinco años y medio de cierres hasta el día del corte —la volatilidad de las
 * opciones pide cinco— y los eventos de la security. Una serie cruda no
 * necesita otra cosa para no ver el futuro: lo posterior al `as_of` se filtra.
 */
async function readPrices(securityId: string, knownAt: string) {
  const prices = getPriceRepository();
  const to = knownAt.slice(0, 10);
  const [closes, events] = await Promise.all([
    prices.loadSeries({
      securityId,
      from: subtractDays(subtractCalendarYears(to, 5), 30),
      to,
      limit: 2_000,
    }),
    prices.loadEvents({ securityId }),
  ]);

  return {
    closes: closes.map((close) => ({
      marketDate: close.marketDate,
      close: close.close,
      currency: close.currency,
    })),
    events: events
      .filter((event) => event.effectiveOn <= to)
      .map((event) => ({
        eventType: event.eventType,
        effectiveOn: event.effectiveOn,
        value: event.value,
        currency: event.currency,
      })),
  };
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
