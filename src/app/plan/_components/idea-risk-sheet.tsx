"use client";

import { TriangleAlert } from "lucide-react";

import type {
  LiveAccountResult,
  RiskContextResult,
} from "@/app/cuenta/actions";
import { InfoTip } from "@/app/_components/info-tip";
import { formatMoney, formatQuantity } from "@/app/_components/trading-format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  PRE_MARKET_PLAN_VERSION,
  STOP_LOSS_CALC_VERSION,
  type IdeaLevels,
} from "@/modules/trading/domain/pre-market-plan";
import {
  POSITION_SIZE_RISK_VERSION,
  type OpenRisk,
  type PlannerCap,
  type PositionPlan,
} from "@/modules/trading/domain/position-size-risk";
import type { TradingBook } from "@/modules/trading/domain/trading-book";
import {
  allocationOf,
  riskPerTradeOf,
} from "@/modules/trading/domain/trading-rules";
import { formatAmount } from "@/modules/valuation/domain/display-format";

import { planMarkers, type PlanMarker } from "./idea-risk-levels";

/**
 * El riesgo de la idea que se está escribiendo (`F11-12`): primero cuánto se
 * compra, después los niveles y al final la cantidad elegida contra la que
 * sugiere el riesgo de la cuenta. Las cifras salen de `pre-market-plan-1.1.0` y
 * `position-size-risk-2.0.0` en decimal; acá sólo se escriben, y `number` no
 * toca ninguna.
 */

type ValidLevels = Extract<IdeaLevels, { readonly state: "valid" }>;
type PlannedSize = Extract<PositionPlan, { readonly state: "planned" }>;

const CAP_COPY: Readonly<Record<PlannerCap, string>> = {
  risk_per_trade: "riesgo por trade",
  buying_power: "poder de compra",
  capital: "capital del tipo",
  open_risk: "riesgo abierto",
};

const INVALID_COPY: Readonly<Record<string, string>> = {
  no_equity: "Schwab no informó un capital positivo para dimensionar la idea.",
  stop_on_wrong_side: "El stop tiene que quedar debajo de la entrada.",
  target_on_wrong_side: "El target tiene que quedar arriba de la entrada.",
  auto_stop_non_positive:
    "Con esta cantidad el stop automático queda en cero: reducí la cantidad o elegí un stop manual.",
  non_positive_input: "Entrada, cantidad y niveles tienen que ser positivos.",
};

const money = (value: string) => `US$ ${formatMoney(value)}`;
const percent = (value: string) => `${formatAmount(value, { scale: 1 })} %`;
const riskMultiple = (value: string) =>
  `${formatAmount(value, { scale: 2 })} R`;

const SHAPE: Readonly<
  Record<PlanMarker["key"], { readonly axis: string; readonly swatch: string }>
> = {
  stop: {
    axis: "h-6 w-0.5 rounded-full bg-red-600 dark:bg-red-500",
    swatch: "h-3 w-0.5 rounded-full bg-red-600 dark:bg-red-500",
  },
  entry: {
    axis: "size-3 rounded-full border-2 border-foreground bg-card ring-2 ring-card",
    swatch: "size-2.5 rounded-full border-2 border-foreground bg-card",
  },
  two: {
    axis: "h-6 w-0.5 rounded-full bg-emerald-600 dark:bg-emerald-500",
    swatch: "h-3 w-0.5 rounded-full bg-emerald-600 dark:bg-emerald-500",
  },
  three: {
    axis: "h-6 w-0.5 rounded-full bg-emerald-600 dark:bg-emerald-500",
    swatch: "h-3 w-0.5 rounded-full bg-emerald-600 dark:bg-emerald-500",
  },
  target: {
    axis: "h-6 w-0.5 rounded-full bg-emerald-600 dark:bg-emerald-500",
    swatch: "h-3 w-0.5 rounded-full bg-emerald-600 dark:bg-emerald-500",
  },
};

/** Un TP que no se eligió se dibuja como referencia, a media altura. */
const REFERENCE_AXIS =
  "h-3.5 w-0.5 rounded-full bg-emerald-600/45 dark:bg-emerald-500/45";

const axisShape = (marker: PlanMarker) =>
  marker.key === "two" || marker.key === "three"
    ? marker.chosen
      ? SHAPE[marker.key].axis
      : REFERENCE_AXIS
    : SHAPE[marker.key].axis;

/**
 * Stop, entrada y targets sobre un eje de precio. Es un dibujo: lo mismo está
 * escrito en la leyenda de abajo, que va en orden de precio para que dos niveles
 * cercanos nunca se pisen. `number` sólo para la geometría.
 */
function PriceAxis({
  markers,
  entry,
  target,
}: {
  readonly markers: readonly PlanMarker[];
  readonly entry: string;
  readonly target: string;
}) {
  const values = markers.map((marker) => Number(marker.value));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || Math.max(high * 0.02, 0.01);
  const pad = span * 0.05;
  const at = (value: string) =>
    ((Number(value) - (low - pad)) / (span + 2 * pad)) * 100;
  const zone = (to: string, tone: string) => {
    const from = at(entry);
    const edge = at(to);
    return (
      <span
        className={cn("absolute inset-y-0", tone)}
        style={{
          left: `${Math.min(from, edge)}%`,
          width: `${Math.abs(edge - from)}%`,
        }}
      />
    );
  };
  const stop = markers.find((marker) => marker.key === "stop");

  return (
    <div aria-hidden="true" className="relative mx-2 h-6">
      <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
        {stop === undefined
          ? null
          : zone(stop.value, "bg-red-600/20 dark:bg-red-500/25")}
        {zone(target, "bg-emerald-600/20 dark:bg-emerald-500/25")}
      </div>
      {markers.map((marker) => (
        <span
          key={marker.key}
          className={cn(
            "absolute top-1/2 -translate-x-1/2 -translate-y-1/2",
            axisShape(marker),
          )}
          style={{ left: `${at(marker.value)}%` }}
        />
      ))}
    </div>
  );
}

function Fact({
  label,
  value,
  detail,
  muted = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
  readonly muted?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "numeric text-sm font-medium",
          muted && "text-muted-foreground",
        )}
      >
        {value}
      </dd>
      {detail === undefined ? null : (
        <dd className="numeric text-xs text-muted-foreground">{detail}</dd>
      )}
    </div>
  );
}

/**
 * La compra y el riesgo de la cantidad elegida contra las del tamaño que sugiere
 * el riesgo de la cuenta. Comparten filas para que las cifras se comparen solas.
 */
function SizeComparison({
  levels,
  size,
  quantity,
  wholeQuantity,
  onUseSuggested,
}: {
  readonly levels: ValidLevels;
  readonly size: PlannedSize | null;
  readonly quantity: string | null;
  readonly wholeQuantity: boolean;
  readonly onUseSuggested: (shares: string) => void;
}) {
  const exceeds =
    size !== null &&
    wholeQuantity &&
    quantity !== null &&
    BigInt(quantity) > BigInt(size.shares);
  const head = "pb-1 text-xs font-medium";
  const label = "py-2 pr-3 text-left text-xs font-normal text-muted-foreground";
  const cell = "py-2 align-top";
  /** La compra se lee primero: es el monto que se pone. */
  const purchase = "numeric text-base font-semibold";
  const detail = "block text-xs text-muted-foreground";

  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          Cantidad elegida y tamaño sugerido, con el monto de la compra y el
          riesgo de cada uno
        </caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className={cn(head, "pr-3")}>
              <span className="sr-only">Concepto</span>
            </th>
            <th scope="col" className={cn(head, "pr-3")}>
              Tu cantidad
            </th>
            <th scope="col" className={head}>
              {size === null
                ? "Sugerido"
                : `Sugerido · ${CAP_COPY[size.binding]}`}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t">
            <th scope="row" className={label}>
              Shares
            </th>
            <td className={cn(cell, "numeric pr-3 text-base font-semibold")}>
              {quantity === null ? "—" : formatQuantity(quantity)}
            </td>
            <td className={cell}>
              {size === null ? (
                "—"
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="numeric text-base font-semibold">
                    {formatQuantity(size.shares)}
                  </span>
                  {size.shares === "0" || size.shares === quantity ? null : (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => onUseSuggested(size.shares)}
                    >
                      Usar
                    </Button>
                  )}
                </span>
              )}
            </td>
          </tr>
          <tr className="border-t">
            <th scope="row" className={label}>
              Compra
            </th>
            <td className={cn(cell, "pr-3")}>
              <span className={purchase}>{money(levels.chosenValue)}</span>
              <span className={detail}>
                {percent(levels.chosenPercent)} del capital
              </span>
            </td>
            <td className={cell}>
              {size === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <>
                  <span className={purchase}>{money(size.positionValue)}</span>
                  <span className={detail}>
                    {percent(size.positionPercent)} del capital
                  </span>
                </>
              )}
            </td>
          </tr>
          <tr className="border-t">
            <th scope="row" className={label}>
              Riesgo
            </th>
            <td className={cn(cell, "pr-3")}>
              <span className="numeric">{money(levels.chosenRisk)}</span>
              <span className={detail}>
                {percent(levels.chosenRiskPercent)} del capital
              </span>
            </td>
            <td className={cell}>
              {size === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <>
                  <span className="numeric">{money(size.riskAmount)}</span>
                  <span className={detail}>
                    {percent(size.riskPercent)} del capital
                  </span>
                </>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      {exceeds && size !== null && quantity !== null ? (
        <p
          role="note"
          className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300"
        >
          <TriangleAlert
            className="mt-px size-3.5 shrink-0"
            aria-hidden="true"
          />
          {`Tu cantidad supera el tope de ${CAP_COPY[size.binding]}: ${formatQuantity(quantity)} acciones contra ${formatQuantity(size.shares)}.`}
        </p>
      ) : null}
    </div>
  );
}

export function IdeaRiskSheet({
  live,
  risk,
  open,
  levels,
  size,
  quantity,
  wholeQuantity,
  entry,
  stopMode,
  targetMode,
  book,
  capitalLeft,
  onUseSuggested,
}: {
  readonly live: LiveAccountResult | null;
  readonly risk: RiskContextResult | null;
  readonly open: OpenRisk | null;
  readonly levels: IdeaLevels | null;
  readonly size: PositionPlan | null;
  readonly quantity: string | null;
  readonly wholeQuantity: boolean;
  readonly entry: string | null;
  readonly stopMode: "manual" | "automatic";
  readonly targetMode: "manual" | "one_to_two" | "one_to_three";
  readonly book: TradingBook;
  /** Lo que le queda al capital del tipo hoy; `null` sin medir. */
  readonly capitalLeft: string | null;
  readonly onUseSuggested: (shares: string) => void;
}) {
  const valid = levels?.state === "valid" ? levels : null;
  const planned = size?.state === "planned" ? size : null;
  const markers =
    valid === null || entry === null
      ? []
      : planMarkers(valid, entry, targetMode);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-1">
          Riesgo de la idea
          <InfoTip title="Riesgo de la idea">
            <p>
              Stop automático: entrada − riesgo por trade del tipo ÷ shares. El
              sugerido es el mínimo entre el riesgo por trade, el buying power,
              lo que le queda al capital del tipo y, en swing, al riesgo
              abierto; no cambia tu cantidad ni envía órdenes.
            </p>
            {valid !== null &&
            stopMode === "manual" &&
            valid.autoStop !== null ? (
              <p className="numeric">
                Stop automático alternativo {money(valid.autoStop)}.
              </p>
            ) : null}
            <p className="font-mono text-xs">
              {PRE_MARKET_PLAN_VERSION} · {STOP_LOSS_CALC_VERSION} ·{" "}
              {POSITION_SIZE_RISK_VERSION}
            </p>
          </InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {live === null || risk === null ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Spinner aria-hidden="true" />
            Leyendo cuenta y reglas…
          </p>
        ) : live.state !== "read" || risk.state !== "read" ? (
          <p className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            Sin cuenta: no hay tamaño sugerido
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b pb-4 sm:grid-cols-3">
            <Fact
              label="Capital"
              value={money(live.balances.liquidationValue)}
            />
            <Fact
              label={`Riesgo ${book}`}
              value={percent(riskPerTradeOf(risk.settings, book))}
            />
            {book === "day" ? (
              <Fact
                label="Capital day libre"
                value={capitalLeft === null ? "Sin medir" : money(capitalLeft)}
                detail={`${percent(allocationOf(risk.settings, "day"))} del capital`}
                muted={capitalLeft === null}
              />
            ) : (
              <Fact
                label="Riesgo abierto"
                value={open?.value == null ? "Sin medir" : money(open.value)}
                detail={
                  open?.value != null && open.percent !== null
                    ? `${percent(open.percent)} de ${percent(risk.settings.openRiskPercent)}`
                    : open !== null && open.missing.length > 0
                      ? `sin stop: ${open.missing.join(", ")}`
                      : undefined
                }
                muted={open?.value == null}
              />
            )}
          </dl>
        )}

        {levels === null ? (
          <p className="text-muted-foreground">Entrada y shares.</p>
        ) : levels.state === "invalid" ? (
          <p className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            {INVALID_COPY[levels.reason] ?? "Revisá los valores del plan."}
          </p>
        ) : markers.length === 0 ? null : (
          <>
            <SizeComparison
              levels={levels}
              size={planned}
              quantity={quantity}
              wholeQuantity={wholeQuantity}
              onUseSuggested={onUseSuggested}
            />
            <div className="flex flex-col gap-3 border-t pt-4">
              <PriceAxis
                markers={markers}
                entry={entry!}
                target={levels.target}
              />
              <ol
                aria-label="Niveles del plan, de menor a mayor precio"
                className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs"
              >
                {markers.map((marker) => (
                  <li key={marker.key} className="flex items-center gap-1.5">
                    <span className="flex size-3.5 items-center justify-center">
                      <span
                        aria-hidden="true"
                        className={SHAPE[marker.key].swatch}
                      />
                    </span>
                    <span
                      className={
                        marker.chosen
                          ? "font-medium text-foreground"
                          : "text-muted-foreground"
                      }
                    >
                      {marker.label}
                    </span>
                    <span className="numeric font-medium">
                      {money(marker.value)}
                    </span>
                    {marker.multiple === null ? null : (
                      <span className="numeric text-muted-foreground">
                        {riskMultiple(marker.multiple)}
                      </span>
                    )}
                    {marker.chosen ? (
                      <span className="text-muted-foreground">elegido</span>
                    ) : null}
                  </li>
                ))}
              </ol>
              <p className="numeric text-xs text-muted-foreground">
                1 R = {money(levels.riskPerShare)} por acción.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
