import { BRIDGE_LABELS } from "@/app/valuacion/_components/run/labels";
import { cn } from "@/lib/utils";
import { formatCompactAmount } from "@/modules/valuation/domain/display-format";
import type { ValueChain } from "@/modules/valuation/domain/valuation-verdict";

type Step = {
  readonly key: string;
  readonly label: string;
  readonly kind: "add" | "subtract" | "total";
  /** Sólo geometría: el tramo que ocupa la barra. La cifra va en `amount`. */
  readonly from: number;
  readonly to: number;
  readonly amount: string;
};

const SIGN: Record<Step["kind"], { glyph: string; spoken: string }> = {
  add: { glyph: "+", spoken: "suma" },
  subtract: { glyph: "−", spoken: "resta" },
  total: { glyph: "=", spoken: "da" },
};

/**
 * Los tramos de la cascada, en el orden en que el motor los suma. Cada monto
 * sale tal cual de la corrida; el único número que se calcula acá es la
 * posición de la barra, y ese no se lee.
 */
function stepsOf(chain: ValueChain): Step[] {
  const explicit = Number(chain.explicitPresentValue);
  const goingConcern = explicit + Number(chain.terminalPresentValue);
  const steps: Step[] = [
    {
      key: "explicit",
      label: `Los ${chain.explicitYears} años proyectados`,
      kind: "add",
      from: 0,
      to: explicit,
      amount: chain.explicitPresentValue,
    },
    {
      key: "terminal",
      label: "Valor terminal",
      kind: "add",
      from: explicit,
      to: goingConcern,
      amount: chain.terminalPresentValue,
    },
  ];

  // Con probabilidad de quiebra, el valor como empresa en marcha y el ajustado
  // son dos totales: la caída entre los dos es el ajuste, sin escribir una
  // resta que el motor no publica.
  if (chain.failureProbability !== "0") {
    steps.push({
      key: "going-concern",
      label: "Si sigue operando",
      kind: "total",
      from: 0,
      to: Number(chain.goingConcernValue),
      amount: chain.goingConcernValue,
    });
  }

  steps.push({
    key: "enterprise",
    label: "Valor de las operaciones",
    kind: "total",
    from: 0,
    to: Number(chain.enterpriseValue),
    amount: chain.enterpriseValue,
  });

  let running = Number(chain.enterpriseValue);

  for (const item of chain.bridge) {
    if (item.value === "0") continue;
    const next =
      item.sign === "add"
        ? running + Number(item.value)
        : running - Number(item.value);
    steps.push({
      key: item.key,
      label: BRIDGE_LABELS[item.key],
      kind: item.sign === "add" ? "add" : "subtract",
      from: running,
      to: next,
      amount: item.value,
    });
    running = next;
  }

  steps.push({
    key: "equity",
    label: "Para los accionistas",
    kind: "total",
    from: 0,
    to: Number(chain.equityValue),
    amount: chain.equityValue,
  });

  return steps;
}

/**
 * De dónde sale el valor (`F6-17`): una cascada horizontal desde los flujos
 * descontados hasta lo que queda para los accionistas. Es una lista ordenada,
 * no un dibujo: cada fila dice su signo y su monto en texto, y la barra sólo
 * los ubica. El signo nunca depende del color.
 */
export function ValueComposition({
  chain,
  currency,
}: {
  chain: ValueChain;
  currency: string;
}) {
  const steps = stepsOf(chain);
  const bounds = steps.flatMap((step) => [step.from, step.to]);
  const low = Math.min(0, ...bounds);
  const high = Math.max(0, ...bounds);
  const span = high - low || 1;
  const at = (value: number) => ((value - low) / span) * 100;

  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map((step) => {
        const left = at(Math.min(step.from, step.to));
        // Un tramo mínimo visible: un monto chico sigue teniendo su fila.
        const width = Math.max(
          (Math.abs(step.to - step.from) / span) * 100,
          0.6,
        );
        const sign = SIGN[step.kind];

        return (
          <li
            key={step.key}
            className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 sm:grid-cols-[1rem_minmax(0,12rem)_minmax(0,1fr)_7.5rem]"
          >
            <span
              aria-hidden="true"
              className="numeric text-center text-sm text-muted-foreground"
            >
              {sign.glyph}
            </span>
            <span
              className={cn(
                "truncate text-sm",
                step.kind === "total" ? "font-medium" : "text-muted-foreground",
              )}
            >
              <span className="sr-only">{sign.spoken} </span>
              {step.label}
            </span>
            <span
              aria-hidden="true"
              className="relative col-span-3 col-start-1 row-start-2 h-3 sm:col-span-1 sm:col-start-3 sm:row-start-1"
            >
              {low < 0 ? (
                <span
                  className="absolute inset-y-[-2px] w-px bg-border"
                  style={{ left: `${at(0)}%` }}
                />
              ) : null}
              <span
                className={cn(
                  "absolute inset-y-0 rounded-sm",
                  step.kind === "total" && "bg-chart-1",
                  step.kind === "add" && "bg-chart-1/45",
                  step.kind === "subtract" &&
                    "bg-chart-5/25 ring-1 ring-chart-5 ring-inset",
                )}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </span>
            <span
              className={cn(
                "numeric col-start-3 row-start-1 text-right text-sm whitespace-nowrap sm:col-start-4",
                step.kind === "total" && "font-semibold",
              )}
            >
              {formatCompactAmount(step.amount)}
              <span className="sr-only"> {currency}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
