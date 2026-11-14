import { randomUUID } from "node:crypto";

import { ArrowRight, DatabaseZap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  servesRealData,
  servesSchwabConnection,
} from "@/modules/configuration/domain/config-health";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { safeErrorSummary } from "@/server/trading/safe-error";
import {
  readJournal,
  type JournalReading,
} from "@/server/trading/transactions";

import { JournalView } from "./_components/journal-view";
import { TransactionSync } from "./_components/transaction-sync";

export const metadata: Metadata = {
  title: "Diario | Portal Financiero",
  description: "Trades de la cuenta Schwab, armados desde sus transacciones.",
};

/** Ver [ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

function Header({ children }: { readonly children?: React.ReactNode }) {
  return (
    <section
      className="flex flex-wrap items-end justify-between gap-3"
      aria-labelledby="diario-title"
    >
      <h1
        id="diario-title"
        className="text-2xl font-semibold tracking-tight md:text-3xl"
      >
        Diario
      </h1>
      {children}
    </section>
  );
}

function Shell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        {children}
      </div>
    </div>
  );
}

function NotConnected() {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Sin cuenta conectada</CardTitle>
      </CardHeader>
      <CardContent>
        <Link
          href="/cuenta"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Conectar en Cuenta
          <ArrowRight data-icon="inline-end" />
        </Link>
      </CardContent>
    </Card>
  );
}

function FirstLoad() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-72 w-full" />
      <p className="text-sm text-muted-foreground">
        Bajando la historia de Schwab…
      </p>
    </div>
  );
}

export default async function JournalPage() {
  const health = await getRequestConfigHealth();
  if (!servesRealData(health)) {
    return <RuntimeLockedNotice health={health} surface="El diario" />;
  }

  if (!servesSchwabConnection(health)) {
    return (
      <Shell>
        <Header />
        <NotConnected />
      </Shell>
    );
  }

  let reading: JournalReading | null = null;
  const reference = randomUUID();
  try {
    reading = await readJournal();
  } catch (error) {
    console.error("journal read failed", reference, safeErrorSummary(error));
  }

  if (reading === null) {
    return (
      <Shell>
        <Header />
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <DatabaseZap className="size-4" aria-hidden="true" />
              Base de trading no disponible
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Referencia <code className="font-mono text-xs">{reference}</code>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Header>
        <div className="flex items-center gap-3">
          {reading.account === null ? null : (
            <span className="numeric text-sm text-muted-foreground">
              ···{reading.account.lastFour}
            </span>
          )}
          <TransactionSync lastSyncAt={reading.lastRun?.finishedAt ?? null} />
        </div>
      </Header>
      {reading.account === null ? (
        <FirstLoad />
      ) : (
        <JournalView
          trades={reading.trades}
          summary={reading.summary}
          calendar={reading.calendar}
        />
      )}
    </Shell>
  );
}
