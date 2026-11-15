"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { termShort } from "@/app/_components/financial-terms";
import { CompanyMark } from "@/app/_components/company-mark";
import { InfoTip } from "@/app/_components/info-tip";
import { Segmented } from "@/app/_components/segmented";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { companyLogoUrl } from "@/modules/configuration/domain/company-logo";
import type { TradingSetup } from "@/modules/trading/domain/trading-setups";
import {
  SMALL_SAMPLE,
  type CutDimension,
  type CutGroup,
} from "@/modules/trading/domain/trading-stats";
import {
  formatAmount,
  formatPercent,
} from "@/modules/valuation/domain/display-format";

import { Money, RValue } from "../../_components/pnl-values";

const DIMENSIONS: readonly { value: CutDimension; label: string }[] = [
  { value: "setup", label: "Setup" },
  { value: "hour", label: "Hora" },
  { value: "weekday", label: "Día" },
  { value: "ticker", label: "Ticker" },
  { value: "holding", label: "Day · swing" },
];

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function groupLabel(
  dimension: CutDimension,
  key: string | null,
  setups: ReadonlyMap<string, string>,
): string {
  switch (dimension) {
    case "setup":
      return key === null ? "Sin setup" : (setups.get(key) ?? key);
    case "hour": {
      const hour = Number(key);
      return `${hour}–${hour + 1} h`;
    }
    case "weekday":
      return WEEKDAYS[Number(key) - 1] ?? String(key);
    case "ticker":
      return key ?? "—";
    case "holding":
      return key === "day" ? "Day" : "Swing";
  }
}

/** La fracción ganadora sobre una pista con la marca del 50 %. */
function WinRateCell({ group }: { readonly group: CutGroup }) {
  const small = group.stats.smallSample;
  const share = Number(group.stats.winRate) * 100;
  return (
    <span className="flex items-center justify-end gap-2">
      <span
        className={cn(
          "relative hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block",
          small && "opacity-50",
        )}
        aria-hidden="true"
      >
        <span
          className="absolute inset-y-0 left-0 bg-emerald-600 dark:bg-emerald-500"
          style={{ width: `${share}%` }}
        />
        <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/40" />
      </span>
      <span className="numeric w-12 text-right">
        {formatPercent(group.stats.winRate, { scale: 0 })}
      </span>
    </span>
  );
}

/** Expectancy contra cero: a la derecha gana, a la izquierda pierde. */
function ExpectancyCell({
  group,
  scale,
}: {
  readonly group: CutGroup;
  readonly scale: number;
}) {
  const value = Number(group.stats.expectancy);
  const width = scale === 0 ? 0 : (Math.abs(value) / scale) * 50;
  const small = group.stats.smallSample;
  return (
    <span className="flex items-center justify-end gap-2">
      <span
        className={cn(
          "relative hidden h-2.5 w-24 sm:block",
          small && "opacity-50",
        )}
        aria-hidden="true"
      >
        <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
        <span
          className={cn(
            "absolute inset-y-0 rounded-sm",
            value >= 0
              ? "left-1/2 bg-emerald-600 dark:bg-emerald-500"
              : "right-1/2 bg-red-600 dark:bg-red-500",
          )}
          style={{ width: `${width}%` }}
        />
      </span>
      <Money
        value={group.stats.expectancy}
        signed
        className="w-20 text-right"
      />
    </span>
  );
}

export function StatsCuts({
  cuts,
  setups,
  lessonSlugs,
  logoKey,
}: {
  readonly cuts: Readonly<Record<CutDimension, readonly CutGroup[]>>;
  readonly setups: readonly TradingSetup[];
  /** Por código de setup declarado, su lección (`F11-10`). */
  readonly lessonSlugs: Readonly<Record<string, string>>;
  readonly logoKey: string | null;
}) {
  const [dimension, setDimension] = useState<CutDimension>("setup");
  const setupLabels = useMemo(
    () => new Map(setups.map((setup) => [setup.code, setup.label])),
    [setups],
  );
  const groups = cuts[dimension];
  const scale = Math.max(
    0,
    ...groups.map((group) => Math.abs(Number(group.stats.expectancy))),
  );
  const current = DIMENSIONS.find((item) => item.value === dimension)!;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle as="h2" className="flex items-center gap-1">
          Cortes
          <InfoTip title="Cómo se lee">
            <p>
              Cada fila es un grupo de trades cerrados. Hora y día son los de la
              entrada, en Nueva York.
            </p>
            <p>
              La barra de {termShort("expectancy")} crece desde cero: a la
              derecha ganó por trade, a la izquierda perdió. La de{" "}
              {termShort("winRate")} marca el 50 %.
            </p>
            <p>
              Con menos de {SMALL_SAMPLE} trades, sus barras se atenúan y su
              cantidad va subrayada: es una muestra chica.
            </p>
          </InfoTip>
        </CardTitle>
        <div className="max-w-full overflow-x-auto">
          <Segmented
            label="Cortar por"
            options={DIMENSIONS}
            value={dimension}
            onChange={setDimension}
          />
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {groups.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Sin trades cerrados.
          </p>
        ) : (
          <Table
            containerLabel={`Cortes por ${current.label}, tabla desplazable`}
          >
            <caption className="sr-only">
              Estadísticas de los trades cerrados por{" "}
              {current.label.toLowerCase()}
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead>{current.label}</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">
                  {termShort("winRate")}
                </TableHead>
                <TableHead className="text-right">
                  {termShort("expectancy")}
                </TableHead>
                <TableHead className="text-right">En R</TableHead>
                <TableHead className="text-right">
                  {termShort("profitFactor")}
                </TableHead>
                <TableHead className="text-right">P&amp;L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const small = group.stats.smallSample;
                return (
                  <TableRow key={group.key ?? "none"}>
                    <TableCell className="max-w-48 font-medium">
                      <span className="flex items-center gap-2">
                        {dimension === "ticker" && group.key !== null ? (
                          <CompanyMark
                            ticker={group.key}
                            name={null}
                            logoUrl={companyLogoUrl(
                              group.key,
                              logoKey ?? undefined,
                            )}
                            size="sm"
                          />
                        ) : null}
                        {dimension === "setup" &&
                        group.key !== null &&
                        lessonSlugs[group.key] !== undefined ? (
                          <Link
                            href={`/lecciones/${lessonSlugs[group.key]}`}
                            className="truncate rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            {groupLabel(dimension, group.key, setupLabels)}
                          </Link>
                        ) : (
                          <span className="truncate">
                            {groupLabel(dimension, group.key, setupLabels)}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="numeric text-right">
                      <span
                        className={cn(
                          small &&
                            "underline decoration-dotted underline-offset-4",
                        )}
                      >
                        {group.stats.trades}
                        {small ? (
                          <span className="sr-only">, muestra chica</span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      <WinRateCell group={group} />
                    </TableCell>
                    <TableCell>
                      <ExpectancyCell group={group} scale={scale} />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <span>
                        <RValue r={group.stats.expectancyR} />
                        {group.stats.expectancyR.n === 0 ||
                        group.stats.expectancyR.missing === 0 ? null : (
                          <span className="numeric ml-1 text-xs text-muted-foreground">
                            ({group.stats.expectancyR.n})
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="numeric text-right">
                      <span>
                        {group.stats.profitFactor.value === null ? (
                          <span className="text-muted-foreground">
                            —<span className="sr-only">, sin pérdidas</span>
                          </span>
                        ) : (
                          formatAmount(group.stats.profitFactor.value, {
                            scale: 2,
                          })
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <Money value={group.stats.realizedPnl} signed />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
