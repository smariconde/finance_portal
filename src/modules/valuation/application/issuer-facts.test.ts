import { describe, expect, it } from "vitest";

import {
  DEMO_IDENTITY_GRAPH,
  DEMO_IDENTITY_IDS,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";

import { issuerFactsAt } from "./issuer-facts";

const query = pointInTimeQuerySchema.parse({
  effectiveAt: "2026-10-21T15:00:00.000Z",
  knownAt: "2026-10-21T15:00:00.000Z",
  revisionPolicy: "as_known",
  adjustmentPolicy: "as_known",
  knowledgeBasis: "public_availability",
  sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
});

describe("issuerFactsAt", () => {
  it("lee el CIK y el país vigentes al corte", () => {
    expect(
      issuerFactsAt(
        DEMO_IDENTITY_GRAPH,
        DEMO_IDENTITY_IDS.fixtureCoEntity,
        DEMO_IDENTITY_IDS.fixtureCoXnasListing,
        query,
      ),
    ).toEqual({ cik: "0000999901", listingCountry: "US" });
  });

  it("un corte anterior a la asignación no ve el CIK", () => {
    const early = pointInTimeQuerySchema.parse({
      ...query,
      effectiveAt: "2009-01-01T00:00:00.000Z",
      knownAt: "2009-01-01T00:00:00.000Z",
    });

    expect(
      issuerFactsAt(
        DEMO_IDENTITY_GRAPH,
        DEMO_IDENTITY_IDS.fixtureCoEntity,
        DEMO_IDENTITY_IDS.fixtureCoXnasListing,
        early,
      ),
    ).toEqual({ cik: null, listingCountry: null });
  });
});
