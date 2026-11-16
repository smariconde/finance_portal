import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatSignedAmount } from "@/modules/valuation/domain/display-format";

import { pnlTone, signOf } from "./trading-format";

/**
 * La variación del día de una cotización: flecha, signo y color dicen lo mismo,
 * así el color nunca es el único canal. Sin dato, una raya.
 */
export function PercentChange({
  value,
  className,
}: {
  readonly value: string | null | undefined;
  readonly className?: string;
}) {
  if (value === null || value === undefined) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }
  const sign = signOf(value);
  const Icon = sign > 0 ? ArrowUpRight : sign < 0 ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "numeric inline-flex items-center gap-0.5 font-medium",
        pnlTone(value) ?? "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {formatSignedAmount(value, { scale: 2 })} %
    </span>
  );
}
