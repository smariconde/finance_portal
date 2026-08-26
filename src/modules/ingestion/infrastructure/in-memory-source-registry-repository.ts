import {
  matchesSourceRegistryQuery,
  sourceRegistryListQuerySchema,
  type SourceRegistryRepository,
} from "@/modules/ingestion/application/source-registry-repository";
import {
  sourceRegistryEntrySchema,
  type SourceRegistryEntry,
} from "@/modules/ingestion/domain/source-registry-entry";

import { DEMO_SOURCE_REGISTRY } from "./demo-source-registry";

export function createInMemorySourceRegistryRepository(
  fixtureEntries: readonly SourceRegistryEntry[] = DEMO_SOURCE_REGISTRY,
): SourceRegistryRepository {
  const entries = fixtureEntries.map((entry) =>
    sourceRegistryEntrySchema.parse(entry),
  );

  return {
    storage: "in-memory-fixture",
    async findBySourceId(sourceId) {
      return entries.find((entry) => entry.sourceId === sourceId) ?? null;
    },
    async list(query) {
      const parsedQuery = sourceRegistryListQuerySchema.parse(query ?? {});

      return entries
        .filter((entry) => matchesSourceRegistryQuery(entry, parsedQuery))
        .slice(0, parsedQuery.limit);
    },
    async upsert(entry) {
      const parsedEntry = sourceRegistryEntrySchema.parse(entry);
      const index = entries.findIndex(
        (stored) => stored.sourceId === parsedEntry.sourceId,
      );

      if (index === -1) {
        entries.push(parsedEntry);
      } else {
        entries[index] = parsedEntry;
      }

      return parsedEntry;
    },
  };
}
