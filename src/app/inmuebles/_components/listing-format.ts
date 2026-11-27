import type { ListingCurrency } from "@/modules/real-estate/domain/listing-capture";
import { formatAmount } from "@/modules/valuation/domain/display-format";

/** Decimales que trae el valor, hasta dos: un precio redondo no muestra «,00». */
function scaleOf(value: string): number {
  return value.includes(".") ? Math.min(value.split(".")[1]!.length, 2) : 0;
}

export function formatListingPrice(
  amount: string | null,
  currency: ListingCurrency | null,
): string {
  if (amount === null || currency === null) return "Consultar";
  return `${currency} ${formatAmount(amount, { scale: scaleOf(amount) })}`;
}

export function formatArea(value: string | null): string | null {
  return value === null
    ? null
    : `${formatAmount(value, { scale: scaleOf(value) })} m²`;
}
