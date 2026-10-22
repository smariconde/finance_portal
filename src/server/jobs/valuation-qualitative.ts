import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { runModelLadder } from "@/modules/ai/application/run-model-ladder";
import {
  searchTavily,
  TAVILY_SOURCE_ID,
} from "@/modules/ai/application/tavily-search";
import { SEC_SIC_TAXONOMY_ID } from "@/modules/classification/domain/sec-sic-classification";
import { buildCompanyConceptUrl } from "@/modules/corporate-actions/application/live-split-claim-source";
import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import { parseSecCompanyConcept } from "@/modules/fundamentals/domain/parse-sec-company-concept";
import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";
import {
  SEC_REQUEST_PACING,
  type EgressFetch,
} from "@/modules/ingestion/application/egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { readReferenceDataset } from "@/modules/reference-data/application/read-reference-dataset";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import { readAnnualFundamentals } from "@/modules/valuation/application/assess-company";
import { DECLARED_INDUSTRY_ASSIGNMENTS } from "@/modules/valuation/application/declared-industry-assignments";
import { DECLARED_OPERATIONS_MIXES } from "@/modules/valuation/application/declared-operations-mixes";
import {
  ensureQualitativeDecisions,
  type QualitativeNeeds,
} from "@/modules/valuation/application/ensure-qualitative-decisions";
import { issuerFactsAt } from "@/modules/valuation/application/issuer-facts";
import { proposeEmployeeEquity } from "@/modules/valuation/application/propose-employee-equity";
import { proposeOperationsMix } from "@/modules/valuation/application/propose-operations-mix";
import { resolveCompanyIndustry } from "@/modules/valuation/application/resolve-company-industry";
import {
  COUNTRY_RISK_DATASET,
  COUNTRY_RISK_REGIONS_DATASET,
} from "@/modules/valuation/domain/cost-of-capital";
import { DAMODARAN_INDUSTRY_TAXONOMY } from "@/modules/valuation/domain/industry-mapping";
import type { ValuationQualitativeStep } from "@/modules/valuation/domain/valuation-qualitative-step";
import { getAiLayer } from "@/server/ai/get-ai-layer";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getEmployeeEquityRepository } from "@/server/persistence/get-employee-equity-repository";
import { getIndustryResolutionRepository } from "@/server/persistence/get-industry-resolution-repository";
import { getOperationsMixRepository } from "@/server/persistence/get-operations-mix-repository";
import { getReferenceDatasetRepository } from "@/server/persistence/get-reference-dataset-repository";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { createFundamentalReaders } from "@/server/valuation/fundamental-readers";

/**
 * Raíz de composición del paso cualitativo de la corrida (`F6-13`,
 * [ADR 0052](../../../docs/architecture/adr/0052-qualitative-decisions-in-valuation-job.md)).
 *
 * Arma las tres tareas como las arman sus comandos —`valuation:resolve-industry`,
 * `valuation:employee-equity` y `valuation:operations-mix`— y las guarda con
 * `apply`. Es el único camino de la app hacia un modelo, y lo toma el worker
 * después de responder: la acción no ve la capa IA ni su gasto.
 *
 * Las tres tareas leen el mismo `submissions` y el mismo 10-K: cada URL se pide
 * una vez por job. Una corrida comparte breaker y techo de proceso, como un
 * comando con varias empresas.
 */
export type QualitativeStepRequest = {
  readonly graph: IdentityGraph;
  readonly legalEntityId: string;
  readonly cik: string;
  /** El CIK pedido primero, después sus antecesores de reporte. */
  readonly annualReportCiks: readonly string[];
  readonly query: PointInTimeQuery;
  readonly needs: QualitativeNeeds;
};

/** Una búsqueda web por job como mucho, la de la industria. */
const WEB_PACING = Object.freeze({ minIntervalMs: 1000, maxRequests: 1 });

export class QualitativeRightsRefusedError extends Error {
  constructor(sourceId: string) {
    super(`${sourceId} is not approved for this use.`);
    this.name = "QualitativeRightsRefusedError";
  }
}

function approved(sourceId: string): boolean {
  const entry = DEMO_SOURCE_REGISTRY.find(
    (candidate) => candidate.sourceId === sourceId,
  );

  return (
    entry !== undefined &&
    evaluateIngestionRights(entry, {
      storesRawPayload: false,
      storesNormalizedValues: true,
      publicDisplay: false,
    }).allowed
  );
}

function legalNameAt(
  graph: IdentityGraph,
  legalEntityId: string,
): string | null {
  return (
    graph.legalEntities.find(
      (entity) =>
        entity.legalEntityId === legalEntityId &&
        entity.validTo === null &&
        entity.supersededAt === null,
    )?.legalName ?? null
  );
}

export async function runQualitativeStep(
  request: QualitativeStepRequest,
): Promise<ValuationQualitativeStep> {
  await syncDeclaredSourceRegistry(
    DEMO_SOURCE_REGISTRY,
    getSourceRegistryRepository(),
  );

  const refused = ["sec-edgar", "openrouter"].find(
    (sourceId) => !approved(sourceId),
  );
  const guard = <Result>(task: () => Promise<Result>) =>
    refused === undefined
      ? task
      : async (): Promise<Result> => {
          throw new QualitativeRightsRefusedError(refused);
        };

  const secFetch: EgressFetch = getSourceEgressFetch(SEC_REQUEST_PACING);
  const webFetch: EgressFetch = getSourceEgressFetch(WEB_PACING);
  const run = getAiLayer().runDependencies();
  const decoder = new TextDecoder("utf-8");
  const texts = new Map<string, Promise<string>>();

  const fetchText = (url: string, accept: string): Promise<string> => {
    const cached = texts.get(url);

    if (cached !== undefined) {
      return cached;
    }

    const pending = secFetch({ sourceId: "sec-edgar", url, accept }).then(
      (response) => {
        if (response.status !== 200) {
          throw new Error(`SEC responded ${response.status}`);
        }

        return decoder.decode(response.body);
      },
    );

    // Una falla no se cachea: la próxima tarea puede volver a intentar.
    pending.catch(() => texts.delete(url));
    texts.set(url, pending);

    return pending;
  };
  const loadSubmissions = async (subjectCik: string) =>
    JSON.parse(
      await fetchText(buildSubmissionsUrl(subjectCik), "application/json"),
    ) as unknown;
  const loadAnnualReport = (report: { readonly url: string }) =>
    fetchText(report.url, "text/html");

  const { graph, legalEntityId, cik, annualReportCiks, query } = request;
  const companyName = legalNameAt(graph, legalEntityId) ?? cik;
  const referenceDatasets = getReferenceDatasetRepository();
  const classifications = getClassificationRepository();
  const fundamentalReaders = createFundamentalReaders(
    (subjectId) => issuerFactsAt(graph, subjectId, null, query).cik,
  );
  const releaseKeys = async (
    datasetId: string,
    pointInTime: PointInTimeQuery,
  ) => {
    const reading = await readReferenceDataset(
      datasetId,
      pointInTime,
      referenceDatasets,
    );

    return reading === null
      ? null
      : {
          releaseId: reading.release.releaseId,
          keys: reading.rows.map((row) => row.key),
        };
  };
  const common = {
    loadSubmissions,
    loadAnnualReport,
    registry: DEMO_SOURCE_REGISTRY,
    now: () => new Date().toISOString(),
    sha256: (text: string) => createHash("sha256").update(text).digest("hex"),
  };
  const task = {
    legalEntityId,
    cik,
    companyName,
    annualReportCiks,
    query,
    apply: true,
    again: false,
  };

  return ensureQualitativeDecisions(request.needs, {
    resolveIndustry: guard(() =>
      resolveCompanyIndustry(
        { ...task, declarations: DECLARED_INDUSTRY_ASSIGNMENTS },
        {
          ...common,
          loadSicAssertions: async () =>
            classifications.loadClassifications({
              taxonomyId: SEC_SIC_TAXONOMY_ID,
              limit: 10_000,
            }),
          industryRelease: async (pointInTime) => {
            const reading = await readReferenceDataset(
              DAMODARAN_INDUSTRY_TAXONOMY,
              pointInTime,
              referenceDatasets,
            );

            return reading === null
              ? null
              : new Map(reading.rows.map((row) => [row.key, row.label]));
          },
          runLadder: (definition, input) =>
            runModelLadder(definition, input, run),
          repository: getIndustryResolutionRepository(),
          newId: () => randomUUID(),
          ...(approved(TAVILY_SOURCE_ID)
            ? {
                // La búsqueda nunca frena la tarea: lo que no vuelve es `null`.
                searchWeb: async (webQuery: string) => {
                  try {
                    const result = await searchTavily(webFetch, webQuery);

                    return result.kind === "completed" ? result.results : null;
                  } catch {
                    return null;
                  }
                },
              }
            : {}),
        },
      ),
    ),
    proposeEmployeeEquity: guard(() =>
      proposeEmployeeEquity(task, {
        ...common,
        loadConceptFacts: async (subjectCik, concept) => {
          const response = await secFetch({
            sourceId: "sec-edgar",
            url: buildCompanyConceptUrl(subjectCik, concept),
            accept: "application/json",
          });

          // Un `404` es un filer que nunca etiquetó el concepto: no corrobora.
          if (response.status === 404) return [];
          if (response.status !== 200) {
            throw new Error(`SEC responded ${response.status}`);
          }

          const parsed = parseSecCompanyConcept(
            decoder.decode(response.body),
            concept,
          );

          if (!parsed.ok) {
            throw new Error(`companyconcept unreadable: ${parsed.code}`);
          }

          return parsed.facts;
        },
        runLadder: (definition, input) =>
          runModelLadder(definition, input, run),
        repository: getEmployeeEquityRepository(),
      }),
    ),
    proposeOperationsMix: guard(() =>
      proposeOperationsMix(
        { ...task, declarations: DECLARED_OPERATIONS_MIXES },
        {
          ...common,
          countryRelease: (pointInTime) =>
            releaseKeys(COUNTRY_RISK_DATASET, pointInTime),
          regionRelease: (pointInTime) =>
            releaseKeys(COUNTRY_RISK_REGIONS_DATASET, pointInTime),
          annualFundamentals: async (subjectId, pointInTime) =>
            (
              await readAnnualFundamentals(
                subjectId,
                pointInTime,
                fundamentalReaders,
              )
            ).series,
          runLadder: (definition, input) =>
            runModelLadder(definition, input, run),
          repository: getOperationsMixRepository(),
        },
      ),
    ),
  });
}
