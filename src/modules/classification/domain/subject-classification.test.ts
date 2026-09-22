import { describe, expect, it } from "vitest";

import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";
import { TemporalContractError } from "@/modules/temporal/domain/temporal-error";

import {
  isOpenClassification,
  resolveClassificationAt,
  subjectClassificationSchema,
  type SubjectClassification,
} from "./subject-classification";
import { SP500_SECTOR_TAXONOMY_ID } from "./sector-taxonomy";

const APPLE = "11111111-1111-4111-8111-111111111111";

function classification(
  overrides: Partial<SubjectClassification> = {},
): SubjectClassification {
  return subjectClassificationSchema.parse({
    classificationAssignmentId: "44444444-4444-4444-8444-444444444444",
    subjectType: "legal_entity",
    subjectId: APPLE,
    taxonomyId: SP500_SECTOR_TAXONOMY_ID,
    taxonomyVersion: "a".repeat(40),
    code: "information-technology",
    label: "Information Technology",
    validFrom: "2026-06-01T00:00:00.000Z",
    validTo: null,
    availableAt: "2026-06-01T00:00:00.000Z",
    supersededAt: null,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    contentHash: "a".repeat(64),
    recordedAt: "2026-06-02T00:00:00.000Z",
    ...overrides,
  });
}

describe("subjectClassificationSchema", () => {
  it("rejects a code that is not kebab-case", () => {
    expect(() => classification({ code: "Information Technology" })).toThrow();
  });

  it("rejects a taxonomy id that is not kebab-case", () => {
    expect(() => classification({ taxonomyId: "GICS_Sector" })).toThrow();
  });

  it("rejects superseding before the fact could be known", () => {
    expect(() =>
      classification({ supersededAt: "2026-05-01T00:00:00.000Z" }),
    ).toThrow();
  });
});

describe("resolveClassificationAt", () => {
  const query = pointInTimeQuerySchema.parse({
    effectiveAt: "2026-08-01T00:00:00.000Z",
    knownAt: "2026-08-01T00:00:00.000Z",
    revisionPolicy: "as_known",
    sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
  });

  it("returns the assertion effective and known at the cutoff", () => {
    const result = resolveClassificationAt(
      [classification()],
      SP500_SECTOR_TAXONOMY_ID,
      query,
      APPLE,
    );

    expect(result.classified).toBe(true);
  });

  it("does not see an assertion the pin published later", () => {
    // `TM-06`: un `as_known` anterior al commit no ve la clasificación de ese
    // commit, porque antes del commit no existía.
    const later = classification({
      validFrom: "2026-09-05T01:39:10.000Z",
      availableAt: "2026-09-05T01:39:10.000Z",
    });

    const result = resolveClassificationAt(
      [later],
      SP500_SECTOR_TAXONOMY_ID,
      query,
      APPLE,
    );

    expect(result).toEqual({
      classified: false,
      absence: "not_effective_at_cutoff",
    });
  });

  it("distinguishes never classified from not effective yet", () => {
    const result = resolveClassificationAt(
      [],
      SP500_SECTOR_TAXONOMY_ID,
      query,
      APPLE,
    );

    expect(result).toEqual({
      classified: false,
      absence: "never_classified",
    });
  });

  it("does not answer with another taxonomy's assertion", () => {
    const archetype = classification({ taxonomyId: "valuation-archetype" });

    const result = resolveClassificationAt(
      [archetype],
      SP500_SECTOR_TAXONOMY_ID,
      query,
      APPLE,
    );

    expect(result).toEqual({
      classified: false,
      absence: "never_classified",
    });
  });

  it("declares two effective assertions instead of picking one", () => {
    const duplicate = classification({
      classificationAssignmentId: "55555555-5555-4555-8555-555555555555",
      code: "financials",
      label: "Financials",
    });

    expect(() =>
      resolveClassificationAt(
        [classification(), duplicate],
        SP500_SECTOR_TAXONOMY_ID,
        query,
        APPLE,
      ),
    ).toThrow(TemporalContractError);
  });
});

describe("isOpenClassification", () => {
  it("is false once superseded", () => {
    expect(
      isOpenClassification(
        classification({ supersededAt: "2026-09-05T01:39:10.000Z" }),
      ),
    ).toBe(false);
  });
});
