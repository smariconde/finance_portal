import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";

import { MarketStrip } from "@/app/_components/market-strip";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import type { StoredIdea } from "@/modules/trading/application/pre-market-store";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  tradeKeyOf,
  tradeRefOf,
} from "@/modules/trading/domain/trade-annotation";
import {
  servesRealData,
  servesSchwabConnection,
} from "@/modules/configuration/domain/config-health";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getPreMarketStore } from "@/server/persistence/trading/get-pre-market-store";
import { readEarningsCalendar } from "@/server/persistence/read-earnings-calendar";
import { safeErrorSummary } from "@/server/trading/safe-error";
import { loadJournalState } from "@/server/trading/transactions";

import { PlanNav } from "./_components/plan-nav";
import {
  PlanWorkspace,
  type IdeaExecution,
} from "./_components/plan-workspace";

export const metadata: Metadata = {
  title: "Plan | Portal Financiero",
  description: "Ideas, riesgo y niveles de entrada antes de la rueda.",
  robots: { index: false },
};

export const instant = false;

export default async function PlanPage() {
  const health = await getRequestConfigHealth();
  if (!servesRealData(health))
    return <RuntimeLockedNotice health={health} surface="El plan" />;
  return (
    <PageContainer>
      <PageHeader
        id="plan-title"
        title="Plan"
        nav={<PlanNav current="ideas" />}
      />
      <MarketStrip />
      {!servesSchwabConnection(health) ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Cuenta no disponible</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Configurá la conexión de Schwab en Cuenta para guardar un plan.
          </CardContent>
        </Card>
      ) : (
        <PlanContent />
      )}
    </PageContainer>
  );
}

async function PlanContent() {
  const reference = randomUUID();
  let result: {
    readonly state: Awaited<ReturnType<typeof loadJournalState>>;
    readonly ideas: StoredIdea[];
  } | null = null;
  try {
    const state = await loadJournalState();
    result = {
      state,
      ideas:
        state.account === null
          ? []
          : await getPreMarketStore().listCurrent(state.account.accountKey),
    };
  } catch (error) {
    console.error("pre-market page failed", reference, safeErrorSummary(error));
  }
  if (result === null)
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h2">Plan no disponible</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          La base de trading no respondió. Referencia{" "}
          <code className="font-mono">{reference}</code>.
        </CardContent>
      </Card>
    );
  if (result.state.account === null)
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h2">Todavía no hay cuenta en el diario</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
          <p>
            Sincronizá las transacciones desde el Diario para asociar las ideas
            a tu cuenta.
          </p>
          <Link
            href="/diario"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Abrir diario
          </Link>
        </CardContent>
      </Card>
    );
  const at = new Date().toISOString();
  const symbols = result.ideas
    .filter((idea) => idea.status === "active")
    .map((idea) => idea.symbol);
  const earnings = await readEarningsCalendar(at, { symbols }).catch(
    () => null,
  );
  // La idea que ya se ejecutó muestra la entrada real: el plan dice dónde se
  // pensaba entrar, el diario dónde se entró.
  const executions: Record<string, IdeaExecution> = {};
  for (const trade of result.state.trades) {
    const key = tradeKeyOf(trade);
    const linked = result.state.linkedPlans.get(key);
    if (linked === undefined || trade.status === "opened_before_history")
      continue;
    executions[linked.link.ideaId] = {
      tradeRef: tradeRefOf(key),
      status: trade.status,
      averageEntryPrice: trade.averageEntryPrice,
      entryQuantity: trade.entryQuantity,
    };
  }
  return (
    <PlanWorkspace
      executions={executions}
      earnings={earnings?.reports ?? []}
      calendarAt={at}
      ideas={result.ideas.map(({ accountKey, ...idea }) => {
        void accountKey;
        return idea;
      })}
      setups={result.state.setups}
    />
  );
}
