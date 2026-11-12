import type { ArgentinaDashboard } from "@/modules/argentina-dashboard/application/load-argentina-dashboard";

import { DashboardBlock } from "./block";
import { calendarDate } from "./format";
import { TimelineChart, type TimelineRow } from "./timeline-chart";

export function ItcrmSection({
  itcrm,
}: {
  readonly itcrm: ArgentinaDashboard["itcrm"];
}) {
  const daily: TimelineRow[] = itcrm.days.map((point) => ({
    on: point.on,
    values: { itcrm: point.value },
  }));
  const monthly: TimelineRow[] = itcrm.months.map((point) => ({
    on: point.on,
    values: { itcrm: point.value },
  }));
  const latest = itcrm.latest;
  return (
    <DashboardBlock
      id="itcrm"
      title="Competitividad cambiaria real (ITCRM)"
      reading={
        latest === null
          ? "Todavía no hay ITCRM guardado. La serie se carga a mano desde el BCRA."
          : `El ITCRM fue ${Number(latest.value).toLocaleString("es-AR", { maximumFractionDigits: 1 })} el ${calendarDate(latest.on)}. Su trayectoria permite comparar el nivel actual con su propia historia; el índice no define un valor justo del dólar.`
      }
      provenance={
        <>
          BCRA · índice 17/12/2015 = 100 · último dato{" "}
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
            El BCRA calcula un promedio geométrico encadenado de tipos de cambio
            reales bilaterales, ponderado por el comercio de manufacturas. Una
            suba indica mayor precio relativo externo medido en pesos. El índice
            permite comparar momentos, pero su base 100 no es un nivel de
            equilibrio ni una señal para comprar dólares.
          </p>
          <p>
            El BCRA estima diariamente los índices de precios aún no publicados
            y revisa valores recientes cuando llegan el REM, el IPC y los datos
            de comercio. El portal conserva cada versión desde la fecha en que
            la observó; no atribuye una fecha de publicación que el archivo no
            declara. En rangos de más de cinco años se muestra el último dato de
            cada mes, sin promediar.
          </p>
          <p>
            Fuente:{" "}
            <a
              className="underline underline-offset-2"
              href="https://www.bcra.gob.ar/indices-de-tipo-de-cambio-multilateral/"
              target="_blank"
              rel="noopener noreferrer"
            >
              serie y metodología del BCRA
            </a>
            .
          </p>
        </>
      }
    >
      {monthly.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay puntos de ITCRM guardados.
        </p>
      ) : (
        <TimelineChart
          label="Evolución histórica del ITCRM del BCRA, índice 17 de diciembre de 2015 igual a 100"
          caption="ITCRM del BCRA por fecha, índice 17/12/2015 = 100"
          daily={daily}
          monthly={monthly}
          frequency="daily"
          ranges={["1y", "2y", "5y", "10y", "20y", "max"]}
          defaultRange="5y"
          axis="index"
          series={[
            {
              key: "itcrm",
              label: "ITCRM",
              color: "var(--chart-1)",
              mark: "line",
              format: { kind: "amount", scale: 1 },
              change: "ratio",
            },
          ]}
        />
      )}
    </DashboardBlock>
  );
}
