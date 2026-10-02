import type {
  OpenedReleasePlan,
  ReferenceDatasetRepository,
} from "../application/reference-dataset-repository";
import {
  isOpenRelease,
  type ReferenceRelease,
  type ReferenceRow,
} from "../domain/reference-release";

/**
 * Doble de test, no un modo de runtime. Ningún composition root lo construye.
 *
 * Sostiene las mismas invariantes que la base: una sola release vigente por
 * dataset y una supersesión que tiene que encontrar la vigente que el plan vio.
 */
export class InMemoryReferenceDatasetRepository implements ReferenceDatasetRepository {
  readonly storage = "in-memory-fixture" as const;

  private readonly releases: ReferenceRelease[] = [];
  private readonly rows = new Map<string, readonly ReferenceRow[]>();

  async listReleases(datasetId: string): Promise<readonly ReferenceRelease[]> {
    return this.releases
      .filter((release) => release.datasetId === datasetId)
      .map((release) => ({ ...release }));
  }

  async loadRows(releaseId: string): Promise<readonly ReferenceRow[]> {
    return [...(this.rows.get(releaseId) ?? [])];
  }

  async applyReleasePlan(plan: OpenedReleasePlan): Promise<void> {
    const open = this.releases.filter(
      (release) =>
        release.datasetId === plan.release.datasetId && isOpenRelease(release),
    );

    if (
      plan.supersedes === null
        ? open.length > 0
        : open[0]?.releaseId !== plan.supersedes.releaseId
    ) {
      throw new Error(
        `the open release of ${plan.release.datasetId} is not the one the plan saw`,
      );
    }

    if (plan.supersedes !== null) {
      const index = this.releases.indexOf(open[0]!);
      this.releases[index] = {
        ...open[0]!,
        supersededAt: plan.release.availableAt,
      };
    }

    this.releases.push({ ...plan.release });
    this.rows.set(plan.release.releaseId, [...plan.rows]);
  }
}
