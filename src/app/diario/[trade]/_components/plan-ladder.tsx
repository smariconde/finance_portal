import { formatMoney } from "@/app/_components/trading-format";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  priceInR,
  type TradePlan,
} from "@/modules/trading/domain/trade-annotation";
import { formatSignedAmount } from "@/modules/valuation/domain/display-format";

type MarkerKey = "stop" | "plannedEntry" | "entry" | "exit" | "target";

type Marker = {
  readonly key: MarkerKey;
  readonly label: string;
  readonly value: string;
};

/** Stop y target son rayas largas de color; entradas y salida, puntos. */
const MARKER_SHAPE: Readonly<Record<MarkerKey, string>> = {
  stop: "h-6 w-0.5 rounded-full bg-red-600 dark:bg-red-500",
  target: "h-6 w-0.5 rounded-full bg-emerald-600 dark:bg-emerald-500",
  plannedEntry: "size-3 rounded-full border-2 border-muted-foreground bg-card",
  entry: "size-3 rounded-full bg-foreground ring-2 ring-card",
  exit: "size-3 rotate-45 rounded-[2px] bg-primary ring-2 ring-card",
};

/**
 * El plan contra lo ejecutado sobre un eje de precio: stop, entrada planeada,
 * entrada y salida promedio, target. La zona entre la entrada y el stop es el
 * riesgo; entre la entrada y el target, el objetivo. Los rótulos van en una
 * leyenda en orden de precio, con la distancia en R (`trade-plan-1.0.0`), para
 * que nunca se pisen: dos ejecuciones a centavos de distancia son lo normal.
 * `number` sólo para la geometría.
 */
export function PlanLadder({
  direction,
  plan,
  averageEntryPrice,
  averageExitPrice,
}: {
  readonly direction: "long" | "short";
  readonly plan: TradePlan | null;
  readonly averageEntryPrice: string | null;
  readonly averageExitPrice: string | null;
}) {
  if (plan === null || (plan.stop === null && plan.target === null)) {
    return null;
  }
  const candidates: (Marker | null)[] = [
    plan.stop === null
      ? null
      : { key: "stop", label: "Stop", value: plan.stop },
    plan.entry === null
      ? null
      : { key: "plannedEntry", label: "Entrada plan", value: plan.entry },
    averageEntryPrice === null
      ? null
      : { key: "entry", label: "Entrada", value: averageEntryPrice },
    averageExitPrice === null
      ? null
      : { key: "exit", label: "Salida", value: averageExitPrice },
    plan.target === null
      ? null
      : { key: "target", label: "Target", value: plan.target },
  ];
  const markers = candidates
    .filter((marker): marker is Marker => marker !== null)
    .sort((a, b) => Number(a.value) - Number(b.value));

  const values = markers.map((marker) => Number(marker.value));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || Math.max(high * 0.02, 0.01);
  const pad = span * 0.04;
  const position = (value: string) =>
    ((Number(value) - (low - pad)) / (span + 2 * pad)) * 100;
  // La entrada de referencia es la ejecutada; sin ejecuciones, la planeada.
  const reference = averageEntryPrice ?? plan.entry;

  const zone = (to: string, tone: string) => {
    if (reference === null) return null;
    const a = position(reference);
    const b = position(to);
    return (
      <span
        className={cn("absolute inset-y-0", tone)}
        style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }}
      />
    );
  };

  return (
    <Card className="py-0">
      <CardContent className="flex flex-col gap-3 px-4 py-4">
        <div aria-hidden="true" className="relative mx-2 h-6">
          <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
            {plan.stop === null
              ? null
              : zone(plan.stop, "bg-red-600/20 dark:bg-red-500/25")}
            {plan.target === null
              ? null
              : zone(plan.target, "bg-emerald-600/20 dark:bg-emerald-500/25")}
          </div>
          {markers.map((marker) => (
            <span
              key={marker.key}
              className={cn(
                "absolute top-1/2 -translate-x-1/2 -translate-y-1/2",
                MARKER_SHAPE[marker.key],
              )}
              style={{ left: `${position(marker.value)}%` }}
            />
          ))}
        </div>
        <ol
          aria-label={`Plan ${direction === "long" ? "largo" : "corto"}, de menor a mayor precio`}
          className="flex flex-wrap gap-x-6 gap-y-2 text-xs"
        >
          {markers.map((marker) => {
            const r = priceInR(direction, reference, plan.stop, marker.value);
            return (
              <li key={marker.key} className="flex items-center gap-2">
                <span className="flex size-4 items-center justify-center">
                  <span
                    aria-hidden="true"
                    className={cn(
                      MARKER_SHAPE[marker.key],
                      marker.key === "stop" || marker.key === "target"
                        ? "h-3.5"
                        : undefined,
                    )}
                  />
                </span>
                <span className="text-muted-foreground">{marker.label}</span>
                <span className="numeric font-medium">
                  {formatMoney(marker.value)}
                </span>
                {r === null || marker.key === "entry" ? null : (
                  <span className="numeric text-muted-foreground">
                    {formatSignedAmount(r, { scale: 2 })} R
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
