import { describe, expect, it } from "vitest";

import {
  businessLinesText,
  readBusinessLines,
} from "./sec-xbrl-business-lines";
import { readXbrlInstance, type XbrlInstance } from "./sec-xbrl-instance";

const CIK = "0000000042";
const FY = "2025-12-31";
const SEGMENT = "us-gaap:StatementBusinessSegmentsAxis";
const PRODUCT = "srt:ProductOrServiceAxis";
const OPERATING: [string, string] = [
  "srt:ConsolidationItemsAxis",
  "srt:OperatingSegmentsMember",
];

function context(
  id: string,
  members: readonly [string, string][],
  options: { start?: string; end?: string; cik?: string } = {},
): string {
  const segment =
    members.length === 0
      ? ""
      : `<segment>${members
          .map(
            ([axis, member]) =>
              `<xbrldi:explicitMember dimension="${axis}">${member}</xbrldi:explicitMember>`,
          )
          .join("")}</segment>`;
  return `<context id="${id}"><entity><identifier scheme="http://www.sec.gov/CIK">${options.cik ?? CIK}</identifier>${segment}</entity><period><startDate>${options.start ?? "2025-01-01"}</startDate><endDate>${options.end ?? FY}</endDate></period></context>`;
}

const fact = (concept: string, contextId: string, value: string) =>
  `<gaap:${concept} contextRef="${contextId}" unitRef="usd" decimals="-6">${value}</gaap:${concept}>`;

function instanceOf(body: string): XbrlInstance {
  const read = readXbrlInstance(`<?xml version="1.0" encoding="utf-8"?>
<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:acme="http://www.acme.example/20251231" xmlns:gaap="http://fasb.org/us-gaap/2025" xmlns:srt="http://fasb.org/srt/2025" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<unit id="usd"><measure>iso4217:USD</measure></unit>
${context("total", [])}
${body}
</xbrl>`);
  if (read.status !== "read") throw new Error(read.reason);
  return read.instance;
}

const REVENUE = "RevenueFromContractWithCustomerExcludingAssessedTax";

describe("sec-xbrl-business-lines-1.0.0", () => {
  it("offers both axes, each with its own concept, largest first", () => {
    const instance = instanceOf(`
${context("s1", [[SEGMENT, "acme:ServicesMember"]])}
${context("s2", [[SEGMENT, "acme:CloudMember"]])}
${context("p1", [[PRODUCT, "acme:AdsMember"]])}
${context("p2", [[PRODUCT, "acme:SubscriptionsMember"]])}
${fact(REVENUE, "s1", "342721000000")}
${fact(REVENUE, "s2", "58705000000")}
${fact("Revenues", "p1", "1000")}
${fact("Revenues", "p2", "9000")}
${fact(REVENUE, "total", "401426000000")}`);

    expect(
      readBusinessLines(instance, { cik: CIK, fiscalYearEnd: FY }),
    ).toEqual({
      version: "sec-xbrl-business-lines-1.0.0",
      fiscalYearEnd: FY,
      lines: [
        {
          lineId: "L1",
          axis: "StatementBusinessSegmentsAxis",
          member: "ServicesMember",
          concept: `us-gaap:${REVENUE}`,
          amount: "342721000000",
        },
        {
          lineId: "L2",
          axis: "StatementBusinessSegmentsAxis",
          member: "CloudMember",
          concept: `us-gaap:${REVENUE}`,
          amount: "58705000000",
        },
        {
          lineId: "L3",
          axis: "ProductOrServiceAxis",
          member: "SubscriptionsMember",
          concept: "us-gaap:Revenues",
          amount: "9000",
        },
        {
          lineId: "L4",
          axis: "ProductOrServiceAxis",
          member: "AdsMember",
          concept: "us-gaap:Revenues",
          amount: "1000",
        },
      ],
    });
  });

  it("reads a segment tagged with the operating-segments member, not a cross", () => {
    const instance = instanceOf(`
${context("a", [OPERATING, [SEGMENT, "acme:UsMember"]])}
${context("b", [OPERATING, [SEGMENT, "acme:InternationalMember"]])}
${context("x", [
  [SEGMENT, "acme:UsMember"],
  ["srt:StatementGeographicalAxis", "country:CA"],
])}
${fact("Revenues", "a", "700")}
${fact("Revenues", "b", "300")}
${fact("Revenues", "x", "50")}`);

    const lines = readBusinessLines(instance, { cik: CIK, fiscalYearEnd: FY });
    expect(lines?.lines.map((line) => [line.member, line.amount])).toEqual([
      ["UsMember", "700"],
      ["InternationalMember", "300"],
    ]);
  });

  it("drops a member published with two values and lines that are not positive", () => {
    const instance = instanceOf(`
${context("a", [[SEGMENT, "acme:AMember"]])}
${context("a2", [OPERATING, [SEGMENT, "acme:AMember"]])}
${context("b", [[SEGMENT, "acme:BMember"]])}
${context("c", [[SEGMENT, "acme:CMember"]])}
${context("d", [[SEGMENT, "acme:DMember"]])}
${fact("Revenues", "a", "10")}
${fact("Revenues", "a2", "11")}
${fact("Revenues", "b", "20")}
${fact("Revenues", "c", "0")}
${fact("Revenues", "d", "30")}`);

    expect(
      readBusinessLines(instance, { cik: CIK, fiscalYearEnd: FY })?.lines.map(
        (line) => line.member,
      ),
    ).toEqual(["DMember", "BMember"]);
  });

  it("ignores quarters, another filer and another fiscal year", () => {
    const instance = instanceOf(`
${context("q1", [[SEGMENT, "acme:AMember"]], { start: "2025-10-01" })}
${context("q2", [[SEGMENT, "acme:BMember"]], { start: "2025-10-01" })}
${context("o1", [[SEGMENT, "acme:AMember"]], { cik: "0000000099" })}
${context("o2", [[SEGMENT, "acme:BMember"]], { cik: "0000000099" })}
${context("y1", [[SEGMENT, "acme:AMember"]], { start: "2024-01-01", end: "2024-12-31" })}
${context("y2", [[SEGMENT, "acme:BMember"]], { start: "2024-01-01", end: "2024-12-31" })}
${fact("Revenues", "q1", "1")}
${fact("Revenues", "q2", "2")}
${fact("Revenues", "o1", "3")}
${fact("Revenues", "o2", "4")}
${fact("Revenues", "y1", "5")}
${fact("Revenues", "y2", "6")}`);

    expect(
      readBusinessLines(instance, { cik: CIK, fiscalYearEnd: FY }),
    ).toBeNull();
  });

  it("offers nothing for a single segment", () => {
    const instance = instanceOf(`
${context("a", [OPERATING, [SEGMENT, "acme:ReportableSegmentMember"]])}
${fact(REVENUE, "a", "23232690000")}`);

    expect(
      readBusinessLines(instance, { cik: CIK, fiscalYearEnd: FY }),
    ).toBeNull();
  });

  it("writes the lines the model sees as plain text", () => {
    const instance = instanceOf(`
${context("a", [[PRODUCT, "acme:OpticalMember"]])}
${context("b", [[PRODUCT, "acme:DisplayMember"]])}
${fact("Revenues", "a", "6274000000")}
${fact("Revenues", "b", "2965000000")}`);
    const lines = readBusinessLines(instance, { cik: CIK, fiscalYearEnd: FY })!;

    expect(businessLinesText(lines)).toBe(
      [
        "Revenue by business line, fiscal year ended 2025-12-31, in USD, from the 10-K's XBRL:",
        "L1 | ProductOrServiceAxis | OpticalMember | 6274000000",
        "L2 | ProductOrServiceAxis | DisplayMember | 2965000000",
      ].join("\n"),
    );
  });
});
