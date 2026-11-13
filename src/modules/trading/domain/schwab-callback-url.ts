/**
 * Dónde vuelve Schwab después del login (ADR 0076, sección 6).
 *
 * - `route`: `https://<host>/cuenta/schwab/callback`, el callback del portal.
 * - `local_root`: `https://127.0.0.1:<puerto>` en la raíz, el callback que la
 *   app de Schwab del owner ya tenía registrado para su Flask. Sirve sólo fuera
 *   de Vercel, para conectar en local sin esperar la re-aprobación de la app
 *   (`F11-03`): la raíz reenvía `code`, `state` y `error` al callback real.
 *
 * Schwab exige que la URL coincida exacta con una registrada, así que el
 * `redirect_uri` que se manda es siempre este valor, nunca el path al que se
 * reenvía.
 */
export const SCHWAB_CALLBACK_PATH = "/cuenta/schwab/callback";

export type SchwabCallbackForm = "route" | "local_root";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function schwabCallbackForm(
  value: string | undefined,
  options: { readonly onVercel: boolean },
): SchwabCallbackForm | null {
  let url: URL;

  try {
    url = new URL(value?.trim() ?? "");
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return null;
  }

  if (url.pathname === SCHWAB_CALLBACK_PATH) return "route";

  if (
    url.pathname === "/" &&
    LOCAL_HOSTS.has(url.hostname) &&
    !options.onVercel
  ) {
    return "local_root";
  }

  return null;
}

const FORWARDED = ["code", "state", "error"] as const;
const MAX_PARAMETER_LENGTH = 1024;

/**
 * El path del callback real con los tres parámetros que Schwab manda, y nada
 * más. `null` si no hay `state` —no es una vuelta de Schwab— o si un valor
 * excede lo que un código o un `state` pueden medir.
 */
export function forwardedCallbackPath(
  query: Readonly<Record<string, string | string[] | undefined>>,
): string | null {
  const forwarded = new URLSearchParams();

  for (const name of FORWARDED) {
    const value = query[name];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length > MAX_PARAMETER_LENGTH) {
      return null;
    }
    forwarded.set(name, value);
  }

  if (!forwarded.has("state")) return null;
  if (!forwarded.has("code") && !forwarded.has("error")) return null;

  return `${SCHWAB_CALLBACK_PATH}?${forwarded.toString()}`;
}
