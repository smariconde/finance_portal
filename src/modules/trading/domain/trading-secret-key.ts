import { hkdfSync } from "node:crypto";

/**
 * La única clave propia del módulo de trading
 * ([ADR 0076](../../../../docs/architecture/adr/0076-schwab-read-only-account-trading-journal.md),
 * sección 5): `TRADING_SECRET_KEY`, 32 bytes en base64.
 *
 * Nunca se usa directo. HKDF-SHA256 deriva una subclave por uso, así que la
 * clave que cifra tokens no es la que firma el número de cuenta, y una
 * filtración de una subclave no expone la otra. El `info` lleva la versión: una
 * derivación nueva es una versión nueva, nunca otro resultado para la misma.
 */
export const TRADING_KEY_DERIVATION_VERSION = "trading-key-derivation-1.0.0";

export type TradingKeyUse = "schwab-token-encryption" | "account-hmac";

const KEY_BYTES = 32;
const SALT = Buffer.from("portal-financiero/trading", "utf8");
const BASE64 = /^[A-Za-z0-9+/]{43}=$/u;

export type TradingSecretKeyResolution =
  | { readonly ok: true; readonly key: Buffer }
  | { readonly ok: false; readonly problem: "missing" | "invalid" };

/**
 * Lee la clave del entorno. Se espera exactamente lo que imprime
 * `openssl rand -base64 32`: un valor que no decodifica a 32 bytes es
 * `invalid`, nunca una clave rellenada o truncada.
 */
export function parseTradingSecretKey(
  value: string | undefined,
): TradingSecretKeyResolution {
  const trimmed = value?.trim() ?? "";

  if (trimmed.length === 0) return { ok: false, problem: "missing" };
  if (!BASE64.test(trimmed)) return { ok: false, problem: "invalid" };

  const key = Buffer.from(trimmed, "base64");

  if (key.byteLength !== KEY_BYTES || key.toString("base64") !== trimmed) {
    return { ok: false, problem: "invalid" };
  }

  return { ok: true, key };
}

export function deriveTradingSubkey(
  masterKey: Buffer,
  use: TradingKeyUse,
): Buffer {
  if (masterKey.byteLength !== KEY_BYTES) {
    throw new Error("The trading master key must be 32 bytes.");
  }

  return Buffer.from(
    hkdfSync(
      "sha256",
      masterKey,
      SALT,
      Buffer.from(`${TRADING_KEY_DERIVATION_VERSION}:${use}`, "utf8"),
      KEY_BYTES,
    ),
  );
}
