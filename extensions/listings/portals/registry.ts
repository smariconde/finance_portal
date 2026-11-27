import { remaxAdapter } from "./remax/remax-adapter";
import type { PortalAdapter } from "./types";

export { portalHostPermissions } from "./portal-matches";

/**
 * La única lista de portales (ADR 0089, Decisión 2). Agregar un portal es un
 * adapter y una línea acá; el manifest deriva de esta lista los
 * `host_permissions` y los `matches` del content script.
 */
export const PORTAL_ADAPTERS: readonly PortalAdapter[] = [remaxAdapter];

/** El adapter cuyo patrón cubre la URL, o `null`. */
export function adapterFor(url: string): PortalAdapter | null {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  return (
    PORTAL_ADAPTERS.find((adapter) =>
      adapter.matches.some((pattern) => matchesPattern(pattern, parsed)),
    ) ?? null
  );
}

/** Un patrón de `matches` de Chrome con esquema y host fijos. */
export function matchesPattern(pattern: string, url: URL): boolean {
  const parsed = /^(https):\/\/([a-z0-9.-]+)(\/.*)$/u.exec(pattern);
  if (parsed === null) return false;
  const [, scheme, host, path] = parsed;
  if (url.protocol !== `${scheme}:` || url.hostname !== host) return false;
  const pathPattern = new RegExp(
    `^${path.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replaceAll("*", ".*")}$`,
    "u",
  );
  return pathPattern.test(url.pathname);
}
