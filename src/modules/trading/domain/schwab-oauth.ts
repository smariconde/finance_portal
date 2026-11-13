import { z } from "zod";

/**
 * OAuth 2 de la Trader API de Schwab (ADR 0076, sección 6), sin red: arma el
 * pedido y lee la respuesta. Quien lo manda es la puerta de egress, que agrega
 * la autenticación Basic de la app; nada acá ve la app key ni el secret.
 */
export const SCHWAB_OAUTH_VERSION = "schwab-oauth-1.0.0";

export const SCHWAB_AUTHORIZE_URL =
  "https://api.schwabapi.com/v1/oauth/authorize";
export const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";

/**
 * El refresh token vive 7 días desde la autorización y Schwab no lo extiende:
 * renovar el access token no corre su vencimiento, y un refresh token con otro
 * valor tampoco prueba que se haya extendido. Por eso el vencimiento se fija al
 * autorizar y no se mueve hasta el próximo login (`schwab-refresh-lifetime-1.0.0`).
 */
export const SCHWAB_REFRESH_LIFETIME_VERSION = "schwab-refresh-lifetime-1.0.0";
export const SCHWAB_REFRESH_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** Se renueva el access token cuando le queda menos que esto. */
export const SCHWAB_ACCESS_REFRESH_MARGIN_MS = 60 * 1000;

/** Una app key de Schwab: el `client_id` que va en la URL de autorización. */
const appKeySchema = z.string().regex(/^[A-Za-z0-9]{16,64}$/u);

export function buildSchwabAuthorizeUrl(input: {
  readonly appKey: string;
  readonly callbackUrl: string;
  readonly state: string;
}): string {
  const url = new URL(SCHWAB_AUTHORIZE_URL);
  url.searchParams.set("client_id", appKeySchema.parse(input.appKey));
  url.searchParams.set("redirect_uri", input.callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  return url.toString();
}

/** El código que Schwab devuelve al callback. */
const authorizationCodeSchema = z
  .string()
  .min(8)
  .max(1024)
  .regex(/^[\x21-\x7e]+$/u);

export function parseAuthorizationCode(value: string | null): string | null {
  const parsed = authorizationCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function authorizationCodeForm(input: {
  readonly code: string;
  readonly callbackUrl: string;
}): Uint8Array {
  return new TextEncoder().encode(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.callbackUrl,
    }).toString(),
  );
}

export function refreshTokenForm(refreshToken: string): Uint8Array {
  return new TextEncoder().encode(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  );
}

const tokenValueSchema = z
  .string()
  .min(8)
  .max(4096)
  .regex(/^[\x21-\x7e]+$/u);

/**
 * Respuesta del endpoint de token, cerrada (`TM-05`): un campo que Schwab
 * agregue o quite rechaza la respuesta por nombre en vez de pasar en silencio.
 * `id_token` es opcional porque la renovación puede no traerlo.
 */
const tokenResponseSchema = z
  .object({
    access_token: tokenValueSchema,
    refresh_token: tokenValueSchema,
    token_type: z.literal("Bearer"),
    expires_in: z.number().int().min(60).max(86_400),
    scope: z.string().max(256),
    id_token: z.string().max(8192).optional(),
  })
  .strict();

export type SchwabTokenGrant = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: string;
};

export class SchwabTokenResponseError extends Error {
  readonly code: "not_json" | "unexpected_shape";

  constructor(code: "not_json" | "unexpected_shape", detail?: string) {
    // `detail` es la ruta del campo, nunca su valor.
    super(
      detail === undefined
        ? `Schwab token response rejected (${code}).`
        : `Schwab token response rejected (${code}): ${detail}.`,
    );
    this.name = "SchwabTokenResponseError";
    this.code = code;
  }
}

export function parseSchwabTokenResponse(
  body: Uint8Array,
  receivedAt: string,
): SchwabTokenGrant {
  let json: unknown;

  try {
    json = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new SchwabTokenResponseError("not_json");
  }

  const parsed = tokenResponseSchema.safeParse(json);

  if (!parsed.success) {
    throw new SchwabTokenResponseError(
      "unexpected_shape",
      parsed.error.issues
        .map((issue) =>
          issue.code === "unrecognized_keys"
            ? `unrecognized:${issue.keys.join(",")}`
            : issue.path.join("."),
        )
        .join("; "),
    );
  }

  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    accessExpiresAt: new Date(
      Date.parse(receivedAt) + parsed.data.expires_in * 1000,
    ).toISOString(),
  };
}

export function refreshExpiresAtFrom(authorizedAt: string): string {
  return new Date(
    Date.parse(authorizedAt) + SCHWAB_REFRESH_LIFETIME_MS,
  ).toISOString();
}

export function accessNeedsRefresh(
  accessExpiresAt: string,
  now: string,
): boolean {
  return (
    Date.parse(accessExpiresAt) - Date.parse(now) <
    SCHWAB_ACCESS_REFRESH_MARGIN_MS
  );
}
