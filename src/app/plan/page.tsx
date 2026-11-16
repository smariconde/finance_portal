import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";

import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import type { StoredIdea } from "@/modules/trading/application/pre-market-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  servesRealData,
  servesSchwabConnection,
} from "@/modules/configuration/domain/config-health";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getPreMarketStore } from "@/server/persistence/trading/get-pre-market-store";
import { safeErrorSummary } from "@/server/trading/safe-error";
import { loadJournalState } from "@/server/trading/transactions";

import { PlanWorkspace } from "./_components/plan-workspace";

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
    <main
      id="contenido"
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Plan antes de la rueda
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ideas fechadas, riesgo calculado y niveles para revisar antes de
            operar.
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/diario" />}>
          Ir al diario
        </Button>
      </header>
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
    </main>
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
          <Button variant="outline" size="sm" render={<Link href="/diario" />}>
            Abrir diario
          </Button>
        </CardContent>
      </Card>
    );
  return (
    <PlanWorkspace
      ideas={result.ideas.map(({ accountKey, ...idea }) => {
        void accountKey;
        return idea;
      })}
      setups={result.state.setups}
      lastFour={result.state.account.lastFour}
    />
  );
}
