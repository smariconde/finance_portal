import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import { createInMemorySourceDocumentRepository } from "@/modules/observations/infrastructure/in-memory-source-document-repository";
import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import { ASSIGNMENTS_URL } from "@/modules/universe/application/live-universe-source";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import {
  buildFixtureListingGraph,
  fixtureSubmissionsPayload,
} from "../infrastructure/fixture-listing-events";
import {
  acquisitionEvidence,
  symbolEvidence,
  FIXTURE_ACQUISITION,
  FIXTURE_SYMBOL_CHANGE,
  DECLARED_EVENT_CLOCK,
} from "../infrastructure/fixture-declared-events";
import { createInMemoryCorporateActionRepository } from "../infrastructure/in-memory-corporate-action-repository";
import { createLiveListingEvidenceSource } from "./live-listing-evidence-source";
import { recordDeclaredEvent } from "./record-declared-event";

function harness() {
  const acquisition = acquisitionEvidence();
  const payloads = new Map<string, unknown>([
    [
      buildSubmissionsUrl(FIXTURE_ACQUISITION.acquiredCik),
      fixtureSubmissionsPayload(acquisition.acquired),
    ],
    [
      buildSubmissionsUrl(FIXTURE_ACQUISITION.acquirerCik),
      fixtureSubmissionsPayload(acquisition.acquirer),
    ],
    [
      ASSIGNMENTS_URL,
      {
        fields: ["cik", "name", "ticker", "exchange"],
        data: symbolEvidence().assignments.map((a) => [
          Number(a.cik),
          a.name,
          a.ticker,
          a.exchange,
        ]),
      },
    ],
  ]);
  let clock = DECLARED_EVENT_CLOCK;
  const fetch = vi.fn<EgressFetch>(async ({ url }) => {
    const body = new TextEncoder().encode(JSON.stringify(payloads.get(url)));
    return { status: 200, body, byteLength: body.byteLength, fetchedAt: clock };
  });
  const corporateActions = createInMemoryCorporateActionRepository({
    graph: buildFixtureListingGraph(),
  });
  const deps = {
    corporateActions,
    loadIdentityGraph: corporateActions.loadIdentityGraph,
    sourceRegistry:
      createInMemorySourceRegistryRepository(DEMO_SOURCE_REGISTRY),
    ingestionRuns: createInMemoryIngestionRunRepository(),
    sourceDocuments: createInMemorySourceDocumentRepository(),
    source: createLiveListingEvidenceSource({ fetch }),
    now: () => clock,
    newId: randomUUID,
  };
  return {
    deps,
    fetch,
    payloads,
    setClock: (value: string) => {
      clock = value;
    },
  };
}

describe("record declared corporate event", () => {
  it("a discarded old-symbol row cannot be used as evidence of absence", async () => {
    const h = harness();
    const payload = h.payloads.get(ASSIGNMENTS_URL) as { data: unknown[][] };
    payload.data.push([85, null, "OLDT", "NYSE"]);
    const result = await recordDeclaredEvent(
      { declaration: FIXTURE_SYMBOL_CHANGE, mode: "personal", dryRun: false },
      h.deps,
    );
    expect(result.rejection).toBe("payload_schema_invalid");
    expect(result.run.status).toBe("quarantined");
    expect(await h.deps.corporateActions.listCorporateActions()).toEqual([]);
  });
  it.each([FIXTURE_ACQUISITION, FIXTURE_SYMBOL_CHANGE])(
    "records $kind once and replays without new graph rows",
    async (declaration) => {
      const h = harness();
      const first = await recordDeclaredEvent(
        { declaration, mode: "personal", dryRun: false },
        h.deps,
      );
      expect(first.run.status).toBe("succeeded");
      expect(first.applied?.corporateActions).toBe(1);
      const before = h.deps.corporateActions.snapshotGraph();
      const actions = await h.deps.corporateActions.listCorporateActions();
      h.setClock("2025-09-21T18:00:00.000Z");
      const second = await recordDeclaredEvent(
        { declaration, mode: "personal", dryRun: false },
        h.deps,
      );
      expect(second.run.status).toBe("duplicate");
      expect(second.applied).toBeNull();
      expect(second.run.replayOfRunId).toBe(first.run.runId);
      expect(h.deps.corporateActions.snapshotGraph()).toEqual(before);
      expect(await h.deps.corporateActions.listCorporateActions()).toEqual(
        actions,
      );
    },
  );

  it.each([FIXTURE_ACQUISITION, FIXTURE_SYMBOL_CHANGE])(
    "recovers $kind after the audit/document write and before the graph commit",
    async (declaration) => {
      const h = harness();
      h.deps.corporateActions.failNextApply();
      await expect(
        recordDeclaredEvent(
          { declaration, mode: "personal", dryRun: false },
          h.deps,
        ),
      ).rejects.toThrow("simulated");
      expect(await h.deps.corporateActions.listCorporateActions()).toEqual([]);
      h.setClock("2025-09-21T18:00:00.000Z");
      const recovered = await recordDeclaredEvent(
        { declaration, mode: "personal", dryRun: false },
        h.deps,
      );
      expect(recovered.rejection).toBeNull();
      expect(recovered.run.status).toBe("duplicate");
      expect(recovered.applied?.corporateActions).toBe(1);
      if (declaration.kind === "symbol_change")
        expect(
          (await h.deps.corporateActions.listCorporateActions())[0]!
            .availableAt,
        ).toBe(DECLARED_EVENT_CLOCK);
    },
  );

  it("defaults to dry run with no audit, document or graph writes", async () => {
    const h = harness();
    const append = vi.spyOn(h.deps.ingestionRuns, "append");
    const record = vi.spyOn(h.deps.sourceDocuments, "record");
    const apply = vi.spyOn(h.deps.corporateActions, "applyDeclaredEventPlan");
    const result = await recordDeclaredEvent(
      { declaration: FIXTURE_ACQUISITION, mode: "personal" },
      h.deps,
    );
    expect(result.plan?.status).toBe("planned");
    expect(append).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
  it("fails closed before any dependency in locked runtime", async () => {
    const h = harness();
    await expect(
      recordDeclaredEvent(
        { declaration: FIXTURE_ACQUISITION, mode: "locked" as "personal" },
        h.deps,
      ),
    ).rejects.toThrow();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("checks rights and identity before network", async () => {
    const h = harness();
    const entry = DEMO_SOURCE_REGISTRY.find((e) => e.sourceId === "sec-edgar")!;
    await h.deps.sourceRegistry.upsert({
      ...entry,
      rights: { ...entry.rights, normalizedStorage: "unknown" },
    });
    expect(
      (
        await recordDeclaredEvent(
          { declaration: FIXTURE_ACQUISITION, mode: "personal" },
          h.deps,
        )
      ).rejection,
    ).toBe("rights_not_approved");
    expect(h.fetch).not.toHaveBeenCalled();
    await h.deps.sourceRegistry.upsert(entry);
    expect(
      (
        await recordDeclaredEvent(
          {
            declaration: { ...FIXTURE_ACQUISITION, acquiredCik: "999" },
            mode: "personal",
          },
          h.deps,
        )
      ).rejection,
    ).toBe("entity_not_uniquely_in_graph");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("quarantines a broken index and leaves existing identity intact", async () => {
    const h = harness();
    const before = h.deps.corporateActions.snapshotGraph();
    h.payloads.set(buildSubmissionsUrl(FIXTURE_ACQUISITION.acquiredCik), {});
    const result = await recordDeclaredEvent(
      { declaration: FIXTURE_ACQUISITION, mode: "personal", dryRun: false },
      h.deps,
    );
    expect(result.run.status).toBe("quarantined");
    expect(result.rejection).toBe("payload_schema_invalid");
    expect(h.deps.corporateActions.snapshotGraph()).toEqual(before);
  });
  it.each([429, 503])("records HTTP %i without publishing", async (status) => {
    const h = harness();
    h.fetch.mockResolvedValue({
      status,
      body: new Uint8Array(),
      byteLength: 0,
      fetchedAt: DECLARED_EVENT_CLOCK,
    });
    const result = await recordDeclaredEvent(
      { declaration: FIXTURE_SYMBOL_CHANGE, mode: "personal", dryRun: false },
      h.deps,
    );
    expect(result.run.status).toBe("failed");
    expect(await h.deps.corporateActions.listCorporateActions()).toEqual([]);
  });
  it("does not publish over a conflicting immutable source document", async () => {
    const h = harness();
    const first = await recordDeclaredEvent(
      { declaration: FIXTURE_ACQUISITION, mode: "personal" },
      h.deps,
    );
    const id = first.plan!.filings[0]!.filing.accessionNumber;
    vi.spyOn(h.deps.sourceDocuments, "findByIds").mockResolvedValue([
      { sourceDocumentId: id, contentHash: "f".repeat(64) } as Awaited<
        ReturnType<typeof h.deps.sourceDocuments.findByIds>
      >[number],
    ]);
    const result = await recordDeclaredEvent(
      { declaration: FIXTURE_ACQUISITION, mode: "personal", dryRun: false },
      h.deps,
    );
    expect(result.rejection).toBe("source_document_conflict");
    expect(result.run.status).toBe("quarantined");
    expect(await h.deps.corporateActions.listCorporateActions()).toEqual([]);
  });
});
