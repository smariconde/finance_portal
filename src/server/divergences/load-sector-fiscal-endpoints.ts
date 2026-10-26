import "server-only";

import { loadSectorFiscalEndpoints as loadSector } from "@/modules/divergences/application/load-sector-fiscal-endpoints";
import { readLineageObservations } from "@/modules/corporate-actions/application/read-lineage-observations";
import { SEC_SOURCE_ID } from "@/modules/fundamentals/application/live-company-facts-source";
import { COMPANY_FACTS_DATASET_ID } from "@/modules/fundamentals/application/ingest-company-facts";
import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";
import {
  pointInTimeQuerySchema,
  DEFAULT_SOURCE_POLICY_VERSION,
  type PointInTimeQueryInput,
} from "@/modules/temporal/domain/point-in-time-query";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getCorporateActionRepository } from "@/server/persistence/get-corporate-action-repository";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getObservationRepository } from "@/server/persistence/get-observation-repository";
import { getPriceRepository } from "@/server/persistence/get-price-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/** Only the SEC concepts that F8-01 needs; no universe fundamentals backfill. */
const FISCAL_CONCEPTS = [
  "us-gaap:NetIncomeLoss",
  "us-gaap:ProfitLoss",
  "us-gaap:EarningsPerShareDiluted",
  "us-gaap:IncomeLossFromContinuingOperationsPerDilutedShare",
  "us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding",
  "us-gaap:CommonStockSharesOutstanding",
];

/** A predecessor has no current CIK assignment but keeps its last filing key. */
function cikOf(graph: IdentityGraph, legalEntityId: string): string | null {
  const assignments = graph.identifierAssignments.filter(
    (candidate) =>
      candidate.identifierType === "cik" &&
      candidate.subjectType === "legal_entity" &&
      candidate.subjectId === legalEntityId,
  );
  const open = assignments.find(
    (candidate) =>
      candidate.validTo === null && candidate.supersededAt === null,
  );
  return (open ?? assignments[0])?.normalizedValue ?? null;
}

/** Stored-only sector read; the default is the current personal snapshot. */
export async function loadStoredSectorFiscalEndpoints(
  sectorCode: string,
  historicalQuery?: PointInTimeQueryInput,
) {
  const instant = new Date().toISOString();
  const query = pointInTimeQuerySchema.parse(
    historicalQuery ?? {
      effectiveAt: instant,
      knownAt: instant,
      revisionPolicy: "as_known",
      adjustmentPolicy: "as_known",
      sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
    },
  );
  const corporateActions = getCorporateActionRepository();
  const observations = getObservationRepository();
  const ingestionRuns = getIngestionRunRepository();

  return loadSector(
    { sectorCode, query },
    {
      universe: getUniverseRepository(),
      classifications: getClassificationRepository(),
      prices: getPriceRepository(),
      createFactReaders: (graph) => ({
        readFacts: async (legalEntityId, cutoff) => {
          const selection = await readLineageObservations(
            { legalEntityId, metricIds: FISCAL_CONCEPTS },
            cutoff,
            { corporateActions, observations },
          );
          return selection.rows.map((row) => ({
            observationId: row.observation.observationId,
            subjectId: row.observation.subjectId,
            concept: row.observation.concept,
            periodType: row.observation.periodType,
            asOf: row.observation.asOf,
            periodStart: row.observation.periodStart,
            unit: row.observation.unit,
            currency: row.observation.currency,
            value: row.value,
            availableAt: row.observation.availableAt,
            recordedAt: row.observation.recordedAt,
            sourceDocumentId: row.observation.sourceDocumentId,
          }));
        },
        fiscalYearAnchors: async (subjectIds, cutoff) => {
          const anchors = await Promise.all(
            subjectIds.map(async (subjectId) => {
              const cik = cikOf(graph, subjectId);
              if (cik === null) return null;
              const run = await ingestionRuns.findLatestAnchoredAt(
                SEC_SOURCE_ID,
                COMPANY_FACTS_DATASET_ID,
                cik,
                cutoff.knownAt ?? instant,
              );
              return run?.selectionAnchorOn ?? null;
            }),
          );
          return anchors.filter((anchor): anchor is string => anchor !== null);
        },
      }),
    },
  );
}
