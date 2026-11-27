import { Check, X } from "lucide-react";

import { InfoTip } from "@/app/_components/info-tip";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ADHERENCE_RULES,
  adherenceTally,
} from "@/modules/trading/domain/trade-annotation";
import type { RMultipleReason } from "@/modules/trading/domain/trade-r-multiple";
import { formatAmount } from "@/modules/valuation/domain/display-format";
import type { TradeEntryReading } from "@/server/trading/trade-entry";

import {
  ADHERENCE_LABELS,
  R_REASON_LABELS,
  REWARD_RISK_REASON_LABELS,
} from "../../_components/journal-labels";
import { Money, RValue } from "../../_components/pnl-values";

function Figure({
  label,
  children,
  detail,
}: {
  readonly label: React.ReactNode;
  readonly children: React.ReactNode;
  readonly detail?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <dt className="flex items-center gap-0.5 text-xs text-muted-foreground">
        {label}
      </dt>
      <dd className="text-xl leading-none font-semibold">{children}</dd>
      {detail === undefined ? null : (
        <dd className="text-xs text-muted-foreground">{detail}</dd>
      )}
    </div>
  );
}

/** Cuatro casillas, una por regla del plan: el tilde y la cruz no dependen del color. */
function AdherenceMarks({
  adherence,
}: {
  readonly adherence: NonNullable<TradeEntryReading["annotation"]>["adherence"];
}) {
  return (
    <ul className="flex gap-1" aria-label="Adherencia por regla">
      {ADHERENCE_RULES.map((rule) => {
        const mark = adherence[rule];
        return (
          <li
            key={rule}
            title={ADHERENCE_LABELS[rule]}
            className={cn(
              "flex size-5 items-center justify-center rounded-sm border",
              mark === "kept" &&
                "border-positive-fill/40 bg-positive-fill/10 text-positive",
              mark === "broken" &&
                "border-negative-fill/40 bg-negative-fill/10 text-negative",
              mark === null && "border-dashed text-muted-foreground",
            )}
          >
            {mark === "kept" ? (
              <Check className="size-3" aria-hidden="true" />
            ) : mark === "broken" ? (
              <X className="size-3" aria-hidden="true" />
            ) : null}
            <span className="sr-only">
              {ADHERENCE_LABELS[rule]}:{" "}
              {mark === "kept"
                ? "cumplida"
                : mark === "broken"
                  ? "rota"
                  : "sin marcar"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function TradeFigures({
  reading,
}: {
  readonly reading: TradeEntryReading;
}) {
  const { trade, annotation, r, risk, rewardRisk } = reading;
  const tally = annotation === null ? null : adherenceTally(annotation);
  return (
    <Card className="py-0">
      <dl className="grid grid-cols-2 md:grid-cols-5 md:divide-x [&>div]:border-border max-md:[&>div:nth-child(-n+4)]:border-b max-md:[&>div:nth-child(odd):not(:last-child)]:border-r max-md:[&>div:last-child]:col-span-2">
        <Figure
          label="P&L realizado"
          detail={
            trade.fees === null ? undefined : (
              <>
                Fees <Money value={trade.fees} />
              </>
            )
          }
        >
          <Money value={trade.realizedPnl} signed />
        </Figure>
        <Figure
          label={
            <>
              R
              <InfoTip title="R">
                <p>
                  El P&amp;L realizado sobre el riesgo inicial:{" "}
                  <strong>|entrada − stop| × cantidad</strong>, con el promedio
                  de las entradas y todo lo que entró.
                </p>
              </InfoTip>
            </>
          }
          detail={
            r.reason === null
              ? undefined
              : R_REASON_LABELS[r.reason as RMultipleReason]
          }
        >
          <RValue r={r} />
        </Figure>
        <Figure label="Riesgo inicial">
          <Money value={risk.value} />
        </Figure>
        <Figure
          label="Reward/risk"
          detail={
            rewardRisk.reason !== null
              ? REWARD_RISK_REASON_LABELS[rewardRisk.reason]
              : rewardRisk.entryBasis === "fills"
                ? "Con la entrada ejecutada"
                : "Con la entrada planeada"
          }
        >
          {rewardRisk.value === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="numeric">
              {formatAmount(rewardRisk.value, { scale: 2 })} : 1
            </span>
          )}
        </Figure>
        <Figure
          label="Adherencia"
          detail={
            tally === null || tally.unmarked === ADHERENCE_RULES.length
              ? "Sin marcar"
              : `${tally.kept} de ${tally.kept + tally.broken} cumplidas`
          }
        >
          <AdherenceMarks
            adherence={
              annotation?.adherence ?? {
                entry: null,
                stop: null,
                target: null,
                size: null,
              }
            }
          />
        </Figure>
      </dl>
    </Card>
  );
}
