/**
 * Where a REM target month stands against the cutoff (`rem-target-month-1.0.0`,
 * `F9-24`), so a month without an observed CPI says why: a month that has not
 * ended cannot have a CPI yet; a month that ended may have one published that
 * is not stored. The month is read in Buenos Aires, where the INDEC dates it.
 *
 * - `future`: starts after the cutoff's month;
 * - `current`: the cutoff's own month, still running;
 * - `closed`: ended before the cutoff; its CPI is due or stored.
 */
export const REM_TARGET_MONTH_VERSION = "rem-target-month-1.0.0";

export type RemTargetMonthState = "future" | "current" | "closed";

/** Buenos Aires is UTC−3 all year. */
const BUENOS_AIRES_OFFSET_MS = 3 * 3_600_000;

export function remTargetMonthState(
  targetMonth: string,
  knownAt: string,
): RemTargetMonthState {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(targetMonth)) {
    throw new Error(`invalid_target_month: ${targetMonth}`);
  }
  const knownMs = Date.parse(knownAt);
  if (!Number.isFinite(knownMs))
    throw new Error(`invalid_known_at: ${knownAt}`);
  const cutoffMonth = new Date(knownMs - BUENOS_AIRES_OFFSET_MS)
    .toISOString()
    .slice(0, 7);
  if (targetMonth > cutoffMonth) return "future";
  if (targetMonth === cutoffMonth) return "current";
  return "closed";
}
