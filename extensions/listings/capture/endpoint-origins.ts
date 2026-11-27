/**
 * Los únicos lugares a los que la extensión puede mandar capturas: el portal
 * en Production y el servidor local (`pnpm dev`, `pnpm walkthrough`). El
 * popup sólo acepta una URL base con uno de estos orígenes.
 */
export const CAPTURE_ENDPOINT_ORIGINS = [
  "https://finance-portal-flame.vercel.app/*",
  "http://127.0.0.1/*",
  "http://localhost/*",
] as const;

export const CAPTURE_ENDPOINT_PATH = "/api/inmuebles/captura";

/** La URL base es un origen declarado, sin ruta, consulta ni credenciales. */
export function isDeclaredEndpointBase(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.username !== "" || url.password !== "") return false;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "")
    return false;
  return CAPTURE_ENDPOINT_ORIGINS.some((pattern) => {
    const origin = pattern.slice(0, -2);
    const declared = new URL(origin);
    return (
      url.protocol === declared.protocol &&
      url.hostname === declared.hostname &&
      (declared.protocol === "https:" ? url.port === "" : true)
    );
  });
}
