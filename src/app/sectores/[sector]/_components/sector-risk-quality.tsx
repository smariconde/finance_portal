import { CircleAlert, CircleCheck } from "lucide-react";

import type { SectorRiskQuality as Quality } from "@/modules/metrics/domain/sector-risk-quality";

function percent(value: number | null): string {
  return value === null ? "No evaluable" : `${value} %`;
}

export function SectorRiskQuality({ quality }: { readonly quality: Quality }) {
  const complete = quality.status === "ready";
  const Icon = complete ? CircleCheck : CircleAlert;

  return (
    <section
      aria-labelledby="sector-quality-title"
      className="rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="sector-quality-title" className="text-base font-semibold">
          Calidad de esta matriz
        </h2>
        <p className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Icon aria-hidden="true" className="size-4 shrink-0" />
          {quality.score === null
            ? "Sin nota: sector vacío"
            : `${quality.score}/100 · ${complete ? "Completa" : "Degradada"}`}
        </p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {quality.comparable} de {quality.population} securities tienen Sortino
        en ambas ventanas.
        {quality.seriesWithoutRows > 0
          ? ` ${quality.seriesWithoutRows} no tienen ninguna rueda guardada.`
          : ""}
      </p>
      <dl className="mt-4 grid gap-x-8 gap-y-3 border-t pt-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Completitud</dt>
          <dd className="numeric font-medium">
            {percent(quality.components.completeness)}

            <span className="block text-xs font-normal text-muted-foreground">
              {quality.computed2y + quality.computed5y} de{" "}
              {quality.population * 2} valores calculados
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Frescura</dt>
          <dd className="numeric font-medium">
            {percent(quality.components.freshness)}

            <span className="block text-xs font-normal text-muted-foreground">
              Último cierre hace {quality.daysSinceClose}{" "}
              {quality.daysSinceClose === 1 ? "día" : "días"} calendario
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Comparabilidad</dt>
          <dd className="numeric font-medium">
            {percent(quality.components.comparability)}

            <span className="block text-xs font-normal text-muted-foreground">
              Ambas ventanas y referencia calculadas
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Validación</dt>
          <dd className="font-medium">
            Reconciliación interna aprobada
            <span className="block text-xs font-normal text-muted-foreground">
              Población, ajuste, cuadrantes y distancias
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Acuerdo entre fuentes</dt>
          <dd className="font-medium">
            No evaluable
            <span className="block text-xs font-normal text-muted-foreground">
              Hay una sola fuente de precios; no suma ni resta puntos
            </span>
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">
        Nota operativa {quality.ruleVersion}: 40 % completitud, 20 % frescura,
        20 % comparabilidad y 20 % validación. Frescura: 100 hasta 4 días, 50 de
        5 a 7, 0 después, sin calendario de feriados. La reconciliación
        comprueba el cálculo interno; no verifica independientemente los precios
        publicados por Yahoo Finance.
      </p>
    </section>
  );
}
