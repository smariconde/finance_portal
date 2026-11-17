import { createHash, timingSafeEqual } from "node:crypto";

/**
 * El permiso de la ruta `/mcp` ([ADR 0078](../../../../docs/architecture/adr/0078-owner-read-only-mcp.md),
 * sección 5): `MCP_ACCESS_TOKEN`, al menos 32 bytes aleatorios en base64url,
 * como imprime `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`.
 *
 * No es autenticación de aplicación: no hay usuarios ni sesiones. Es una
 * credencial de máquina para una sola ruta, separada del secreto de bypass de
 * Vercel, que abre el proyecto entero.
 */
export const MCP_ACCESS_TOKEN_VARIABLE = "MCP_ACCESS_TOKEN";

const MIN_TOKEN_BYTES = 32;
const BASE64URL = /^[A-Za-z0-9_-]{43,512}$/u;

export type McpAccessTokenResolution =
  | {
      readonly ok: true;
      /** SHA-256 del token: lo único que se compara, nunca el token. */
      readonly digest: Buffer;
    }
  | { readonly ok: false; readonly problem: "missing" | "invalid" };

/**
 * Lee el token del entorno. Un valor que no es base64url canónico o que
 * decodifica a menos de 32 bytes es `invalid`: nunca se rellena ni se acepta
 * una contraseña elegida a mano.
 */
export function parseMcpAccessToken(
  value: string | undefined,
): McpAccessTokenResolution {
  const trimmed = value?.trim() ?? "";

  if (trimmed.length === 0) return { ok: false, problem: "missing" };
  if (!BASE64URL.test(trimmed)) return { ok: false, problem: "invalid" };

  const bytes = Buffer.from(trimmed, "base64url");

  if (
    bytes.byteLength < MIN_TOKEN_BYTES ||
    bytes.toString("base64url") !== trimmed
  ) {
    return { ok: false, problem: "invalid" };
  }

  return { ok: true, digest: sha256(trimmed) };
}

/**
 * Si el header `Authorization` trae el token. Compara los SHA-256 con
 * `timingSafeEqual`, así que ni el largo ni el prefijo del valor se filtran
 * por tiempo. Un esquema que no es `Bearer` no coincide.
 */
export function bearerMatches(
  authorization: string | null,
  expectedDigest: Buffer,
): boolean {
  const match = /^Bearer ([^\s]{1,1024})$/u.exec(authorization?.trim() ?? "");
  const presented = sha256(match?.[1] ?? "");

  return timingSafeEqual(presented, expectedDigest) && match !== null;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
