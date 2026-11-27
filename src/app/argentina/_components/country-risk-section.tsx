import type { CountryRiskBlock } from "@/modules/argentina-dashboard/domain/country-risk-block";
import {
  COUNTRY_RISK_INDEX_SEGMENTS,
  COUNTRY_RISK_INDEX_VERSION,
} from "@/modules/macro-series/domain/declared-country-risk";

import { DashboardBlock } from "./block";
import { amount, calendarDate, signedAmount } from "./format";
import {
  TimelineChart,
  type ChartContext,
  type TimelineRow,
} from "./timeline-chart";

function nextDay(on: string): string {
  return new Date(Date.parse(`${on}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** El índice detrás de la cifra como tramos del primer carril (ADR 0080). */
function indexContext(lastOn: string): ChartContext {
  return {
    toggleLabel: "Gobiernos e índice de J.P. Morgan",
    spansTitle: "Índice de J.P. Morgan",
    spans: COUNTRY_RISK_INDEX_SEGMENTS.map((segment) => ({
      id: segment.id,
      label: segment.label,
      from: segment.from,
      to: segment.to ?? nextDay(lastOn),
      description: segment.description,
      source: segment.source,
    })),
    seasons: [],
    seasonNote: "",
    // Los dos tramos son contiguos: la fecha del cambio va también como
    // línea vertical, así el límite se ve.
    eventsTitle: "Cambio de índice",
    events: COUNTRY_RISK_INDEX_SEGMENTS.slice(1).map((segment) => ({
      id: `${segment.id}-start`,
      on: segment.from,
      label: `Pasa a ${segment.label}`,
      description: segment.description,
      source: segment.source,
    })),
    note: `Tramos declarados en ${COUNTRY_RISK_INDEX_VERSION}: el cambio de índice se fecha, no se detecta en los datos.`,
  };
}

/**
 * Riesgo país (`F9-21`, ADR 0080): el spread soberano de J.P. Morgan como lo
 * publica Ámbito. Describe el nivel y su cambio; no explica movimientos.
 */
export function CountryRiskSection({
  countryRisk,
}: {
  readonly countryRisk: CountryRiskBlock;
}) {
  const { latest, previous, changeBp } = countryRisk;
  const daily: TimelineRow[] = countryRisk.days.map((point) => ({
    on: point.on,
    values: { spread: point.value },
  }));
  const monthly: TimelineRow[] = countryRisk.months.map((point) => ({
    on: point.on,
    values: { spread: point.value },
  }));

  return (
    <DashboardBlock
      id="riesgo-pais"
      title="Riesgo país"
      reading={
        latest === null
          ? "Todavía no hay riesgo país guardado."
          : `${calendarDate(latest.on)}: ${amount(latest.value)} puntos básicos${
              previous !== null && changeBp !== null
                ? `, ${signedAmount(changeBp)} contra el ${calendarDate(previous.on)}`
                : ""
            }.`
      }
      provenance={
        <>
          J.P. Morgan vía Ámbito ·{" "}
          {latest?.index ? latest.index.label : "índice sin dato"} · puntos
          básicos · último cierre{" "}
          {latest ? calendarDate(latest.on) : "sin dato"} · versión observada{" "}
          {latest ? calendarDate(latest.observedAt.slice(0, 10)) : "sin dato"}
          {latest && latest.revision > 0
            ? ` · revisión ${latest.revision}`
            : ""}
        </>
      }
      methodology={
        <>
          <p>
            El riesgo país es el spread de los bonos soberanos de la Argentina
            en dólares sobre los del Tesoro de los Estados Unidos, en puntos
            básicos: 100 puntos son un punto porcentual de tasa. Lo calcula J.P.
            Morgan dentro de su índice EMBI; hasta el 29/09/2025 fue el del
            EMBI+ y desde el 30/09/2025 es el del EMBI Global Diversified, que
            se publica una vez por día con el cierre anterior.
          </p>
          <p>
            La tarjeta consulta la cotización del día de Ámbito. El gráfico y la
            tabla usan los cierres del histórico. Un día publicado con dos
            valores distintos queda afuera, nombrado en la corrida. En rangos de
            más de cinco años se muestra el último cierre de cada mes, sin
            promediar. El índice es propiedad de J.P. Morgan: se usa sólo en
            este portal personal.
          </p>
          <p>
            Fuente:{" "}
            <a
              className="underline underline-offset-2"
              href="https://www.ambito.com/contenidos/riesgo-pais.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              riesgo país en Ámbito
            </a>
            .
          </p>
        </>
      }
    >
      {monthly.length === 0 || latest === null ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay cierres de riesgo país guardados.
        </p>
      ) : (
        <TimelineChart
          label="Riesgo país de la Argentina, spread soberano de J.P. Morgan en puntos básicos"
          caption="Riesgo país por fecha, en puntos básicos"
          context={indexContext(latest.on)}
          daily={daily}
          monthly={monthly}
          frequency="daily"
          ranges={["1y", "2y", "5y", "10y", "20y", "max"]}
          defaultRange="5y"
          axis="index"
          allowLog
          series={[
            {
              key: "spread",
              label: "Riesgo país",
              color: "var(--chart-1)",
              mark: "line",
              format: { kind: "amount", scale: 0 },
              change: "difference",
            },
          ]}
        />
      )}
    </DashboardBlock>
  );
}
