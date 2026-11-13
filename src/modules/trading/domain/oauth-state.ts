import { createHash, randomBytes } from "node:crypto";

/**
 * El `state` de la conexión con Schwab (ADR 0076, sección 6): 32 bytes
 * aleatorios, vida de 10 minutos y un solo uso.
 *
 * Viaja en claro en dos lugares —la cookie `httpOnly` y el query del callback—
 * y en la base sólo se guarda su SHA-256: quien lea la tabla no puede armar un
 * callback válido.
 */
export const OAUTH_STATE_VERSION = "schwab-oauth-state-1.0.0";
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const STATE_BYTES = 32;
/** 32 bytes en base64url, sin relleno. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type OAuthState = {
  readonly state: string;
  readonly hash: Buffer;
};

export function createOAuthState(
  random: Buffer = randomBytes(STATE_BYTES),
): OAuthState {
  if (random.byteLength !== STATE_BYTES) {
    throw new Error("The OAuth state needs 32 random bytes.");
  }

  const state = random.toString("base64url");
  return { state, hash: createHash("sha256").update(state).digest() };
}

/**
 * Hash de un `state` recibido, o `null` si no tiene la forma de uno emitido. Un
 * valor así no llega a la base: se rechaza antes de buscarlo.
 */
export function hashOAuthState(
  value: string | null | undefined,
): Buffer | null {
  if (typeof value !== "string" || !STATE_PATTERN.test(value)) return null;
  return createHash("sha256").update(value).digest();
}
