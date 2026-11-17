import type { SourceRegistryEntry } from "@/modules/ingestion/domain/source-registry-entry";

/**
 * Qué fuentes pueden llegar al asistente del owner por el MCP
 * ([ADR 0078](../../../../docs/architecture/adr/0078-owner-read-only-mcp.md),
 * sección 6).
 *
 * Cada sección de una respuesta declara las fuentes de las que sale. Si
 * alguna no admite `ownerAssistant` —o no tiene fila en el registro— la
 * sección sale de la respuesta con su motivo, nunca vacía ni en cero. Así una
 * fuente futura que lo prohíba se declara en el registro y se respeta sin
 * tocar las herramientas (`TM-15`).
 */
export const OWNER_ASSISTANT_POLICY_VERSION = "owner-assistant-1.0.0";

const READABLE: ReadonlySet<string> = new Set(["allowed", "owner_accepted"]);

export type WithheldSource = {
  readonly sourceId: string;
  /** `rights.ownerAssistant:<veredicto>` o `source_unregistered`. */
  readonly reason: string;
};

export function withheldSources(
  sourceIds: readonly string[],
  registry: readonly SourceRegistryEntry[],
): WithheldSource[] {
  return [...new Set(sourceIds)].sort().flatMap((sourceId) => {
    const entry = registry.find((candidate) => candidate.sourceId === sourceId);

    if (entry === undefined) {
      return [{ sourceId, reason: "source_unregistered" }];
    }

    return READABLE.has(entry.rights.ownerAssistant)
      ? []
      : [
          {
            sourceId,
            reason: `rights.ownerAssistant:${entry.rights.ownerAssistant}`,
          },
        ];
  });
}

/** Una sección que se entrega o sale con el motivo de cada fuente retenida. */
export type Gated<T> =
  | ({ readonly withheld: null } & T)
  | { readonly withheld: readonly WithheldSource[] };

export function gate<T extends object>(
  sourceIds: readonly string[],
  registry: readonly SourceRegistryEntry[],
  section: () => T,
): Gated<T> {
  const withheld = withheldSources(sourceIds, registry);

  return withheld.length > 0 ? { withheld } : { withheld: null, ...section() };
}
