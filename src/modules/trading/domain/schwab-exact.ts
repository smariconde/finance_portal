import { z } from "zod";

import {
  canonicalDecimalFromJsonNumber,
  ExactJsonNumber,
  ExactJsonUnavailableError,
  parseJsonPreservingNumbers,
} from "@/modules/fundamentals/domain/exact-json";

/**
 * Piezas comunes de los parsers de Schwab (ADR 0076, `TM-05`). Todo número del
 * cable se lee de su texto fuente: un saldo que pasa por `double` es un saldo
 * inventado. Los rechazos son códigos cerrados con, a lo sumo, el camino de
 * claves donde falló; nunca un valor.
 */
export type SchwabParseFailure = {
  readonly ok: false;
  readonly code: string;
  /** Camino de claves del primer problema (`securitiesAccount.type`), sin valores. */
  readonly path: string | null;
};

export type SchwabParseResult<T> =
  { readonly ok: true; readonly value: T } | SchwabParseFailure;

export function failure(
  code: string,
  path: string | null = null,
): SchwabParseFailure {
  return { ok: false, code, path };
}

/** El cuerpo como JSON con cada número como texto, o `null` si no es JSON. */
export function readExactJson(body: Uint8Array): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }

  try {
    return parseJsonPreservingNumbers(text);
  } catch (error) {
    if (error instanceof ExactJsonUnavailableError) throw error;
    return null;
  }
}

/** Un importe exacto: el texto fuente del número, canónico y sin exponente. */
export const exactDecimalSchema = z
  .instanceof(ExactJsonNumber)
  .transform((value, context) => {
    const canonical = canonicalDecimalFromJsonNumber(value.source);
    if (canonical === null) {
      context.addIssue({ code: "custom", message: "not a decimal" });
      return z.NEVER;
    }
    return canonical;
  });

/** Un entero exacto (cantidades de veces, epoch en milisegundos). */
export const exactIntegerSchema = exactDecimalSchema.transform(
  (value, context) => {
    if (!/^-?\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) {
      context.addIssue({ code: "custom", message: "not a safe integer" });
      return z.NEVER;
    }
    return Number(value);
  },
);

/** El camino de la primera falla, sólo con claves e índices. */
export function issuePath(error: z.ZodError, prefix = ""): string {
  const issue = error.issues[0];
  const keys =
    issue?.code === "unrecognized_keys"
      ? [...issue.path, issue.keys[0] ?? ""]
      : (issue?.path ?? []);
  const path = keys
    .map((key) => (typeof key === "number" ? `[${key}]` : String(key)))
    .join(".")
    .replace(/\.\[/gu, "[");
  const full =
    prefix.length > 0 && path.length > 0 ? `${prefix}.${path}` : prefix || path;
  return /^[A-Za-z0-9_.<>[\]]{0,160}$/u.test(full) ? full : "unprintable";
}
