import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import appleSubmissions from "@/modules/fundamentals/infrastructure/golden/0000320193/submissions.json";

import {
  planSecSicClassification,
  projectClassificationPlan,
  readSecSic,
  SEC_SIC_TAXONOMY_ID,
  type SecSicObservation,
} from "./sec-sic-classification";
import type { SubjectClassification } from "./subject-classification";

const SUBJECT = "11111111-1111-4111-8111-111111111111";
const FIRST = "2026-10-02T12:00:00.000Z";
const SECOND = "2026-11-02T12:00:00.000Z";

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function ids() {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  };
}

function observation(sic: string, observedAt = FIRST): SecSicObservation {
  return {
    subjectId: SUBJECT,
    reading: { sic, description: "Fixture" },
    observedAt,
    sourceId: "sec-edgar",
    sourceDocumentId: "submissions/CIK0000000042.json",
  };
}

function plan(
  sic: string,
  stored: readonly SubjectClassification[] = [],
  observedAt = FIRST,
) {
  return planSecSicClassification({
    observation: observation(sic, observedAt),
    stored,
    recordedAt: observedAt,
    taxonomyVersion: "sec-submissions-1.0.0",
    newId: ids(),
    hashContent: hash,
  });
}

describe("readSecSic", () => {
  it("reads the frozen Apple submissions as SIC 3571", () => {
    expect(readSecSic(appleSubmissions)).toStrictEqual({
      sic: "3571",
      description: "Electronic Computers",
    });
  });

  it("returns null rather than guessing a missing or malformed SIC", () => {
    const withoutSic = Object.fromEntries(
      Object.entries(appleSubmissions).filter(([key]) => key !== "sic"),
    );
    expect(readSecSic(withoutSic)).toBeNull();
    expect(readSecSic({ ...appleSubmissions, sic: "" })).toBeNull();
    expect(readSecSic({ ...appleSubmissions, sic: "6021<b>" })).toBeNull();
    expect(readSecSic(null)).toBeNull();
  });

  it("keeps the code when the description is absent", () => {
    expect(readSecSic({ sic: "6798" })).toStrictEqual({
      sic: "6798",
      description: null,
    });
  });
});

describe("planSecSicClassification", () => {
  it("opens the first assertion at the observation, not earlier", () => {
    const first = plan("3571");

    expect(first.taxonomyId).toBe(SEC_SIC_TAXONOMY_ID);
    expect(first.counts).toMatchObject({ opened: 1, superseded: 0 });
    expect(first.opened[0]).toMatchObject({
      subjectId: SUBJECT,
      code: "3571",
      label: "3571 Fixture",
      validFrom: FIRST,
      availableAt: FIRST,
      validTo: null,
      supersededAt: null,
    });
  });

  it("writes nothing when the same code is observed again", () => {
    const stored = plan("3571").opened;
    const again = plan("3571", stored, SECOND);

    expect(again.opened).toHaveLength(0);
    expect(again.supersessions).toHaveLength(0);
    expect(again.counts.unchanged).toBe(1);
  });

  it("supersedes at the new observation instead of closing in an unpublished date", () => {
    const stored = plan("3571").opened;
    const changed = plan("6021", stored, SECOND);

    expect(changed.supersessions).toStrictEqual([
      {
        subjectId: SUBJECT,
        validFrom: FIRST,
        supersededAt: SECOND,
        previousCode: "3571",
        nextCode: "6021",
      },
    ]);
    expect(changed.opened[0]).toMatchObject({
      code: "6021",
      validFrom: SECOND,
    });
  });

  it("refuses an observation that does not follow the stored assertion", () => {
    const stored = plan("3571", [], SECOND).opened;

    expect(() => plan("6021", stored, FIRST)).toThrow(
      "does not follow the stored assertion",
    );
  });

  it("projects the plan exactly as the transaction would leave it", () => {
    const stored = plan("3571").opened;
    const changed = plan("6021", stored, SECOND);
    const projected = projectClassificationPlan(stored, changed);

    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({ code: "3571", supersededAt: SECOND });
    expect(projected[1]).toMatchObject({ code: "6021", supersededAt: null });
  });
});
