/**
 * Estado de la conexión con Schwab que ve el owner (ADR 0076, sección 6): el
 * login semanal no se puede evitar, así que se avisa con 24 horas.
 *
 * - `not_connected`: nunca se conectó, o se desconectó.
 * - `connected`: el refresh token vence en más de 24 horas.
 * - `expiring`: vence en 24 horas o menos; la superficie ofrece reconectar.
 * - `expired`: venció; sólo un login humano lo renueva.
 * - `renewal_failed` (`1.1.0`, `F11-05`): el último evento del token es una
 *   renovación fallida. Pasa cuando otro entorno se conectó: Schwab admite un
 *   solo login activo y el refresh token de este dejó de valer (medido el
 *   2026-11-14, `http_400`). Sin esto la página decía «Conectada» con la cuenta
 *   ya inaccesible.
 */
export const SCHWAB_CONNECTION_STATUS_VERSION =
  "schwab-connection-status-1.1.0";
export const SCHWAB_EXPIRY_WARNING_MS = 24 * 60 * 60 * 1000;

export type SchwabConnectionStatus =
  | { readonly status: "not_connected" }
  | {
      readonly status: "connected" | "expiring" | "expired" | "renewal_failed";
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
  /** El último evento del token: conexión, renovación o renovación fallida. */
  lastTokenEvent:
    "connected" | "access_refreshed" | "refresh_failed" | null = null,
): SchwabConnectionStatus {
  if (connection === null) return { status: "not_connected" };

  const expiresAt = Date.parse(connection.refreshExpiresAt);
  const warnFrom = expiresAt - SCHWAB_EXPIRY_WARNING_MS;
  const at = Date.parse(now);

  return {
    status:
      at >= expiresAt
        ? "expired"
        : lastTokenEvent === "refresh_failed"
          ? "renewal_failed"
          : at >= warnFrom
            ? "expiring"
            : "connected",
    connectedAt: connection.connectedAt,
    refreshExpiresAt: connection.refreshExpiresAt,
    warnFrom: new Date(warnFrom).toISOString(),
  };
}
