import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type { ArgentinaIndicatorVintage } from "../domain/argentina-indicator";
import type {
  ArgentinaDefinitionVersion,
  ArgentinaIndicatorPlan,
} from "../domain/plan-argentina-indicator";

export interface ArgentinaIndicatorRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  currentDefinition(
    indicatorId: string,
  ): Promise<ArgentinaDefinitionVersion | null>;
  openObservations(
    indicatorId: string,
  ): Promise<readonly ArgentinaIndicatorVintage[]>;
  allObservations(
    indicatorId: string,
  ): Promise<readonly ArgentinaIndicatorVintage[]>;
  apply(plan: ArgentinaIndicatorPlan, indicatorId: string): Promise<void>;
}

export function selectArgentinaIndicatorRepository(
  mode: AppMode,
  factories: { personal: () => ArgentinaIndicatorRepository },
): ArgentinaIndicatorRepository {
  return selectPersonalDependency(
    mode,
    "argentina-indicator-repository",
    factories.personal,
  );
}
