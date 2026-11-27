/**
 * Los patrones de cada portal, sin imports: los lee `wxt.config.ts` al armar
 * el manifest (su cargador no resuelve el alias `@/`) y el content script al
 * declarar dónde corre. El test del registro exige que cada adapter declare
 * exactamente estos.
 */
export const PORTAL_MATCHES = {
  "remax-ar": ["https://www.remax.com.ar/listings/*"],
} as const;

export const ALL_PORTAL_MATCHES: readonly string[] =
  Object.values(PORTAL_MATCHES).flat();

/** Los hosts que el manifest pide: los de los patrones, sin repetir. */
export function portalHostPermissions(): readonly string[] {
  return [
    ...new Set(
      ALL_PORTAL_MATCHES.map((pattern) => {
        const host = /^https:\/\/([a-z0-9.-]+)\//u.exec(pattern)?.[1];
        if (host === undefined)
          throw new Error(`bad match pattern: ${pattern}`);
        return `https://${host}/*`;
      }),
    ),
  ];
}
