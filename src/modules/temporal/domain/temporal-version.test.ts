import { describe, expect, it } from "vitest";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  pointInTimeQuerySchema,
  type PointInTimeQueryInput,
} from "@/modules/temporal/domain/point-in-time-query";
import { isTemporalContractError } from "@/modules/temporal/domain/temporal-error";
import {
  assertNoOverlappingVersions,
  isEffectiveAt,
  isKnownAt,
  selectEffectiveVersion,
  temporalVersionSchema,
  type TemporalVersion,
} from "@/modules/temporal/domain/temporal-version";

function version(overrides: Partial<TemporalVersion> = {}): TemporalVersion {
  return temporalVersionSchema.parse({
    validFrom: "2024-01-01T00:00:00.000Z",
    validTo: null,
    availableAt: "2024-01-01T00:00:00.000Z",
    supersededAt: null,
    sourceId: "fixture-demo-fundamentals",
    sourceDocumentId: "fixture-document",
    contentHash: computeContentHash({ fixture: true }),
    recordedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  });
}

function query(overrides: Partial<PointInTimeQueryInput> = {}) {
  return pointInTimeQuerySchema.parse({
    effectiveAt: "2024-06-01T00:00:00.000Z",
    revisionPolicy: "as_known",
    knownAt: "2024-06-01T00:00:00.000Z",
    sourcePolicyVersion: "source-policy-1.0.0",
    ...overrides,
  } as PointInTimeQueryInput);
}

describe("isEffectiveAt", () => {
  it("treats the interval as half open on both edges", () => {
    const bounded = version({
      validFrom: "2024-01-01T00:00:00.000Z",
      validTo: "2024-06-01T00:00:00.000Z",
    });

    expect(isEffectiveAt(bounded, "2023-12-31T23:59:59.999Z")).toBe(false);
    expect(isEffectiveAt(bounded, "2024-01-01T00:00:00.000Z")).toBe(true);
    expect(isEffectiveAt(bounded, "2024-05-31T23:59:59.999Z")).toBe(true);
    // El borde superior es exclusivo: sucesor y predecesor pueden tocarse.
    expect(isEffectiveAt(bounded, "2024-06-01T00:00:00.000Z")).toBe(false);
  });

  it("keeps an open interval open without claiming future certainty", () => {
    expect(isEffectiveAt(version(), "2099-01-01T00:00:00.000Z")).toBe(true);
  });
});

describe("isKnownAt", () => {
  const published = version({
    availableAt: "2024-03-01T00:00:00.000Z",
    recordedAt: "2026-01-01T00:00:00.000Z",
  });

  it("excludes a fact that was not yet public at the cutoff", () => {
    expect(
      isKnownAt(published, query({ knownAt: "2024-02-29T23:59:59.999Z" })),
    ).toBe(false);
    expect(
      isKnownAt(published, query({ knownAt: "2024-03-01T00:00:00.000Z" })),
    ).toBe(true);
  });

  it("separates public availability from what this installation had recorded", () => {
    const knownAt = "2024-06-01T00:00:00.000Z";

    expect(
      isKnownAt(
        published,
        query({ knownAt, knowledgeBasis: "public_availability" }),
      ),
    ).toBe(true);
    // Ingesta tardía: era público, pero la instalación todavía no lo tenía.
    expect(
      isKnownAt(
        published,
        query({ knownAt, knowledgeBasis: "system_recorded" }),
      ),
    ).toBe(false);
  });

  it("stops selecting a version from the instant its successor takes over", () => {
    const superseded = version({
      availableAt: "2024-01-01T00:00:00.000Z",
      supersededAt: "2024-05-01T00:00:00.000Z",
    });

    expect(
      isKnownAt(superseded, query({ knownAt: "2024-04-30T23:59:59.999Z" })),
    ).toBe(true);
    expect(
      isKnownAt(superseded, query({ knownAt: "2024-05-01T00:00:00.000Z" })),
    ).toBe(false);
  });

  it("returns only the current version under latest_restated", () => {
    const currentView = query({
      revisionPolicy: "latest_restated",
      knownAt: null,
    } as PointInTimeQueryInput);

    expect(isKnownAt(version(), currentView)).toBe(true);
    expect(
      isKnownAt(
        version({ supersededAt: "2025-01-01T00:00:00.000Z" }),
        currentView,
      ),
    ).toBe(false);
  });
});

describe("selectEffectiveVersion", () => {
  it("returns null instead of guessing when nothing is effective yet", () => {
    const future = version({ validFrom: "2030-01-01T00:00:00.000Z" });

    expect(selectEffectiveVersion([future], query(), "subject")).toBeNull();
  });

  it("refuses to break a tie between two simultaneous authoritative versions", () => {
    expect(() =>
      selectEffectiveVersion([version(), version()], query(), "subject"),
    ).toThrowError(/more than one effective version/iu);

    try {
      selectEffectiveVersion([version(), version()], query(), "subject");
    } catch (error) {
      expect(
        isTemporalContractError(error, "overlapping_effective_versions"),
      ).toBe(true);
    }
  });
});

describe("assertNoOverlappingVersions", () => {
  it("accepts intervals that touch without overlapping", () => {
    expect(() =>
      assertNoOverlappingVersions(
        [
          version({
            validFrom: "2020-01-01T00:00:00.000Z",
            validTo: "2024-06-01T00:00:00.000Z",
          }),
          version({ validFrom: "2024-06-01T00:00:00.000Z" }),
        ],
        "listing",
      ),
    ).not.toThrow();
  });

  it("rejects two authoritative intervals that really overlap", () => {
    expect(() =>
      assertNoOverlappingVersions(
        [
          version({
            validFrom: "2020-01-01T00:00:00.000Z",
            validTo: "2024-07-01T00:00:00.000Z",
          }),
          version({ validFrom: "2024-06-01T00:00:00.000Z" }),
        ],
        "listing",
      ),
    ).toThrowError(/overlap/iu);
  });

  it("ignores versions already superseded by a later revision", () => {
    expect(() =>
      assertNoOverlappingVersions(
        [
          version({ supersededAt: "2024-07-15T00:00:00.000Z" }),
          version({ validFrom: "2024-01-01T00:00:00.000Z" }),
        ],
        "ratio",
      ),
    ).not.toThrow();
  });
});

describe("temporalVersionSchema", () => {
  it("rejects an empty or inverted effective interval", () => {
    expect(() =>
      version({
        validFrom: "2024-06-01T00:00:00.000Z",
        validTo: "2024-06-01T00:00:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      version({
        validFrom: "2024-06-01T00:00:00.000Z",
        validTo: "2024-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects a supersession that precedes its own publication", () => {
    expect(() =>
      version({
        availableAt: "2024-06-01T00:00:00.000Z",
        supersededAt: "2024-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("pointInTimeQuerySchema", () => {
  it("requires a finite cutoff for as_known", () => {
    expect(() =>
      pointInTimeQuerySchema.parse({
        effectiveAt: "2024-06-01T00:00:00.000Z",
        revisionPolicy: "as_known",
        knownAt: null,
        sourcePolicyVersion: "source-policy-1.0.0",
      }),
    ).toThrow();
  });

  it("refuses a latest_restated query that pretends to have a cutoff", () => {
    expect(() =>
      pointInTimeQuerySchema.parse({
        effectiveAt: "2024-06-01T00:00:00.000Z",
        revisionPolicy: "latest_restated",
        knownAt: "2024-06-01T00:00:00.000Z",
        sourcePolicyVersion: "source-policy-1.0.0",
      }),
    ).toThrow();
  });

  it("keeps public availability as the only basis of a current view", () => {
    expect(() =>
      pointInTimeQuerySchema.parse({
        effectiveAt: "2024-06-01T00:00:00.000Z",
        revisionPolicy: "latest_restated",
        knowledgeBasis: "system_recorded",
        sourcePolicyVersion: "source-policy-1.0.0",
      }),
    ).toThrow();
  });
});
