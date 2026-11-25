import { describe, expect, it } from "vitest";

import { readXbrlShareFacts } from "@/modules/fundamentals/domain/sec-xbrl-instance";

import {
  NONCONTROLLING_INTEREST_EVIDENCE_VERSION,
  NONCONTROLLING_INTEREST_US_GAAP_CONCEPTS,
  noncontrollingInterestEvidence,
} from "./noncontrolling-interest-evidence";

const CIK = "0000000042";
const CLOSE = "2026-09-30";
const TOTAL =
  "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest";

function context(id: string, member: string | null, date = CLOSE): string {
  const segment =
    member === null
      ? ""
      : `<segment><xbrldi:explicitMember dimension="us-gaap:StatementEquityComponentsAxis">us-gaap:${member}</xbrldi:explicitMember></segment>`;
  return `<context id="${id}"><entity><identifier scheme="http://www.sec.gov/CIK">${CIK}</identifier>${segment}</entity><period><instant>${date}</instant></period></context>`;
}

const equity = (contextId: string, value: string, concept = TOTAL) =>
  `<us-gaap:${concept} contextRef="${contextId}" unitRef="usd" decimals="-6">${value}</us-gaap:${concept}>`;

function evidence(facts: string) {
  const xml = `<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<unit id="usd"><measure>iso4217:USD</measure></unit>
${context("total", null)}
${context("common", "CommonStockIncludingAdditionalPaidInCapitalMember")}
${context("retained", "RetainedEarningsMember")}
${context("aoci", "AccumulatedOtherComprehensiveIncomeMember")}
${context("nci", "NoncontrollingInterestMember")}
${context("prior", null, "2025-09-30")}
${facts}
</xbrl>`;
  const read = readXbrlShareFacts(xml, {
    usGaap: NONCONTROLLING_INTEREST_US_GAAP_CONCEPTS,
    extension: [],
  });
  if (read.status !== "read") throw new Error("synthetic instance rejected");
  return noncontrollingInterestEvidence({
    cik: CIK,
    asOf: CLOSE,
    accessionNumber: "0000000042-26-000134",
    read: read.read,
  });
}

const COMPLETE = [
  equity("total", "36111000000"),
  equity("common", "22850000000"),
  equity("retained", "13513000000"),
  equity("aoci", "-252000000"),
];

describe(NONCONTROLLING_INTEREST_EVIDENCE_VERSION, () => {
  it("reads zero when every component adds up to the total and none is noncontrolling", () => {
    expect(evidence(COMPLETE.join("\n"))).toEqual({
      status: "zero",
      version: NONCONTROLLING_INTEREST_EVIDENCE_VERSION,
      accessionNumber: "0000000042-26-000134",
      asOf: CLOSE,
      total: "36111000000",
      components: 3,
    });
  });

  it("accepts a noncontrolling column published as zero", () => {
    expect(
      evidence([...COMPLETE, equity("nci", "0")].join("\n")),
    ).toMatchObject({ status: "zero", components: 4 });
  });

  it("never reads a noncontrolling amount as zero", () => {
    expect(
      evidence(
        [
          equity("total", "36111000000"),
          equity("common", "22850000000"),
          equity("retained", "13261000000"),
          equity("nci", "0"),
          equity("aoci", "0"),
          equity("total", "5", "MinorityInterest"),
        ].join("\n"),
      ),
    ).toEqual({ status: "unavailable", reason: "noncontrolling_reported" });
    expect(
      evidence(
        [
          equity("total", "36111000000"),
          equity("common", "22850000000"),
          equity("retained", "13011000000"),
          equity("nci", "250000000"),
        ].join("\n"),
      ),
    ).toEqual({ status: "unavailable", reason: "noncontrolling_reported" });
  });

  it("proves nothing with a statement that does not add up or is not there", () => {
    expect(
      evidence(
        [
          equity("total", "36111000000"),
          equity("common", "22850000000"),
          equity("retained", "13000000000"),
        ].join("\n"),
      ),
    ).toEqual({ status: "unavailable", reason: "components_do_not_add_up" });
    expect(
      evidence(
        [equity("total", "36111000000"), equity("common", "36111000000")].join(
          "\n",
        ),
      ),
    ).toEqual({ status: "unavailable", reason: "components_missing" });
    expect(evidence(equity("prior", "1"))).toEqual({
      status: "unavailable",
      reason: "total_missing",
    });
  });
});
