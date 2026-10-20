import { describe, expect, it } from "vitest";

import {
  evalCorpusManifestSchema,
  loadEvalCorpusManifest,
} from "./eval-corpus";
import { readEmployeeEquityCorroboration } from "./employee-equity-corpus";

const declared = {
  cik: "0000000001",
  accessionNumber: "0000000001-26-000001",
  fiscalYearEnd: "2025-12-31",
};
function fixture() {
  const manifest = loadEvalCorpusManifest();
  manifest.employeeEquityXbrl = (
    ["optionsOutstanding", "weightedStrike"] as const
  ).map((field) => ({
    ...declared,
    field,
    sourceUrl:
      "https://data.sec.gov/api/xbrl/companyconcept/CIK0000000001/us-gaap/Example.json",
    fetchedAt: "2026-10-20T00:00:00.000Z",
    status: 200 as const,
    rawBytes: 100,
    rawSha256: "a".repeat(64),
    parserVersion: "sec-companyconcept-1.0.0",
    values: field === "optionsOutstanding" ? ["100", "100"] : ["20"],
  }));
  return manifest;
}
describe("frozen employee-equity corroboration", () => {
  it("reads one distinct value, and preserves zero and decimal precision", () => {
    const manifest = fixture();
    manifest.employeeEquityXbrl[0]!.values = ["0"];
    manifest.employeeEquityXbrl[1]!.values = ["20.1234567890123456789"];
    expect(readEmployeeEquityCorroboration(manifest, declared)).toEqual({
      optionsOutstanding: "0",
      weightedStrike: "20.1234567890123456789",
    });
  });
  it("treats absent and conflicting observations as unknown", () => {
    const manifest = fixture();
    manifest.employeeEquityXbrl[0]!.values = ["100", "101"];
    manifest.employeeEquityXbrl[1]!.values = [];
    manifest.employeeEquityXbrl[1]!.status = 404;
    expect(readEmployeeEquityCorroboration(manifest, declared)).toEqual({
      optionsOutstanding: null,
      weightedStrike: null,
    });
  });
  it.each(["missing", "duplicate", "wrong_accession", "wrong_end"])(
    "refuses %s corroboration",
    (condition) => {
      const manifest = fixture();
      if (condition === "missing") manifest.employeeEquityXbrl.pop();
      if (condition === "duplicate")
        manifest.employeeEquityXbrl.push(manifest.employeeEquityXbrl[0]!);
      if (condition === "wrong_accession")
        manifest.employeeEquityXbrl[0]!.accessionNumber =
          "0000000001-25-000001";
      if (condition === "wrong_end")
        manifest.employeeEquityXbrl[0]!.fiscalYearEnd = "2024-12-31";
      expect(() => readEmployeeEquityCorroboration(manifest, declared)).toThrow(
        "Missing or inconsistent frozen",
      );
    },
  );
  it("rejects values attributed to a missing concept and nonfinite values", () => {
    const manifest = fixture();
    manifest.employeeEquityXbrl[0]!.status = 404;
    expect(evalCorpusManifestSchema.safeParse(manifest).success).toBe(false);
    manifest.employeeEquityXbrl[0]!.status = 200;
    manifest.employeeEquityXbrl[0]!.values = ["Infinity"];
    expect(evalCorpusManifestSchema.safeParse(manifest).success).toBe(false);
  });
});
