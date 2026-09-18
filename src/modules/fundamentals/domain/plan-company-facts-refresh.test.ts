import { describe, expect, it } from "vitest";

import {
  identityGraphSchema,
  type IdentityGraph,
} from "@/modules/identity/domain/identity-graph";

import {
  planCompanyFactsRefresh,
  type PublishedFilerSubject,
} from "./plan-company-facts-refresh";

const RECORDED_AT = "2026-09-05T01:00:00.000Z";

const provenance = {
  validFrom: RECORDED_AT,
  validTo: null,
  availableAt: RECORDED_AT,
  supersededAt: null,
  sourceId: "datahub-sp500-pddl",
  sourceDocumentId: null,
  contentHash: "e".repeat(64),
  recordedAt: RECORDED_AT,
};

const id = (suffix: string) =>
  `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

type Issuer = {
  readonly entity: string;
  readonly ciks: readonly string[];
  readonly securities: readonly { id: string; ticker: string }[];
};

/** Grafo sintético: emisores con sus securities, un listing y un ticker cada una. */
function buildGraph(issuers: readonly Issuer[]): IdentityGraph {
  return identityGraphSchema.parse({
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
    identifierAssignments: issuers.flatMap((issuer) =>
      issuer.ciks.map((cik, index) => ({
        ...provenance,
        identifierAssignmentId: id(`a${issuer.entity.slice(-2)}${index}`),
        subjectType: "legal_entity",
        subjectId: issuer.entity,
        identifierType: "cik",
        identifierValue: String(Number(cik)),
        normalizedValue: cik,
        scope: "sec:filer",
        issuingAuthority: "SEC",
        confidence: "authoritative",
      })),
    ),
  });
}

function published(
  subjectId: string,
  overrides: Partial<PublishedFilerSubject> = {},
): PublishedFilerSubject {
  return {
    subjectType: "legal_entity",
    subjectId,
    observations: 100,
    latestAvailableAt: "2026-07-31T10:01:02.000Z",
    ...overrides,
  };
}

const ALPHA = id("e1");
const BETA = id("e2");
const PREDECESSOR = id("e3");
const NO_CIK = id("e4");
const TWO_CIKS = id("e5");
const UNKNOWN = id("e9");

describe("planCompanyFactsRefresh", () => {
  it("sigue a los sujetos con datos publicados, ordenados por CIK y con sus símbolos", () => {
    const graph = buildGraph([
      {
        entity: BETA,
        ciks: ["0000000200"],
        securities: [{ id: id("5b1"), ticker: "BBB" }],
      },
      {
        entity: ALPHA,
        ciks: ["0000000100"],
        securities: [
          { id: id("5a1"), ticker: "AAAA" },
          { id: id("5a2"), ticker: "AAA" },
        ],
      },
    ]);

    const plan = planCompanyFactsRefresh({
      published: [published(BETA), published(ALPHA, { observations: 42 })],
      graph,
    });

    expect(plan.planVersion).toBe("companyfacts-refresh-plan-1.0.0");
    expect(plan.published).toBe(2);
    expect(plan.rejections).toEqual([]);
    expect(plan.subjects).toEqual([
      {
        cik: "0000000100",
        legalEntityId: ALPHA,
        observations: 42,
        latestAvailableAt: "2026-07-31T10:01:02.000Z",
        // Las dos clases del mismo emisor son un solo filer: el CIK es de la
        // entidad legal.
        symbols: ["AAA", "AAAA"],
      },
      {
        cik: "0000000200",
        legalEntityId: BETA,
        observations: 100,
        latestAvailableAt: "2026-07-31T10:01:02.000Z",
        symbols: ["BBB"],
      },
    ]);
  });

  it("es exactamente lo publicado: un emisor del grafo sin datos no se sigue", () => {
    const graph = buildGraph([
      {
        entity: ALPHA,
        ciks: ["0000000100"],
        securities: [{ id: id("5a1"), ticker: "AAA" }],
      },
      {
        entity: BETA,
        ciks: ["0000000200"],
        securities: [{ id: id("5b1"), ticker: "BBB" }],
      },
    ]);

    const plan = planCompanyFactsRefresh({
      published: [published(ALPHA)],
      graph,
    });

    expect(plan.subjects.map((subject) => subject.cik)).toEqual(["0000000100"]);
  });

  it("incluye al antecesor de reporte, que entra sin símbolo vigente", () => {
    const graph = buildGraph([
      {
        entity: ALPHA,
        ciks: ["0000000100"],
        securities: [{ id: id("5a1"), ticker: "AAA" }],
      },
      { entity: PREDECESSOR, ciks: ["0000000099"], securities: [] },
    ]);

    const plan = planCompanyFactsRefresh({
      published: [published(ALPHA), published(PREDECESSOR)],
      graph,
    });

    expect(plan.subjects).toHaveLength(2);
    expect(
      plan.subjects.find((subject) => subject.cik === "0000000099")?.symbols,
    ).toEqual([]);
  });

  it("rechaza por nombre lo que no resuelve a un filer con CIK vigente", () => {
    const graph = buildGraph([
      {
        entity: ALPHA,
        ciks: ["0000000100"],
        securities: [{ id: id("5a1"), ticker: "AAA" }],
      },
      { entity: NO_CIK, ciks: [], securities: [] },
      {
        entity: TWO_CIKS,
        ciks: ["0000000300", "0000000301"],
        securities: [],
      },
    ]);

    const plan = planCompanyFactsRefresh({
      published: [
        published(ALPHA),
        published(NO_CIK),
        published(TWO_CIKS),
        published(UNKNOWN),
        published(id("5a1"), { subjectType: "security" }),
      ],
      graph,
    });

    expect(plan.subjects.map((subject) => subject.cik)).toEqual(["0000000100"]);
    expect(plan.published).toBe(5);
    expect(plan.rejections).toEqual([
      { code: "issuer_without_cik", subjectId: NO_CIK },
      { code: "issuer_with_several_ciks", subjectId: TWO_CIKS },
      { code: "subject_not_in_graph", subjectId: UNKNOWN },
      { code: "subject_not_a_filer", subjectId: id("5a1") },
    ]);
  });

  it("no sigue a un sujeto cuya entidad legal dejó de estar vigente", () => {
    const graph = identityGraphSchema.parse({
      ...buildGraph([
        {
          entity: ALPHA,
          ciks: ["0000000100"],
          securities: [{ id: id("5a1"), ticker: "AAA" }],
        },
      ]),
      legalEntities: [
        {
          ...provenance,
          validTo: "2026-09-10T00:00:00.000Z",
          legalEntityId: ALPHA,
          legalName: "Emisor cerrado",
          entityType: "operating_company",
          jurisdiction: null,
          status: "merged",
        },
      ],
    });

    const plan = planCompanyFactsRefresh({
      published: [published(ALPHA)],
      graph,
    });

    expect(plan.subjects).toEqual([]);
    expect(plan.rejections).toEqual([
      { code: "subject_not_in_graph", subjectId: ALPHA },
    ]);
  });
});
