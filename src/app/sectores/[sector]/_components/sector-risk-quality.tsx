"use client";

import { ChevronDown, CircleAlert, CircleCheck } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { SectorRiskQuality as Quality } from "@/modules/metrics/domain/sector-risk-quality";

import { qualityVerdict } from "./quality-verdict";

function percent(value: number | null): string {
  return value === null ? "—" : `${value} %`;
}

/**
 * La calidad de la matriz en una línea: la nota y lo que la degrada, en una
 * palabra. Los componentes, sus pesos y la regla van en el panel que abre el
 * botón (click, toque, Enter o Espacio; nunca sólo por hover).
 */
export function SectorRiskQuality({ quality }: { readonly quality: Quality }) {
  const verdict = qualityVerdict(quality);
  const ready = verdict.state === "ready";
  const Icon = ready ? CircleCheck : CircleAlert;
  const summary = ready ? "Completa" : verdict.reasons[0];
  const components: [string, string, string][] = [
    [
      "Completitud",
      percent(quality.components.completeness),
      `${quality.computed2y + quality.computed5y} de ${quality.population * 2} Sortino · 40 %`,
    ],
    [
      "Frescura",
      percent(quality.components.freshness),
      `Cierre de hace ${quality.daysSinceClose} ${quality.daysSinceClose === 1 ? "día" : "días"} · 20 %`,
    ],
    [
      "Comparabilidad",
      percent(quality.components.comparability),
      `${quality.comparable} de ${quality.population} con las dos ventanas · 20 %`,
    ],
    [
      "Validación",
      `${quality.components.validation} %`,
      "Reconciliación interna aprobada · 20 %",
    ],
    ["Acuerdo entre fuentes", "—", "Una sola fuente: no suma ni resta"],
  ];

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted",
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0",
            ready ? "text-muted-foreground" : "text-foreground",
          )}
        />
        <span className="text-muted-foreground">Calidad</span>
        {verdict.score === null ? null : (
          <span className="numeric">{verdict.score}</span>
        )}
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <span>{summary}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <PopoverTitle>
          Calidad de esta matriz
          {verdict.score === null ? null : (
            <span className="numeric ml-1.5 text-muted-foreground">
              {verdict.score}
            </span>
          )}
        </PopoverTitle>
        {verdict.reasons.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            {verdict.reasons.join(" · ")}
          </p>
        ) : null}
        <dl className="flex flex-col divide-y text-xs">
          {components.map(([term, value, detail]) => (
            <div
              key={term}
              className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 py-1.5"
            >
              <dt className="font-medium text-foreground">{term}</dt>
              <dd className="numeric text-right font-medium">{value}</dd>
              <dd className="col-span-2 text-muted-foreground">{detail}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          Frescura: 100 hasta 4 días, 50 de 5 a 7, sin feriados. Comprueba el
          cálculo interno, no los precios de Yahoo Finance.{" "}
          <span className="font-mono">{quality.ruleVersion}</span>
        </p>
      </PopoverContent>
    </Popover>
  );
}
