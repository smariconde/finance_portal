import type { CedearRegistryRepository } from "@/modules/cedears/application/cedear-registry-repository";
import { CEDEAR_DEPOSITARIES } from "@/modules/cedears/domain/cedear-depositaries";
import type { StoredCedearRegistry } from "@/modules/cedears/domain/plan-cedear-registry";
import {
  CEDEAR_ACCESS_RULE_VERSION,
  resolveCedearAccess,
} from "@/modules/cedears/domain/resolve-cedear-access";
import type {
  DepositaryProgram,
  IdentityGraph,
} from "@/modules/identity/domain/identity-graph";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
  type TemporalVersion,
} from "@/modules/temporal/domain/temporal-version";
import type { UniverseRepository } from "@/modules/universe/application/universe-repository";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";

import {
  cedearEquivalent,
  type CedearEquivalent,
} from "../domain/cedear-equivalent";
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

/**
 * Acceso por CEDEAR a la security valuada (`F6-04`), al corte de la corrida.
 *
 * Sale del registro de `F7-03` y nunca entra al snapshot: el CEDEAR es otro
 * instrumento, y la valuación corre sobre la subyacente. Lleva lo que se
 * muestra —depositario, estado, ISIN, código de Caja, ratio y desde cuándo se
 * lo conoce— y ningún ID interno.
 */
export type ValuationResultCedearProgram = {
  readonly depositaryName: string | null;
  readonly status: DepositaryProgram["status"];
  readonly investorScope: string | null;
  readonly cedearIsin: string | null;
  readonly cajaValoresCode: string | null;
  readonly programSeenAt: string;
  readonly ratio: {
    readonly depositaryUnits: string;
    readonly underlyingUnits: string;
    readonly availableAt: string;
  } | null;
  readonly equivalent: CedearEquivalent;
};

export type ValuationResultCedear = {
  readonly rule: typeof CEDEAR_ACCESS_RULE_VERSION;
} & (
  | {
      readonly status: "program";
      readonly programs: readonly ValuationResultCedearProgram[];
    }
  | {
      readonly status: "none_known";
      readonly reason: "no_program_recorded" | "not_effective_at_cutoff";
    }
);

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
      readonly cedear: ValuationResultCedear;
    };

export type ValuationResultDependencies = {
  readonly jobs: Pick<ValuationJobStore, "listCompletedByTicker">;
  readonly runs: Pick<ValuationRunRepository, "findById">;
  readonly universe: Pick<UniverseRepository, "loadState">;
  readonly cedears: Pick<CedearRegistryRepository, "loadRegistry">;
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

/**
 * El acceso por CEDEAR al corte de la corrida: un ratio visto después del
 * corte no convierte el valor de una corrida anterior (`TM-06`).
 */
export function cedearAccessAt(
  graph: IdentityGraph,
  registry: StoredCedearRegistry,
  run: ValuationRun,
): ValuationResultCedear {
  const query = run.provenance.knowledge;
  const access = resolveCedearAccess(registry, run.subject.securityId, query);

  if (access.status === "none_known") {
    return {
      rule: CEDEAR_ACCESS_RULE_VERSION,
      status: "none_known",
      reason: access.reason,
    };
  }

  const identifiers = versionsAt(graph.identifierAssignments, query);
  const identifierOf = (securityId: string, identifierType: string) =>
    identifiers.find(
      (assignment) =>
        assignment.subjectType === "security" &&
        assignment.subjectId === securityId &&
        assignment.identifierType === identifierType,
    )?.identifierValue ?? null;

  return {
    rule: CEDEAR_ACCESS_RULE_VERSION,
    status: "program",
    programs: access.programs.map(({ program, ratio }) => ({
      depositaryName:
        CEDEAR_DEPOSITARIES.find(
          (depositary) =>
            depositary.legalEntityId === program.depositaryLegalEntityId,
        )?.legalName ?? null,
      status: program.status,
      investorScope: program.investorScope,
      cedearIsin: identifierOf(program.depositarySecurityId, "isin"),
      cajaValoresCode: identifierOf(
        program.depositarySecurityId,
        "caja_valores_code",
      ),
      programSeenAt: program.availableAt,
      ratio:
        ratio === null
          ? null
          : {
              depositaryUnits: ratio.depositaryUnits,
              underlyingUnits: ratio.underlyingUnits,
              availableAt: ratio.availableAt,
            },
      equivalent: cedearEquivalent({
        valuePerShare: run.result?.valuePerShare ?? null,
        currency: run.currency,
        ratio,
      }),
    })),
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
  const [state, registry] = await Promise.all([
    dependencies.universe.loadState({
      indexId: SP500_INDEX_ID,
      versions: "all",
      limit: 50_000,
    }),
    dependencies.cedears.loadRegistry({}),
  ]);

  return {
    state: "run",
    ticker,
    run,
    job: jobReading(recordedJob),
    newerGap: recordedIndex === 0 ? null : gapReading(latest),
    subject: subjectAt(state.graph, run),
    cedear: cedearAccessAt(state.graph, registry, run),
  };
}
