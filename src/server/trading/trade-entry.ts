import "server-only";

import type { StoredAnnotation } from "@/modules/trading/application/trade-annotation-store";
import {
  plannedRewardRisk,
  plannedStopOf,
  tradeKeyFromRef,
  tradeKeyOf,
  type PlannedRewardRisk,
} from "@/modules/trading/domain/trade-annotation";
import {
  initialRiskOf,
  inR,
  type RMultiple,
} from "@/modules/trading/domain/trade-r-multiple";
import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";
import type { TradingSetup } from "@/modules/trading/domain/trading-setups";
import { getTradeAnnotationStore } from "@/server/persistence/trading/get-trade-annotation-store";

import { loadJournalState } from "./transactions";

export type AnnotationRevisionSummary = {
  readonly revision: number;
  readonly recordedAt: string;
  readonly stop: string | null;
  readonly target: string | null;
};

export type TradeEntryReading = {
  readonly lastFour: string;
  readonly ref: string;
  readonly trade: RoundTrip;
  readonly annotation: StoredAnnotation | null;
  /** Las revisiones, la más nueva primero: un stop corregido sigue a la vista. */
  readonly revisions: readonly AnnotationRevisionSummary[];
  readonly setups: readonly TradingSetup[];
  /** Riesgo inicial en dinero con el stop planeado, o por qué no hay. */
  readonly risk:
    | { readonly value: string; readonly reason: null }
    | { readonly value: null; readonly reason: string };
  readonly r: RMultiple;
  readonly rewardRisk: PlannedRewardRisk;
};

/**
 * Un trade del diario con su anotación (`F11-07`), leído de la base de trading.
 * `null` si el segmento no es un trade de la cuenta: nunca se repite el segmento.
 */
export async function readTradeEntry(
  ref: string,
): Promise<TradeEntryReading | null> {
  const tradeKey = tradeKeyFromRef(ref);
  if (tradeKey === null) return null;
  const state = await loadJournalState();
  if (state.account === null) return null;
  const trade = state.trades.find(
    (candidate) => tradeKeyOf(candidate) === tradeKey,
  );
  if (trade === undefined) return null;

  const annotation = state.annotations.get(tradeKey) ?? null;
  const revisions =
    annotation === null
      ? []
      : await getTradeAnnotationStore().listAnnotationRevisions(
          state.account.accountKey,
          tradeKey,
        );
  const initialRisk = initialRiskOf(
    trade,
    plannedStopOf(annotation, trade.currency),
  );
  return {
    lastFour: state.account.lastFour,
    ref,
    trade,
    annotation,
    revisions: revisions.map((stored) => ({
      revision: stored.revision,
      recordedAt: stored.recordedAt,
      stop: stored.plan.stop,
      target: stored.plan.target,
    })),
    setups: state.setups,
    risk:
      initialRisk.value === null
        ? { value: null, reason: initialRisk.reason }
        : { value: initialRisk.value.toFixed(), reason: null },
    r: inR(trade.realizedPnl, initialRisk),
    rewardRisk:
      annotation === null
        ? { value: null, entryBasis: null, reason: "no_stop" }
        : plannedRewardRisk(
            trade.direction,
            annotation.plan,
            trade.averageEntryPrice,
          ),
  };
}
