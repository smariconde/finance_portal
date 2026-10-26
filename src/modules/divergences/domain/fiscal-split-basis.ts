import {
  isSplitAction,
  isSplitVisibleAt,
  laterSplitFactor,
  ShareBasisError,
  toBasisChange,
} from "@/modules/corporate-actions/domain/share-basis";
import type { CorporateAction } from "@/modules/corporate-actions/domain/reporting-succession";
import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";
import type { PriceEvent } from "@/modules/prices/domain/daily-close";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import type { FundamentalRow } from "@/modules/valuation/domain/annual-fundamentals";

/** SEC publication dates and market split dates describe different events. */
export const FISCAL_SPLIT_BASIS_VERSION = "fiscal-split-basis-1.1.0";

const decimal = createDecimalOperations((code, message) => {
  const error = new Error(message);
  error.name = code;
  return error;
});

export type FiscalSplitBasis = {
  readonly version: typeof FISCAL_SPLIT_BASIS_VERSION;
  readonly priceFactor: string;
  readonly actionIds: readonly string[];
  readonly adjustedPrice: string | null;
  readonly adjustedEps: string | null;
  readonly adjustedDilutedShares: string | null;
  readonly adjustedSharesOutstanding: string | null;
  readonly reason:
    "split_evidence_missing_or_ambiguous" | "split_subject_unreconciled" | null;
};

type ShareFact = FundamentalRow | null;

/**
 * Carry the raw market close and SEC reported figures to the last split basis
 * knowable at the query cutoff. A price event is paired with one SEC-confirmed
 * change by ratio and publication order. SEC's `effectiveOn` is a fiscal period
 * end, not the trading date, so equality of those dates would be false evidence.
 */
export function reconcileFiscalSplitBasis(input: {
  readonly price: {
    readonly marketDate: string;
    readonly close: string;
  } | null;
  readonly fiscalYearEnd: string;
  readonly events: readonly PriceEvent[];
  readonly actions: readonly CorporateAction[];
  readonly query: PointInTimeQuery;
  readonly eps: ShareFact;
  readonly dilutedShares: ShareFact;
  readonly sharesOutstanding: ShareFact;
}): FiscalSplitBasis {
  const { price, fiscalYearEnd, query } = input;
  const empty: Omit<FiscalSplitBasis, "reason"> = {
    version: FISCAL_SPLIT_BASIS_VERSION,
    priceFactor: "1",
    actionIds: [] as readonly string[],
    adjustedPrice: price?.close ?? null,
    adjustedEps: input.eps?.value ?? null,
    adjustedDilutedShares: input.dilutedShares?.value ?? null,
    adjustedSharesOutstanding: input.sharesOutstanding?.value ?? null,
  };
  const cutoff =
    query.revisionPolicy === "as_known"
      ? [query.effectiveAt.slice(0, 10), query.knownAt.slice(0, 10)].sort()[0]!
      : query.effectiveAt.slice(0, 10);
  const since = price?.marketDate ?? fiscalYearEnd;
  const marketSplits = input.events
    .filter(
      (event) =>
        event.eventType === "split" &&
        event.effectiveOn > since &&
        event.effectiveOn <= cutoff &&
        (query.revisionPolicy !== "as_known" ||
          event.effectiveOn < query.knownAt.slice(0, 10)),
    )
    .sort((left, right) => left.effectiveOn.localeCompare(right.effectiveOn));

  for (const event of marketSplits) {
    if (decimal.parseDecimal(event.value, "event.value").lte(0)) {
      throw new Error("invalid_split_ratio");
    }
  }

  const facts = [
    input.eps,
    input.dilutedShares,
    input.sharesOutstanding,
  ].filter((row): row is FundamentalRow => row !== null);
  const subjects = [...new Set(facts.map((row) => row.subjectId))];
  const relevantActions = input.actions.filter(
    (action) =>
      isSplitAction(action) &&
      action.subjectType === "legal_entity" &&
      subjects.includes(action.subjectId) &&
      action.effectiveOn > fiscalYearEnd &&
      action.effectiveOn <= cutoff &&
      isSplitVisibleAt(action, query),
  );
  if (marketSplits.length === 0) {
    return {
      ...empty,
      reason:
        relevantActions.length === 0
          ? null
          : "split_evidence_missing_or_ambiguous",
    };
  }

  if (subjects.length !== 1) {
    return { ...empty, reason: "split_subject_unreconciled" };
  }

  const actions = input.actions.filter(
    (action) =>
      isSplitAction(action) &&
      action.subjectType === "legal_entity" &&
      action.subjectId === subjects[0] &&
      isSplitVisibleAt(action, query),
  );
  const matched: CorporateAction[] = [];
  for (const event of marketSplits) {
    const candidates = actions.filter(
      (action) =>
        !matched.includes(action) &&
        action.effectiveOn > fiscalYearEnd &&
        action.availableAt.slice(0, 10) >= event.effectiveOn &&
        (matched.length === 0 ||
          action.availableAt >= matched[matched.length - 1]!.availableAt) &&
        decimal
          .parseDecimal(action.terms.ratio!, "action.terms.ratio")
          .eq(decimal.parseDecimal(event.value, "event.value")),
    );
    if (candidates.length !== 1) {
      return { ...empty, reason: "split_evidence_missing_or_ambiguous" };
    }
    matched.push(candidates[0]!);
  }
  if (relevantActions.some((action) => !matched.includes(action))) {
    return { ...empty, reason: "split_evidence_missing_or_ambiguous" };
  }

  const changes = matched.map(toBasisChange);
  const factor = marketSplits.reduce(
    (product, event) =>
      product.times(decimal.parseDecimal(event.value, "event.value")),
    decimal.parseDecimal("1", "priceFactor"),
  );
  const adjust = (row: ShareFact, direction: "shares" | "per_share") => {
    if (row?.value === null || row === null) return null;
    const later = laterSplitFactor(changes, {
      availableAt: row.availableAt,
      document: row.sourceDocumentId,
    });
    const value = decimal.parseDecimal(row.value, "fact.value");
    return decimal.formatDecimal(
      direction === "shares"
        ? value.times(later.factor)
        : decimal.divide(value, later.factor, "fact.shareFactor"),
      "fact.adjustedValue",
    );
  };

  try {
    return {
      version: FISCAL_SPLIT_BASIS_VERSION,
      priceFactor: decimal.formatDecimal(factor, "priceFactor"),
      actionIds: matched.map((action) => action.corporateActionId),
      adjustedPrice:
        price === null
          ? null
          : decimal.formatDecimal(
              decimal.divide(
                decimal.parseDecimal(price.close, "price.close"),
                factor,
                "priceFactor",
              ),
              "price.adjustedClose",
            ),
      adjustedEps: adjust(input.eps, "per_share"),
      adjustedDilutedShares: adjust(input.dilutedShares, "shares"),
      adjustedSharesOutstanding: adjust(input.sharesOutstanding, "shares"),
      reason: null,
    };
  } catch (error) {
    if (error instanceof ShareBasisError) {
      return { ...empty, reason: "split_evidence_missing_or_ambiguous" };
    }
    throw error;
  }
}
