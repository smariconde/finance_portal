import type { ArgentinaDashboard } from "@/modules/argentina-dashboard/application/load-argentina-dashboard";

import {
  amount,
  calendarDate,
  compactMillions,
  comparisonText,
  fractionAsPoints,
  points,
  resultWord,
  shortMonth,
  signedAmount,
  signedPoints,
} from "./format";

type Summary = {
  readonly href: string;
  readonly label: string;
  /** La cifra principal, o el motivo de su ausencia. */
  readonly value: string;
  readonly detail: string;
  /** Fecha del dato principal, como se la lee. */
  readonly asOf: string | null;
};

function summariesOf(dashboard: ArgentinaDashboard): readonly Summary[] {
  const { activity, dollar, monetary, fiscal, external, soy } = dashboard;
  const inflation = monetary.monthlyInflation.at(-1);
  const fiscalYear = fiscal.years.at(-1);
  const trade = external.months.at(-1);

  return [
    {
      href: "#actividad",
      label: "Actividad, var. mensual",
      value: activity.latest
        ? comparisonText(activity.latest.monthOverMonth)
        : "Sin dato",
      detail: activity.latest
        ? `${comparisonText(activity.latest.yearOverYear)} interanual`
        : "EMAE del INDEC",
      asOf: activity.latest ? shortMonth(activity.latest.on) : null,
    },
    {
      href: "#dolar",
      label: "Brecha CCL / oficial",
      value: dollar.latestGap
        ? fractionAsPoints(dollar.latestGap.gap)
        : "Sin dato",
      detail: dollar.latestOfficial?.value
        ? `Oficial $ ${amount(dollar.latestOfficial.value, 2)}${dollar.latestCcl?.value ? ` · CCL $ ${amount(dollar.latestCcl.value, 2)}` : ""}`
        : "Mayorista y CCL implícito",
      asOf: dollar.latestGap ? calendarDate(dollar.latestGap.on) : null,
    },
    {
      href: "#monetario",
      label: "Inflación mensual",
      value: inflation?.value ? points(inflation.value) : "Sin dato",
      detail: monetary.annualInflation?.value
        ? `${points(monetary.annualInflation.value)} interanual`
        : "IPC, vía BCRA",
      asOf: inflation ? shortMonth(inflation.on) : null,
    },
    {
      href: "#fiscal",
      label: "Primario, % del PIB",
      value: fiscalYear ? comparisonText(fiscalYear.primary) : "Sin dato",
      detail: fiscal.yearToDate
        ? `${fiscal.yearToDate.year} hasta ${shortMonth(fiscal.yearToDate.lastOn)}: ${resultWord(fiscal.yearToDate.primary)} de $ ${compactMillions(fiscal.yearToDate.primary)}`
        : "Sector Público Nacional",
      asOf: fiscalYear ? String(fiscalYear.year) : null,
    },
    {
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
      href: "#soja",
      label: "Basis de la soja",
      value: soy.latest ? signedPoints(soy.latest.basis) : "Sin dato",
      detail: soy.latest
        ? `US$ ${amount(soy.latest.rosarioUsd!, 0)} contra US$ ${amount(soy.latest.chicagoUsd!, 0)} por t`
        : "Pizarra de Rosario y CBOT",
      asOf: soy.latest ? calendarDate(soy.latest.on) : null,
    },
  ];
}

/**
 * Lectura rápida: una cifra por bloque con su fecha, que enlaza a la sección.
 * No hay flechas ni colores de «bien» o «mal»: el signo va en la cifra y la
 * interpretación queda para quien lee.
 */
export function SummaryCards({
  dashboard,
}: {
  readonly dashboard: ArgentinaDashboard;
}) {
  return (
    <nav aria-label="Lectura rápida">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {summariesOf(dashboard).map((summary) => (
          <li key={summary.href} className="min-w-0">
            <a
              href={summary.href}
              className="flex h-full flex-col gap-1 rounded-xl bg-card p-3 ring-1 ring-foreground/10 transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span className="text-xs text-muted-foreground">
                {summary.label}
              </span>
              <span className="numeric text-xl leading-tight font-semibold">
                {summary.value}
              </span>
              <span className="text-xs text-muted-foreground">
                {summary.detail}
              </span>
              <span className="mt-auto pt-1 text-xs text-muted-foreground">
                {summary.asOf === null ? "Sin fecha" : summary.asOf}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
