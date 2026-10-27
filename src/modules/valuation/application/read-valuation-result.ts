import { securityTickersAt } from "@/modules/identity/domain/resolve-identity";
import {
  cedearPesoValue,
  type CedearPesoValue,
} from "../domain/cedear-peso-value";
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
import type { PriceRepository } from "@/modules/prices/application/price-repository";
import type { UniverseRepository } from "@/modules/universe/application/universe-repository";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";

import {
  cedearEquivalent,
  type CedearEquivalent,
} from "../domain/cedear-equivalent";
import {
  judgePlausibility,
  type DriverPlausibility,
  type StoredMarketExpectations,
} from "../domain/market-expectations";
import {
  compareWithMarketPrice,
  marketImpliedContext,
  marketImpliedExpectations,
  type MarketClose,
  type MarketImplied,
  type MarketImpliedContext,
  type MarketPriceComparison,
} from "../domain/market-implied";
import {
  valuationTickerSchema,
  type ValuationJob,
} from "../domain/valuation-job";
import {
  companyTrajectory,
  type CompanyTrajectory,
} from "../domain/company-trajectory";
import { valuationRunSchema, type ValuationRun } from "../domain/valuation-run";
import {
  readAnnualFundamentals,
  type CompanyAssessmentDependencies,
} from "./assess-company";
import { issuerFactsAt } from "./issuer-facts";
import type { MarketExpectationsRepository } from "./market-expectations-repository";
import { readPeerContext } from "./read-peer-context";
import type { PeerContext } from "../domain/peer-context";
import type { ClassificationRepository } from "@/modules/classification/application/classification-repository";
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
  readonly bymaSymbol: string | null;
  readonly pesos: CedearPesoValue;
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

/**
 * El precio contra el valor (`F6-09`, ADR 0048): el cierre crudo al `as_of`
 * de la corrida, lo que ese precio exige de cada driver y contra qué leerlo.
 * Sale de la serie guardada y de la propia corrida; nada entra al snapshot.
 */
export type ValuationResultMarket = {
  readonly comparison: MarketPriceComparison;
  readonly implied: MarketImplied;
  readonly context: MarketImpliedContext;
  /**
   * El último cierre guardado cuando es posterior al corte: la corrida no lo
   * vio, y compararlo con su valor mezclaría dos fechas. Se muestra al lado.
   */
  readonly latestClose: MarketClose | null;
  /**
   * La lectura de la IA sobre el 10-K del año base de la corrida (`F6-11`), y
   * dónde cae lo que exige el precio en sus escalas. `null` si nadie la pidió.
   */
  readonly reading: {
    readonly stored: StoredMarketExpectations;
    readonly plausibility: readonly DriverPlausibility[];
  } | null;
};

export type ValuationResultJob = {
  readonly knownAt: string;
  readonly finishedAt: string | null;
};

export type ValuationResultNewerGap = ValuationResultJob & {
  readonly gap: ValuationJob["gap"];
  readonly assetProfile: ValuationJob["assetProfile"];
  readonly unsupportedReason: ValuationJob["unsupportedReason"];
  readonly snapshotGap: ValuationJob["snapshotGap"];
  /** Qué bajó y auditó (`F6-05`): estados y códigos, sin IDs. */
  readonly dataStep: ValuationJob["dataStep"];
  /** Qué le preguntó a la IA (`F6-13`): estados y códigos, sin IDs. */
  readonly qualitativeStep: ValuationJob["qualitativeStep"];
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
      readonly market: ValuationResultMarket;
      /**
       * Cómo venía la empresa (`F6-17`): la serie anual reportada al corte de
       * la corrida. `null` cuando la empresa no tiene fundamentals ingeridos.
       */
      readonly trajectory: CompanyTrajectory | null;
      /** La brecha frente a lo demás que se valuó (`F6-19`). */
      readonly peers: PeerContext;
    };

export type ValuationResultDependencies = {
  readonly jobs: Pick<ValuationJobStore, "listCompletedByTicker">;
  readonly runs: Pick<
    ValuationRunRepository,
    "findById" | "listLatestInWindow"
  >;
  readonly classifications: Pick<
    ClassificationRepository,
    "loadClassifications"
  >;
  readonly universe: Pick<UniverseRepository, "loadState">;
  readonly cedears: Pick<CedearRegistryRepository, "loadRegistry">;
  readonly prices: Pick<PriceRepository, "loadSeries" | "loadEvents">;
  readonly expectations: Pick<
    MarketExpectationsRepository,
    "acceptedForFiscalYear"
  >;
  /** Los lectores de la serie anual, con el CIK de cada sujeto del linaje. */
  readonly fundamentals: (
    cikOf: (legalEntityId: string) => string | null,
  ) => Pick<
    CompanyAssessmentDependencies,
    "readFundamentals" | "fiscalYearAnchors"
  >;
};

/** Ocho años de ruedas: más que eso, el corte es demasiado viejo para leer. */
const MARKET_CLOSES_LIMIT = 2_000;

/**
 * El precio al corte de la corrida y lo que exige. Se leen las ruedas desde
 * el `as_of` —la del corte y la última guardada— y los splits, que deciden si
 * precio y valor hablan de las mismas acciones.
 */
export async function marketAt(
  run: ValuationRun,
  dependencies: Pick<ValuationResultDependencies, "prices" | "expectations">,
): Promise<ValuationResultMarket> {
  const { prices } = dependencies;
  const securityId = run.subject.securityId;
  const [closes, events, stored] = await Promise.all([
    prices.loadSeries({
      securityId,
      from: run.asOf,
      to: null,
      limit: MARKET_CLOSES_LIMIT,
    }),
    prices.loadEvents({ securityId }),
    dependencies.expectations.acceptedForFiscalYear(
      run.subject.legalEntityId,
      run.input.baseRevenue.asOf,
    ),
  ]);
  const readable = closes.map(({ marketDate, close, currency }) => ({
    marketDate,
    close,
    currency,
  }));
  const comparison = compareWithMarketPrice({ run, closes: readable, events });
  const latest = readable.at(-1);
  const implied = marketImpliedExpectations({ run, comparison });
  const context = marketImpliedContext(run.input);

  return {
    comparison,
    implied,
    context,
    reading:
      stored?.record.reading == null
        ? null
        : {
            stored,
            plausibility: judgePlausibility({
              readings: stored.record.reading.drivers,
              implied: implied.status === "computed" ? implied.readings : [],
              context,
            }),
          },
    latestClose:
      latest === undefined || latest.marketDate <= run.asOf ? null : latest,
  };
}

function jobReading(job: ValuationJob): ValuationResultJob {
  return { knownAt: job.knownAt, finishedAt: job.finishedAt };
}

function gapReading(job: ValuationJob): ValuationResultNewerGap {
  return {
    ...jobReading(job),
    gap: job.gap,
    assetProfile: job.assetProfile,
    unsupportedReason: job.unsupportedReason,
    snapshotGap: job.snapshotGap,
    dataStep: job.dataStep,
    qualitativeStep: job.qualitativeStep,
  };
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
      bymaSymbol: localSymbolAt(graph, program.depositarySecurityId, query),
      pesos: {
        status: "unavailable",
        version: "cedear-peso-value-1.0.0",
        reason: "no_cedear_close_at_as_of",
      },
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

function localSymbolAt(
  graph: IdentityGraph,
  securityId: string,
  query: PointInTimeQuery,
): string | null {
  const ids = new Set(
    versionsAt(graph.listings, query)
      .filter(
        (row) =>
          row.securityId === securityId &&
          row.mic === "XBUE" &&
          row.quoteCurrency === "ARS" &&
          row.status === "active",
      )
      .map((row) => row.listingId),
  );
  const symbols = securityTickersAt(graph, securityId, query).filter((row) =>
    ids.has(row.listingId),
  );
  return symbols.length === 1 ? symbols[0]!.symbol : null;
}

export async function cedearMarketAt(
  graph: IdentityGraph,
  registry: StoredCedearRegistry,
  run: ValuationRun,
  market: ValuationResultMarket,
  prices: ValuationResultDependencies["prices"],
): Promise<ValuationResultCedear> {
  const cedear = cedearAccessAt(graph, registry, run);
  const access = resolveCedearAccess(
    registry,
    run.subject.securityId,
    run.provenance.knowledge,
  );
  const securityIds =
    access.status === "program"
      ? access.programs.map(({ program }) => program.depositarySecurityId)
      : [];
  if (cedear.status !== "program") return cedear;
  return {
    ...cedear,
    programs: await Promise.all(
      cedear.programs.map(async (program, index) => ({
        ...program,
        pesos: cedearPesoValue({
          asOf: run.asOf,
          symbol: program.bymaSymbol,
          ratio: program.ratio,
          ratioKnownOn: program.ratio?.availableAt.slice(0, 10) ?? null,
          events:
            program.bymaSymbol === null
              ? []
              : await prices.loadEvents({ securityId: securityIds[index]! }),
          comparison: market.comparison,
          closes:
            program.bymaSymbol === null
              ? []
              : await prices.loadSeries({
                  securityId: securityIds[index]!,
                  from: run.asOf,
                  to: run.asOf,
                  limit: 2,
                }),
        }),
      })),
    ),
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

  // El job por ticker registra `fcff_base` y, desde `F6-18`, `normalized_fcff`,
  // que comparten el resultado FCFF; un motor que no lo comparte no se lee acá.
  const parsed = valuationRunSchema.safeParse(stored);

  if (!parsed.success) {
    return { state: "unsupported_run", ticker, job: jobReading(recordedJob) };
  }

  const run = parsed.data;
  const [state, registry, market] = await Promise.all([
    dependencies.universe.loadState({
      indexId: SP500_INDEX_ID,
      versions: "all",
      limit: 50_000,
    }),
    dependencies.cedears.loadRegistry({}),
    marketAt(run, dependencies),
  ]);

  // La misma serie que leyó la evaluación de la corrida, al mismo corte: una
  // publicación posterior no puede aparecer en la historia.
  const knowledge = run.provenance.knowledge;
  const { series } = await readAnnualFundamentals(
    run.subject.legalEntityId,
    knowledge,
    dependencies.fundamentals(
      (subjectId) => issuerFactsAt(state.graph, subjectId, null, knowledge).cik,
    ),
  );

  return {
    state: "run",
    ticker,
    run,
    job: jobReading(recordedJob),
    newerGap: recordedIndex === 0 ? null : gapReading(latest),
    subject: subjectAt(state.graph, run),
    cedear: await cedearMarketAt(
      state.graph,
      registry,
      run,
      market,
      dependencies.prices,
    ),
    market,
    trajectory: series === null ? null : companyTrajectory(series),
    peers: await readPeerContext(
      {
        run,
        series,
        comparison: market.comparison,
        graph: state.graph,
        subjectOf: (peerRun) => subjectAt(state.graph, peerRun),
      },
      dependencies,
    ),
  };
}
