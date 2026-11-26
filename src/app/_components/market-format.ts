/**
 * Fechas del calendario de mercado en español, con nombres fijos: `Intl`
 * podría nombrarlas distinto en el servidor y en el navegador.
 */
const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;
const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

function weekdayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return WEEKDAYS[day === 0 ? 6 : day - 1]!;
}

/** `2026-11-27` → `vie 27/11`. */
export function shortMarketDate(date: string): string {
  return `${weekdayOf(date)} ${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;
}

/** `2026-11-27` → `27/11/2026`. */
export function fullMarketDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** `2026-11` → `noviembre 2026`. */
export function monthTitle(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** «hoy», «mañana» o «en 28 días». */
export function daysAwayLabel(days: number): string {
  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  return `en ${days} días`;
}
