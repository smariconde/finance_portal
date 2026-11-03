import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type { AdrLegClose } from "../domain/declared-adr-pairs";

/** Lo que una pata guardó, con el instante en que su corrida lo registró. */
export type StoredAdrLegClose = AdrLegClose & {
  /** `recorded_at` de la corrida: lo que un corte `as_known` compara. */
  readonly recordedAt: string;
};

export type AdrLegWriteSummary = {
  readonly legId: string;
  readonly closesInserted: number;
  readonly closesDuplicate: number;
  /** Ruedas que ya estaban con otro cierre: no se pisan, se reportan. */
  readonly closesConflicting: readonly string[];
};

/** Techo de una lectura: diez pares, dos patas, 27 años de ruedas. */
export const MAX_LEG_CLOSES_PER_READ = 200_000;

export interface AdrPairRepository {
  writeLegCloses(
    closes: readonly AdrLegClose[],
    ingestionRunId: string,
  ): Promise<AdrLegWriteSummary>;
  /** Cierres de esas patas hasta `untilOn`, inclusive, ordenados por fecha. */
  listLegCloses(
    legIds: readonly string[],
    untilOn: string,
  ): Promise<readonly StoredAdrLegClose[]>;
}

export function selectAdrPairRepository(
  mode: AppMode,
  factories: { personal: () => AdrPairRepository },
): AdrPairRepository {
  return selectPersonalDependency(
    mode,
    "adr-pair-repository",
    factories.personal,
  );
}
