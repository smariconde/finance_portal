import { formatMoney, formatQuantity } from "@/app/_components/trading-format";
import type { FillPortion } from "@/modules/trading/domain/trade-round-trips";

import { Money } from "./pnl-values";

const NY_TIME = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  hourCycle: "h23",
  timeZone: "America/New_York",
});

/**
 * Las ejecuciones de un trade, en hora de Nueva York, con el neto de Schwab. En
 * un teléfono, cantidad y precio bajan a una segunda línea en vez de desplazar.
 */
export function ExecutionsList({
  portions,
}: {
  readonly portions: readonly FillPortion[];
}) {
  return (
    <ul className="grid gap-1.5 py-1 text-xs sm:gap-1">
      {portions.map((portion, index) => {
        const quantity = formatQuantity(portion.quantity);
        const price = formatMoney(portion.price);
        return (
          <li
            key={`${portion.fillId}-${index}`}
            className="grid grid-cols-[4rem_1fr_auto] items-baseline gap-x-3 sm:grid-cols-[4.5rem_7.5rem_3.5rem_5.5rem_1fr]"
          >
            <span className="font-medium">
              {portion.side === "buy" ? "Compra" : "Venta"}
            </span>
            <span className="numeric flex flex-col text-muted-foreground">
              <span>{NY_TIME.format(new Date(portion.executedAt))} NY</span>
              <span className="text-foreground sm:hidden">
                {quantity} @ {price}
              </span>
            </span>
            <span className="numeric hidden text-right sm:inline">
              {quantity}
            </span>
            <span className="numeric hidden text-right sm:inline">
              @ {price}
            </span>
            <span className="text-right">
              <Money value={portion.netAmount} signed />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
