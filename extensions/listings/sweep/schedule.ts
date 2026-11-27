import { buenosAiresDate } from "../capture/status";

/**
 * Cuándo y a qué paso barre la extensión (`listing-sweep-1.0.0`, ADR 0089,
 * Decisión 2; `docs/real-estate/market-model.md` §4).
 *
 * - **Una vez por día de Buenos Aires**, a una hora sorteada alrededor de las
 *   10:00 con ±90 minutos. El sorteo es determinista por día y portal (un
 *   hash, no `Math.random`), así un service worker que se reinicia no cambia
 *   la hora. Si Brave estaba cerrado a esa hora, el barrido corre la próxima
 *   vez que se abra ese mismo día; un día que pasó entero no se recupera.
 * - **Entre páginas, 8 a 15 s**; cada 5 a 8 páginas, una pausa larga de 45 a
 *   120 s. Los dos con el mismo sorteo determinista por paso.
 */
export const LISTING_SWEEP_VERSION = "listing-sweep-1.0.0";

/** Hora central del barrido en Buenos Aires, en minutos desde la medianoche. */
const CENTER_MINUTE = 10 * 60;
const JITTER_MINUTES = 90;
/** Argentina no tiene horario de verano: UTC−3 todo el año. */
const BUENOS_AIRES_OFFSET_MINUTES = -3 * 60;

export const PAGE_DELAY_MS = { min: 8_000, max: 15_000 } as const;
export const LONG_PAUSE_MS = { min: 45_000, max: 120_000 } as const;
export const LONG_PAUSE_EVERY = { min: 5, max: 8 } as const;

/** Un número en [0, 1) que depende sólo de la semilla: FNV-1a de 32 bits. */
export function seededUnit(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x1_0000_0000;
}

function between(seed: string, range: { min: number; max: number }): number {
  return Math.round(range.min + seededUnit(seed) * (range.max - range.min));
}

/** El instante sorteado para el barrido de `date` (AAAA-MM-DD, Buenos Aires). */
export function sweepStartAt(date: string, portal: string): string {
  const offset = Math.round(
    (seededUnit(`${LISTING_SWEEP_VERSION}:${portal}:${date}`) * 2 - 1) *
      JITTER_MINUTES,
  );
  const minute = CENTER_MINUTE + offset;
  const midnightUtc = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(
    midnightUtc + (minute - BUENOS_AIRES_OFFSET_MINUTES) * 60_000,
  ).toISOString();
}

/** Si a esta hora corresponde barrer: pasó la hora sorteada del día de hoy. */
export function sweepIsDue(now: string, portal: string): boolean {
  const today = buenosAiresDate(now);
  return Date.parse(now) >= Date.parse(sweepStartAt(today, portal));
}

/**
 * La espera antes de la página `step` (0 es la primera, sin espera). Cada
 * `LONG_PAUSE_EVERY` páginas, sorteado por bloque, la espera es larga.
 */
export function delayBeforeStep(
  date: string,
  portal: string,
  step: number,
): { readonly ms: number; readonly long: boolean } {
  if (step === 0) return { ms: 0, long: false };
  const seed = `${LISTING_SWEEP_VERSION}:${portal}:${date}`;
  const every = between(`${seed}:every`, LONG_PAUSE_EVERY);
  const long = step % every === 0;
  return {
    ms: between(`${seed}:delay:${step}`, long ? LONG_PAUSE_MS : PAGE_DELAY_MS),
    long,
  };
}
