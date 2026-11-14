import {
  formatMoney,
  formatSignedMoney,
  signOf,
} from "@/app/_components/trading-format";
import { cn } from "@/lib/utils";
import type { PeriodR } from "@/modules/trading/domain/daily-pnl";
import { formatSignedAmount } from "@/modules/valuation/domain/display-format";

/**
 * Verde y rojo del P&L; el signo escrito dice lo mismo sin el color. `strong` es
 * para texto sobre un fondo teñido, donde el tono normal no llega a 4,5:1.
 */
export function pnlTone(
  value: string | null,
  strong = false,
): string | undefined {
  if (value === null) return undefined;
  const sign = signOf(value);
  if (sign > 0) {
    return strong
      ? "text-emerald-800 dark:text-emerald-300"
      : "text-emerald-700 dark:text-emerald-400";
  }
  if (sign < 0) {
    return strong
      ? "text-red-800 dark:text-red-300"
      : "text-red-700 dark:text-red-400";
  }
  return undefined;
}

export function Money({
  value,
  signed = false,
  className,
}: {
  readonly value: string | null;
  readonly signed?: boolean;
  readonly className?: string;
}) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("numeric", signed && pnlTone(value), className)}>
      {signed ? formatSignedMoney(value) : formatMoney(value)}
    </span>
  );
}

/** R con dos decimales y su signo; sin R, una raya, nunca un cero. */
export function RValue({
  r,
  className,
}: {
  readonly r: PeriodR | null;
  readonly className?: string;
}) {
  if (r === null || r.value === null) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }
  return (
    <span className={cn("numeric", pnlTone(r.value), className)}>
      {formatSignedAmount(r.value, { scale: 2 })} R
    </span>
  );
}
