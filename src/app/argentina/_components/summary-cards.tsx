import { ChangeIndicator } from "@/app/_components/stat-tile";
import type { ArgentinaDashboard } from "@/modules/argentina-dashboard/application/load-argentina-dashboard";
import type {
  ArgentinaNews,
  NewsMetric,
} from "@/modules/argentina-dashboard/domain/argentina-news";
import {
  SUMMARY_CADENCE,
  SUMMARY_ORDER,
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
import { CountryRiskQuoteTile } from "./country-risk-quote-tile";
import { SummaryTile, type SummaryTileProps } from "./freshness-marks";

type Summary = {
  readonly metric: SummaryMetric;
  readonly href: string;
  readonly label: string;
  /** La cifra principal, o el motivo de su ausencia. */
  readonly value: string;
  readonly detail: string;
  readonly note?: string;
  /** Fecha del dato principal, como se la lee. */
  readonly asOf: string | null;
  readonly cadence: SummaryCadence;
};

/** `ago 2026` → `ago`. */
function monthAbbr(on: string): string {
  return shortMonth(on).slice(0, 3);
}

function summariesOf(dashboard: ArgentinaDashboard): readonly Summary[] {
  return headlinesOf(dashboard).map((headline) => ({
    ...headline,
    cadence: SUMMARY_CADENCE[headline.metric],
  }));
}

function headlinesOf(
  dashboard: ArgentinaDashboard,
): readonly Omit<Summary, "cadence">[] {
  const { activity, dollar, monetary, countryRisk, external, soy } = dashboard;
  const inflation = monetary.monthlyInflation.at(-1);
  const trade = external.months.at(-1);
  const lastSoyOn = soy.latest?.on;
  const waitingForChicago =
    lastSoyOn &&
    soy.days.findLast(
      (day) => day.on > lastSoyOn && day.reason === "missing_chicago",
    );

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
    },
    {
      metric: "fxGap",
      href: "#dolar",
      label: "Dólar: brecha CCL / oficial",
      value: dollar.latestGap
        ? fractionAsPoints(dollar.latestGap.gap)
        : "Sin dato",
      detail: dollar.latestGap
        ? `Oficial $ ${amount(dollar.latestGap.official)} · CCL $ ${amount(dollar.latestGap.ccl)}`
        : "Mayorista y CCL implícito",
      asOf: dollar.latestGap ? calendarDate(dollar.latestGap.on) : null,
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
      asOf: countryRisk.latest
        ? `Cierre ${calendarDate(countryRisk.latest.on)}`
        : null,
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
    },
    {
      metric: "soyGap",
      href: "#soja",
      label: "Soja: Rosario–Chicago",
      value: soy.latest ? signedPoints(soy.latest.basis) : "Sin dato",
      detail: soy.latest
        ? `US$ ${amount(soy.latest.rosarioUsd!, 0)} vs. US$ ${amount(soy.latest.chicagoUsd!, 0)} por\u00a0t`
        : "Pizarra de Rosario y CBOT",
      note: waitingForChicago
        ? `Falta Chicago del ${dayMonth(waitingForChicago.on)}`
        : undefined,
      asOf: soy.latest ? calendarDate(soy.latest.on) : null,
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

const CADENCE_GROUPS: readonly {
  readonly cadence: SummaryCadence;
  readonly label: string;
}[] = [
  { cadence: "daily", label: "Cada día" },
  { cadence: "monthly", label: "Cada mes" },
];

/**
 * Lectura rápida: una cifra por bloque con su fecha, que enlaza a la sección.
 * Debajo de la cifra, cuánto se movió contra su lectura anterior
 * (`summary-change-1.0.0`) con flecha, signo y color. Decisión del owner del
 * 2026-11-16: el color dice si el movimiento favorece según la métrica —que
 * baje la inflación o la brecha cambiaria se pinta verde—, y reemplaza la
 * regla anterior de «sin flechas ni colores de bien o mal». El signo escrito
 * dice el sentido sin depender del color.
 *
 * Desde `F9-22` (pedido del owner del 2026-11-26) las tarjetas van de lo que
 * cambia cada día, a la izquierda, a lo que cambia cada mes, a la derecha
 * (`SUMMARY_ORDER`), en dos grupos rotulados; y cada una dice si su fuente
 * está siendo consultada, fue verificada o no respondió (`SummaryTile`).
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
  const byMetric = new Map(
    summariesOf(dashboard).map((summary) => [summary.metric, summary]),
  );
  const ordered = SUMMARY_ORDER.map((metric) => byMetric.get(metric)!);

  function markOf(metric: SummaryMetric) {
    if (news.status !== "compared" || !(metric in news.metrics)) return null;
    const mark = news.metrics[metric as NewsMetric];
    return mark.status === "unchanged" ? null : mark.status;
  }

  return (
    <nav
      aria-label="Lectura rápida"
      className="grid gap-x-3 gap-y-4 lg:grid-cols-2"
    >
      {CADENCE_GROUPS.map((group) => {
        const summaries = ordered.filter(
          (summary) => summary.cadence === group.cadence,
        );
        if (summaries.length === 0) return null;
        const headingId = `lectura-${group.cadence}`;
        return (
          <div key={group.cadence} className="flex min-w-0 flex-col gap-2">
            <p
              id={headingId}
              className="text-xs font-medium text-muted-foreground"
            >
              {group.label}
            </p>
            <ul
              aria-labelledby={headingId}
              className="grid grid-cols-2 gap-3 sm:grid-cols-3"
            >
              {summaries.map((summary) => {
                const tile: SummaryTileProps = {
                  metric: summary.metric,
                  href: summary.href,
                  label: summary.label,
                  value: summary.value,
                  date: summary.asOf ?? "Sin fecha",
                  mark: markOf(summary.metric),
                  detail: summary.detail,
                  note: summary.note,
                  change: (
                    <Change
                      change={changes[summary.metric]}
                      summary={summary}
                    />
                  ),
                };
                return (
                  <li key={summary.href} className="min-w-0">
                    {summary.metric === "countryRisk" ? (
                      <CountryRiskQuoteTile
                        tile={tile}
                        close={dashboard.countryRisk.latest}
                      />
                    ) : (
                      <SummaryTile {...tile} />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
