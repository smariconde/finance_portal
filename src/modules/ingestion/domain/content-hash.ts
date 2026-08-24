import { createHash } from "node:crypto";

/**
 * Serialización canónica usada por el contrato point-in-time: el mismo contenido
 * lógico debe producir siempre el mismo texto y, por lo tanto, el mismo hash.
 *
 * Reglas: claves ordenadas por code unit, `undefined` se omite en objetos y se
 * rechaza en arrays, y los valores que no tienen representación estable
 * (no finitos, funciones, símbolos, `bigint`, fechas) fallan en vez de degradar
 * silenciosamente a `null` o a una cadena dependiente del entorno.
 */
export class CanonicalSerializationError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${message} (path: ${path || "$"})`);
    this.name = "CanonicalSerializationError";
    this.path = path || "$";
  }
}

function serialize(value: unknown, path: string): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        return raise("non finite numbers are not serializable", path);
      }
      // `Object.is` distingue -0 de 0; el hash no debe depender de ese signo.
      return JSON.stringify(value === 0 ? 0 : value);
    case "bigint":
      return raise("bigint is not serializable; use a decimal string", path);
    case "function":
    case "symbol":
    case "undefined":
      return raise(`${typeof value} is not serializable`, path);
    default:
      break;
  }

  if (Array.isArray(value)) {
    return `[${value
      .map((item, index) => serialize(item, `${path}[${index}]`))
      .join(",")}]`;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return raise(
      "only plain objects are serializable; convert instances first",
      path,
    );
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${serialize(entryValue, `${path}.${key}`)}`,
    )
    .join(",")}}`;
}

function raise(message: string, path: string): never {
  throw new CanonicalSerializationError(message, path);
}

export function canonicalize(value: unknown): string {
  return serialize(value, "$");
}

export function computeContentHash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}
