import { z } from "zod";

/**
 * El pedido que la extensión manda a `POST /api/inmuebles/captura` (ADR 0089,
 * Decisión 2, «Envío»), compartido por el service worker y el servidor.
 *
 * Un lote es lo que salió de una o más páginas vistas: una ficha es una
 * captura, un listado de Remax son 24. El tope de 50 deja entrar dos listados
 * encolados sin que un pedido crezca sin límite.
 */
export const CAPTURE_REQUEST_VERSION = "listing-capture-request-1.0.0";

export const MAX_CAPTURES_PER_REQUEST = 50;

/**
 * El ID de la extensión desempaquetada, fijo porque el manifest declara su
 * `key` pública: Chrome lo deriva del SHA-256 de esa clave. El endpoint acepta
 * sólo `Origin: chrome-extension://<este ID>`; la clave privada no existe,
 * porque una extensión cargada desempaquetada no se firma.
 */
export const CAPTURE_EXTENSION_ID = "gmhcgoihkkneboibeanlkemldaalnikk";
export const CAPTURE_EXTENSION_ORIGIN = `chrome-extension://${CAPTURE_EXTENSION_ID}`;
export const CAPTURE_EXTENSION_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnu5HBv+Hh5nXTf/Rh9I//OnK8MntPxjCI7NK0HsnZWYiLf6wHGaGluDDmsI5lYOgFoWS3wcvUkD/W6qZ2ZYJzzKdnGAa1HgaoX3jL4762vHuswXs63wcXWzGZWbHBhi10VAgnj5ekV3cme2idRjxwYQKebhHn3xMphOGYSN5ImjZuwkppz73BXPVbJ738/iNgGlG8y61luj9jlfOWfODS1Nm5kNmHFY54kP/s5mdCM7pFaNzOstaaBfRBIJGSQpmFudkls6Za0UaVuIn/0FLy7470uyRe2BOw3Ykk2pSyDWRIj1abjZyQw99opCjX/+ArDgxC+x7bbGMhB+qJHbq8wIDAQAB";

export const captureRequestSchema = z.strictObject({
  contract: z.literal(CAPTURE_REQUEST_VERSION),
  /** La versión del adapter que leyó las páginas, para el registro. */
  adapterVersion: z.string().regex(/^[a-z0-9-]+-\d+\.\d+\.\d+$/u),
  captures: z.array(z.unknown()).min(1).max(MAX_CAPTURES_PER_REQUEST),
});

export type CaptureRequest = z.infer<typeof captureRequestSchema>;

/**
 * Qué pasó con cada captura, en el orden en que llegaron. `rejected` nombra
 * el campo y el motivo, nunca el valor.
 */
export const CAPTURE_OUTCOMES = [
  "new_listing",
  "revision",
  "seen",
  "out_of_order",
  "rejected",
] as const;

export type CaptureOutcome = (typeof CAPTURE_OUTCOMES)[number];

export const captureResponseSchema = z.strictObject({
  contract: z.literal(CAPTURE_REQUEST_VERSION),
  results: z.array(
    z.strictObject({
      outcome: z.enum(CAPTURE_OUTCOMES),
      issues: z.array(z.string()).optional(),
    }),
  ),
});

export type CaptureResponse = z.infer<typeof captureResponseSchema>;
