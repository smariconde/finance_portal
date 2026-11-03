import type {
  MacroSeriesRepository,
  ObservationWrite,
} from "../application/macro-series-repository";
import {
  isOpenDefinition,
  sameBasis,
  type CatalogPlan,
  type SeriesDefinition,
} from "../domain/series-definition";
import {
  isOpenObservation,
  type MacroSeries,
  type SeriesObservation,
} from "../domain/series-observation";

/**
 * Doble de test, no un modo de runtime. Ningún composition root lo construye.
 *
 * Sostiene las mismas invariantes que la base: una definición vigente por serie,
 * una revisión vigente por fecha y una supersesión que tiene que encontrar la
 * vigente que el plan vio. Una escritura que falla no deja nada a medias.
 */
export class InMemoryMacroSeriesRepository implements MacroSeriesRepository {
  readonly storage = "in-memory-fixture" as const;

  private definitions: SeriesDefinition[] = [];
  private readonly series = new Map<string, MacroSeries>();
  private observations: SeriesObservation[] = [];

  async listOpenDefinitions(
    sourceId: string,
  ): Promise<readonly SeriesDefinition[]> {
    return this.definitions
      .filter(
        (definition) =>
          definition.sourceId === sourceId && isOpenDefinition(definition),
      )
      .map((definition) => ({ ...definition }));
  }

  async listSeriesDefinitions(
    seriesKey: string,
  ): Promise<readonly SeriesDefinition[]> {
    return this.definitions
      .filter((definition) => definition.seriesKey === seriesKey)
      .map((definition) => ({ ...definition }));
  }

  async applyCatalogPlan(plan: CatalogPlan): Promise<void> {
    const next = this.definitions.map((definition) => ({ ...definition }));
    const openOf = (seriesKey: string) =>
      next.findIndex(
        (definition) =>
          definition.seriesKey === seriesKey && isOpenDefinition(definition),
      );

    for (const { previous, next: replacement } of plan.superseded) {
      const index = openOf(previous.seriesKey);

      if (index < 0 || next[index]!.definitionId !== previous.definitionId) {
        throw new Error(
          `the open definition of ${previous.seriesKey} is not the one the plan saw`,
        );
      }

      next[index] = { ...next[index]!, supersededAt: replacement.availableAt };
      next.push({ ...replacement });
    }

    for (const withdrawn of plan.withdrawn) {
      const index = openOf(withdrawn.seriesKey);

      if (index < 0 || next[index]!.definitionId !== withdrawn.definitionId) {
        throw new Error(
          `the open definition of ${withdrawn.seriesKey} is not the one the plan saw`,
        );
      }

      next[index] = { ...next[index]!, validTo: withdrawn.validTo };
    }

    for (const opened of plan.opened) {
      if (openOf(opened.seriesKey) >= 0) {
        throw new Error(`${opened.seriesKey} already has an open definition`);
      }

      next.push({ ...opened });
    }

    for (const definition of [
      ...plan.opened,
      ...plan.superseded.map((pair) => pair.next),
    ]) {
      if (!this.series.has(definition.seriesKey)) {
        this.series.set(definition.seriesKey, {
          seriesKey: definition.seriesKey,
          sourceId: definition.sourceId,
          externalId: definition.externalId,
          basis: null,
        });
      }
    }

    this.definitions = next;
  }

  async findSeries(seriesKey: string): Promise<MacroSeries | null> {
    const series = this.series.get(seriesKey);

    return series === undefined ? null : { ...series };
  }

  async listOpenObservations(
    seriesKey: string,
    fromPeriodOn: string | null,
  ): Promise<readonly SeriesObservation[]> {
    return this.observations
      .filter(
        (observation) =>
          observation.seriesKey === seriesKey &&
          isOpenObservation(observation) &&
          (fromPeriodOn === null || observation.periodOn >= fromPeriodOn),
      )
      .map((observation) => ({ ...observation }));
  }

  async listObservations(
    seriesKey: string,
  ): Promise<readonly SeriesObservation[]> {
    return this.observations
      .filter((observation) => observation.seriesKey === seriesKey)
      .map((observation) => ({ ...observation }));
  }

  async applyObservations(write: ObservationWrite): Promise<void> {
    const series = this.series.get(write.seriesKey);

    if (series === undefined) {
      throw new Error(`${write.seriesKey} is not a recorded series`);
    }

    if (series.basis !== null && !sameBasis(series.basis, write.basis)) {
      throw new Error(`${write.seriesKey} was pinned to another basis`);
    }

    const next = this.observations.map((observation) => ({ ...observation }));

    for (const revision of write.revisions) {
      const index = next.findIndex(
        (observation) =>
          observation.seriesKey === write.seriesKey &&
          observation.periodOn === revision.periodOn &&
          isOpenObservation(observation),
      );

      if (
        revision.revision === 0
          ? index >= 0
          : next[index]?.revision !== revision.revision - 1
      ) {
        throw new Error(
          `the open revision of ${write.seriesKey} at ${revision.periodOn} is not the one the plan saw`,
        );
      }

      if (index >= 0) {
        next[index] = { ...next[index]!, supersededAt: revision.availableAt };
      }

      next.push({ ...revision });
    }

    this.observations = next;
    this.series.set(write.seriesKey, { ...series, basis: write.basis });
  }
}
