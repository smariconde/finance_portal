/**
 * Lo que se puede loguear de un error de la cuenta (`TM-02`): su tipo y, si lo
 * trae, el código del driver o del sistema —`ECONNREFUSED`, un SQLSTATE como
 * `28P01`—, también el de su `cause`. Nunca el mensaje, que puede traer un host,
 * un puerto, SQL o un token.
 */
const CODE = /^[A-Za-z0-9_]{1,40}$/u;

function codeOf(error: unknown): string | null {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return null;
  }
  const code = String((error as { code: unknown }).code);
  return CODE.test(code) ? code : null;
}

export function safeErrorSummary(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const codes = [codeOf(error), codeOf(error.cause)].filter(
    (code): code is string => code !== null,
  );
  return codes.length === 0 ? error.name : `${error.name} ${codes.join(" ")}`;
}
