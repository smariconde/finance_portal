import { describe, expect, it } from "vitest";

import { createInMemoryUniverseRepository } from "../infrastructure/in-memory-universe-repository";
import {
  FIXTURE_CONSTITUENT_CLAIMS,
  FIXTURE_INDEX_ID,
  FIXTURE_TICKER_ASSIGNMENTS,
  FIXTURE_UNIVERSE_DOCUMENT,
  FIXTURE_UNIVERSE_SOURCE_ID,
} from "../infrastructure/fixture-universe-source";

import {
  planUniverseConstitution,
  UNIVERSE_CONSTITUTION_RULE_VERSION,
  type UniverseConstitutionPlan,
  type UniverseState,
} from "./plan-universe-constitution";
import { resolveConstituents } from "./resolve-constituents";
import type {
  CompanyTickerAssignment,
  IndexConstituentClaim,
} from "./universe-source-records";

const AVAILABLE_AT = "2026-01-01T12:00:00.000Z";
const EFFECTIVE_AT = "2026-01-02T00:00:00.000Z";
const RECORDED_AT = "2026-01-03T00:00:00.000Z";
const LATER_EFFECTIVE_AT = "2026-04-01T00:00:00.000Z";
const LATER_AVAILABLE_AT = "2026-03-20T12:00:00.000Z";
const LATER_RECORDED_AT = "2026-04-02T00:00:00.000Z";

/**
 * IDs opacos y deterministas: el test no depende del orden de `randomUUID`.
 * `space` separa las corridas, porque dos fábricas que empiezan en cero emitirían
 * el mismo ID para sujetos distintos y el escenario dejaría de ser el que dice.
 */
function createIdFactory(space = 1): () => string {
  let counter = 0;

  return () => {
    counter += 1;

    return `0a1b7c40-3f21-4d8e-9a0${space}-${String(counter).padStart(12, "0")}`;
  };
}

const EMPTY_STATE: UniverseState = {
  graph: {
    legalEntities: [],
    securities: [],
    listings: [],
    listingSymbols: [],
    depositaryPrograms: [],
    depositaryRatios: [],
    identifierAssignments: [],
  },
  memberships: [],
};

type PlanOverrides = {
  claims?: readonly IndexConstituentClaim[];
  assignments?: readonly CompanyTickerAssignment[];
  state?: UniverseState;
  effectiveAt?: string;
  availableAt?: string;
  recordedAt?: string;
  newId?: () => string;
};

function plan(overrides: PlanOverrides = {}): UniverseConstitutionPlan {
  return planUniverseConstitution({
    indexId: FIXTURE_INDEX_ID,
    effectiveAt: overrides.effectiveAt ?? EFFECTIVE_AT,
    availableAt: overrides.availableAt ?? AVAILABLE_AT,
    recordedAt: overrides.recordedAt ?? RECORDED_AT,
    sourceId: FIXTURE_UNIVERSE_SOURCE_ID,
    sourceDocumentId: FIXTURE_UNIVERSE_DOCUMENT,
    resolution: resolveConstituents(
      overrides.claims ?? FIXTURE_CONSTITUENT_CLAIMS,
      overrides.assignments ?? FIXTURE_TICKER_ASSIGNMENTS,
    ),
    state: overrides.state ?? EMPTY_STATE,
    newId: overrides.newId ?? createIdFactory(),
  });
}

/** Aplica el plan sobre el doble en memoria y devuelve el estado resultante. */
async function applied(
  first: UniverseConstitutionPlan,
): Promise<ReturnType<typeof createInMemoryUniverseRepository>> {
  const repository = createInMemoryUniverseRepository();
  await repository.applyConstitution(first);

  return repository;
}

describe("planificación de la constitución del universo", () => {
  it("abre los cuatro niveles separados y cuelga el CIK de la entidad legal", () => {
    const constitution = plan();

    expect(constitution.ruleVersion).toBe(UNIVERSE_CONSTITUTION_RULE_VERSION);
    // Tres emisores para cuatro instrumentos: dos clases comparten entidad.
    expect(constitution.legalEntities).toHaveLength(3);
    expect(constitution.securities).toHaveLength(4);
    expect(constitution.listings).toHaveLength(4);
    expect(constitution.listingSymbols).toHaveLength(4);
    expect(constitution.memberships).toHaveLength(4);
    expect(constitution.counts).toMatchObject({
      members: 4,
      entitiesOpened: 3,
      securitiesOpened: 4,
      exits: 0,
      rejected: 3,
      relaxedMatches: 1,
    });

    const entityIds = new Set(
      constitution.legalEntities.map((entity) => entity.legalEntityId),
    );

    // El CIK identifica al filer. Copiarlo al instrumento haría que dos clases
    // del mismo emisor parecieran la misma security.
    expect(constitution.identifierAssignments).toHaveLength(3);
    for (const assignment of constitution.identifierAssignments) {
      expect(assignment.identifierType).toBe("cik");
      expect(assignment.subjectType).toBe("legal_entity");
      expect(entityIds.has(assignment.subjectId)).toBe(true);
      expect(assignment.confidence).toBe("authoritative");
    }
  });

  it("mantiene dos clases del mismo emisor como securities distintas", () => {
    const constitution = plan();
    const symbolByListing = new Map(
      constitution.listingSymbols.map((symbol) => [
        symbol.listingId,
        symbol.symbol,
      ]),
    );
    const northwind = constitution.listings
      .filter((listing) =>
        ["NWND", "NWNDA"].includes(
          symbolByListing.get(listing.listingId) ?? "",
        ),
      )
      .map((listing) =>
        constitution.securities.find(
          (security) => security.securityId === listing.securityId,
        )!,
      );

    expect(northwind).toHaveLength(2);
    expect(northwind[0]!.securityId).not.toBe(northwind[1]!.securityId);
    expect(northwind[0]!.issuerLegalEntityId).toBe(
      northwind[1]!.issuerLegalEntityId,
    );
  });

  it("persiste el símbolo de la fuente autoritativa y no el de la lista", () => {
    const constitution = plan();

    expect(
      constitution.listingSymbols.map((symbol) => symbol.symbol),
    ).toContain("PAMPA-B");
    expect(
      constitution.listingSymbols.map((symbol) => symbol.symbol),
    ).not.toContain("PAMPA.B");
  });

  it("no abre ninguna versión nueva al repetir la misma constitución", async () => {
    const repository = await applied(plan());
    const state = await repository.loadState({ indexId: FIXTURE_INDEX_ID });

    const replay = plan({ state, newId: createIdFactory(2) });

    expect(replay.legalEntities).toEqual([]);
    expect(replay.securities).toEqual([]);
    expect(replay.listings).toEqual([]);
    expect(replay.listingSymbols).toEqual([]);
    expect(replay.identifierAssignments).toEqual([]);
    expect(replay.memberships).toEqual([]);
    expect(replay.closures).toEqual([]);
    // Reconocer lo que ya existe no es "no hay universo": los cuatro siguen
    // siendo miembros.
    expect(replay.counts.members).toBe(4);
  });

  it("historiza un renombre en vez de reescribir la fila vigente", async () => {
    const repository = await applied(plan());
    const state = await repository.loadState({ indexId: FIXTURE_INDEX_ID });

    const renamed = plan({
      state,
      effectiveAt: LATER_EFFECTIVE_AT,
      availableAt: LATER_AVAILABLE_AT,
      recordedAt: LATER_RECORDED_AT,
      assignments: FIXTURE_TICKER_ASSIGNMENTS.map((assignment) =>
        assignment.ticker === "ANDES"
          ? { ...assignment, name: "Andes Synthetic Holdings" }
          : assignment,
      ),
    });

    expect(renamed.legalEntities).toHaveLength(1);
    expect(renamed.closures).toEqual([
      {
        level: "legal_entity",
        subjectId: renamed.legalEntities[0]!.legalEntityId,
        validFrom: EFFECTIVE_AT,
        validTo: LATER_EFFECTIVE_AT,
        reason: "renamed",
      },
    ]);
    // La identidad no cambia con el nombre: es el mismo emisor.
    expect(renamed.legalEntities[0]!.legalName).toBe(
      "Andes Synthetic Holdings",
    );

    await repository.applyConstitution(renamed);
    const versions = repository
      .snapshot()
      .graph.legalEntities.filter(
        (entity) =>
          entity.legalEntityId === renamed.legalEntities[0]!.legalEntityId,
      );

    expect(versions).toHaveLength(2);
    expect(versions.map((version) => version.legalName)).toEqual([
      "Andes Synthetic Corp",
      "Andes Synthetic Holdings",
    ]);
    // Intervalos que se tocan: el borde superior es exclusivo.
    expect(versions[0]!.validTo).toBe(LATER_EFFECTIVE_AT);
    expect(versions[1]!.validFrom).toBe(LATER_EFFECTIVE_AT);
  });

  it("cierra la membresía de quien sale del índice sin borrar la fila ni deslistar", async () => {
    const repository = await applied(plan());
    const state = await repository.loadState({ indexId: FIXTURE_INDEX_ID });
    const andesListing = state.graph.listings.find((listing) =>
      state.graph.listingSymbols.some(
        (symbol) =>
          symbol.listingId === listing.listingId && symbol.symbol === "ANDES",
      ),
    )!;

    const rebalanced = plan({
      state,
      effectiveAt: LATER_EFFECTIVE_AT,
      availableAt: LATER_AVAILABLE_AT,
      recordedAt: LATER_RECORDED_AT,
      claims: FIXTURE_CONSTITUENT_CLAIMS.filter(
        (entry) => entry.symbol !== "ANDES",
      ),
    });

    expect(rebalanced.counts.members).toBe(3);
    expect(rebalanced.counts.exits).toBe(1);
    expect(rebalanced.memberships).toEqual([]);

    await repository.applyConstitution(rebalanced);
    const snapshot = repository.snapshot();
    const closed = snapshot.memberships.filter(
      (membership) => membership.validTo !== null,
    );

    expect(snapshot.memberships).toHaveLength(4);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.validTo).toBe(LATER_EFFECTIVE_AT);
    expect(closed[0]!.securityId).toBe(andesListing.securityId);
    // Salir del índice no deslista el instrumento: la security sigue vigente.
    expect(
      snapshot.graph.securities.every((security) => security.validTo === null),
    ).toBe(true);
  });

  it("rechaza el ticker que ya pertenece a la security de otro emisor", async () => {
    const repository = await applied(plan());
    const state = await repository.loadState({ indexId: FIXTURE_INDEX_ID });

    const conflicted = plan({
      state,
      newId: createIdFactory(2),
      effectiveAt: LATER_EFFECTIVE_AT,
      availableAt: LATER_AVAILABLE_AT,
      recordedAt: LATER_RECORDED_AT,
      claims: [{ symbol: "ANDES", name: "Otro emisor", sector: null }],
      assignments: [
        {
          cik: "9900099",
          name: "Otro Emisor Synthetic",
          ticker: "ANDES",
          exchange: "Nasdaq",
        },
      ],
    });

    expect(conflicted.memberships).toEqual([]);
    expect(conflicted.rejections).toContainEqual(
      expect.objectContaining({
        claimSymbol: "ANDES",
        stage: "plan",
        code: "issuer_conflict",
      }),
    );
  });

  it("no adivina si un símbolo nuevo de un emisor conocido es renombre o clase nueva", async () => {
    const repository = await applied(
      plan({
        claims: [{ symbol: "NWND", name: "Northwind", sector: null }],
      }),
    );
    const state = await repository.loadState({ indexId: FIXTURE_INDEX_ID });

    const ambiguous = plan({
      state,
      effectiveAt: LATER_EFFECTIVE_AT,
      availableAt: LATER_AVAILABLE_AT,
      recordedAt: LATER_RECORDED_AT,
      claims: [
        { symbol: "NWND", name: "Northwind", sector: null },
        { symbol: "NWNDA", name: "Northwind", sector: null },
      ],
    });

    expect(ambiguous.securities).toEqual([]);
    expect(ambiguous.rejections).toContainEqual(
      expect.objectContaining({
        claimSymbol: "NWNDA",
        code: "unresolved_share_class",
      }),
    );
  });

  it("rechaza un snapshot que no es posterior a la versión que debería cerrar", async () => {
    const repository = await applied(plan());
    const state = await repository.loadState({ indexId: FIXTURE_INDEX_ID });

    const stale = plan({
      state,
      // Mismo instante que la versión vigente: cerrarla ahí dejaría un intervalo
      // vacío, no una historia.
      effectiveAt: EFFECTIVE_AT,
      assignments: FIXTURE_TICKER_ASSIGNMENTS.map((assignment) =>
        assignment.ticker === "ANDES"
          ? { ...assignment, name: "Andes Synthetic Holdings" }
          : assignment,
      ),
    });

    expect(stale.legalEntities).toEqual([]);
    expect(stale.closures).toEqual([]);
    expect(stale.rejections).toContainEqual(
      expect.objectContaining({
        claimSymbol: "ANDES",
        code: "stale_effective_date",
      }),
    );
  });

  it("hashea el contenido de la versión y no el instante en que se registró", () => {
    const first = plan({ newId: createIdFactory() });
    const second = plan({
      newId: createIdFactory(),
      recordedAt: LATER_RECORDED_AT,
    });

    expect(second.legalEntities.map((entity) => entity.contentHash)).toEqual(
      first.legalEntities.map((entity) => entity.contentHash),
    );
    expect(second.legalEntities[0]!.recordedAt).toBe(LATER_RECORDED_AT);
  });
});
