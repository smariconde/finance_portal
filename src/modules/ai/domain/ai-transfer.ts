import type { SourceRegistryEntry } from "@/modules/ingestion/domain/source-registry-entry";

/**
 * Qué puede viajar a un modelo
 * ([ADR 0033](../../../../docs/architecture/adr/0033-ai-layer-industry-resolution.md),
 * decisión 2).
 *
 * El armado de un prompt comprueba, por cada pieza de evidencia, el
 * `aiTransfer` de la fuente de la que salió. `allowed` es una fuente primaria
 * que lo cubre —la SEC autoriza copiar con cita—; `owner_accepted` es una
 * decisión del owner. Cualquier otro veredicto, o una fuente sin fila, niega el
 * prompt entero antes de reservar un centavo: Damodaran, Yahoo, Comafi y Caja
 * no viajan.
 */
export const AI_TRANSFER_POLICY_VERSION = "ai-transfer-1.0.0";

const TRANSFERABLE: ReadonlySet<string> = new Set([
  "allowed",
  "owner_accepted",
]);

export class AiTransferRefusedError extends Error {
  readonly sourceIds: readonly string[];

  constructor(sourceIds: readonly string[]) {
    super(
      `Evidence from ${sourceIds.join(", ")} may not be sent to a model (aiTransfer).`,
    );
    this.name = "AiTransferRefusedError";
    this.sourceIds = sourceIds;
  }
}

export function assertAiTransferable(
  sourceIds: readonly string[],
  registry: readonly SourceRegistryEntry[],
): void {
  const refused = [...new Set(sourceIds)].filter((sourceId) => {
    const entry = registry.find((candidate) => candidate.sourceId === sourceId);

    return entry === undefined || !TRANSFERABLE.has(entry.rights.aiTransfer);
  });

  if (refused.length > 0) {
    throw new AiTransferRefusedError(refused.sort());
  }
}
