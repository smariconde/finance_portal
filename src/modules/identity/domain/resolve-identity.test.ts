import { describe, expect, it } from "vitest";

import {
  identityGraphSchema,
  type IdentityGraph,
} from "@/modules/identity/domain/identity-graph";
import {
  resolveDepositaryRatio,
  resolveIdentity,
  requireResolvedSubject,
  type IdentityLookup,
} from "@/modules/identity/domain/resolve-identity";
import {
  DEMO_IDENTITY_GRAPH,
  DEMO_IDENTITY_IDS,
  DEMO_SUBJECT_LOOKUP,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";
import {
  pointInTimeQuerySchema,
  type PointInTimeQueryInput,
} from "@/modules/temporal/domain/point-in-time-query";
import { isTemporalContractError } from "@/modules/temporal/domain/temporal-error";

function at(effectiveAt: string, knownAt = effectiveAt) {
  return pointInTimeQuerySchema.parse({
    effectiveAt,
    revisionPolicy: "as_known",
    knownAt,
    sourcePolicyVersion: "source-policy-1.0.0",
  } as PointInTimeQueryInput);
}

function resolve(
  lookup: IdentityLookup,
  effectiveAt: string,
  knownAt?: string,
) {
  return resolveIdentity(DEMO_IDENTITY_GRAPH, lookup, at(effectiveAt, knownAt));
}

describe("resolveIdentity: símbolo y vigencia", () => {
  it("resolves the ticker in force before the rename", () => {
    const resolution = resolve(
      { symbol: "FIXA", mic: "XNAS" },
      "2023-06-01T00:00:00.000Z",
    );

    expect(resolution.status).toBe("resolved");
    expect(resolution.securityId).toBe(DEMO_IDENTITY_IDS.fixtureCoClassA);
    expect(resolution.legalEntityId).toBe(DEMO_IDENTITY_IDS.fixtureCoEntity);
    expect(resolution.listingId).toBe(DEMO_IDENTITY_IDS.fixtureCoXnasListing);
    expect(resolution.decidedBy).toBe("rule");
  });

  it("keeps the old ticker unresolvable once its interval closed", () => {
    // El 2024-06-01 es exactamente el borde: el símbolo anterior ya no aplica y
    // el nuevo todavía no fue reasignado a otro emisor.
    expect(
      resolve({ symbol: "FIXA", mic: "XNAS" }, "2024-06-01T00:00:00.000Z")
        .status,
    ).toBe("not_found");
    expect(
      resolve({ symbol: "FXCO", mic: "XNAS" }, "2024-06-01T00:00:00.000Z")
        .securityId,
    ).toBe(DEMO_IDENTITY_IDS.fixtureCoClassA);
  });

  it("does not know the new ticker before it was announced", () => {
    // Efectivo el 2024-06-01, anunciado el 2024-05-10: una consulta con corte
    // anterior al anuncio no puede conocerlo.
    expect(
      resolve(
        { symbol: "FXCO", mic: "XNAS" },
        "2024-07-01T00:00:00.000Z",
        "2024-05-01T00:00:00.000Z",
      ).status,
    ).toBe("not_found");
    expect(
      resolve(
        { symbol: "FXCO", mic: "XNAS" },
        "2024-07-01T00:00:00.000Z",
        "2024-05-10T13:00:00.000Z",
      ).status,
    ).toBe("resolved");
  });

  it("returns candidates instead of guessing when the symbol lacks a MIC", () => {
    const resolution = resolve({ symbol: "FIXA" }, "2023-06-01T00:00:00.000Z");

    expect(resolution.status).toBe("ambiguous");
    expect(resolution.securityId).toBeNull();
    expect(resolution.candidateIds).toHaveLength(2);
    expect(resolution.candidateIds).toContain(
      DEMO_IDENTITY_IDS.fixtureCoXnasListing,
    );
    expect(resolution.candidateIds).toContain(
      DEMO_IDENTITY_IDS.fixtureCoXbueListing,
    );
  });

  it("follows a reused ticker to its new issuer, never to the old one", () => {
    const resolution = resolve(
      { symbol: "FIXA", mic: "XNAS" },
      "2025-06-01T00:00:00.000Z",
    );

    expect(resolution.securityId).toBe(DEMO_IDENTITY_IDS.andesCommon);
    expect(resolution.legalEntityId).toBe(DEMO_IDENTITY_IDS.andesEntity);
    expect(resolution.securityId).not.toBe(DEMO_IDENTITY_IDS.fixtureCoClassA);
  });
});

describe("resolveIdentity: identificadores", () => {
  it("resolves an ISIN to the instrument, not to the issuer or the venue", () => {
    const resolution = resolve(
      { identifierType: "isin", identifierValue: "us0fixture01" },
      "2024-01-01T00:00:00.000Z",
    );

    expect(resolution.securityId).toBe(DEMO_IDENTITY_IDS.fixtureCoClassA);
    expect(resolution.listingId).toBeNull();
    expect(resolution.matchedAssignmentIds).toHaveLength(1);
  });

  it("never joins through a candidate assignment", () => {
    // El mismo ISIN tiene una asignación `candidate` a otra security; si el
    // filtro fallara, la consulta devolvería `conflict` en vez de resolver.
    const resolution = resolve(
      { identifierType: "isin", identifierValue: "US0FIXTURE01" },
      "2025-06-01T00:00:00.000Z",
    );

    expect(resolution.status).toBe("resolved");
    expect(resolution.securityId).toBe(DEMO_IDENTITY_IDS.fixtureCoClassA);
  });

  it("reports a conflict when one authoritative identifier names two subjects", () => {
    const conflicted: IdentityGraph = identityGraphSchema.parse({
      ...DEMO_IDENTITY_GRAPH,
      identifierAssignments: DEMO_IDENTITY_GRAPH.identifierAssignments.map(
        (assignment) =>
          assignment.confidence === "candidate"
            ? { ...assignment, confidence: "confirmed" }
            : assignment,
      ),
    });

    const resolution = resolveIdentity(
      conflicted,
      { identifierType: "isin", identifierValue: "US0FIXTURE01" },
      at("2025-06-01T00:00:00.000Z"),
    );

    expect(resolution.status).toBe("conflict");
    expect(resolution.candidateIds).toHaveLength(2);
    expect(resolution.decidedBy).toBeNull();
  });

  it("reports a conflict when symbol and identifier disagree", () => {
    const resolution = resolve(
      {
        symbol: "FIXA",
        mic: "XNAS",
        identifierType: "isin",
        identifierValue: "US0FIXTURE01",
      },
      // En 2025 el ticker ya pertenece a otro emisor que no lleva ese ISIN.
      "2025-06-01T00:00:00.000Z",
    );

    expect(resolution.status).toBe("conflict");
  });

  it("scopes a vendor key so two sources cannot collide on the same string", () => {
    const resolution = resolve(DEMO_SUBJECT_LOOKUP, "2024-12-31T00:00:00.000Z");

    expect(resolution.legalEntityId).toBe(DEMO_IDENTITY_IDS.fixtureCoEntity);
    expect(
      resolve(
        { ...DEMO_SUBJECT_LOOKUP, scope: "source:otra-fuente" },
        "2024-12-31T00:00:00.000Z",
      ).status,
    ).toBe("not_found");
  });
});

describe("resolveIdentity: programa depositario", () => {
  it("keeps the CEDEAR and its underlying as different securities", () => {
    const cedear = resolve(
      { symbol: "FIXA", mic: "XBUE" },
      "2023-06-01T00:00:00.000Z",
    );

    expect(cedear.securityId).toBe(DEMO_IDENTITY_IDS.fixtureCoCedear);
    expect(cedear.depositaryProgramId).toBe(DEMO_IDENTITY_IDS.cedearProgram);
    // El subyacente conserva su propia identidad y su propio issuer.
    expect(cedear.legalEntityId).toBe(DEMO_IDENTITY_IDS.depositaryEntity);
    expect(cedear.securityId).not.toBe(DEMO_IDENTITY_IDS.fixtureCoClassA);
  });

  it("does not attach a program to the underlying security", () => {
    expect(
      resolve({ symbol: "FXCO", mic: "XNAS" }, "2024-12-01T00:00:00.000Z")
        .depositaryProgramId,
    ).toBeNull();
  });

  it("keeps the previous ratio until the announced change is effective", () => {
    const beforeEffective = resolveDepositaryRatio(
      DEMO_IDENTITY_GRAPH,
      DEMO_IDENTITY_IDS.cedearProgram,
      at("2024-08-15T00:00:00.000Z", "2024-08-01T00:00:00.000Z"),
    );
    const afterEffective = resolveDepositaryRatio(
      DEMO_IDENTITY_GRAPH,
      DEMO_IDENTITY_IDS.cedearProgram,
      at("2024-10-01T00:00:00.000Z", "2024-08-01T00:00:00.000Z"),
    );

    expect(beforeEffective?.depositaryUnits).toBe("10");
    expect(afterEffective?.depositaryUnits).toBe("20");
  });

  it("returns the open-ended ratio for a cutoff before the announcement", () => {
    const beforeAnnouncement = resolveDepositaryRatio(
      DEMO_IDENTITY_GRAPH,
      DEMO_IDENTITY_IDS.cedearProgram,
      at("2024-10-01T00:00:00.000Z", "2024-07-01T00:00:00.000Z"),
    );

    // El cambio ni siquiera era conocible: la mejor respuesta sigue siendo 10:1.
    expect(beforeAnnouncement?.depositaryUnits).toBe("10");
    expect(beforeAnnouncement?.announcedAt).toBeNull();
  });

  it("keeps the ratio as an exact fraction of decimal strings", () => {
    const ratio = resolveDepositaryRatio(
      DEMO_IDENTITY_GRAPH,
      DEMO_IDENTITY_IDS.cedearProgram,
      at("2025-01-01T00:00:00.000Z"),
    );

    expect(ratio).toMatchObject({
      depositaryUnits: "20",
      underlyingUnits: "1",
    });
  });
});

describe("requireResolvedSubject", () => {
  it("raises ambiguous_identity instead of returning a partial subject", () => {
    const ambiguous = resolve({ symbol: "FIXA" }, "2023-06-01T00:00:00.000Z");

    try {
      requireResolvedSubject(ambiguous, "security");
      throw new Error("Expected requireResolvedSubject to raise.");
    } catch (error) {
      expect(isTemporalContractError(error, "ambiguous_identity")).toBe(true);
    }
  });
});
