import type { ArgentinaIndicatorRepository } from "../application/argentina-indicator-repository";
import type { ArgentinaIndicatorVintage } from "../domain/argentina-indicator";
import type {
  ArgentinaDefinitionVersion,
  ArgentinaIndicatorPlan,
} from "../domain/plan-argentina-indicator";

type StoredVintage = ArgentinaIndicatorVintage & {
  supersededAt: string | null;
};

/**
 * Test double, not a runtime mode. It keeps the database invariants: one open
 * definition per indicator, one open revision per date, and a supersession that
 * must find the open row the plan saw. A failed apply leaves nothing behind.
 */
export class InMemoryArgentinaIndicatorRepository implements ArgentinaIndicatorRepository {
  readonly storage = "in-memory-fixture" as const;

  private definitions: ArgentinaDefinitionVersion[] = [];
  private observations: StoredVintage[] = [];

  async currentDefinition(
    indicatorId: string,
  ): Promise<ArgentinaDefinitionVersion | null> {
    return (
      this.definitions.find(
        (row) => row.indicatorId === indicatorId && row.supersededAt === null,
      ) ?? null
    );
  }

  async openObservations(
    indicatorId: string,
  ): Promise<readonly ArgentinaIndicatorVintage[]> {
    return this.read(indicatorId, true);
  }

  async allObservations(
    indicatorId: string,
  ): Promise<readonly ArgentinaIndicatorVintage[]> {
    return this.read(indicatorId, false);
  }

  async apply(
    plan: ArgentinaIndicatorPlan,
    indicatorId: string,
  ): Promise<void> {
    if (plan.guard.refused) throw new Error("mass_change_refused");
    const definitions = this.definitions.map((row) => ({ ...row }));
    const observations = this.observations.map((row) => ({ ...row }));
    if (plan.definition) {
      const next = plan.definition;
      if (next.indicatorId !== indicatorId) {
        throw new Error("definition_indicator_mismatch");
      }
      if (next.revision > 0) {
        const open = definitions.find(
          (row) =>
            row.indicatorId === indicatorId &&
            row.revision === next.revision - 1 &&
            row.supersededAt === null,
        );
        if (!open) throw new Error("definition_changed_during_apply");
        Object.assign(open, { supersededAt: next.availableAt });
      }
      definitions.push({ ...next });
    }
    for (const point of plan.observations) {
      if (point.indicatorId !== indicatorId) {
        throw new Error("observation_indicator_mismatch");
      }
      if (point.revision > 0) {
        const open = observations.find(
          (row) =>
            row.indicatorId === indicatorId &&
            row.periodOn === point.periodOn &&
            row.revision === point.revision - 1 &&
            row.supersededAt === null,
        );
        if (!open) throw new Error("observation_changed_during_apply");
        open.supersededAt = point.availableAt;
      } else if (
        observations.some(
          (row) =>
            row.indicatorId === indicatorId && row.periodOn === point.periodOn,
        )
      ) {
        throw new Error("observation_changed_during_apply");
      }
      observations.push({ ...point, supersededAt: null });
    }
    this.definitions = definitions;
    this.observations = observations;
  }

  private read(
    indicatorId: string,
    openOnly: boolean,
  ): readonly ArgentinaIndicatorVintage[] {
    return this.observations
      .filter(
        (row) =>
          row.indicatorId === indicatorId &&
          (!openOnly || row.supersededAt === null),
      )
      .sort(
        (a, b) =>
          a.periodOn.localeCompare(b.periodOn) || a.revision - b.revision,
      )
      .map((row) => {
        const vintage: Partial<StoredVintage> = { ...row };
        delete vintage.supersededAt;
        return vintage as ArgentinaIndicatorVintage;
      });
  }
}
