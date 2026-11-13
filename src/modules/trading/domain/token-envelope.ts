import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Sobre de un token de Schwab en reposo (ADR 0076, sección 5): AES-256-GCM con
 * un IV aleatorio de 12 bytes por sellado.
 *
 * Formato, en un solo `bytea`: `[formato (1)][IV (12)][tag (16)][cifrado]`. El
 * byte de formato permite cambiar el sobre sin adivinar cómo se escribió uno
 * viejo.
 *
 * El AAD ata el sobre a su uso —`schwab:access` o `schwab:refresh`—: un sobre
 * copiado de una columna a la otra no abre, así que nadie con acceso de
 * escritura a la base puede hacer pasar un refresh token por un access token.
 */
export const TOKEN_ENVELOPE_VERSION = "schwab-token-envelope-1.0.0";

export type TokenKind = "access" | "refresh";

const FORMAT = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

export class TokenEnvelopeError extends Error {
  readonly code: "format" | "authentication";

  constructor(code: "format" | "authentication") {
    // Nunca el contenido: ni el sobre ni lo que debería haber adentro.
    super(`The token envelope could not be opened (${code}).`);
    this.name = "TokenEnvelopeError";
    this.code = code;
  }
}

function aadOf(kind: TokenKind): Buffer {
  return Buffer.from(`schwab:${kind}`, "utf8");
}

export function sealToken(
  key: Buffer,
  kind: TokenKind,
  token: string,
  iv: Buffer = randomBytes(IV_BYTES),
): Buffer {
  if (iv.byteLength !== IV_BYTES) throw new Error("The IV must be 12 bytes.");

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadOf(kind));
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  return Buffer.concat([
    Buffer.from([FORMAT]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

export function openToken(
  key: Buffer,
  kind: TokenKind,
  envelope: Uint8Array,
): string {
  const bytes = Buffer.from(envelope);

  if (bytes.byteLength <= HEADER_BYTES || bytes[0] !== FORMAT) {
    throw new TokenEnvelopeError("format");
  }

  const iv = bytes.subarray(1, 1 + IV_BYTES);
  const tag = bytes.subarray(1 + IV_BYTES, HEADER_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aadOf(kind));
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([
      decipher.update(bytes.subarray(HEADER_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new TokenEnvelopeError("authentication");
  }
}
