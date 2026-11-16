import {
  formatMoney,
  formatSignedMoney,
  pnlTone,
} from "@/app/_components/trading-format";
import { cn } from "@/lib/utils";
import { formatSignedAmount } from "@/modules/valuation/domain/display-format";

export { pnlTone };

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
  readonly r: { readonly value: string | null } | null;
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
