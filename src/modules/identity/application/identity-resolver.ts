import type { AppMode } from "@/modules/configuration/domain/config-health";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import type { IdentityGraph } from "../domain/identity-graph";
import {
  IDENTITY_RESOLUTION_RULE_VERSION,
  resolveIdentity,
  type IdentityLookup,
  type IdentityResolution,
} from "../domain/resolve-identity";

/**
 * Puerto de resolución de identidad. La regla es pura y vive en el dominio; el
 * puerto sólo decide de dónde sale el grafo, de modo que persistir identidad
 * (`F2-02`) no cambie la semántica ya probada.
 */
export interface IdentityResolver {
  readonly ruleVersion: string;
  resolve(
    lookup: IdentityLookup,
    query: PointInTimeQuery,
  ): Promise<IdentityResolution>;
}

export function createGraphIdentityResolver(
  loadGraph: () => IdentityGraph | Promise<IdentityGraph>,
): IdentityResolver {
  return {
    ruleVersion: IDENTITY_RESOLUTION_RULE_VERSION,
    async resolve(lookup, query) {
      return resolveIdentity(await loadGraph(), lookup, query);
    },
  };
}

/**
 * Identidad de cache: el modo forma parte de la clave, así que demo y personal
 * no pueden compartir una entrada resuelta (`TM-04`).
 */
export function createIdentityResolutionCacheIdentity(
  mode: AppMode,
  lookupKey: string,
  effectiveAt: string,
  knownAt: string | null,
): readonly ["identity-resolution", AppMode, string, string, string] {
  return [
    "identity-resolution",
    mode,
    lookupKey,
    effectiveAt,
    knownAt ?? "latest_restated",
  ];
}
