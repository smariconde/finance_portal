import { describe, expect, it } from "vitest";

import {
  readCoverShares,
  readXbrlInstance,
  readXbrlShareFacts,
  segmentFacts,
} from "./sec-xbrl-instance";

const CIK = "0000000042";

function context(
  id: string,
  period: string,
  members: readonly [string, string][] = [],
  options: { cik?: string; typed?: boolean; prefix?: string } = {},
): string {
  const p = options.prefix ?? "";
  const segment =
    members.length === 0 && options.typed !== true
      ? ""
      : `<${p}segment>${members
          .map(
            ([axis, member]) =>
              `<xbrldi:explicitMember dimension="${axis}">${member}</xbrldi:explicitMember>`,
          )
          .join(
            "",
          )}${options.typed === true ? '<xbrldi:typedMember dimension="acme:LotAxis"><acme:Lot>1</acme:Lot></xbrldi:typedMember>' : ""}</${p}segment>`;
  return `<${p}context id="${id}"><${p}entity><${p}identifier scheme="http://www.sec.gov/CIK">${options.cik ?? CIK}</${p}identifier>${segment}</${p}entity><${p}period>${period}</${p}period></${p}context>`;
}

const instant = (date: string, p = "") => `<${p}instant>${date}</${p}instant>`;
const duration = (start: string, end: string) =>
  `<startDate>${start}</startDate><endDate>${end}</endDate>`;

const INDUSTRIAL: [string, string] = [
  "srt:ProductOrServiceAxis",
  "acme:MachineryMember",
];
const FINANCE: [string, string] = [
  "srt:ProductOrServiceAxis",
  "acme:FinancialProductsMember",
];

function instance(body: string, root = "xbrl", prefixDecl = ""): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<${root} xmlns${prefixDecl}="http://www.xbrl.org/2003/instance" xmlns:acme="http://www.acme.example/20251231" xmlns:gaap="http://fasb.org/us-gaap/2025" xmlns:srt="http://fasb.org/srt/2025" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
${body}
</${root}>`;
}

const UNITS =
  '<unit id="usd"><measure>iso4217:USD</measure></unit><unit id="eur"><measure>iso4217:EUR</measure></unit>';

const BASE = instance(`${UNITS}
${context("c-1", instant("2025-12-31"))}
${context("c-2", instant("2025-12-31"), [INDUSTRIAL])}
${context("c-3", instant("2025-12-31"), [FINANCE])}
${context("c-4", instant("2025-12-31"), [INDUSTRIAL, ["us-gaap:StatementGeographicalAxis", "country:US"]])}
${context("c-5", duration("2025-01-01", "2025-12-31"), [INDUSTRIAL])}
${context("c-6", duration("2025-10-01", "2025-12-31"), [INDUSTRIAL])}
${context("c-7", instant("2025-12-31"), [INDUSTRIAL], { cik: "0000000099" })}
${context("c-8", instant("2025-12-31"), [INDUSTRIAL], { typed: true })}
<gaap:LongTermDebtNoncurrent contextRef="c-1" unitRef="usd" decimals="-6">30696000000</gaap:LongTermDebtNoncurrent>
<gaap:LongTermDebtAndCapitalLeaseObligations contextRef="c-2" unitRef="usd" decimals="-6">10678000000</gaap:LongTermDebtAndCapitalLeaseObligations>
<gaap:LongTermDebtAndCapitalLeaseObligations contextRef="c-3" unitRef="usd" decimals="-6">20018000000</gaap:LongTermDebtAndCapitalLeaseObligations>
<gaap:ShortTermBorrowings contextRef="c-2" unitRef="usd" decimals="-6">0</gaap:ShortTermBorrowings>
<gaap:ShortTermBorrowings contextRef="c-4" unitRef="usd" decimals="-6">7</gaap:ShortTermBorrowings>
<gaap:CommercialPaper contextRef="c-2" unitRef="eur" decimals="-6">5</gaap:CommercialPaper>
<gaap:DebtCurrent contextRef="c-2" unitRef="usd" xsi:nil="true"/>
<gaap:InterestExpenseNonoperating contextRef="c-5" unitRef="usd" decimals="-6">502000000</gaap:InterestExpenseNonoperating>
<gaap:InterestExpenseNonoperating contextRef="c-6" unitRef="usd" decimals="-6">130000000</gaap:InterestExpenseNonoperating>
<gaap:LongTermDebtCurrent contextRef="c-7" unitRef="usd" decimals="-6">99</gaap:LongTermDebtCurrent>
<gaap:LongTermDebtCurrent contextRef="c-8" unitRef="usd" decimals="-6">98</gaap:LongTermDebtCurrent>
<gaap:LongTermDebtAndCapitalLeaseObligationsCurrent contextRef="c-2" unitRef="usd" decimals="-6">35000000</gaap:LongTermDebtAndCapitalLeaseObligationsCurrent>
<gaap:LongTermDebtAndCapitalLeaseObligationsCurrent contextRef="c-2" unitRef="usd" decimals="-6">35000000</gaap:LongTermDebtAndCapitalLeaseObligationsCurrent>
<gaap:Revenues contextRef="c-1" unitRef="usd">1.5</gaap:Revenues>
<gaap:Revenues contextRef="c-1" unitRef="usd">2.5</gaap:Revenues>
<acme:FinanceSegmentDebt contextRef="c-3" unitRef="usd">1</acme:FinanceSegmentDebt>`);

function read(xml: string) {
  const result = readXbrlInstance(xml);
  if (result.status !== "read") {
    throw new Error(result.reason);
  }
  return result.instance;
}

describe("sec-xbrl-instance-1.0.0", () => {
  it("reads contexts by local names and keeps the published text", () => {
    const parsed = read(BASE);

    expect(parsed.contexts.get("c-2")).toEqual({
      id: "c-2",
      cik: CIK,
      instant: "2025-12-31",
      startDate: null,
      endDate: null,
      members: [{ axis: "ProductOrServiceAxis", member: "MachineryMember" }],
      typed: false,
    });
    expect(parsed.contexts.get("c-8")?.typed).toBe(true);
    expect(
      parsed.facts.find(
        (fact) =>
          fact.concept === "us-gaap:LongTermDebtAndCapitalLeaseObligations" &&
          fact.contextId === "c-2",
      )?.value,
    ).toBe("10678000000");
  });

  it("resolves us-gaap by namespace, whatever its prefix", () => {
    const parsed = read(BASE);

    expect(
      parsed.facts.every((fact) => fact.concept.startsWith("us-gaap:")),
    ).toBe(true);
    expect(
      parsed.facts.some((fact) => fact.concept.includes("FinanceSegmentDebt")),
    ).toBe(false);
  });

  it("skips nil, non-USD and repeated identical facts; drops a conflicting concept by name", () => {
    const parsed = read(BASE);

    expect(
      parsed.facts.some((fact) => fact.concept === "us-gaap:DebtCurrent"),
    ).toBe(false);
    expect(
      parsed.facts.some((fact) => fact.concept === "us-gaap:CommercialPaper"),
    ).toBe(false);
    expect(
      parsed.facts.filter(
        (fact) =>
          fact.concept ===
          "us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent",
      ),
    ).toHaveLength(1);
    expect(parsed.conflicting).toEqual(["us-gaap:Revenues"]);
    expect(
      parsed.facts.some((fact) => fact.concept === "us-gaap:Revenues"),
    ).toBe(false);
  });

  it("selects a member's facts at an instant: one member only, the filer's CIK, never typed", () => {
    const facts = segmentFacts(read(BASE), {
      cik: CIK,
      member: { axis: "ProductOrServiceAxis", member: "MachineryMember" },
      period: { kind: "instant", date: "2025-12-31" },
    });

    expect(Object.fromEntries(facts)).toEqual({
      "us-gaap:LongTermDebtAndCapitalLeaseObligations": "10678000000",
      "us-gaap:ShortTermBorrowings": "0",
      "us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent": "35000000",
    });
  });

  it("selects a fiscal-year duration and leaves a quarter out", () => {
    const facts = segmentFacts(read(BASE), {
      cik: CIK,
      member: { axis: "ProductOrServiceAxis", member: "MachineryMember" },
      period: {
        kind: "duration",
        endDate: "2025-12-31",
        minDays: 357,
        maxDays: 373,
      },
    });

    expect(Object.fromEntries(facts)).toEqual({
      "us-gaap:InterestExpenseNonoperating": "502000000",
    });
  });

  it("reads an instance whose instance namespace has a prefix", () => {
    const xml = instance(
      `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
${context("c-1", instant("2025-12-31", "xbrli:"), [INDUSTRIAL], { prefix: "xbrli:" })}
<gaap:ShortTermBorrowings contextRef="c-1" unitRef="usd">12</gaap:ShortTermBorrowings>`,
      "xbrli:xbrl",
      ":xbrli",
    );

    expect(read(xml).facts).toEqual([
      { concept: "us-gaap:ShortTermBorrowings", contextId: "c-1", value: "12" },
    ]);
  });

  it("rejects a DOCTYPE, a document without the instance root, and one without contexts", () => {
    expect(
      readXbrlInstance(
        `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${BASE}`,
      ),
    ).toEqual({ status: "rejected", reason: "doctype_present" });
    expect(readXbrlInstance("<html><body>10-K</body></html>")).toEqual({
      status: "rejected",
      reason: "instance_root_missing",
    });
    expect(
      readXbrlInstance(
        '<xbrl xmlns="http://example.com/not-xbrl"><context id="c"/></xbrl>',
      ),
    ).toEqual({ status: "rejected", reason: "instance_root_missing" });
    expect(readXbrlInstance(instance(UNITS))).toEqual({
      status: "rejected",
      reason: "no_contexts",
    });
  });

  it("drops a concept two contexts of the same member publish with different values", () => {
    const xml = instance(`${UNITS}
${context("c-1", instant("2025-12-31"), [INDUSTRIAL])}
${context("c-2", instant("2025-12-31"), [INDUSTRIAL])}
<gaap:ShortTermBorrowings contextRef="c-1" unitRef="usd">1</gaap:ShortTermBorrowings>
<gaap:ShortTermBorrowings contextRef="c-2" unitRef="usd">2</gaap:ShortTermBorrowings>
<gaap:DebtCurrent contextRef="c-1" unitRef="usd">3</gaap:DebtCurrent>
<gaap:DebtCurrent contextRef="c-2" unitRef="usd">3</gaap:DebtCurrent>`);

    const facts = segmentFacts(read(xml), {
      cik: CIK,
      member: { axis: "ProductOrServiceAxis", member: "MachineryMember" },
      period: { kind: "instant", date: "2025-12-31" },
    });

    expect(Object.fromEntries(facts)).toEqual({ "us-gaap:DebtCurrent": "3" });
  });
});

describe("sec-xbrl-cover-shares-1.0.0", () => {
  const CLASS_A: [string, string] = [
    "us-gaap:StatementClassOfStockAxis",
    "us-gaap:CommonClassAMember",
  ];
  const CLASS_B: [string, string] = [
    "us-gaap:StatementClassOfStockAxis",
    "us-gaap:CommonClassBMember",
  ];
  const cover = (facts: string, doctype = "") =>
    `${doctype}<?xml version="1.0" encoding="utf-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2025" xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>
<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
${context("a", instant("2026-10-26", "xbrli:"), [CLASS_A], { prefix: "xbrli:" })}
${context("b", instant("2026-10-26", "xbrli:"), [CLASS_B], { prefix: "xbrli:" })}
${facts}
</xbrli:xbrl>`;

  it("reads each class with its member, date and published integer", () => {
    const result = readCoverShares(
      cover(
        '<dei:EntityCommonStockSharesOutstanding contextRef="a" unitRef="shares" decimals="INF">2306705341</dei:EntityCommonStockSharesOutstanding><dei:EntityCommonStockSharesOutstanding contextRef="b" unitRef="shares" decimals="INF">101787133</dei:EntityCommonStockSharesOutstanding>',
      ),
    );
    if (result.status !== "read") throw new Error(result.reason);
    expect(
      result.facts.map((fact) => [
        fact.members[0]?.member,
        fact.instant,
        fact.value,
      ]),
    ).toEqual([
      ["CommonClassAMember", "2026-10-26", "2306705341"],
      ["CommonClassBMember", "2026-10-26", "101787133"],
    ]);
  });

  it("ignores a count in a unit that is not shares", () => {
    const result = readCoverShares(
      cover(
        '<dei:EntityCommonStockSharesOutstanding contextRef="a" unitRef="usd">5</dei:EntityCommonStockSharesOutstanding>',
      ),
    );
    expect(result).toMatchObject({ status: "read", facts: [] });
  });

  it("drops a context published with two different counts", () => {
    const result = readCoverShares(
      cover(
        '<dei:EntityCommonStockSharesOutstanding contextRef="a" unitRef="shares">10</dei:EntityCommonStockSharesOutstanding><dei:EntityCommonStockSharesOutstanding contextRef="a" unitRef="shares">11</dei:EntityCommonStockSharesOutstanding>',
      ),
    );
    expect(result).toMatchObject({
      status: "read",
      facts: [],
      conflicting: ["a"],
    });
  });

  it("rejects a document with a DOCTYPE", () => {
    expect(readCoverShares(cover("", "<!DOCTYPE x>"))).toEqual({
      status: "rejected",
      reason: "doctype_present",
    });
  });
});

describe("sec-xbrl-share-facts-1.0.0", () => {
  const CLASS_A: [string, string] = [
    "us-gaap:StatementClassOfStockAxis",
    "gaap:CommonClassAMember",
  ];
  const SHARE_UNITS = `${UNITS}
<unit id="shares"><measure>shares</measure></unit>
<unit id="pure"><measure>pure</measure></unit>
<unit id="usdPerShare"><divide><unitNumerator><measure>iso4217:USD</measure></unitNumerator><unitDenominator><measure>shares</measure></unitDenominator></divide></unit>
<unit id="eurPerShare"><divide><unitNumerator><measure>iso4217:EUR</measure></unitNumerator><unitDenominator><measure>shares</measure></unitDenominator></divide></unit>`;
  const DOC = instance(`${SHARE_UNITS}
${context("fy", duration("2025-01-01", "2025-12-31"))}
${context("fy-a", duration("2025-01-01", "2025-12-31"), [CLASS_A])}
${context("close-a", instant("2025-12-31"), [CLASS_A])}
<gaap:NetIncomeLoss contextRef="fy" unitRef="usd" decimals="-6">1000000000</gaap:NetIncomeLoss>
<gaap:WeightedAverageNumberOfDilutedSharesOutstanding contextRef="fy-a" unitRef="shares" decimals="-6">80000000</gaap:WeightedAverageNumberOfDilutedSharesOutstanding>
<gaap:EarningsPerShareDiluted contextRef="fy-a" unitRef="usdPerShare" decimals="2">12.50</gaap:EarningsPerShareDiluted>
<gaap:EarningsPerShareDiluted contextRef="fy" unitRef="eurPerShare" decimals="2">11.00</gaap:EarningsPerShareDiluted>
<gaap:WeightedAverageNumberOfSharesOutstandingBasic contextRef="fy" unitRef="shares">79000000</gaap:WeightedAverageNumberOfSharesOutstandingBasic>
<acme:CommonStockConversionRate contextRef="close-a" unitRef="pure" decimals="4">1.5400</acme:CommonStockConversionRate>
<acme:Unrequested contextRef="close-a" unitRef="pure" decimals="4">2</acme:Unrequested>`);
  const read = (xml: string) =>
    readXbrlShareFacts(xml, {
      usGaap: [
        "NetIncomeLoss",
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "EarningsPerShareDiluted",
        "WeightedAverageNumberOfSharesOutstandingBasic",
      ],
      extension: ["CommonStockConversionRate"],
    });

  it("reads shares, USD, USD per share and pure, with the printed rounding", () => {
    const result = read(DOC);
    expect(result.status).toBe("read");
    if (result.status !== "read") return;
    expect(
      result.read.facts.map(({ concept, contextId, unit, value, decimals }) => [
        concept,
        contextId,
        unit,
        value,
        decimals,
      ]),
    ).toEqual([
      ["us-gaap:NetIncomeLoss", "fy", "usd", "1000000000", -6],
      [
        "us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding",
        "fy-a",
        "shares",
        "80000000",
        -6,
      ],
      ["us-gaap:EarningsPerShareDiluted", "fy-a", "usd_per_share", "12.50", 2],
      ["extension:CommonStockConversionRate", "close-a", "pure", "1.5400", 4],
    ]);
  });

  it("leaves out a per-share amount in another currency, a fact without decimals and an unrequested concept", () => {
    const result = read(DOC);
    if (result.status !== "read") throw new Error("expected read");
    const concepts = result.read.facts.map((fact) => fact.concept);
    expect(concepts).not.toContain(
      "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
    );
    expect(concepts).not.toContain("extension:Unrequested");
    expect(
      result.read.facts.filter(
        (fact) => fact.concept === "us-gaap:EarningsPerShareDiluted",
      ),
    ).toHaveLength(1);
  });

  it("reads INF as exact and drops a concept with two values in one context", () => {
    const result = read(
      instance(`${SHARE_UNITS}
${context("fy", duration("2025-01-01", "2025-12-31"))}
<gaap:WeightedAverageNumberOfSharesOutstandingBasic contextRef="fy" unitRef="shares" decimals="INF">79000000</gaap:WeightedAverageNumberOfSharesOutstandingBasic>
<gaap:NetIncomeLoss contextRef="fy" unitRef="usd" decimals="-6">1</gaap:NetIncomeLoss>
<gaap:NetIncomeLoss contextRef="fy" unitRef="usd" decimals="-6">2</gaap:NetIncomeLoss>`),
    );
    if (result.status !== "read") throw new Error("expected read");
    expect(result.read.facts).toEqual([
      {
        concept: "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
        contextId: "fy",
        unit: "shares",
        value: "79000000",
        decimals: null,
      },
    ]);
    expect(result.read.conflicting).toEqual(["us-gaap:NetIncomeLoss"]);
  });

  it("never reads a standard taxonomy as the filer's extension", () => {
    const result = readXbrlShareFacts(DOC, {
      usGaap: [],
      extension: ["NetIncomeLoss"],
    });
    if (result.status !== "read") throw new Error("expected read");
    expect(result.read.facts).toEqual([]);
  });

  it("rejects a DOCTYPE", () => {
    expect(read(`<!DOCTYPE x>${DOC}`)).toEqual({
      status: "rejected",
      reason: "doctype_present",
    });
  });
});
