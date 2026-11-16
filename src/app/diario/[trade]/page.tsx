import { randomUUID } from "node:crypto";

import { ArrowLeft, DatabaseZap, GraduationCap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InfoTip } from "@/app/_components/info-tip";
import { TickerMark } from "@/app/_components/ticker-mark";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import {
  formatMoney,
  formatQuantity,
  formatSession,
} from "@/app/_components/trading-format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  servesRealData,
  servesSchwabConnection,
} from "@/modules/configuration/domain/config-health";
import { lessonOfSetup } from "@/modules/education/domain/technical-lessons";
import type { StoredAnnotation } from "@/modules/trading/application/trade-annotation-store";
import {
  tradeRefSchema,
  type TradeAnnotation,
} from "@/modules/trading/domain/trade-annotation";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { safeErrorSummary } from "@/server/trading/safe-error";
import {
  readTradeEntry,
  type TradeEntryReading,
} from "@/server/trading/trade-entry";

import { ExecutionsList } from "../_components/executions-list";
import { AnnotationForm } from "./_components/annotation-form";
import { PlanLadder } from "./_components/plan-ladder";
import { PreMarketLink } from "./_components/pre-market-link";
import { TradeChart } from "./_components/trade-chart";
import { TradeFigures } from "./_components/trade-figures";

export const metadata: Metadata = {
  title: "Trade | Diario | Portal Financiero",
  description:
    "Plan, setup, adherencia y notas de un trade de la cuenta Schwab.",
  robots: { index: false },
};

/** Ver [ADR 0005](../../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

type PageProps = { readonly params: Promise<{ trade: string }> };

function Shell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <Link
          href="/diario"
          className="inline-flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Diario
        </Link>
        {children}
      </div>
    </div>
  );
}

/** Sólo lo que el owner escribió: la cuenta (su HMAC) no viaja al cliente. */
function annotationFields(
  stored: StoredAnnotation | null,
): TradeAnnotation | null {
  if (stored === null) return null;
  return {
    setupCode: stored.setupCode,
    plan: stored.plan,
    adherence: stored.adherence,
    emotion: stored.emotion,
    review: stored.review,
    notes: stored.notes,
  };
}

function statusBadge(trade: TradeEntryReading["trade"]) {
  if (trade.status === "open") return <Badge variant="outline">Abierto</Badge>;
  if (trade.status === "opened_before_history") {
    return <Badge variant="outline">Sin entrada</Badge>;
  }
  return (
    <Badge variant={trade.dayTrade ? "secondary" : "outline"}>
      {trade.dayTrade ? "Day" : "Swing"}
    </Badge>
  );
}

function TradeHeader({ reading }: { readonly reading: TradeEntryReading }) {
  const { trade } = reading;
  const lesson = lessonOfSetup(
    reading.annotation?.setupCode ?? reading.linkedPlan?.idea.setupCode ?? null,
  );
  const quantity =
    trade.status === "opened_before_history"
      ? trade.portions[0]!.quantity
      : trade.entryQuantity;
  return (
    <section
      aria-labelledby="trade-title"
      className="flex flex-wrap items-end justify-between gap-3"
    >
      <div className="flex flex-col gap-1">
        <h1
          id="trade-title"
          className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight md:text-3xl"
        >
          <TickerMark ticker={trade.symbol} name={null} size="md" />
          {trade.symbol}
          <span className="text-base font-normal text-muted-foreground">
            {trade.direction === "long" ? "Largo" : "Corto"}
          </span>
          {statusBadge(trade)}
        </h1>
        <p className="numeric text-sm text-muted-foreground">
          {trade.status === "opened_before_history"
            ? "—"
            : formatSession(trade.openedSession)}
          {" → "}
          {trade.closedSession === null
            ? "abierto"
            : formatSession(trade.closedSession)}
          {" · "}
          {formatQuantity(quantity)}
          {trade.assetType === "COLLECTIVE_INVESTMENT"
            ? " cuotas"
            : " acciones"}
        </p>
      </div>
      <span className="flex items-center gap-3 text-sm text-muted-foreground">
        {lesson === null ? null : (
          <Link
            href={`/lecciones/${lesson.slug}`}
            className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <GraduationCap className="size-4" aria-hidden="true" />
            Lección · {lesson.title}
          </Link>
        )}
        <span className="numeric">···{reading.lastFour}</span>
      </span>
    </section>
  );
}

export default async function TradePage({ params }: PageProps) {
  const health = await getRequestConfigHealth();
  if (!servesRealData(health)) {
    return <RuntimeLockedNotice health={health} surface="El diario" />;
  }
  const { trade: segment } = await params;
  // Un segmento que no son dos IDs de Schwab no llega a la base ni se repite.
  if (!tradeRefSchema.safeParse(segment).success) notFound();
  if (!servesSchwabConnection(health)) notFound();

  let reading: TradeEntryReading | null = null;
  const reference = randomUUID();
  try {
    reading = await readTradeEntry(segment);
  } catch (error) {
    console.error(
      "trade entry read failed",
      reference,
      safeErrorSummary(error),
    );
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle as="h1" className="flex items-center gap-2">
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
  if (reading === null) notFound();

  const effectivePlan =
    reading.annotation === null && reading.linkedPlan === null
      ? null
      : {
          entry:
            reading.annotation?.plan.entry ??
            reading.linkedPlan?.idea.entry ??
            null,
          stop:
            reading.annotation?.plan.stop ?? reading.linkedPlan?.stop ?? null,
          target:
            reading.annotation?.plan.target ??
            reading.linkedPlan?.target ??
            null,
          quantity:
            reading.annotation?.plan.quantity ??
            reading.linkedPlan?.idea.quantity ??
            null,
        };

  return (
    <Shell>
      <TradeHeader reading={reading} />
      <Card>
        <CardHeader>
          <CardTitle as="h2">Plan antes de la entrada</CardTitle>
        </CardHeader>
        <CardContent>
          {reading.linkedPlan === null ? (
            <PreMarketLink
              tradeRef={reading.ref}
              candidates={reading.ideaCandidates}
            />
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                Idea <strong>{reading.linkedPlan.idea.symbol}</strong> ·
                revisión {reading.linkedPlan.idea.revision} ·{" "}
                <time dateTime={reading.linkedPlan.idea.recordedAt}>
                  {new Date(reading.linkedPlan.idea.recordedAt).toLocaleString(
                    "es-AR",
                    { dateStyle: "medium", timeStyle: "short" },
                  )}
                </time>
              </p>
              <p className="numeric text-muted-foreground">
                Entrada US$ {reading.linkedPlan.idea.entry} · stop US${" "}
                {reading.linkedPlan.stop} · target US${" "}
                {reading.linkedPlan.target} · {reading.linkedPlan.idea.quantity}{" "}
                acciones
              </p>
              {reading.linkedPlan.idea.notes ? (
                <p className="whitespace-pre-wrap">
                  {reading.linkedPlan.idea.notes}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Primera ejecución{" "}
                <time dateTime={reading.linkedPlan.link.openedAt}>
                  {new Date(reading.linkedPlan.link.openedAt).toLocaleString(
                    "es-AR",
                    { dateStyle: "medium", timeStyle: "short" },
                  )}
                </time>
                . El plan original conserva su fecha aunque después se edite la
                idea.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      <TradeFigures reading={reading} />
      <PlanLadder
        direction={reading.trade.direction}
        plan={effectivePlan}
        averageEntryPrice={reading.trade.averageEntryPrice}
        averageExitPrice={reading.trade.averageExitPrice}
      />
      <TradeChart
        tradeRef={reading.ref}
        symbol={reading.trade.symbol}
        plan={effectivePlan}
      />
      <AnnotationForm
        key={reading.annotation?.revision ?? 0}
        tradeRef={reading.ref}
        annotation={annotationFields(reading.annotation)}
        revision={reading.annotation?.revision ?? null}
        recordedAt={reading.annotation?.recordedAt ?? null}
        setups={reading.setups}
      />
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-1">
            Ejecuciones
            <InfoTip title="Ejecuciones">
              <p>
                Las transacciones de Schwab de este trade, en hora de Nueva
                York, con su <strong>netAmount</strong> ya neto de comisiones.
              </p>
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ExecutionsList portions={reading.trade.portions} />
        </CardContent>
      </Card>
      {reading.revisions.length > 1 ? (
        <details className="group rounded-xl border bg-card px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            Revisiones{" "}
            <span className="numeric text-muted-foreground">
              {reading.revisions.length}
            </span>
          </summary>
          <ol className="mt-3 grid gap-1 text-xs">
            {reading.revisions.map((revision) => (
              <li
                key={revision.revision}
                className="numeric grid grid-cols-[2rem_9rem_1fr_1fr] gap-3 text-muted-foreground"
              >
                <span>#{revision.revision}</span>
                <span>
                  {new Date(revision.recordedAt).toLocaleString("es-AR", {
                    dateStyle: "short",
                    timeStyle: "short",
                    hourCycle: "h23",
                    timeZone: "America/Argentina/Buenos_Aires",
                  })}
                </span>
                <span>
                  Stop{" "}
                  {revision.stop === null ? "—" : formatMoney(revision.stop)}
                </span>
                <span>
                  Target{" "}
                  {revision.target === null
                    ? "—"
                    : formatMoney(revision.target)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </Shell>
  );
}
