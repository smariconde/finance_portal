import { describe, expect, it } from "vitest";

import {
  legalEntityRelationshipSchema,
  type LegalEntityRelationship,
} from "@/modules/corporate-actions/domain/reporting-succession";
import {
  identityGraphSchema,
  type IdentityGraph,
} from "@/modules/identity/domain/identity-graph";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import {
  indexMembershipSchema,
  type IndexMembership,
} from "@/modules/universe/domain/index-membership";

import { planCompanyFactsBackfill } from "./plan-company-facts-backfill";

const CONSTITUTED_AT = "2026-09-05T01:00:00.000Z";
const CUTOFF = pointInTimeQuerySchema.parse({
  effectiveAt: "2026-09-16T12:00:00.000Z",
  revisionPolicy: "as_known",
  knownAt: "2026-09-16T12:00:00.000Z",
  sourcePolicyVersion: "source-policy-1.0.0",
});

const provenance = {
  validFrom: CONSTITUTED_AT,
  validTo: null,
  availableAt: CONSTITUTED_AT,
  supersededAt: null,
  sourceId: "datahub-sp500-pddl",
  sourceDocumentId: null,
  contentHash: "e".repeat(64),
  recordedAt: CONSTITUTED_AT,
};

const id = (suffix: string) =>
  `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

type Issuer = {
  readonly entity: string;
  readonly cik: string | null;
  readonly securities: readonly { id: string; ticker: string }[];
};

/** Grafo sintético: emisores, securities, un listing y un ticker por security. */
function buildState(
  issuers: readonly Issuer[],
  extraCiks: readonly [string, string][] = [],
) {
  const graph: IdentityGraph = identityGraphSchema.parse({
    legalEntities: issuers.map((issuer) => ({
      ...provenance,
      legalEntityId: issuer.entity,
      legalName: `Emisor ${issuer.entity.slice(-4)}`,
      entityType: "operating_company",
      jurisdiction: null,
      status: "active",
    })),
    securities: issuers.flatMap((issuer) =>
      issuer.securities.map((security) => ({
        ...provenance,
        securityId: security.id,
        issuerLegalEntityId: issuer.entity,
        securityType: "common_equity",
        shareClass: null,
        economicCurrency: "USD",
        status: "active",
      })),
    ),
    listings: issuers.flatMap((issuer) =>
      issuer.securities.map((security) => ({
        ...provenance,
        listingId: `${security.id.slice(0, -1)}f`,
        securityId: security.id,
        mic: "XNAS",
        quoteCurrency: "USD",
        country: "US",
        status: "active",
        primaryListing: true,
      })),
    ),
    listingSymbols: issuers.flatMap((issuer) =>
      issuer.securities.map((security) => ({
        ...provenance,
        listingSymbolId: `${security.id.slice(0, -1)}e`,
        listingId: `${security.id.slice(0, -1)}f`,
        symbol: security.ticker,
        symbolType: "ticker",
      })),
    ),
    depositaryPrograms: [],
    depositaryRatios: [],
    identifierAssignments: [
      ...issuers
        .filter((issuer) => issuer.cik !== null)
        .map((issuer) => [issuer.entity, issuer.cik!] as const),
      ...extraCiks,
    ].map(([entity, cik], index) => ({
      ...provenance,
      identifierAssignmentId: id(`a${index}`),
      subjectType: "legal_entity",
      subjectId: entity,
      identifierType: "cik",
      identifierValue: String(Number(cik)),
      normalizedValue: cik,
      scope: "sec:filer",
      issuingAuthority: "SEC",
      confidence: "authoritative",
    })),
  });
  const memberships: IndexMembership[] = issuers.flatMap((issuer) =>
    issuer.securities.map((security) =>
      indexMembershipSchema.parse({
        ...provenance,
        indexMembershipId: `${security.id.slice(0, -1)}d`,
        indexId: "sp-500",
        securityId: security.id,
      }),
    ),
  );

  return { graph, memberships };
}

function succession(
  predecessor: string,
  successor: string,
): LegalEntityRelationship {
  return legalEntityRelationshipSchema.parse({
    validFrom: "2026-07-01T04:00:00.000Z",
    validTo: null,
    availableAt: "2026-07-01T16:36:49.000Z",
    supersededAt: null,
    sourceId: "sec-edgar",
    sourceDocumentId: "0000000900-26-000001",
    contentHash: "f".repeat(64),
    recordedAt: "2026-09-14T00:00:00.000Z",
    relationshipId: id("1a1"),
    relationshipType: "reporting_successor",
    predecessorLegalEntityId: predecessor,
    successorLegalEntityId: successor,
    corporateActionId: id("ac1"),
    effectiveOn: "2026-07-01",
    decidedBy: "rule",
    decisionRuleVersion: "sec-succession-evidence-1.0.0",
  });
}

const ALPHA = id("e1");
const BETA = id("e2");
const HOLDING = id("e3");
const OLD_OPERATING = id("e4");
const NO_CIK = id("e5");

describe("planCompanyFactsBackfill", () => {
  it("toma un CIK por emisor, ordenado, aunque el emisor tenga dos clases en el índice", () => {
    const { graph, memberships } = buildState([
      {
        entity: BETA,
        cik: "0000000200",
        securities: [{ id: id("5b1"), ticker: "BBB" }],
      },
      {
        entity: ALPHA,
        cik: "0000000100",
        securities: [
          { id: id("5a1"), ticker: "AAAA" },
          { id: id("5a2"), ticker: "AAA" },
        ],
      },
    ]);

    const plan = planCompanyFactsBackfill({
      graph,
      memberships,
      relationships: [],
      indexId: "sp-500",
      cutoff: CUTOFF,
    });

    expect(plan.members).toBe(3);
    expect(plan.rejections).toEqual([]);
    expect(plan.subjects).toEqual([
      {
        cik: "0000000100",
        legalEntityId: ALPHA,
        role: "index_member",
        symbols: ["AAA", "AAAA"],
        successorLegalEntityId: null,
      },
      {
        cik: "0000000200",
        legalEntityId: BETA,
        role: "index_member",
        symbols: ["BBB"],
        successorLegalEntityId: null,
      },
    ]);
  });

  it("suma el antecesor de reporte de un miembro, con su propio CIK", () => {
    const { graph, memberships } = buildState(
      [
        {
          entity: HOLDING,
          cik: "0000000072",
          securities: [{ id: id("5c1"), ticker: "HLD" }],
        },
      ],
      [[OLD_OPERATING, "0000000071"]],
    );

    const plan = planCompanyFactsBackfill({
      graph,
      memberships,
      relationships: [succession(OLD_OPERATING, HOLDING)],
      indexId: "sp-500",
      cutoff: CUTOFF,
    });

    expect(plan.subjects.map((subject) => [subject.cik, subject.role])).toEqual(
      [
        ["0000000071", "reporting_predecessor"],
        ["0000000072", "index_member"],
      ],
    );
    expect(plan.subjects[0]?.successorLegalEntityId).toBe(HOLDING);
  });

  it("no ve un antecesor que todavía no se conocía al corte", () => {
    const { graph, memberships } = buildState(
      [
        {
          entity: HOLDING,
          cik: "0000000072",
          securities: [{ id: id("5c1"), ticker: "HLD" }],
        },
      ],
      [[OLD_OPERATING, "0000000071"]],
    );

    const plan = planCompanyFactsBackfill({
      graph,
      memberships,
      relationships: [succession(OLD_OPERATING, HOLDING)],
      indexId: "sp-500",
      cutoff: pointInTimeQuerySchema.parse({
        ...CUTOFF,
        effectiveAt: "2026-07-01T12:00:00.000Z",
        knownAt: "2026-07-01T12:00:00.000Z",
      }),
    });

    expect(plan.subjects.map((subject) => subject.cik)).toEqual(["0000000072"]);
  });

  it("rechaza con nombre lo que no tiene un CIK único y no inventa uno", () => {
    const { graph, memberships } = buildState(
      [
        {
          entity: NO_CIK,
          cik: null,
          securities: [{ id: id("5d1"), ticker: "NOC" }],
        },
        {
          entity: ALPHA,
          cik: "0000000100",
          securities: [{ id: id("5a1"), ticker: "AAA" }],
        },
        {
          entity: HOLDING,
          cik: "0000000072",
          securities: [{ id: id("5c1"), ticker: "HLD" }],
        },
      ],
      [[ALPHA, "0000000101"]],
    );
    const orphanMembership = indexMembershipSchema.parse({
      ...provenance,
      indexMembershipId: id("dd9"),
      indexId: "sp-500",
      securityId: id("999"),
    });

    const plan = planCompanyFactsBackfill({
      graph,
      memberships: [...memberships, orphanMembership],
      relationships: [succession(OLD_OPERATING, HOLDING)],
      indexId: "sp-500",
      cutoff: CUTOFF,
    });

    expect(plan.subjects.map((subject) => subject.cik)).toEqual(["0000000072"]);
    expect(plan.rejections).toEqual([
      { code: "security_not_in_graph", subjectId: id("999") },
      { code: "issuer_without_cik", subjectId: NO_CIK },
      { code: "issuer_with_several_ciks", subjectId: ALPHA },
      { code: "predecessor_without_cik", subjectId: OLD_OPERATING },
    ]);
  });

  it("ignora membresías cerradas y las de otro índice", () => {
    const { graph, memberships } = buildState([
      {
        entity: ALPHA,
        cik: "0000000100",
        securities: [{ id: id("5a1"), ticker: "AAA" }],
      },
      {
        entity: BETA,
        cik: "0000000200",
        securities: [{ id: id("5b1"), ticker: "BBB" }],
      },
    ]);

    const plan = planCompanyFactsBackfill({
      graph,
      memberships: [
        { ...memberships[0]!, validTo: "2026-09-10T00:00:00.000Z" },
        { ...memberships[1]!, indexId: "other-index" },
      ],
      relationships: [],
      indexId: "sp-500",
      cutoff: CUTOFF,
    });

    expect(plan.members).toBe(0);
    expect(plan.subjects).toEqual([]);
  });
});
