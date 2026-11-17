import { ChangeIndicator, StatTile } from "@/app/_components/stat-tile";
import { cn } from "@/lib/utils";
import type { ArgentinaDashboard } from "@/modules/argentina-dashboard/application/load-argentina-dashboard";
import type {
  ArgentinaNews,
  NewsMetric,
} from "@/modules/argentina-dashboard/domain/argentina-news";
import {
  SUMMARY_POLARITY,
  summaryChanges,
  type SummaryCadence,
  type SummaryChange,
  type SummaryMetric,
} from "@/modules/argentina-dashboard/domain/summary-change";

import {
  amount,
  calendarDate,
  comparisonText,
  dayMonth,
  fractionAsPoints,
  points,
  roundedTo,
  shortMonth,
  signedAmount,
  signedPoints,
} from "./format";
import { NewsBadge } from "./news-mark";

type Summary = {
  readonly metric: SummaryMetric;
  readonly href: string;
  readonly label: string;
  /** La cifra principal, o el motivo de su ausencia. */
  readonly value: string;
  readonly detail: string;
  /** Fecha del dato principal, como se la lee. */
  readonly asOf: string | null;
  readonly cadence: SummaryCadence;
};

/** `ago 2026` → `ago`. */
function monthAbbr(on: string): string {
  return shortMonth(on).slice(0, 3);
}

function summariesOf(dashboard: ArgentinaDashboard): readonly Summary[] {
  const { activity, dollar, monetary, countryRisk, external, soy } = dashboard;
  const inflation = monetary.monthlyInflation.at(-1);
  const trade = external.months.at(-1);

  return [
    {
      metric: "activity",
      href: "#actividad",
      label: "Actividad: var. mensual",
      value: activity.latest
        ? comparisonText(activity.latest.monthOverMonth)
        : "Sin dato",
      detail: activity.latest
        ? `${comparisonText(activity.latest.yearOverYear)} interanual`
        : "EMAE del INDEC",
      asOf: activity.latest ? shortMonth(activity.latest.on) : null,
      cadence: "monthly",
    },
    {
      metric: "fxGap",
      href: "#dolar",
      label: "Dólar: brecha CCL / oficial",
      value: dollar.latestGap
        ? fractionAsPoints(dollar.latestGap.gap)
        : "Sin dato",
      detail: dollar.latestOfficial?.value
        ? `Oficial $ ${amount(dollar.latestOfficial.value)}${dollar.latestCcl?.value ? ` · CCL $ ${amount(dollar.latestCcl.value)}` : ""}`
        : "Mayorista y CCL implícito",
      asOf: dollar.latestGap ? calendarDate(dollar.latestGap.on) : null,
      cadence: "daily",
    },
    {
      metric: "inflation",
      href: "#monetario",
      label: "Inflación mensual",
      value: inflation?.value ? points(inflation.value) : "Sin dato",
      detail: monetary.annualInflation?.value
        ? `${points(monetary.annualInflation.value)} interanual`
        : "IPC, vía BCRA",
      asOf: inflation ? shortMonth(inflation.on) : null,
      cadence: "monthly",
    },
    {
      metric: "countryRisk",
      href: "#riesgo-pais",
      label: "Riesgo país",
      value: countryRisk.latest
        ? `${amount(countryRisk.latest.value)} pb`
        : "Sin dato",
      detail: countryRisk.latest?.index
        ? `J.P. Morgan, ${countryRisk.latest.index.label}`
        : "J.P. Morgan, vía Ámbito",
      asOf: countryRisk.latest ? calendarDate(countryRisk.latest.on) : null,
      cadence: "daily",
    },
    {
      metric: "tradeBalance",
      href: "#externo",
      label: "Saldo comercial",
      value: trade
        ? comparisonText(
            trade.balance,
            (value) => `US$ ${signedAmount(value)} M`,
          )
        : "Sin dato",
      detail: external.lastTwelve
        ? `12 meses: US$ ${signedAmount(external.lastTwelve.balance)} M`
        : "Bienes, ICA",
      asOf: trade ? shortMonth(trade.on) : null,
      cadence: "monthly",
    },
    {
      metric: "soyGap",
      href: "#soja",
      label: "Soja: Rosario–Chicago",
      value: soy.latest ? signedPoints(soy.latest.basis) : "Sin dato",
      detail: soy.latest
        ? `US$ ${amount(soy.latest.rosarioUsd!, 0)} vs. US$ ${amount(soy.latest.chicagoUsd!, 0)} por t`
        : "Pizarra de Rosario y CBOT",
      asOf: soy.latest ? calendarDate(soy.latest.on) : null,
      cadence: "daily",
    },
  ];
}

/** Contra qué lectura se compara, en lo mínimo que la nombra. */
function previousLabel(
  change: Extract<SummaryChange, { status: "computed" }>,
  cadence: SummaryCadence,
): string {
  switch (cadence) {
    case "daily":
      return `vs. ${dayMonth(change.previousOn)}`;
    case "monthly":
      return change.previousOn.slice(0, 4) === change.currentOn.slice(0, 4)
        ? `vs. ${monthAbbr(change.previousOn)}`
        : `vs. ${shortMonth(change.previousOn)}`;
    case "annual":
      return `vs. ${change.previousOn.slice(0, 4)}`;
  }
}

const MISSING_PREVIOUS: Readonly<Record<SummaryCadence, string>> = {
  daily: "Sin dato anterior",
  monthly: "Sin el mes anterior",
  annual: "Sin el año anterior",
};

function Change({
  change,
  summary,
}: {
  readonly change: SummaryChange;
  readonly summary: Summary;
}) {
  if (change.status === "unavailable") {
    // Sin cifra principal no hay cambio que decir: el valor ya dice «Sin dato».
    return change.reason === "missing_current" ? null : (
      <span className="text-xs leading-4 text-muted-foreground">
        {MISSING_PREVIOUS[summary.cadence]}
      </span>
    );
  }
  const scale = change.unit === "pp" ? 1 : 0;
  // Redondeado antes de decidir la flecha: un cambio que se escribe «0,0 pp»
  // no lleva dirección ni color.
  const rounded = roundedTo(change.difference, scale);
  return (
    <ChangeIndicator
      amount={rounded}
      text={
        change.unit === "amount"
          ? `US$ ${signedAmount(rounded)} M`
          : change.unit === "bp"
            ? `${signedAmount(rounded)}\u00a0pb`
            : `${signedAmount(rounded, 1)}\u00a0pp`
      }
      polarity={SUMMARY_POLARITY[summary.metric]}
      context={previousLabel(change, summary.cadence)}
    />
  );
}

/**
 * Lectura rápida: una cifra por bloque con su fecha, que enlaza a la sección.
 * Debajo de la cifra, cuánto se movió contra su lectura anterior
 * (`summary-change-1.0.0`) con flecha, signo y color. Decisión del owner del
 * 2026-11-16: el color dice si el movimiento favorece según la métrica —que
 * baje la inflación o la brecha cambiaria se pinta verde—, y reemplaza la
 * regla anterior de «sin flechas ni colores de bien o mal». El signo escrito
 * dice el sentido sin depender del color.
 */
export function SummaryCards({
  dashboard,
  news,
}: {
  readonly dashboard: ArgentinaDashboard;
  /** Lo que llegó desde la visita anterior (ADR 0079). */
  readonly news: ArgentinaNews;
}) {
  const changes = summaryChanges(dashboard);

  function markOf(metric: SummaryMetric) {
    if (news.status !== "compared" || !(metric in news.metrics)) return null;
    const mark = news.metrics[metric as NewsMetric];
    return mark.status === "unchanged" ? null : mark.status;
  }

  return (
    <nav aria-label="Lectura rápida">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {summariesOf(dashboard).map((summary) => {
          const mark = markOf(summary.metric);
          const date = summary.asOf === null ? "Sin fecha" : summary.asOf;
          return (
            <li key={summary.href} className="min-w-0">
              <StatTile
                href={summary.href}
                className={cn(
                  "h-full",
                  mark === "new_period" && "ring-blue-300 dark:ring-blue-800",
                )}
                size="sm"
                label={summary.label}
                value={summary.value}
                change={
                  <Change change={changes[summary.metric]} summary={summary} />
                }
                detail={summary.detail}
                footer={
                  mark === null ? (
                    date
                  ) : (
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {date}
                      <NewsBadge status={mark} />
                    </span>
                  )
                }
              />
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
