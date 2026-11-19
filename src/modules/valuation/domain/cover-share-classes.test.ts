import { describe, expect, it } from "vitest";

import type { CoverShareFact } from "@/modules/fundamentals/domain/sec-xbrl-instance";

import {
  SHARES_OUTSTANDING_CLASSES_VERSION,
  sumCoverShareClasses,
} from "./cover-share-classes";

const CIK = "0001321655";
const fact = (
  member: string,
  value: string,
  overrides: Partial<CoverShareFact> = {},
): CoverShareFact => ({
  contextId: member,
  cik: CIK,
  instant: "2026-10-26",
  members: [{ axis: "StatementClassOfStockAxis", member }],
  typed: false,
  value,
  ...overrides,
});
const sum = (facts: readonly CoverShareFact[], cik = CIK) =>
  sumCoverShareClasses({
    cik,
    facts,
    accessionNumber: "0001321655-26-000099",
    acceptedAt: "2026-11-03T21:05:00.000Z",
  });

describe(SHARES_OUTSTANDING_CLASSES_VERSION, () => {
  // PLTR, 10-Q del 2026-09-30: A, B y F.
  it("sums every class at the cover date and cites the filing", () => {
    expect(
      sum([
        fact("CommonClassAMember", "2306705341"),
        fact("CommonClassBMember", "101787133"),
        fact("CommonClassFMember", "1005000"),
      ]),
    ).toEqual({
      status: "summed",
      observation: {
        concept: "dei:EntityCommonStockSharesOutstanding",
        asOf: "2026-10-26",
        availableAt: "2026-11-03T21:05:00.000Z",
        value: "2409497474",
        observationId: null,
        sourceDocumentId: "0001321655-26-000099",
        qualityFlags: [SHARES_OUTSTANDING_CLASSES_VERSION],
      },
      classes: [
        { member: "CommonClassAMember", shares: "2306705341", weight: "1" },
        { member: "CommonClassBMember", shares: "101787133", weight: "1" },
        { member: "CommonClassFMember", shares: "1005000", weight: "1" },
      ],
    });
  });

  it("weighs Berkshire's class A in class B shares, as declared", () => {
    const result = sum(
      [
        fact("CommonClassAMember", "480476", { cik: "0001067983" }),
        fact("CommonClassBMember", "1403805594", { cik: "0001067983" }),
      ],
      "0001067983",
    );
    expect(result).toMatchObject({
      status: "summed",
      observation: {
        value: "2124519594",
        qualityFlags: [
          SHARES_OUTSTANDING_CLASSES_VERSION,
          "share_class_weights_declared",
        ],
      },
    });
  });

  it("leaves a single class to the undimensioned rule", () => {
    expect(sum([fact("CommonClassAMember", "10")])).toEqual({
      status: "unavailable",
      reason: "single_class",
    });
  });

  it("refuses classes counted at different dates", () => {
    expect(
      sum([
        fact("CommonClassAMember", "10"),
        fact("CommonClassBMember", "5", { instant: "2026-10-27" }),
      ]),
    ).toEqual({ status: "unavailable", reason: "class_dates_differ" });
  });

  it("refuses a count on another axis or with a second member", () => {
    expect(
      sum([
        fact("CommonClassAMember", "10"),
        fact("CommonClassBMember", "5", {
          members: [
            { axis: "StatementClassOfStockAxis", member: "CommonClassBMember" },
            { axis: "LegalEntityAxis", member: "SubsidiaryMember" },
          ],
        }),
      ]),
    ).toEqual({ status: "unavailable", reason: "class_member_ambiguous" });
  });

  it("ignores another filer's facts", () => {
    expect(
      sum([
        fact("CommonClassAMember", "10", { cik: "0000000099" }),
        fact("CommonClassBMember", "5", { cik: "0000000099" }),
      ]),
    ).toEqual({ status: "unavailable", reason: "no_class_facts" });
  });
});
