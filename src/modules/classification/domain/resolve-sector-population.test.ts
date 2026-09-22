import { describe, expect, it } from "vitest";

import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";
import { indexMembershipSchema } from "@/modules/universe/domain/index-membership";

import { resolveSectorPopulation } from "./resolve-sector-population";
import { SP500_SECTOR_TAXONOMY_ID } from "./sector-taxonomy";
import { subjectClassificationSchema } from "./subject-classification";

const ALPHABET = "11111111-1111-4111-8111-111111111111";
const GOOG = "22222222-2222-4222-8222-222222222222";
const GOOGL = "33333333-3333-4333-8333-333333333333";
const EXXON = "44444444-4444-4444-8444-444444444444";
const XOM = "55555555-5555-4555-8555-555555555555";

const PIN_AT = "2026-06-01T00:00:00.000Z";

function membership(securityId: string, overrides = {}) {
  return indexMembershipSchema.parse({
    indexMembershipId: `66666666-6666-4666-8666-${securityId.slice(-12)}`,
    indexId: "sp-500",
    securityId,
    validFrom: PIN_AT,
    validTo: null,
    availableAt: PIN_AT,
    supersededAt: null,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    contentHash: "a".repeat(64),
    recordedAt: PIN_AT,
    ...overrides,
  });
}

function classification(subjectId: string, code: string, label: string) {
  return subjectClassificationSchema.parse({
    classificationAssignmentId: `77777777-7777-4777-8777-${subjectId.slice(-12)}`,
    subjectType: "legal_entity",
    subjectId,
    taxonomyId: SP500_SECTOR_TAXONOMY_ID,
    taxonomyVersion: "a".repeat(40),
    code,
    label,
    validFrom: PIN_AT,
    validTo: null,
    availableAt: PIN_AT,
    supersededAt: null,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    contentHash: "b".repeat(64),
    recordedAt: PIN_AT,
  });
}

const query = pointInTimeQuerySchema.parse({
  effectiveAt: "2026-08-01T00:00:00.000Z",
  knownAt: "2026-08-01T00:00:00.000Z",
  revisionPolicy: "as_known",
  sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
});

describe("resolveSectorPopulation", () => {
  it("counts two share classes of one issuer as two members of one sector", () => {
    // Dos clases del mismo emisor son dos securities y dos puntos de la matriz,
    // con un solo sector: es el punto 7 de la especificación de la matriz.
    const population = resolveSectorPopulation({
      indexId: "sp-500",
      memberships: [membership(GOOG), membership(GOOGL)],
      issuers: [
        { securityId: GOOG, issuerLegalEntityId: ALPHABET },
        { securityId: GOOGL, issuerLegalEntityId: ALPHABET },
      ],
      classifications: [
        classification(
          ALPHABET,
          "communication-services",
          "Communication Services",
        ),
      ],
      query,
      code: "communication-services",
    });

    expect(population.members).toHaveLength(2);
    expect(population.unclassified).toHaveLength(0);
  });

  it("filters to the requested sector", () => {
    const population = resolveSectorPopulation({
      indexId: "sp-500",
      memberships: [membership(GOOG), membership(XOM)],
      issuers: [
        { securityId: GOOG, issuerLegalEntityId: ALPHABET },
        { securityId: XOM, issuerLegalEntityId: EXXON },
      ],
      classifications: [
        classification(
          ALPHABET,
          "communication-services",
          "Communication Services",
        ),
        classification(EXXON, "energy", "Energy"),
      ],
      query,
      code: "energy",
    });

    expect(population.members.map((member) => member.securityId)).toEqual([
      XOM,
    ]);
  });

  it("gives a reason instead of a default sector", () => {
    const population = resolveSectorPopulation({
      indexId: "sp-500",
      memberships: [membership(XOM)],
      issuers: [{ securityId: XOM, issuerLegalEntityId: EXXON }],
      classifications: [],
      query,
      code: null,
    });

    expect(population.members).toHaveLength(0);
    expect(population.unclassified).toEqual([
      {
        securityId: XOM,
        issuerLegalEntityId: EXXON,
        reason: "never_classified",
      },
    ]);
  });

  it("excludes a security that left the index before the cutoff", () => {
    const population = resolveSectorPopulation({
      indexId: "sp-500",
      memberships: [membership(XOM, { validTo: "2026-07-01T00:00:00.000Z" })],
      issuers: [{ securityId: XOM, issuerLegalEntityId: EXXON }],
      classifications: [classification(EXXON, "energy", "Energy")],
      query,
      code: null,
    });

    expect(population.members).toHaveLength(0);
    expect(population.unclassified).toHaveLength(0);
  });

  it("does not see a classification published after the cutoff", () => {
    // `TM-06` compuesto: la membresía ya valía, la clasificación todavía no.
    const later = subjectClassificationSchema.parse({
      ...classification(EXXON, "energy", "Energy"),
      validFrom: "2026-09-05T01:39:10.000Z",
      availableAt: "2026-09-05T01:39:10.000Z",
    });

    const population = resolveSectorPopulation({
      indexId: "sp-500",
      memberships: [membership(XOM)],
      issuers: [{ securityId: XOM, issuerLegalEntityId: EXXON }],
      classifications: [later],
      query,
      code: null,
    });

    expect(population.unclassified[0]!.reason).toBe("not_effective_at_cutoff");
  });

  it("names a security whose issuer is unknown", () => {
    const population = resolveSectorPopulation({
      indexId: "sp-500",
      memberships: [membership(XOM)],
      issuers: [],
      classifications: [],
      query,
      code: null,
    });

    expect(population.unclassified[0]!.reason).toBe("issuer_unknown");
  });

  it("ignores memberships of another index", () => {
    const population = resolveSectorPopulation({
      indexId: "sp-500",
      memberships: [membership(XOM, { indexId: "nasdaq-100" })],
      issuers: [{ securityId: XOM, issuerLegalEntityId: EXXON }],
      classifications: [classification(EXXON, "energy", "Energy")],
      query,
      code: null,
    });

    expect(population.members).toHaveLength(0);
    expect(population.unclassified).toHaveLength(0);
  });
});
