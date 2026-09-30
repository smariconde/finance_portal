/**
 * ¿La última rueda es un cierre? (`settled-session-1.0.0`, `F7-05`).
 *
 * Una fila cruda es inmutable ([ADR 0026](../../../../docs/architecture/adr/0026-daily-prices-source.md)),
 * así que guardar un precio intradía como cierre no se arregla con la próxima
 * descarga: el cierre real aparece como «pasado cambiado» y no se pisa. La barra
 * de hoy lleva el mismo timestamp —su apertura— esté la rueda abierta o cerrada,
 * y lo único que las distingue es la sesión que declara la respuesta.
 *
 * La última rueda es definitiva sólo si su fecha es la de esa sesión y:
 *
 * - el último precio está sellado **después** del fin de la sesión regular, y
 * - la descarga ocurrió al menos `SETTLEMENT_DELAY_MINUTES` después de ese fin.
 *
 * Medido el 2026-09-30 sobre `^SP500TR`: la sesión termina a las 20:00 UTC y el
 * índice total return se publica a las 20:38 UTC. Una hora cubre ese cálculo y
 * la subasta de cierre de una acción. Sin sesión declarada, la regla es la
 * conservadora: la rueda con la fecha de mercado de la descarga no se guarda.
 */
export const SETTLED_SESSION_RULE_VERSION = "settled-session-1.0.0";
export const SETTLEMENT_DELAY_MINUTES = 60;

export type SessionBar = { readonly marketDate: string };

export type SessionEvidence = {
  readonly session: {
    readonly marketDate: string;
    readonly regularEnd: string;
    readonly lastPriceAt: string | null;
  } | null;
  readonly gmtOffsetSeconds: number;
};

export type SettledBars<TBar extends SessionBar> = {
  readonly bars: readonly TBar[];
  /** Fechas que se dejaron afuera por estar en curso. */
  readonly unsettled: readonly string[];
};

export function settleSession<TBar extends SessionBar>(
  bars: readonly TBar[],
  evidence: SessionEvidence,
  fetchedAt: string,
): SettledBars<TBar> {
  const fetchedMs = Date.parse(fetchedAt);
  const { session } = evidence;

  let openDate: string | null;

  if (session === null) {
    openDate = new Date(fetchedMs + evidence.gmtOffsetSeconds * 1000)
      .toISOString()
      .slice(0, 10);
  } else {
    const endMs = Date.parse(session.regularEnd);
    const priced =
      session.lastPriceAt !== null && Date.parse(session.lastPriceAt) >= endMs;
    const waited = fetchedMs >= endMs + SETTLEMENT_DELAY_MINUTES * 60_000;

    openDate = priced && waited ? null : session.marketDate;
  }

  if (openDate === null) {
    return { bars, unsettled: [] };
  }

  return {
    bars: bars.filter((bar) => bar.marketDate < openDate),
    unsettled: bars
      .filter((bar) => bar.marketDate >= openDate)
      .map((bar) => bar.marketDate),
  };
}
