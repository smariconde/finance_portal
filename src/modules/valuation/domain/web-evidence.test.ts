import { describe, expect, it } from "vitest";

import { DEMO_QUALITATIVE_DECISIONS } from "../infrastructure/demo-valuation-fixtures";

import { industryEvidenceRecordSchema } from "./industry-resolution";
import {
  evidenceDigestSchema,
  QUALITATIVE_DECISIONS_VERSION,
  qualitativeDecisionsSchema,
} from "./qualitative-decisions";

/** La evidencia web de `F5-04`: sin filing, y sólo ella sin filing. */
const filing = {
  evidenceId: "E1",
  sourceId: "sec-edgar",
  section: "item_1_business" as const,
  documentUrl: "https://www.sec.gov/Archives/edgar/data/42/x/fix-20251231.htm",
  accessionNumber: "0000000042-26-000001",
  documentAcceptedAt: "2026-02-20T21:00:00.000Z",
  sha256: "a".repeat(64),
  byteLength: 10,
  truncated: false,
};
const web = {
  ...filing,
  evidenceId: "E3",
  sourceId: "tavily",
  section: "web_search" as const,
  documentUrl: "https://example.com/fixture",
  accessionNumber: null,
  documentAcceptedAt: null,
};

describe("web search evidence", () => {
  it("is stored and frozen without a filing", () => {
    expect(
      industryEvidenceRecordSchema.safeParse({ ...web, excerpt: "x" }).success,
    ).toBe(true);
    expect(evidenceDigestSchema.safeParse(web).success).toBe(true);
  });

  it("refuses a filing excerpt without its filing, or a web result that claims one", () => {
    expect(
      evidenceDigestSchema.safeParse({ ...filing, accessionNumber: null })
        .success,
    ).toBe(false);
    expect(
      evidenceDigestSchema.safeParse({
        ...web,
        accessionNumber: filing.accessionNumber,
      }).success,
    ).toBe(false);
    expect(
      industryEvidenceRecordSchema.safeParse({
        ...filing,
        documentAcceptedAt: null,
        excerpt: "x",
      }).success,
    ).toBe(false);
  });

  it("keeps reading a 1.0.0 snapshot while writing 1.1.0", () => {
    expect(QUALITATIVE_DECISIONS_VERSION).toBe("qualitative-decisions-1.1.0");
    expect(DEMO_QUALITATIVE_DECISIONS.version).toBe(
      "qualitative-decisions-1.0.0",
    );
    expect(
      qualitativeDecisionsSchema.safeParse({
        ...DEMO_QUALITATIVE_DECISIONS,
        version: "qualitative-decisions-0.9.0",
      }).success,
    ).toBe(false);
  });
});
