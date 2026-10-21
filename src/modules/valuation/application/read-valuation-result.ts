import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
  type TemporalVersion,
} from "@/modules/temporal/domain/temporal-version";
import type { UniverseRepository } from "@/modules/universe/application/universe-repository";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";

import {
  valuationTickerSchema,
  type ValuationJob,
} from "../domain/valuation-job";
import { valuationRunSchema, type ValuationRun } from "../domain/valuation-run";
import type { ValuationRunRepository } from "./valuation-run-repository";
import {
  VALUATION_HISTORY_LIMIT,
  type ValuationJobStore,
} from "./valuation-job-store";

/**
 * El resultado de un ticker sobre una empresa real (`F6-03`).
 *
 * La corrida que se muestra es la última que un job del ticker registró. Si un
 * job más nuevo terminó sin corrida —un hueco con nombre—, se dice al lado: la
 * corrida anterior no se oculta, pero tampoco se presenta como la vigente sin
 * aviso. Sólo lee: refrescar es volver a encolar (ADR 0047).
 *
 * La identidad se lee **al corte de la corrida**, con versiones cerradas
 * incluidas: un nombre o un ticker posterior no se cuela en el encabezado de
 * una corrida anterior (`TM-06`).
 */
export type ValuationResultSubject = {
  readonly legalName: string;
  readonly jurisdiction: string | null;
  readonly mic: string | null;
  readonly symbol: string | null;
  readonly cik: string | null;
};

export type ValuationResultJob = {
  readonly knownAt: string;
  readonly finishedAt: string | null;
};

export type ValuationResultNewerGap = ValuationResultJob & {
  readonly gap: ValuationJob["gap"];
  readonly snapshotGap: ValuationJob["snapshotGap"];
};

export type ValuationResultReading =
  /** Ningún job del ticker terminó todavía. */
  | { readonly state: "not_requested"; readonly ticker: string }
  /** Hubo jobs, ninguno registró una corrida: el último dice por qué. */
  | {
      readonly state: "no_run";
      readonly ticker: string;
      readonly latest: ValuationResultNewerGap;
    }
  /** La corrida registrada no es FCFF: esta superficie no la lee. */
  | {
      readonly state: "unsupported_run";
      readonly ticker: string;
      readonly job: ValuationResultJob;
    }
  | {
      readonly state: "run";
      readonly ticker: string;
      readonly run: ValuationRun;
      readonly job: ValuationResultJob;
      readonly newerGap: ValuationResultNewerGap | null;
      readonly subject: ValuationResultSubject | null;
    };

export type ValuationResultDependencies = {
  readonly jobs: Pick<ValuationJobStore, "listCompletedByTicker">;
  readonly runs: Pick<ValuationRunRepository, "findById">;
  readonly universe: Pick<UniverseRepository, "loadState">;
};

function jobReading(job: ValuationJob): ValuationResultJob {
  return { knownAt: job.knownAt, finishedAt: job.finishedAt };
}

function gapReading(job: ValuationJob): ValuationResultNewerGap {
  return { ...jobReading(job), gap: job.gap, snapshotGap: job.snapshotGap };
}

function versionsAt<TVersion extends TemporalVersion>(
  versions: readonly TVersion[],
  query: PointInTimeQuery,
): TVersion[] {
  return versions.filter(
    (version) =>
      isEffectiveAt(version, query.effectiveAt) && isKnownAt(version, query),
  );
}

/** Nombre, mercado, símbolo y CIK del sujeto, al corte de la corrida. */
export function subjectAt(
  graph: IdentityGraph,
  run: ValuationRun,
): ValuationResultSubject | null {
  const query = run.provenance.knowledge;
  const entity = versionsAt(graph.legalEntities, query).find(
    (candidate) => candidate.legalEntityId === run.subject.legalEntityId,
  );

  if (entity === undefined) {
    return null;
  }

  const listingId = run.subject.listingId;
  const listing =
    listingId === null
      ? undefined
      : versionsAt(graph.listings, query).find(
          (candidate) => candidate.listingId === listingId,
        );
  const symbol =
    listingId === null
      ? undefined
      : versionsAt(graph.listingSymbols, query).find(
          (candidate) =>
            candidate.listingId === listingId &&
            candidate.symbolType === "ticker",
        );
  const cik = versionsAt(graph.identifierAssignments, query).find(
    (assignment) =>
      assignment.subjectType === "legal_entity" &&
      assignment.subjectId === entity.legalEntityId &&
      assignment.identifierType === "cik",
  );

  return {
    legalName: entity.legalName,
    jurisdiction: entity.jurisdiction,
    mic: listing?.mic ?? null,
    symbol: symbol?.symbol ?? null,
    cik: cik?.identifierValue ?? null,
  };
}

export async function readValuationResult(
  input: { readonly ticker: string },
  dependencies: ValuationResultDependencies,
): Promise<ValuationResultReading> {
  const ticker = valuationTickerSchema.parse(input.ticker);
  const jobs = await dependencies.jobs.listCompletedByTicker(
    ticker,
    VALUATION_HISTORY_LIMIT,
  );
  const latest = jobs[0];

  if (latest === undefined) {
    return { state: "not_requested", ticker };
  }

  const recordedIndex = jobs.findIndex((job) => job.valuationRunId !== null);

  if (recordedIndex < 0) {
    return { state: "no_run", ticker, latest: gapReading(latest) };
  }

  const recordedJob = jobs[recordedIndex]!;
  const stored = await dependencies.runs.findById(recordedJob.valuationRunId!);
  if (stored === null) {
    // El job apunta a una corrida que la FK garantiza; si no está, no se
    // inventa otra.
    throw new Error("The recorded valuation run is missing.");
  }

  // El job por ticker sólo registra `fcff_base`, pero el almacén acepta los
  // otros motores: uno de ellos no se lee con los componentes FCFF.
  const parsed = valuationRunSchema.safeParse(stored);

  if (!parsed.success) {
    return { state: "unsupported_run", ticker, job: jobReading(recordedJob) };
  }

  const run = parsed.data;
  const state = await dependencies.universe.loadState({
    indexId: SP500_INDEX_ID,
    versions: "all",
    limit: 50_000,
  });

  return {
    state: "run",
    ticker,
    run,
    job: jobReading(recordedJob),
    newerGap: recordedIndex === 0 ? null : gapReading(latest),
    subject: subjectAt(state.graph, run),
  };
}
