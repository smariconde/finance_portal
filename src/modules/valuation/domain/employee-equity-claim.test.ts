import { describe, expect, it } from "vitest";

import type {
  ReturnClose,
  ReturnEvent,
} from "@/modules/metrics/domain/total-return";

import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import {
  deriveEmployeeEquity,
  employeeEquityMismatches,
  employeeOptionMarketAt,
  sharesOutstandingAt,
  type EmployeeEquityClaim,
  aiDecisionOf,
  EMPLOYEE_EQUITY_FALLBACK_READING_VERSION,
  employeeOptionsXbrlAt,
  OPTIONS_OUTSTANDING_CONCEPT,
  OPTIONS_WEIGHTED_STRIKE_CONCEPT,
  readingOfDecision,
} from "./employee-equity-claim";
import { checkValuationInput } from "./policy-checks";
import { valuationInputSchema, type ValuationInput } from "./valuation-input";

const claim = DEMO_VALUATION_INPUT.employeeEquity;
const context = {
  riskFree: DEMO_VALUATION_INPUT.costOfCapital.derived.riskFree,
  currency: "USD",
  asOf: DEMO_VALUATION_INPUT.asOf,
};

function draft(mutate: (input: ValuationInput) => void): ValuationInput {
  const candidate = structuredClone(DEMO_VALUATION_INPUT);
  mutate(candidate);

  return valuationInputSchema.parse(candidate);
}

function failedCheck(input: ValuationInput) {
  return checkValuationInput(input).find(
    (entry) => entry.id === "employee_equity_recomputed",
  );
}

describe("deriveEmployeeEquity", () => {
  it("values the options and adds the units to the shares outstanding", () => {
    const derived = deriveEmployeeEquity({
      decision: claim.decision,
      sharesOutstanding: claim.sharesOutstanding,
      market: claim.market,
      riskFree: context.riskFree,
    });

    expect(derived).toStrictEqual(claim.derived);
    expect(derived.reading.options).toMatchObject({
      count: "300000",
      strike: "9",
    });
    expect(derived.shareCount).toBe("12500000");
    // Black-Scholes al precio ajustado: oráculo de doble precisión de Python.
    expect(Number(derived.options!.valuePerOption)).toBeCloseTo(6.6738718, 6);
  });

  it("needs no market without outstanding options", () => {
    const decision = aiDecisionOf(structuredClone(claim.decision));
    decision.transcription = {
      ...decision.transcription,
      optionsStatus: "none_disclosed",
      optionsCount: null,
      optionsCountQuote: null,
      optionsStrike: null,
      optionsStrikeQuote: null,
      optionsLifeBasis: null,
      optionsLife: null,
      optionsLifeQuote: null,
    };

    expect(
      deriveEmployeeEquity({
        decision,
        sharesOutstanding: claim.sharesOutstanding,
        market: null,
        riskFree: context.riskFree,
      }),
    ).toMatchObject({ options: null, shareCount: "12500000" });
  });

  it("refuses to value outstanding options without a market", () => {
    expect(() =>
      deriveEmployeeEquity({
        decision: claim.decision,
        sharesOutstanding: claim.sharesOutstanding,
        market: null,
        riskFree: context.riskFree,
      }),
    ).toThrow(/price, a volatility and a dividend yield/u);
  });
});

describe("employeeEquityMismatches", () => {
  it("accepts the demo claim", () => {
    expect(employeeEquityMismatches(claim, context)).toStrictEqual([]);
  });

  it("names a derived value written by hand", () => {
    const tampered: EmployeeEquityClaim = structuredClone(claim);
    tampered.derived.options!.totalValue = "1";

    expect(employeeEquityMismatches(tampered, context)).toStrictEqual([
      "employeeEquity.derived",
    ]);
  });

  it("recomputes with the run's own risk-free rate", () => {
    expect(
      employeeEquityMismatches(claim, { ...context, riskFree: "0.05" }),
    ).toStrictEqual(["employeeEquity.derived"]);
  });

  it("names a market in another currency or after the as_of", () => {
    expect(
      employeeEquityMismatches(claim, { ...context, currency: "EUR" }),
    ).toContain("employeeEquity.market.price.currency");
    expect(
      employeeEquityMismatches(claim, { ...context, asOf: "2025-06-29" }),
    ).toContain("employeeEquity.market.price.marketDate");
  });

  it("names a market that has no options to value, or options without one", () => {
    const withoutMarket: EmployeeEquityClaim = { ...claim, market: null };

    expect(employeeEquityMismatches(withoutMarket, context)).toStrictEqual([
      "employeeEquity.market",
      "employeeEquity.derived",
    ]);
  });
});

describe("employee_equity_recomputed", () => {
  it("passes on the demo snapshot", () => {
    expect(failedCheck(DEMO_VALUATION_INPUT)?.status).toBe("passed");
  });

  it("rejects a bridge claim that is not the derived option value", () => {
    const input = draft((candidate) => {
      candidate.bridge.employeeOptions.amount!.value = "1000000";
    });

    expect(failedCheck(input)).toMatchObject({
      mode: "reject",
      status: "failed",
      subjects: ["bridge.employeeOptions"],
    });
  });

  it("rejects options declared absent while the note has them", () => {
    const input = draft((candidate) => {
      candidate.bridge.employeeOptions = {
        status: "declared_absent",
        amount: null,
        rationale: "No options.",
      };
    });

    expect(failedCheck(input)?.subjects).toStrictEqual([
      "bridge.employeeOptions",
    ]);
  });
});

/** Ruedas de lunes a viernes entre dos fechas, ambas incluidas. */
function weekdays(from: string, to: string): string[] {
  const dates: string[] = [];

  for (
    let day = new Date(`${from}T00:00:00.000Z`);
    day.toISOString().slice(0, 10) <= to;
    day = new Date(day.getTime() + 86_400_000)
  ) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      dates.push(day.toISOString().slice(0, 10));
    }
  }

  return dates;
}

describe("employeeOptionMarketAt", () => {
  const AS_OF = "2026-06-30";
  const closes: ReturnClose[] = weekdays("2021-06-01", AS_OF).map(
    (marketDate, index) => ({
      marketDate,
      close: (100 + (index % 7) - 3).toFixed(2),
      currency: "USD",
    }),
  );

  it("reads the as_of close, the volatility and a split-adjusted dividend yield", () => {
    const events: ReturnEvent[] = [
      // Antes del split: 2 por acción vieja son 1 por acción nueva.
      {
        eventType: "dividend",
        effectiveOn: "2025-09-02",
        value: "2",
        currency: "USD",
      },
      {
        eventType: "split",
        effectiveOn: "2025-10-01",
        value: "2",
        currency: null,
      },
      {
        eventType: "dividend",
        effectiveOn: "2026-03-02",
        value: "1",
        currency: "USD",
      },
      // Fuera de la ventana de un año y después del as_of: no cuentan.
      {
        eventType: "dividend",
        effectiveOn: "2025-06-02",
        value: "5",
        currency: "USD",
      },
      {
        eventType: "dividend",
        effectiveOn: "2026-07-01",
        value: "5",
        currency: "USD",
      },
    ];
    const market = employeeOptionMarketAt({
      subjectId: "s",
      asOf: AS_OF,
      sourceId: "yahoo-prices",
      closes,
      events,
    });

    if ("reason" in market) {
      throw new Error(`expected a market, got ${market.reason}`);
    }

    const close = closes.find((entry) => entry.marketDate === AS_OF)!;

    expect(market.price).toStrictEqual({
      value: close.close,
      marketDate: AS_OF,
      currency: "USD",
      sourceId: "yahoo-prices",
    });
    expect(market.dividendYield).toMatchObject({
      dividends: "2",
      from: "2025-06-30",
    });
    expect(Number(market.dividendYield.value)).toBeCloseTo(
      2 / Number(close.close),
      12,
    );
    expect(market.volatility.formulaVersion).toBe("equity-volatility-1.0.0");
  });

  it("names what the series lacks", () => {
    expect(
      employeeOptionMarketAt({
        subjectId: "s",
        asOf: "2026-07-01",
        sourceId: "yahoo-prices",
        closes,
        events: [],
      }),
    ).toStrictEqual({ reason: "no_close_at_as_of" });
    expect(
      employeeOptionMarketAt({
        subjectId: "s",
        asOf: AS_OF,
        sourceId: "yahoo-prices",
        closes: closes.filter((entry) => entry.marketDate >= "2023-01-02"),
        events: [],
      }),
    ).toStrictEqual({
      reason: "volatility_unavailable",
      detail: "insufficient_history",
    });
  });
});

describe("sharesOutstandingAt", () => {
  const cover = (asOf: string, availableAt: string, value: string) => ({
    concept: "dei:EntityCommonStockSharesOutstanding",
    asOf,
    availableAt,
    value,
  });
  const observations = [
    cover("2026-04-21", "2026-04-29T20:00:00.000Z", "199782155"),
    cover("2026-07-17", "2026-07-24T20:00:00.000Z", "199500000"),
    // El balance publica otro número; no es la carátula.
    {
      ...cover("2026-06-30", "2026-07-24T20:00:00.000Z", "929000000"),
      concept: "us-gaap:CommonStockSharesOutstanding",
    },
  ];

  it("takes the latest cover count the as_of and the cutoff admit", () => {
    expect(
      sharesOutstandingAt(observations, {
        asOf: "2026-10-19",
        knownAt: "2026-10-20T00:00:00.000Z",
      })?.value,
    ).toBe("199500000");
  });

  it("does not read a cover filed after the cutoff or dated after the as_of", () => {
    expect(
      sharesOutstandingAt(observations, {
        asOf: "2026-10-19",
        knownAt: "2026-07-01T00:00:00.000Z",
      })?.value,
    ).toBe("199782155");
    expect(
      sharesOutstandingAt(observations, {
        asOf: "2026-05-01",
        knownAt: "2026-10-20T00:00:00.000Z",
      })?.value,
    ).toBe("199782155");
  });

  it("is null without a cover count, never another concept", () => {
    expect(
      sharesOutstandingAt([observations[2]!], {
        asOf: "2026-10-19",
        knownAt: "2026-10-20T00:00:00.000Z",
      }),
    ).toBeNull();
  });
});

describe("employee-options-xbrl-1.0.0", () => {
  const fact = (
    concept: string,
    value: string,
    overrides: Partial<{
      sourceDocumentId: string;
      availableAt: string;
      asOf: string;
    }> = {},
  ) => ({
    concept,
    value,
    asOf: "2024-12-31",
    availableAt: "2025-02-20T21:00:00.000Z",
    observationId: "70000000-0000-4000-8000-0000000000a1",
    sourceDocumentId: "0000000000-25-000001",
    ...overrides,
  });
  const at = {
    fiscalYearEnd: "2024-12-31",
    knownAt: "2025-06-01T00:00:00.000Z",
    sourceId: "sec-edgar",
  };

  it("takes the latest filing known at the cutoff, count and strike together", () => {
    const amended = {
      sourceDocumentId: "0000000000-25-000009",
      availableAt: "2025-04-01T21:00:00.000Z",
    };
    const late = {
      sourceDocumentId: "0000000000-25-000010",
      availableAt: "2025-07-01T21:00:00.000Z",
    };
    const decision = employeeOptionsXbrlAt(
      [
        fact(OPTIONS_OUTSTANDING_CONCEPT, "300000"),
        fact(OPTIONS_WEIGHTED_STRIKE_CONCEPT, "9"),
        fact(OPTIONS_OUTSTANDING_CONCEPT, "310000", amended),
        fact(OPTIONS_WEIGHTED_STRIKE_CONCEPT, "9.1", amended),
        // Publicado después del corte: no se ve.
        fact(OPTIONS_OUTSTANDING_CONCEPT, "999", late),
        fact(OPTIONS_WEIGHTED_STRIKE_CONCEPT, "1", late),
        // De otro cierre: no es este balance.
        fact(OPTIONS_OUTSTANDING_CONCEPT, "1", { asOf: "2023-12-31" }),
      ],
      at,
    );

    expect(decision).toMatchObject({
      sourceDocumentId: "0000000000-25-000009",
      optionsOutstanding: { value: "310000" },
      weightedStrike: { value: "9.1" },
      unvestedUnits: null,
    });
    expect(readingOfDecision(decision!)).toMatchObject({
      version: EMPLOYEE_EQUITY_FALLBACK_READING_VERSION,
      unitsBasis: "not_reported",
    });
  });

  it("is no fallback without a strike for outstanding options", () => {
    expect(
      employeeOptionsXbrlAt([fact(OPTIONS_OUTSTANDING_CONCEPT, "300000")], at),
    ).toBeNull();
    expect(employeeOptionsXbrlAt([], at)).toBeNull();
  });

  it("recomputes a frozen XBRL decision and names a fact of another filing", () => {
    const decision = employeeOptionsXbrlAt(
      [
        fact(OPTIONS_OUTSTANDING_CONCEPT, "300000"),
        fact(OPTIONS_WEIGHTED_STRIKE_CONCEPT, "9"),
      ],
      at,
    )!;
    const derived = deriveEmployeeEquity({
      decision,
      sharesOutstanding: claim.sharesOutstanding,
      market: claim.market,
      riskFree: context.riskFree,
    });
    const frozen = { ...claim, decision, derived };
    const moved = structuredClone(frozen);
    if (moved.decision.basis === "xbrl_same_10k") {
      moved.decision.weightedStrike!.sourceDocumentId = "0000000000-24-000001";
    }

    expect(derived.options).not.toBeNull();
    expect(employeeEquityMismatches(frozen, context)).toEqual([]);
    expect(employeeEquityMismatches(moved, context)).toContain(
      "employeeEquity.decision",
    );
  });
});
