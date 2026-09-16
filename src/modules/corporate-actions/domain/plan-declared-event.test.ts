import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveIdentity } from "@/modules/identity/domain/resolve-identity";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import { isKnownAt } from "@/modules/temporal/domain/temporal-version";
import { resolveReportingLineage } from "./reporting-lineage";
import { declaredEventSchema } from "./declared-event";
import { planDeclaredEvent } from "./plan-declared-event";
import {
  buildFixtureListingGraph,
  fixtureIds,
  FIXTURE_LISTING_FILERS,
} from "../infrastructure/fixture-listing-events";
import {
  acquisitionEvidence,
  symbolEvidence,
  FIXTURE_ACQUISITION,
  FIXTURE_SYMBOL_CHANGE,
  DECLARED_EVENT_CLOCK,
} from "../infrastructure/fixture-declared-events";
import { createInMemoryCorporateActionRepository } from "../infrastructure/in-memory-corporate-action-repository";

type MutableEvidence = {
  -readonly [K in keyof ReturnType<typeof acquisitionEvidence>]: ReturnType<
    typeof acquisitionEvidence
  >[K];
};

const query = (
  knownAt: string,
  effectiveAt = "2025-09-18T00:00:00.000Z",
): PointInTimeQuery => ({
  effectiveAt,
  knownAt,
  revisionPolicy: "as_known",
  adjustmentPolicy: "as_known",
  knowledgeBasis: "public_availability",
  sourcePolicyVersion: "fixture-1.0.0",
});
function input(kind: "acquisition" | "symbol_change" = "acquisition") {
  return {
    declaration:
      kind === "acquisition" ? FIXTURE_ACQUISITION : FIXTURE_SYMBOL_CHANGE,
    evidence: kind === "acquisition" ? acquisitionEvidence() : symbolEvidence(),
    graph: buildFixtureListingGraph(),
    corporateActions: [],
    relationships: [],
    recordedAt: DECLARED_EVENT_CLOCK,
    newId: randomUUID,
  };
}

describe("declared acquisition", () => {
  it("waits for BOTH closing filings, keeps the parties separate and never joins reporting history", () => {
    const plan = planDeclaredEvent(input());
    expect(plan.status).toBe("planned");
    const edge = plan.relationships[0]!;
    expect(edge.relationshipType).toBe("acquired_by");
    expect(edge.validFrom).toBe("2025-09-17T04:00:00.000Z");
    expect(edge.availableAt).toBe("2025-09-17T20:01:49.000Z");
    expect(isKnownAt(edge, query("2025-09-17T20:01:48.000Z"))).toBe(false);
    expect(isKnownAt(edge, query(edge.availableAt))).toBe(true);
    const lineage = resolveReportingLineage(
      [edge],
      edge.successorLegalEntityId,
      query(DECLARED_EVENT_CLOCK),
    );
    expect(lineage.segments.map((s) => s.legalEntityId)).toEqual([
      edge.successorLegalEntityId,
    ]);
    expect(plan.listingSymbols).toEqual([]);
    expect(plan.supersessions).toEqual([]);
  });

  it.each([
    [
      "subject_mismatch",
      (e: MutableEvidence) => {
        e.acquirer = { ...e.acquirer, cik: "0000000099" };
      },
    ],
    [
      "closing_filing_missing",
      (e: MutableEvidence) => {
        e.acquired = { ...e.acquired, filings: e.acquired.filings.slice(0, 1) };
      },
    ],
    [
      "closing_filing_invalid",
      (e: MutableEvidence) => {
        e.acquired = {
          ...e.acquired,
          filings: e.acquired.filings.map((f) =>
            f.form === "8-K" ? { ...f, items: ["2.01"] } : f,
          ),
        };
      },
    ],
    [
      "closing_filing_invalid",
      (e: MutableEvidence) => {
        e.acquirer = {
          ...e.acquirer,
          filings: e.acquirer.filings.map((f) =>
            f.form === "8-K" ? { ...f, reportDate: "2025-09-16" } : f,
          ),
        };
      },
    ],
    [
      "closing_filing_invalid",
      (e: MutableEvidence) => {
        e.acquirer = {
          ...e.acquirer,
          filings: e.acquirer.filings.map((f) =>
            f.form === "8-K" ? { ...f, acceptedAt: null } : f,
          ),
        };
      },
    ],
    [
      "shared_communication_missing",
      (e: MutableEvidence) => {
        e.acquirer = {
          ...e.acquirer,
          filings: e.acquirer.filings.filter((f) => f.form !== "425"),
        };
      },
    ],
    [
      "shared_communication_invalid",
      (e: MutableEvidence) => {
        e.acquirer = {
          ...e.acquirer,
          filings: e.acquirer.filings.map((f) =>
            f.form === "425" ? { ...f, form: "S-4" } : f,
          ),
        };
      },
    ],
    [
      "shared_communication_invalid",
      (e: MutableEvidence) => {
        e.acquired = {
          ...e.acquired,
          filings: e.acquired.filings.map((f) =>
            f.form === "425"
              ? { ...f, acceptedAt: "2025-09-18T20:00:00.000Z" }
              : f,
          ),
        };
      },
    ],
    [
      "future_evidence",
      (e: MutableEvidence) => {
        e.fetchedAt = "2025-09-17T20:01:48.000Z";
      },
    ],
  ] as const)("rejects %s without any writes", (code, mutate) => {
    const evidence = acquisitionEvidence();
    mutate(evidence);
    const plan = planDeclaredEvent({ ...input(), evidence });
    expect(plan.rejection).toBe(code);
    expect(plan.corporateActions).toEqual([]);
    expect(plan.relationships).toEqual([]);
  });

  it("allows several acquired companies per acquirer, but rejects a second acquirer and cycles", () => {
    const initial = input();
    const edge = planDeclaredEvent(initial).relationships[0]!;
    const otherTarget = fixtureIds(
      FIXTURE_LISTING_FILERS.transfer,
    ).legalEntityId;
    expect(
      planDeclaredEvent({
        ...initial,
        relationships: [{ ...edge, predecessorLegalEntityId: otherTarget }],
      }).status,
    ).toBe("planned");
    expect(
      planDeclaredEvent({ ...initial, relationships: [edge] }).rejection,
    ).toBe("acquired_has_other_acquirer");
    expect(
      planDeclaredEvent({
        ...initial,
        relationships: [
          {
            ...edge,
            predecessorLegalEntityId: edge.successorLegalEntityId,
            successorLegalEntityId: edge.predecessorLegalEntityId,
          },
        ],
      }).rejection,
    ).toBe("acquisition_cycle");
  });

  it("does not pretend private or unknown companies already exist in the graph", () => {
    const initial = input();
    expect(
      planDeclaredEvent({
        ...initial,
        graph: { ...initial.graph, identifierAssignments: [] },
      }).rejection,
    ).toBe("entity_not_in_graph");
  });
});

describe("declared ticker change", () => {
  it("an old ticker with unknown venue is not proof it left this venue", () => {
    const evidence = symbolEvidence();
    const plan = planDeclaredEvent({
      ...input("symbol_change"),
      evidence: {
        ...evidence,
        assignments: [
          ...evidence.assignments,
          { cik: "85", name: "Synthetic", ticker: "OLDT", exchange: null },
        ],
      },
    });
    expect(plan.rejection).toBe("old_symbol_still_assigned");
  });
  it("preserves the old answer before declaration and changes only the symbol at the effective boundary", async () => {
    const initial = input("symbol_change");
    const repository = createInMemoryCorporateActionRepository({
      graph: initial.graph,
    });
    const plan = planDeclaredEvent(initial);
    expect(plan.status).toBe("planned");
    await repository.applyDeclaredEventPlan(plan);
    const graph = repository.snapshotGraph();
    const before = "2025-09-20T18:00:04.000Z";
    expect(
      resolveIdentity(graph, { symbol: "OLDT", mic: "XNYS" }, query(before))
        .status,
    ).toBe("resolved");
    expect(
      resolveIdentity(graph, { symbol: "NEWT", mic: "XNYS" }, query(before))
        .status,
    ).toBe("not_found");
    expect(
      resolveIdentity(
        graph,
        { symbol: "OLDT", mic: "XNYS" },
        query(DECLARED_EVENT_CLOCK),
      ).status,
    ).toBe("not_found");
    const newIdentity = resolveIdentity(
      graph,
      { symbol: "NEWT", mic: "XNYS" },
      query(DECLARED_EVENT_CLOCK),
    );
    expect(newIdentity.listingId).toBe(
      fixtureIds(FIXTURE_LISTING_FILERS.symbolChange).listingId,
    );
    expect(
      resolveIdentity(
        graph,
        { symbol: "OLDT", mic: "XNYS" },
        query(DECLARED_EVENT_CLOCK, "2025-09-12T03:59:59.000Z"),
      ).status,
    ).toBe("resolved");
    expect(
      resolveIdentity(
        graph,
        { symbol: "NEWT", mic: "XNYS" },
        query(DECLARED_EVENT_CLOCK, "2025-09-12T04:00:00.000Z"),
      ).status,
    ).toBe("resolved");
    const again = planDeclaredEvent({
      ...initial,
      graph: await repository.loadIdentityGraph(),
      corporateActions: await repository.listCorporateActions(),
      recordedAt: "2025-09-21T00:00:00.000Z",
    });
    expect(again.status).toBe("unchanged");
    expect(graph.securities).toEqual(initial.graph.securities);
    expect(graph.listings).toEqual(initial.graph.listings);
  });

  it.each([
    ["new_symbol_not_assigned", []],
    [
      "new_symbol_not_assigned",
      [{ cik: "99", name: "Synthetic", ticker: "NEWT", exchange: "NYSE" }],
    ],
    [
      "new_symbol_not_assigned",
      [{ cik: "85", name: "Synthetic", ticker: "NEWT", exchange: "Nasdaq" }],
    ],
    [
      "old_symbol_still_assigned",
      [
        ...symbolEvidence().assignments,
        { cik: "85", name: "Synthetic", ticker: "OLDT", exchange: "NYSE" },
      ],
    ],
  ] as const)(
    "rejects %s in the current SEC assignment",
    (code, assignments) => {
      expect(
        planDeclaredEvent({
          ...input("symbol_change"),
          evidence: { ...symbolEvidence(), assignments },
        }).rejection,
      ).toBe(code);
    },
  );

  it("rejects an effective date before the graph, instead of creating historical evidence", () => {
    expect(
      planDeclaredEvent({
        ...input("symbol_change"),
        declaration: { ...FIXTURE_SYMBOL_CHANGE, effectiveOn: "2025-08-01" },
      }).rejection,
    ).toBe("stale_effective_date");
  });
  it("rejects ambiguity between share classes", () => {
    const initial = input("symbol_change");
    const own = initial.graph.listings.find(
      (l) =>
        l.listingId ===
        fixtureIds(FIXTURE_LISTING_FILERS.symbolChange).listingId,
    )!;
    expect(
      planDeclaredEvent({
        ...initial,
        graph: {
          ...initial.graph,
          listings: [
            ...initial.graph.listings,
            { ...own, listingId: randomUUID() },
          ],
        },
      }).rejection,
    ).toBe("ambiguous_listing");
  });
  it("rejects changes in the future and undeclared fields", () => {
    expect(
      planDeclaredEvent({
        ...input("symbol_change"),
        declaration: {
          ...FIXTURE_SYMBOL_CHANGE,
          decidedAt: "2026-01-01T00:00:00.000Z",
        },
      }).rejection,
    ).toBe("future_declaration");
    expect(
      planDeclaredEvent({
        ...input("symbol_change"),
        declaration: { ...FIXTURE_SYMBOL_CHANGE, effectiveOn: "2026-01-01" },
      }).rejection,
    ).toBe("future_effective_date");
    expect(
      declaredEventSchema.safeParse({
        ...FIXTURE_SYMBOL_CHANGE,
        url: "http://localhost",
      }).success,
    ).toBe(false);
    expect(
      declaredEventSchema.safeParse({
        ...FIXTURE_SYMBOL_CHANGE,
        toSymbol: "OLDT",
      }).success,
    ).toBe(false);
  });
});
