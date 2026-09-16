import { describe, expect, it, vi } from "vitest";

import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import {
  sourceRegistryEntrySchema,
  type SourceRegistryEntry,
  type SourceRights,
} from "@/modules/ingestion/domain/source-registry-entry";
import {
  ASSIGNMENTS_SOURCE_ID,
  CONSTITUENTS_SOURCE_ID,
  createLiveUniverseSource,
  type EgressFetch,
} from "@/modules/universe/application/live-universe-source";
import { UniverseSourceError } from "@/modules/universe/application/universe-source-provider";

const PINNED_URL = `https://raw.githubusercontent.com/datasets/s-and-p-500-companies/${"a".repeat(40)}/data/constituents.csv`;

const UNREVIEWED_RIGHTS: SourceRights = {
  personalUse: "unknown",
  automatedAccess: "unknown",
  rawStorage: "unknown",
  normalizedStorage: "unknown",
  derivedStorage: "unknown",
  publicDisplay: "unknown",
  export: "unknown",
  aiTransfer: "unknown",
};

const APPROVED_RIGHTS: SourceRights = {
  personalUse: "allowed",
  automatedAccess: "allowed",
  rawStorage: "unknown",
  normalizedStorage: "allowed",
  derivedStorage: "allowed",
  publicDisplay: "unknown",
  export: "unknown",
  aiTransfer: "unknown",
};

function entry(
  sourceId: string,
  overrides: Partial<SourceRegistryEntry> = {},
): SourceRegistryEntry {
  return sourceRegistryEntrySchema.parse({
    sourceId,
    displayName: sourceId,
    owner: "test",
    canonicalUrl: "https://example.test/",
    documentationUrls: [],
    datasets: ["test.dataset"],
    endpoints: [],
    authentication: "none",
    applicablePlan: null,
    rateLimit: null,
    attribution: null,
    expectedCadence: "test",
    freshnessTarget: "test",
    timezone: null,
    units: [],
    currencies: [],
    parserVersion: null,
    fixturePolicy: "test",
    fallbackSourceIds: [],
    rights: APPROVED_RIGHTS,
    technicalStatus: "integrated",
    approvalStatus: "approved_personal",
    reviewedAt: "2026-09-05T00:00:00.000Z",
    rightsReviewedAt: "2026-09-05T00:00:00.000Z",
    rightsReviewDueAt: null,
    reviewEvidence: [],
    retentionClasses: ["R2"],
    quotaPolicyId: null,
    ownerNotes: "",
    recordedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  });
}

const CSV = [
  "Symbol,Security,GICS Sector",
  "MMM,3M,Industrials",
  "BRK.B,Berkshire Hathaway,Financials",
].join("\n");

const JSON_PAYLOAD = JSON.stringify({
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [66740, "3M CO", "MMM", "NYSE"],
    [1067983, "BERKSHIRE HATHAWAY INC", "BRK-B", "NYSE"],
  ],
});

function egress(
  bodies: Record<string, string> = {
    [CONSTITUENTS_SOURCE_ID]: CSV,
    [ASSIGNMENTS_SOURCE_ID]: JSON_PAYLOAD,
  },
  status = 200,
): ReturnType<typeof vi.fn<EgressFetch>> {
  return vi.fn<EgressFetch>(async ({ sourceId }) => {
    const body = new TextEncoder().encode(bodies[sourceId] ?? "");

    return {
      status,
      body,
      byteLength: body.byteLength,
      fetchedAt: "2026-09-05T00:00:00.000Z",
    };
  });
}

function registry(
  entries: readonly SourceRegistryEntry[] = [
    entry(CONSTITUENTS_SOURCE_ID),
    entry(ASSIGNMENTS_SOURCE_ID),
  ],
) {
  return createInMemorySourceRegistryRepository(entries);
}

describe("createLiveUniverseSource", () => {
  it("loads both sources and reports their provenance", async () => {
    const fetch = egress();
    const source = createLiveUniverseSource({
      sourceRegistry: registry(),
      fetch,
      constituentsUrl: PINNED_URL,
    });

    const snapshot = await source.load();

    expect(snapshot.claims.map((claim) => claim.symbol)).toEqual([
      "MMM",
      "BRK.B",
    ]);
    expect(snapshot.assignments.map((a) => a.ticker)).toEqual(["MMM", "BRK-B"]);
    expect(snapshot.documents.map((document) => document.sourceId)).toEqual([
      CONSTITUENTS_SOURCE_ID,
      ASSIGNMENTS_SOURCE_ID,
    ]);
    expect(snapshot.documents[0].contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(snapshot.documents[0].rejectedRows).toBe(0);
  });

  it("refuses a source without approved rights before touching the network", async () => {
    // El orden es el control: una fuente sin rights row aprobada no genera
    // tráfico, no sólo deja de persistir (`TM-15`).
    const fetch = egress();
    const source = createLiveUniverseSource({
      sourceRegistry: registry([
        entry(CONSTITUENTS_SOURCE_ID, {
          approvalStatus: "rights_review_pending",
          rightsReviewedAt: null,
          rights: UNREVIEWED_RIGHTS,
        }),
        entry(ASSIGNMENTS_SOURCE_ID),
      ]),
      fetch,
      constituentsUrl: PINNED_URL,
    });

    await expect(source.load()).rejects.toBeInstanceOf(UniverseSourceError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("names which right is missing without echoing configuration", async () => {
    const source = createLiveUniverseSource({
      sourceRegistry: registry([
        entry(CONSTITUENTS_SOURCE_ID, {
          rights: { ...APPROVED_RIGHTS, automatedAccess: "restricted" },
        }),
        entry(ASSIGNMENTS_SOURCE_ID),
      ]),
      fetch: egress(),
      constituentsUrl: PINNED_URL,
    });

    await source.load().catch((error: unknown) => {
      expect((error as UniverseSourceError).code).toBe("rights_not_approved");
      expect((error as UniverseSourceError).message).toContain(
        "rights.automatedAccess",
      );
    });
    await expect(source.load()).rejects.toThrow();
  });

  it("asks only for the rights it actually uses", async () => {
    // El payload no se conserva, así que `rawStorage` no se pide. Pedir de más
    // convertiría el gate en una formalidad.
    const source = createLiveUniverseSource({
      sourceRegistry: registry([
        entry(CONSTITUENTS_SOURCE_ID, {
          rights: { ...APPROVED_RIGHTS, rawStorage: "restricted" },
        }),
        entry(ASSIGNMENTS_SOURCE_ID, {
          rights: { ...APPROVED_RIGHTS, rawStorage: "restricted" },
        }),
      ]),
      fetch: egress(),
      constituentsUrl: PINNED_URL,
    });

    await expect(source.load()).resolves.toBeDefined();
  });

  it("refuses a constituents URL that does not pin an immutable version", async () => {
    // Una lista servida desde `main` cambia bajo los pies y la corrida deja de
    // ser reproducible.
    const fetch = egress();

    for (const url of [
      "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv",
      "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/v1.0/data/constituents.csv",
      `https://raw.githubusercontent.com/datasets/s-and-p-500-companies/${"a".repeat(39)}/data/constituents.csv`,
      `https://raw.githubusercontent.com/datasets/other-repo/${"a".repeat(40)}/data/constituents.csv`,
    ]) {
      const source = createLiveUniverseSource({
        sourceRegistry: registry(),
        fetch,
        constituentsUrl: url,
      });

      await source.load().catch((error: unknown) => {
        expect((error as UniverseSourceError).code).toBe("source_not_pinned");
      });
      await expect(source.load()).rejects.toThrow();
    }

    // El pin se comprueba antes de mirar derechos y antes de la red.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("quarantines a broken document instead of publishing a thinner universe", async () => {
    const source = createLiveUniverseSource({
      sourceRegistry: registry(),
      fetch: egress({
        [CONSTITUENTS_SOURCE_ID]: "no,es,un,csv,de,constituyentes",
        [ASSIGNMENTS_SOURCE_ID]: JSON_PAYLOAD,
      }),
      constituentsUrl: PINNED_URL,
    });

    await source.load().catch((error: unknown) => {
      expect((error as UniverseSourceError).code).toBe("parser_broken");
      expect((error as UniverseSourceError).sourceId).toBe(
        CONSTITUENTS_SOURCE_ID,
      );
    });
    await expect(source.load()).rejects.toThrow();
  });

  it("quarantines an assignments payload that is not json", async () => {
    const source = createLiveUniverseSource({
      sourceRegistry: registry(),
      fetch: egress({
        [CONSTITUENTS_SOURCE_ID]: CSV,
        [ASSIGNMENTS_SOURCE_ID]: "<html>rate limited</html>",
      }),
      constituentsUrl: PINNED_URL,
    });

    await source.load().catch((error: unknown) => {
      expect((error as UniverseSourceError).code).toBe("parser_broken");
      expect((error as UniverseSourceError).sourceId).toBe(
        ASSIGNMENTS_SOURCE_ID,
      );
    });
    await expect(source.load()).rejects.toThrow();
  });

  it("refuses a non-200 response instead of parsing the error page", async () => {
    const source = createLiveUniverseSource({
      sourceRegistry: registry(),
      fetch: egress(undefined, 429),
      constituentsUrl: PINNED_URL,
    });

    await source.load().catch((error: unknown) => {
      expect((error as UniverseSourceError).code).toBe("unexpected_status");
    });
    await expect(source.load()).rejects.toThrow();
  });

  it("wraps an egress refusal instead of letting it escape untyped", async () => {
    const source = createLiveUniverseSource({
      sourceRegistry: registry(),
      fetch: vi.fn<EgressFetch>(async () => {
        throw new Error("Egress blocked (host_not_allowlisted)");
      }),
      constituentsUrl: PINNED_URL,
    });

    await source.load().catch((error: unknown) => {
      expect((error as UniverseSourceError).code).toBe("fetch_failed");
    });
    await expect(source.load()).rejects.toThrow();
  });

  it("refuses a source that is not registered at all", async () => {
    const source = createLiveUniverseSource({
      sourceRegistry: registry([entry(ASSIGNMENTS_SOURCE_ID)]),
      fetch: egress(),
      constituentsUrl: PINNED_URL,
    });

    await source.load().catch((error: unknown) => {
      expect((error as UniverseSourceError).code).toBe("source_not_registered");
    });
    await expect(source.load()).rejects.toThrow();
  });
});
