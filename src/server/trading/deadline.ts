import "server-only";

/**
 * El techo de una lectura de trading dentro de una Server Action.
 *
 * Medido en Production el 2026-11-27: cuatro acciones de `/plan` quedaron
 * esperando hasta el timeout de Vercel (300 s) apenas entró un trade, y la
 * página se quedó en «Leyendo cuenta y reglas…» sin decir nada. Una lectura
 * normal tarda entre 0,3 y 5 s. Pasado el techo la acción responde una falla
 * nombrada y deja un log con su etiqueta, para saber cuál fue la que no volvió;
 * lo que quedó corriendo no escribe nada que la próxima lectura no repare (la
 * sincronización usa un reclamo con vencimiento).
 */
export class TradingDeadlineError extends Error {
  override readonly name = "TradingDeadlineError";

  constructor(readonly label: string) {
    super(`${label} exceeded its deadline`);
  }
}

export const TRADING_READ_DEADLINE_MS = 20_000;

export async function withTradingDeadline<T>(
  label: string,
  work: () => Promise<T>,
  ms: number = TRADING_READ_DEADLINE_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          console.error("trading read deadline", label, ms);
          reject(new TradingDeadlineError(label));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
