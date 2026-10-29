import type { BusinessExcerpt } from "../domain/sec-business-excerpt";

export interface BusinessExcerptRepository {
  record(excerpt: BusinessExcerpt): Promise<void>;
  latestForEntities(
    legalEntityIds: readonly string[],
    knownAt: string,
  ): Promise<ReadonlyMap<string, BusinessExcerpt>>;
  hasFiling(
    legalEntityId: string,
    accessionNumber: string,
    extractVersion: string,
  ): Promise<boolean>;
}
