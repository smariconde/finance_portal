import type { SourceRegistryEntry } from "@/modules/ingestion/domain/source-registry-entry";
import type { ValuationResultReading } from "@/modules/valuation/application/read-valuation-result";
import type { ValuedCompaniesReading } from "@/modules/valuation/application/read-valued-companies";
import {
  RUN_CHECK_ORIGINS,
  reviewOfRun,
  type RunCheckOrigin,
  type RunReview,
} from "@/modules/valuation/domain/run-review";
import { valuationVerdict } from "@/modules/valuation/domain/valuation-verdict";

import {
  PORTAL_MCP_TOOLS_VERSION,
  VALUATION_CEDEAR_SOURCES,
  VALUATION_MARKET_SOURCES,
  VALUATION_RUN_SOURCES,
} from "../domain/mcp-tool-catalog";
import {
  gate,
  OWNER_ASSISTANT_POLICY_VERSION,
} from "../domain/owner-assistant-rights";

/**
 * Las valuaciones como las lee la página, proyectadas para el asistente del
 * owner (`portal-mcp-tools-1.2.0`). Montos en texto decimal, nunca `number`;
 * ningún ID interno (entidad, security, corrida o job): el ticker y las
 * fechas alcanzan para volver a la página.
 */

function attributionsOf(
  sourceIds: readonly string[],
  registry: readonly SourceRegistryEntry[],
) {
  return [...new Set(sourceIds)].sort().map((sourceId) => ({
    sourceId,
    attribution:
      registry.find((entry) => entry.sourceId === sourceId)?.attribution ??
      null,
  }));
}

const envelope = {
  catalogVersion: PORTAL_MCP_TOOLS_VERSION,
  rightsPolicy: OWNER_ASSISTANT_POLICY_VERSION,
} as const;

export function projectValuedCompanies(
  reading: ValuedCompaniesReading,
  registry: readonly SourceRegistryEntry[],
) {
  const sources = [...VALUATION_RUN_SOURCES, ...VALUATION_MARKET_SOURCES];

  return {
    ...envelope,
    readingVersion: reading.version,
    sources: attributionsOf(sources, registry),
    companies: gate(sources, registry, () => ({
      items: reading.companies.map((company) => ({
        ticker: company.ticker,
        legalName: company.legalName,
        method: company.method,
        status: company.status,
        review: reviewSection(company.review),
        asOf: company.asOf,
        currency: company.currency,
        valuePerShare: company.valuePerShare,
        close: company.close,
        priceToValue: company.priceToValue,
        comparisonGap: company.comparisonGap,
      })),
    })),
  };
}

type RunRecord =
  | Extract<ValuationResultReading, { state: "run" }>["run"]
  | Extract<ValuationResultReading, { state: "financial_run" }>["run"];

/**
 * Lo común a una corrida FCFF y a una financiera. El valor por acción lo
 * pone cada una: la FCFF lo guarda en `result`, la de exceso de retorno en
 * `result.base`.
 */
function runSection(run: RunRecord, valuePerShare: string | null) {
  const knowledge = run.input.knowledge;

  return {
    method: run.method,
    status: run.status,
    assetProfile: run.assetProfile,
    asOf: run.asOf,
    knownAt: knowledge.revisionPolicy === "as_known" ? knowledge.knownAt : null,
    revisionPolicy: knowledge.revisionPolicy,
    currency: run.currency,
    valuePerShare,
    engineVersion: run.engineVersion,
    methodologyVersion: run.methodologyVersion,
    inputHash: run.inputHash,
    resultHash: run.resultHash,
    recordedAt: run.recordedAt,
    // Un rechazo dice qué reglas lo frenaron y sobre qué campos (`F6-45`):
    // el motor sólo nombra reglas y rutas, nunca valores (`TM-02`).
    failure:
      run.failure === null
        ? null
        : {
            code: run.failure.code,
            message: run.failure.message,
            subjects: run.failure.subjects,
          },
  };
}

function reviewSection(review: RunReview) {
  return {
    version: review.version,
    marks: review.marks,
    experimentalModel: review.experimentalModel,
    reviewChecks: review.reviewChecks,
  };
}

type ProjectedCheck = {
  readonly id: string;
  readonly mode: string;
  readonly status: string;
};

/**
 * Los controles que no pasaron, uno por `id` y modo, con los casos donde
 * fallaron: un escenario que pide revisión deja la corrida en revisión y el
 * asistente tiene que poder decir cuál (`F6-51`).
 */
function failedChecks(
  checks: Partial<
    Record<RunCheckOrigin, readonly ProjectedCheck[] | undefined>
  >,
) {
  const failed = new Map<
    string,
    { id: string; mode: string; origins: RunCheckOrigin[] }
  >();

  for (const origin of RUN_CHECK_ORIGINS) {
    for (const check of checks[origin] ?? []) {
      if (check.status !== "failed") continue;
      const key = `${check.mode}:${check.id}`;
      const entry = failed.get(key) ?? {
        id: check.id,
        mode: check.mode,
        origins: [],
      };
      if (!entry.origins.includes(origin)) entry.origins.push(origin);
      failed.set(key, entry);
    }
  }

  return [...failed.values()];
}

function subjectSection(
  subject: Extract<ValuationResultReading, { state: "run" }>["subject"],
) {
  return subject === null
    ? null
    : {
        legalName: subject.legalName,
        jurisdiction: subject.jurisdiction,
        mic: subject.mic,
        symbol: subject.symbol,
        cik: subject.cik,
      };
}

function cedearSection(
  cedear: Extract<ValuationResultReading, { state: "run" }>["cedear"],
) {
  return cedear.status === "program"
    ? {
        rule: cedear.rule,
        status: cedear.status,
        programs: cedear.programs.map((program) => ({
          bymaSymbol: program.bymaSymbol,
          depositaryName: program.depositaryName,
          status: program.status,
          cedearIsin: program.cedearIsin,
          programSeenAt: program.programSeenAt,
          ratio: program.ratio,
          equivalent: program.equivalent,
        })),
      }
    : { rule: cedear.rule, status: cedear.status, reason: cedear.reason };
}

export function projectValuationResult(
  reading: ValuationResultReading,
  registry: readonly SourceRegistryEntry[],
) {
  const base = { ...envelope, ticker: reading.ticker, state: reading.state };

  switch (reading.state) {
    case "not_requested":
      return { ...base, reason: "no_completed_job" };
    case "no_run":
      return {
        ...base,
        latestJob: {
          knownAt: reading.latest.knownAt,
          finishedAt: reading.latest.finishedAt,
          gap: reading.latest.gap,
          snapshotGap: reading.latest.snapshotGap,
          unsupportedReason: reading.latest.unsupportedReason,
        },
      };
    case "unsupported_run":
      return { ...base, reason: "method_not_read_by_this_surface" };
    case "financial_run":
      return {
        ...base,
        sources: attributionsOf(
          [...VALUATION_RUN_SOURCES, ...VALUATION_MARKET_SOURCES],
          registry,
        ),
        company: subjectSection(reading.subject),
        run: gate(VALUATION_RUN_SOURCES, registry, () => {
          const result = reading.run.result;

          return {
            ...runSection(reading.run, result?.base.valuePerShare ?? null),
            scenarios:
              result?.scenarios == null
                ? null
                : {
                    bearValuePerShare: result.scenarios.bear.valuePerShare,
                    bullValuePerShare: result.scenarios.bull.valuePerShare,
                  },
            modelStatus: result?.modelStatus ?? null,
            rigor: result?.rigor ?? null,
            review: reviewSection(reviewOfRun(reading.run)),
            failedChecks: failedChecks({ base: result?.checks }),
          };
        }),
        market: gate(VALUATION_MARKET_SOURCES, registry, () => ({
          close: reading.market.close,
          comparable: reading.market.comparable,
          priceToValue: reading.market.priceToValue,
          reason: reading.market.reason,
        })),
        cedear: gate(VALUATION_CEDEAR_SOURCES, registry, () =>
          cedearSection(reading.cedear),
        ),
        newerJobWithoutRun: reading.newerGap !== null,
      };
    case "run": {
      const { run, market } = reading;
      const scenarios = run.result?.scenarios ?? null;
      const verdict = valuationVerdict({
        comparison: market.comparison,
        scenarios,
      });

      return {
        ...base,
        sources: attributionsOf(
          [
            ...VALUATION_RUN_SOURCES,
            ...VALUATION_MARKET_SOURCES,
            ...VALUATION_CEDEAR_SOURCES,
          ],
          registry,
        ),
        company: subjectSection(reading.subject),
        run: gate(VALUATION_RUN_SOURCES, registry, () => ({
          ...runSection(run, run.result?.valuePerShare ?? null),
          scenarios:
            scenarios === null
              ? null
              : {
                  version: scenarios.version,
                  bearValuePerShare: scenarios.bear.valuePerShare,
                  bullValuePerShare: scenarios.bull.valuePerShare,
                },
          rigor: {
            version: run.input.assessment.rigor.version,
            level: run.input.assessment.rigor.level,
            degradedBy: run.input.assessment.rigor.degradedBy,
          },
          review: reviewSection(reviewOfRun(run)),
          failedChecks: failedChecks({
            base: run.result?.checks,
            bear: run.result?.scenarios?.bear.checks,
            bull: run.result?.scenarios?.bull.checks,
          }),
        })),
        market: gate(VALUATION_MARKET_SOURCES, registry, () => ({
          comparison:
            market.comparison.status === "compared"
              ? {
                  version: market.comparison.version,
                  status: market.comparison.status,
                  price: market.comparison.price,
                  valuePerShare: market.comparison.valuePerShare,
                  priceToValue: market.comparison.priceToValue,
                  valueToPrice: market.comparison.valueToPrice,
                }
              : {
                  version: market.comparison.version,
                  status: market.comparison.status,
                  reason: market.comparison.reason,
                  price: market.comparison.price,
                },
          verdict:
            verdict.status === "placed"
              ? {
                  version: verdict.version,
                  status: verdict.status,
                  relation: verdict.relation,
                  zone: verdict.zone,
                }
              : { version: verdict.version, status: verdict.status },
          implied:
            market.implied.status === "computed"
              ? {
                  version: market.implied.version,
                  status: market.implied.status,
                  price: market.implied.price,
                  readings: market.implied.readings,
                }
              : market.implied,
          latestCloseAfterCutoff: market.latestClose,
        })),
        cedear: gate(VALUATION_CEDEAR_SOURCES, registry, () =>
          cedearSection(reading.cedear),
        ),
        newerJobWithoutRun: reading.newerGap !== null,
      };
    }
  }
}
