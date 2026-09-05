import { describe, expect, it } from "vitest";

import { resolveIdentity } from "@/modules/identity/domain/resolve-identity";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
  type PointInTimeQueryInput,
} from "@/modules/temporal/domain/point-in-time-query";

import {
  FIXTURE_CONSTITUENT_CLAIMS,
  FIXTURE_INDEX_ID,
  FIXTURE_TICKER_ASSIGNMENTS,
  FIXTURE_UNIVERSE_DOCUMENT,
  FIXTURE_UNIVERSE_SOURCE_ID,
} from "../infrastructure/fixture-universe-source";
import { createInMemoryUniverseRepository } from "../infrastructure/in-memory-universe-repository";

import {
  constituteUniverse,
  type ConstituteUniverseCommand,
} from "./constitute-universe";

const AVAILABLE_AT = "2026-01-01T12:00:00.000Z";
const EFFECTIVE_AT = "2026-01-02T00:00:00.000Z";
const RECORDED_AT = "2026-01-03T00:00:00.000Z";

function createIdFactory(): () => string {
  let counter = 0;

  return () => {
    counter += 1;

    return `0a1b7c40-3f21-4d8e-9a01-${String(counter).padStart(12, "0")}`;
  };
}

function command(
  overrides: Partial<ConstituteUniverseCommand> = {},
): ConstituteUniverseCommand {
  return {
    indexId: FIXTURE_INDEX_ID,
    effectiveAt: EFFECTIVE_AT,
    availableAt: AVAILABLE_AT,
    sourceId: FIXTURE_UNIVERSE_SOURCE_ID,
    sourceDocumentId: FIXTURE_UNIVERSE_DOCUMENT,
    claims: [...FIXTURE_CONSTITUENT_CLAIMS],
    assignments: [...FIXTURE_TICKER_ASSIGNMENTS],
    ...overrides,
  };
}

function query(overrides: Partial<PointInTimeQueryInput> = {}) {
  return pointInTimeQuerySchema.parse({
    effectiveAt: "2026-02-01T00:00:00.000Z",
    revisionPolicy: "as_known",
    knownAt: "2026-02-01T00:00:00.000Z",
    sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
    ...overrides,
  } as PointInTimeQueryInput);
}

function dependencies() {
  return {
    repository: createInMemoryUniverseRepository(),
    now: () => RECORDED_AT,
    newId: createIdFactory(),
  };
}

describe("constitución del universo", () => {
  it("deja el universo resoluble por ticker y venue en el corte", async () => {
    const deps = dependencies();
    const { summary } = await constituteUniverse(command(), deps);

    expect(summary.members).toBe(4);
    expect(summary.applied).toMatchObject({
      legalEntities: 3,
      securities: 4,
      listings: 4,
      listingSymbols: 4,
      identifierAssignments: 3,
      memberships: 4,
      closures: 0,
    });

    const { graph } = deps.repository.snapshot();
    const resolution = resolveIdentity(
      graph,
      { symbol: "PAMPA-B", mic: "XNYS" },
      query(),
    );

    expect(resolution.status).toBe("resolved");
    expect(resolution.legalEntityId).not.toBeNull();
    expect(resolution.securityId).not.toBeNull();
    expect(resolution.listingId).not.toBeNull();

    // El mismo emisor se alcanza por su identificador autoritativo, y el CIK
    // resuelve a la entidad legal: no al instrumento.
    const byCik = resolveIdentity(
      graph,
      { identifierType: "cik", identifierValue: "9900003", scope: "sec:filer" },
      query(),
    );

    expect(byCik.legalEntityId).toBe(resolution.legalEntityId);
    expect(byCik.securityId).toBeNull();
  });

  it("no resuelve el universo antes de que el snapshot pudiera conocerse", async () => {
    const deps = dependencies();
    await constituteUniverse(command(), deps);

    const resolution = resolveIdentity(
      deps.repository.snapshot().graph,
      { symbol: "ANDES", mic: "XNAS" },
      query({
        effectiveAt: "2026-01-02T00:00:00.000Z",
        knownAt: "2025-12-31T00:00:00.000Z",
      }),
    );

    expect(resolution.status).toBe("not_found");
  });

  it("registra los irresueltos sin dejarlos entrar al universo", async () => {
    const deps = dependencies();
    const { summary } = await constituteUniverse(command(), deps);

    expect(
      summary.rejections.map((rejection) => rejection.code).sort(),
    ).toEqual(["ambiguous_issuer", "issuer_not_assigned", "unmapped_venue"]);
    expect(
      summary.rejections.every((rejection) => rejection.stage === "match"),
    ).toBe(true);
  });

  it("un lote sin miembros resueltos no vacía el universo", async () => {
    const deps = dependencies();
    await constituteUniverse(command(), deps);
    const before = deps.repository.snapshot();

    // El caso real que esto evita: la lista se descarga rota o cambia de
    // formato, resuelve cero constituyentes y el rebalanceo "vacía" el índice.
    const { summary } = await constituteUniverse(
      command({
        effectiveAt: "2026-06-01T00:00:00.000Z",
        availableAt: "2026-05-20T00:00:00.000Z",
        claims: [],
      }),
      deps,
    );

    expect(summary.members).toBe(0);
    expect(summary.applied.closures).toBe(0);
    expect(deps.repository.snapshot().memberships).toEqual(before.memberships);
  });
});
