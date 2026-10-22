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
import { INDUSTRY_RETURNS_DATASET } from "@/modules/valuation/domain/derived-assumptions";
import { SHARES_OUTSTANDING_CONCEPT } from "@/modules/valuation/domain/employee-equity-claim";
import { readLineageObservations } from "@/modules/corporate-actions/application/read-lineage-observations";
import { resolveReportingLineage } from "@/modules/corporate-actions/domain/reporting-lineage";
import { ensureValuationData } from "@/modules/valuation/application/ensure-valuation-data";
import {
  dataStepBlock,
  dataStepIngested,
  type ValuationDataStep,
} from "@/modules/valuation/domain/valuation-data-step";
import { PRICES_SOURCE_ID } from "@/modules/prices/application/live-price-source";
import {
  subtractCalendarYears,
  subtractDays,
} from "@/modules/temporal/domain/calendar-date";
import { getCedearRegistryRepository } from "@/server/persistence/get-cedear-registry-repository";
import { getCorporateActionRepository } from "@/server/persistence/get-corporate-action-repository";
import { getEmployeeEquityRepository } from "@/server/persistence/get-employee-equity-repository";
import { getMarketExpectationsRepository } from "@/server/persistence/get-market-expectations-repository";
import { getObservationRepository } from "@/server/persistence/get-observation-repository";
import { getPriceRepository } from "@/server/persistence/get-price-repository";
import { getValuationRunRepository } from "@/server/persistence/get-valuation-run-repository";
import {
  outcomeForAssessment,
  outcomeForDataStep,
  outcomeForIdentity,
  outcomeForQualitativeStep,
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
import {
  qualitativeStepAccepted,
  type ValuationQualitativeStep,
} from "@/modules/valuation/domain/valuation-qualitative-step";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getIndustryResolutionRepository } from "@/server/persistence/get-industry-resolution-repository";
import { getOperationsMixRepository } from "@/server/persistence/get-operations-mix-repository";
import { getReferenceDatasetRepository } from "@/server/persistence/get-reference-dataset-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";
import { getValuationJobStore } from "@/server/persistence/get-valuation-job-store";
import { createFundamentalReaders } from "@/server/valuation/fundamental-readers";

import { createValuationDataDependencies } from "./valuation-data";
import { runQualitativeStep } from "./valuation-qualitative";

/**
 * Raíz de composición de la corrida por ticker (`F6-01`,
 * [ADR 0045](../../../docs/architecture/adr/0045-ticker-valuation-job.md)).
 *
 * La acción ya verificó el modo. Estos getters igual lanzan
 * `RuntimeLockedError` en un runtime trabado, así que saltarse la guarda no abre
 * una base.
 *
 * Desde `F6-05` ([ADR 0051](../../../docs/architecture/adr/0051-on-demand-valuation-data.md))
 * el worker baja lo que falta —ventana de la SEC, SIC, precio— y audita el
 * sujeto antes de valuar. Si bajó algo, corre a continuación el job que lo
 * sigue con un corte nuevo.
 *
 * Desde `F6-13` ([ADR 0052](../../../docs/architecture/adr/0052-qualitative-decisions-in-valuation-job.md))
 * pregunta a la IA lo cualitativo que falta —industria ambigua, opciones de
 * empleados, mix de operaciones— con las tareas y los topes de sus comandos.
 * Una decisión aceptada también se continúa con un corte nuevo.
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
      expectations: getMarketExpectationsRepository(),
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

/**
 * Un job que continúa a otro nunca baja nada, y uno que sigue a una decisión
 * de la IA ya la ve: la cadena es de tres —bajar, decidir, valuar—. Cada
 * tarea guarda una respuesta por 10-K, así que una cuarta no tendría qué
 * preguntar.
 */
const MAX_CHAINED_JOBS = 3;

async function runWorker(jobId: string): Promise<void> {
  let next: string | null = jobId;

  for (let index = 0; next !== null && index < MAX_CHAINED_JOBS; index += 1) {
    const result = await runValuationJob(next, {
      store: getValuationJobStore(),
      now,
      newId,
      assess: assessValuationJob,
      startHeartbeat: (beat, intervalMs) => {
        const timer = setInterval(() => void beat(), intervalMs);
        timer.unref();
        return () => clearInterval(timer);
      },
    });

    if (result.status === "failed") {
      console.error("valuation job failed", result.errorName);
    }

    next = result.followUpJobId;
  }
}

async function assessValuationJob(
  job: ValuationJob,
): Promise<ValuationJobOutcome> {
  const prepared = await prepareValuationRun(job, {
    downloadData: true,
    askAi: true,
  });

  if (prepared.kind === "outcome") {
    return prepared.outcome;
  }

  if (prepared.snapshot.status === "not_assembled") {
    return outcomeForAssessment(
      prepared.reading,
      { gap: prepared.snapshot.gap },
      prepared.dataStep,
      prepared.qualitativeStep,
    );
  }

  const run = runValuation(prepared.snapshot.input, {
    now,
    newValuationRunId: newId,
  });
  // Idempotente por clave de replay: el mismo snapshot devuelve la corrida
  // que ya estaba, sin duplicarla.
  const recorded = await getValuationRunRepository().record(run);

  return outcomeForAssessment(
    prepared.reading,
    {
      valuationRunId: recorded.valuationRunId,
      runStatus: recorded.status,
    },
    prepared.dataStep,
    prepared.qualitativeStep,
  );
}

export type PreparedValuationRun =
  | { readonly kind: "outcome"; readonly outcome: ValuationJobOutcome }
  | {
      readonly kind: "snapshot";
      readonly reading: ValuationAssessmentReading;
      readonly snapshot: ValuationSnapshotResult;
      /** `null` si no se pidió el paso de datos. */
      readonly dataStep: ValuationDataStep | null;
      /** `null` si no se le preguntó nada a la IA (`F6-13`). */
      readonly qualitativeStep: ValuationQualitativeStep | null;
    };

/**
 * Resuelve, evalúa y arma el snapshot (`F6-07`). El worker corre el motor y
 * registra la corrida; un script de medición puede llamar a esto sin tocar
 * `valuation_runs`.
 *
 * Con `downloadData` (`F6-05`) baja lo que falta y audita el sujeto antes de
 * armar el snapshot; eso sí escribe, en las tablas de ingesta. Sin la opción,
 * sólo lee.
 *
 * Con `askAi` (`F6-13`) y un método `fcff_base`, pregunta a la IA lo
 * cualitativo que falta antes de armar el snapshot; eso escribe en las tablas
 * de cada tarea y gasta. Sólo corre detrás del paso de datos: una tarea sobre
 * una ventana que no pasó la auditoría preguntaría sobre datos rotos.
 */
export async function prepareValuationRun(
  job: Pick<ValuationJob, "ticker" | "knownAt"> & {
    readonly followsJobId?: string | null;
  },
  options: {
    readonly downloadData?: boolean;
    readonly askAi?: boolean;
  } = {},
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

  let dataStep: ValuationDataStep | null = null;
  const lineage = resolveReportingLineage(
    await getCorporateActionRepository().listRelationships(),
    legalEntityId,
    query,
  );
  const subjectIds = lineage.segments.map((segment) => segment.legalEntityId);
  const lineageCiks = [
    cik,
    ...subjectIds
      .slice(1)
      .map(
        (subjectId) => issuerFactsAt(state.graph, subjectId, null, query).cik,
      )
      .filter(
        (predecessorCik): predecessorCik is string => predecessorCik !== null,
      ),
  ];

  if (options.downloadData === true) {
    dataStep = await ensureValuationData(
      {
        legalEntityId,
        cik,
        securityId: resolution.securityId,
        lineageCiks,
        lineageSubjectIds: subjectIds,
        needsFundamentals: !reading.hasAnnualFundamentals,
        needsSic: assessment.sic === null,
        mayDownload: (job.followsJobId ?? null) === null,
      },
      createValuationDataDependencies(state.graph),
    );

    const subject = {
      legalEntityId,
      securityId: resolution.securityId,
      listingId: resolution.listingId,
    };
    const block = dataStepBlock(dataStep);

    if (block !== null) {
      return {
        kind: "outcome",
        outcome: outcomeForDataStep(subject, block, dataStep),
      };
    }

    if (dataStep.audit?.status === "failed") {
      return {
        kind: "outcome",
        outcome: outcomeForDataStep(
          subject,
          "point_in_time_audit_failed",
          dataStep,
        ),
      };
    }

    if (dataStepIngested(dataStep)) {
      return {
        kind: "outcome",
        outcome: outcomeForDataStep(subject, "data_ingested", dataStep),
      };
    }
  }

  if (!selected || !reading.hasAnnualFundamentals) {
    return {
      kind: "outcome",
      outcome: outcomeForAssessment(reading, undefined, dataStep),
    };
  }

  const securityId = resolution.securityId;
  const employeeEquityRepository = getEmployeeEquityRepository();
  let qualitativeStep: ValuationQualitativeStep | null = null;

  if (
    options.askAi === true &&
    dataStep !== null &&
    assessment.selection.status === "selected" &&
    assessment.selection.recommendedMethod === "fcff_base"
  ) {
    const needs = {
      industry: assessment.industry.status === "ambiguous",
      employeeEquity:
        (await employeeEquityRepository.acceptedAsKnown(
          legalEntityId,
          job.knownAt,
        )) === null,
      operationsMix: assessment.qualitativeDecisions.operationsMix === null,
    };

    if (needs.industry || needs.employeeEquity || needs.operationsMix) {
      qualitativeStep = await runQualitativeStep({
        graph: state.graph,
        legalEntityId,
        cik,
        annualReportCiks: lineageCiks,
        query,
        needs,
      });

      const outcome = qualitativeStepOutcome(
        { legalEntityId, securityId, listingId: resolution.listingId },
        dataStep,
        qualitativeStep,
      );

      if (outcome !== null) {
        return { kind: "outcome", outcome };
      }
    }
  }

  const [employeeEquity, shareCounts, prices, industryReturns] =
    await Promise.all([
      employeeEquityRepository.acceptedAsKnown(legalEntityId, job.knownAt),
      readShareCounts(legalEntityId, query),
      securityId === null
        ? Promise.resolve({ closes: [], events: [] })
        : readPrices(securityId, job.knownAt),
      readReferenceDataset(
        INDUSTRY_RETURNS_DATASET,
        query,
        getReferenceDatasetRepository(),
      ),
    ]);

  return {
    kind: "snapshot",
    reading,
    dataStep,
    qualitativeStep,
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
      industryReturns,
    }),
  };
}

/**
 * Una decisión aceptada se publica después del corte de este job: otro, con
 * corte nuevo, valúa con ella. Sin ninguna, el job sigue al snapshot, que
 * nombra lo que faltó.
 */
function qualitativeStepOutcome(
  subject: Parameters<typeof outcomeForQualitativeStep>[0],
  dataStep: ValuationDataStep,
  step: ValuationQualitativeStep,
): ValuationJobOutcome | null {
  return qualitativeStepAccepted(step)
    ? outcomeForQualitativeStep(subject, dataStep, step)
    : null;
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
