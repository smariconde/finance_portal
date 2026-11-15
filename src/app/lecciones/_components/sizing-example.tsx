import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { formatMoney } from "@/app/_components/trading-format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SizingExample } from "@/modules/education/domain/technical-lessons";
import { planPosition } from "@/modules/trading/domain/position-size-risk";
import {
  formatAmount,
  formatShares,
} from "@/modules/valuation/domain/display-format";

/**
 * El ejemplo de la lección de riesgo, calculado con el mismo planner de
 * `/cuenta` (`position-size-risk-1.0.0`): la lección no repite la cuenta a mano.
 */
export function SizingExampleCard({
  example,
}: {
  readonly example: SizingExample;
}) {
  const plan = planPosition({
    liquidationValue: example.liquidationValue,
    buyingPower: example.liquidationValue,
    riskPerTradePercent: example.riskPerTradePercent,
    openRiskPercent: "6",
    openRisk: "0",
    entry: example.entry,
    stop: example.stop,
    target: example.target,
  });
  if (plan.state !== "planned") return null;

  const steps: readonly [string, React.ReactNode][] = [
    ["Cuenta", formatMoney(example.liquidationValue)],
    [`Riesgo ${example.riskPerTradePercent} %`, formatMoney(plan.riskBudget)],
    ["Entrada − stop", formatMoney(plan.riskPerShare)],
    ["Acciones", formatShares(plan.shares)],
    [
      "Reward/risk",
      plan.rewardRisk.value === null
        ? "—"
        : `${formatAmount(plan.rewardRisk.value, { scale: 2 })} : 1`,
    ],
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle as="h2">El tamaño, con números</CardTitle>
        <Link
          href="/cuenta"
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Planner
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border ring-1 ring-foreground/10 md:grid-cols-5">
          {steps.map(([label, value]) => (
            <div
              key={label}
              className="flex min-w-0 flex-col gap-1.5 bg-card px-4 py-3 max-md:last:odd:col-span-2"
            >
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="numeric text-lg leading-none font-semibold">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
