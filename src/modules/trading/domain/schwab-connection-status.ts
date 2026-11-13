/**
 * Estado de la conexión con Schwab que ve el owner (ADR 0076, sección 6): el
 * login semanal no se puede evitar, así que se avisa con 24 horas.
 *
 * - `not_connected`: nunca se conectó, o se desconectó.
 * - `connected`: el refresh token vence en más de 24 horas.
 * - `expiring`: vence en 24 horas o menos; la superficie ofrece reconectar.
 * - `expired`: venció; sólo un login humano lo renueva.
 */
export const SCHWAB_CONNECTION_STATUS_VERSION =
  "schwab-connection-status-1.0.0";
export const SCHWAB_EXPIRY_WARNING_MS = 24 * 60 * 60 * 1000;

export type SchwabConnectionStatus =
  | { readonly status: "not_connected" }
  | {
      readonly status: "connected" | "expiring" | "expired";
      readonly connectedAt: string;
      readonly refreshExpiresAt: string;
      readonly warnFrom: string;
    };

export function schwabConnectionStatus(
  connection: {
    readonly connectedAt: string;
    readonly refreshExpiresAt: string;
  } | null,
  now: string,
): SchwabConnectionStatus {
  if (connection === null) return { status: "not_connected" };

  const expiresAt = Date.parse(connection.refreshExpiresAt);
  const warnFrom = expiresAt - SCHWAB_EXPIRY_WARNING_MS;
  const at = Date.parse(now);

  return {
    status:
      at >= expiresAt ? "expired" : at >= warnFrom ? "expiring" : "connected",
    connectedAt: connection.connectedAt,
    refreshExpiresAt: connection.refreshExpiresAt,
    warnFrom: new Date(warnFrom).toISOString(),
  };
}
