import { randomUUID } from "node:crypto";

import { ArrowRight, DatabaseZap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { UnreadTradingParts } from "@/app/_components/unread-trading-parts";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  servesRealData,
  servesSchwabConnection,
} from "@/modules/configuration/domain/config-health";
import { SETUP_LESSON_SLUGS } from "@/modules/education/domain/technical-lessons";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { safeErrorSummary } from "@/server/trading/safe-error";
import {
  readTradingStats,
  type TradingStatsReading,
} from "@/server/trading/transactions";

import { JournalNav } from "../_components/journal-nav";

import { RealizedCurve } from "./_components/realized-curve";
import { StatsCuts } from "./_components/stats-cuts";
import { StatsFigures } from "./_components/stats-figures";

export const metadata: Metadata = {
  title: "Estadísticas del diario | Portal Financiero",
  description:
    "Win rate, expectancy, profit factor y drawdown de los trades cerrados.",
};

/** Ver [ADR 0005](../../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

function Shell({ children }: { readonly children: React.ReactNode }) {
  return (
    <PageContainer>
      <PageHeader
        id="estadisticas-title"
        title="Diario"
        nav={<JournalNav current="stats" />}
      />
      {children}
    </PageContainer>
  );
}

function Message({
  title,
  children,
}: {
  readonly title: React.ReactNode;
  readonly children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          {title}
        </CardTitle>
      </CardHeader>
      {children === undefined ? null : (
        <CardContent className="text-sm text-muted-foreground">
          {children}
        </CardContent>
      )}
    </Card>
  );
}

export default async function TradingStatsPage() {
  const health = await getRequestConfigHealth();
  if (!servesRealData(health)) {
    return (
      <RuntimeLockedNotice
        health={health}
        surface="Las estadísticas del diario"
      />
    );
  }

  if (!servesSchwabConnection(health)) {
    return (
      <Shell>
        <Message title="Sin cuenta conectada">
          <Link
            href="/cuenta"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Conectar en Cuenta
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Message>
      </Shell>
    );
  }

  let reading: TradingStatsReading | null = null;
  const reference = randomUUID();
  try {
    reading = await readTradingStats();
  } catch (error) {
    console.error(
      "trading stats read failed",
      reference,
      safeErrorSummary(error),
    );
  }

  if (reading === null) {
    return (
      <Shell>
        <Message
          title={
            <>
              <DatabaseZap className="size-4" aria-hidden="true" />
              Base de trading no disponible
            </>
          }
        >
          Referencia <code className="font-mono text-xs">{reference}</code>
        </Message>
      </Shell>
    );
  }

  const { stats } = reading;
  if (reading.account === null) {
    return (
      <Shell>
        <Message title="Sin historia todavía">
          <Link
            href="/diario"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Bajarla en el diario
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Message>
      </Shell>
    );
  }

  if (stats.state === "currency_mismatch") {
    // No se suma en dos monedas; nunca se convierte por su cuenta.
    return (
      <Shell>
        <Message title="Trades en más de una moneda">
          <span className="numeric">{stats.currencies.join(" · ")}</span>
        </Message>
      </Shell>
    );
  }

  return (
    <Shell>
      <UnreadTradingParts parts={reading.unread} />
      <StatsFigures stats={stats} />
      <RealizedCurve drawdown={stats.drawdown} />
      <StatsCuts
        cuts={stats.cuts}
        setups={reading.setups}
        lessonSlugs={SETUP_LESSON_SLUGS}
      />
    </Shell>
  );
}
