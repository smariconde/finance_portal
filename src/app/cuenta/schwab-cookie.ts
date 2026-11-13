import { SCHWAB_CALLBACK_PATH } from "@/modules/configuration/domain/config-health";
import { OAUTH_STATE_TTL_MS } from "@/modules/trading/domain/oauth-state";

/**
 * Cookie del `state` de OAuth (ADR 0076, sección 6): `httpOnly`, `Secure`,
 * `SameSite=Lax` —el callback llega por una navegación desde Schwab— y acotada
 * al path del callback, así que ninguna otra ruta la recibe.
 */
export const SCHWAB_STATE_COOKIE = "__Secure-schwab-oauth-state";

export const SCHWAB_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: SCHWAB_CALLBACK_PATH,
  maxAge: OAUTH_STATE_TTL_MS / 1000,
} as const;
