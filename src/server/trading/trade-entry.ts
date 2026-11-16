import "server-only";

import type { StoredAnnotation } from "@/modules/trading/application/trade-annotation-store";
import type {
  IdeaLink,
  StoredIdea,
} from "@/modules/trading/application/pre-market-store";
import { ideaLevels } from "@/modules/trading/domain/pre-market-plan";
import {
  plannedRewardRisk,
  plannedStopOf,
  tradeKeyFromRef,
  tradeKeyOf,
  type TradePlan,
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
import { getPreMarketStore } from "@/server/persistence/trading/get-pre-market-store";

import { loadJournalState } from "./transactions";
import { readPart, unreadParts, type TradingPart } from "./trading-parts";

export type AnnotationRevisionSummary = {
  readonly revision: number;
  readonly recordedAt: string;
  readonly stop: string | null;
  readonly target: string | null;
};

export type IdeaCandidate = {
  readonly ideaId: string;
  readonly symbol: string;
  readonly revision: number;
  readonly recordedAt: string;
  readonly setupCode: string | null;
  readonly entry: string;
  readonly stop: string;
  readonly target: string;
  readonly quantity: string;
  readonly notes: string;
};

export type TradeEntryReading = {
  readonly lastFour: string;
  readonly ref: string;
  readonly trade: RoundTrip;
  readonly annotation: StoredAnnotation | null;
  readonly linkedPlan: {
    readonly link: IdeaLink;
    readonly idea: Omit<StoredIdea, "accountKey">;
    readonly stop: string;
    readonly target: string;
  } | null;
  readonly ideaCandidates: readonly IdeaCandidate[];
  /** Las revisiones, la más nueva primero: un stop corregido sigue a la vista. */
  readonly revisions: readonly AnnotationRevisionSummary[];
  readonly setups: readonly TradingSetup[];
  /** Riesgo inicial en dinero con el stop planeado, o por qué no hay. */
  readonly risk:
    | { readonly value: string; readonly reason: null }
    | { readonly value: null; readonly reason: string };
  readonly r: RMultiple;
  readonly rewardRisk: PlannedRewardRisk;
  /** Lo que la base de trading todavía no tiene (`F11-15`). */
  readonly unread: readonly TradingPart[];
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
  const unread = new Set(state.unread);

  const annotation = state.annotations.get(tradeKey) ?? null;
  const linked = state.linkedPlans.get(tradeKey) ?? null;
  const linkedLevels = linked === null ? null : ideaLevels(linked.idea);
  const linkedPlan =
    linked !== null && linkedLevels?.state === "valid"
      ? {
          link: linked.link,
          idea: (({ accountKey, ...idea }) => {
            void accountKey;
            return idea;
          })(linked.idea),
          stop: linkedLevels.stop,
          target: linkedLevels.target,
        }
      : null;
  const effectivePlan: TradePlan | null =
    annotation === null && linkedPlan === null
      ? null
      : {
          entry: annotation?.plan.entry ?? linkedPlan?.idea.entry ?? null,
          stop: annotation?.plan.stop ?? linkedPlan?.stop ?? null,
          target: annotation?.plan.target ?? linkedPlan?.target ?? null,
          quantity:
            annotation?.plan.quantity ?? linkedPlan?.idea.quantity ?? null,
        };
  const store = getPreMarketStore();
  const candidates: IdeaCandidate[] = [];
  if (
    linked === null &&
    trade.status !== "opened_before_history" &&
    trade.direction === "long" &&
    trade.currency === "USD" &&
    ["EQUITY", "COLLECTIVE_INVESTMENT"].includes(trade.assetType)
  ) {
    const accountKey = state.account.accountKey;
    const current = await readPart(
      "pre_market",
      unread,
      () => store.listCurrent(accountKey),
      [],
    );
    const possible = await Promise.all(
      current.map(async (idea) => {
        const revisions = await store.listRevisions(accountKey, idea.ideaId);
        const previous = revisions.find(
          (revision) =>
            Date.parse(revision.recordedAt) < Date.parse(trade.openedAt),
        );
        if (
          previous === undefined ||
          previous.status !== "active" ||
          previous.symbol !== trade.symbol
        )
          return null;
        const levels = ideaLevels(previous);
        if (levels.state !== "valid") return null;
        return {
          ideaId: previous.ideaId,
          symbol: previous.symbol,
          revision: previous.revision,
          recordedAt: previous.recordedAt,
          setupCode: previous.setupCode,
          entry: previous.entry,
          stop: levels.stop,
          target: levels.target,
          quantity: previous.quantity,
          notes: previous.notes,
        };
      }),
    );
    candidates.push(
      ...possible.filter(
        (candidate): candidate is IdeaCandidate => candidate !== null,
      ),
    );
  }
  const accountKey = state.account.accountKey;
  const revisions =
    annotation === null
      ? []
      : await readPart(
          "annotations",
          unread,
          () =>
            getTradeAnnotationStore().listAnnotationRevisions(
              accountKey,
              tradeKey,
            ),
          [],
        );
  const stop =
    plannedStopOf(annotation, trade.currency) ??
    (linkedPlan !== null && trade.currency === "USD"
      ? { price: linkedPlan.stop, currency: "USD" }
      : null);
  const initialRisk = initialRiskOf(trade, stop);
  return {
    lastFour: state.account.lastFour,
    ref,
    trade,
    annotation,
    linkedPlan,
    ideaCandidates: candidates,
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
      effectivePlan === null
        ? { value: null, entryBasis: null, reason: "no_stop" }
        : plannedRewardRisk(
            trade.direction,
            effectivePlan,
            trade.averageEntryPrice,
          ),
    unread: unreadParts(unread),
  };
}
