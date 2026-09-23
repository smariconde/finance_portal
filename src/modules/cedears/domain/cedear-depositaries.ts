/**
 * Los dos emisores de CEDEAR que la CNV autoriza hoy
 * ([ADR 0027](../../../../docs/architecture/adr/0027-cedear-registry-sources.md),
 * decisión 4).
 *
 * El depositario es el **emisor del CEDEAR**, y por eso es una entidad legal del
 * grafo: sin ella, la security del CEDEAR no tendría emisor y el modelo de
 * identidad obligaría a colgarla del subyacente, que es justamente fusionar los
 * dos instrumentos.
 *
 * El ID es fijo y declarado acá. Ningún identificador que el proyecto ya tenga
 * nombra a estos bancos —no tienen CIK—, e inventarles uno para poder buscarlos
 * sería peor que declarar su identidad donde se lee. Un tercer emisor es una
 * fuente nueva con su ADR, no una fila más en esta lista.
 */
export type CedearDepositary = {
  readonly sourceId: string;
  readonly datasetId: string;
  readonly legalEntityId: string;
  readonly legalName: string;
  readonly entityType: "bank" | "depositary";
};

export const COMAFI_DEPOSITARY: CedearDepositary = Object.freeze({
  sourceId: "comafi-cedear",
  datasetId: "comafi.cedear-programs",
  legalEntityId: "55cbb653-211f-4552-a8ca-76376289c579",
  legalName: "Banco Comafi S.A.",
  entityType: "bank",
});

export const CAJA_VALORES_DEPOSITARY: CedearDepositary = Object.freeze({
  sourceId: "caja-valores-cedear",
  datasetId: "cajval.cedear-programs",
  legalEntityId: "54f023f5-b613-48d9-b7fe-bdeb99765658",
  legalName: "Caja de Valores S.A.",
  entityType: "depositary",
});

export const CEDEAR_DEPOSITARIES: readonly CedearDepositary[] = Object.freeze([
  COMAFI_DEPOSITARY,
  CAJA_VALORES_DEPOSITARY,
]);

export function findCedearDepositary(
  sourceId: string,
): CedearDepositary | null {
  return (
    CEDEAR_DEPOSITARIES.find(
      (depositary) => depositary.sourceId === sourceId,
    ) ?? null
  );
}
