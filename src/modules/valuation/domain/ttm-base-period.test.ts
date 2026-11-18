import { describe, expect, it } from "vitest";

import {
  buildAnnualFundamentals,
  type FundamentalRow,
  type LineItemValue,
} from "./annual-fundamentals";
import {
  basePeriodSchema,
  buildTtmBasePeriod,
  flowOf,
  isComparablePrior,
  TTM_QUALITY_FLAG,
  ttmBasePeriodMismatches,
  ttmFlowFact,
  ttmFlowValue,
  type TtmBasePeriod,
} from "./ttm-base-period";
import type { ConceptFact } from "./valuation-facts";

const SUBJECT = "11111111-1111-4111-8111-111111111111";
const FY = "2025-12-31";
const H1 = "2026-06-30";
const CUTOFF = "2026-11-17";
let sequence = 0;

type RowInput = {
  readonly concept: string;
  readonly start: string | null;
  readonly end: string;
  readonly value: string | null;
  readonly periodType?: FundamentalRow["periodType"];
  readonly availableAt?: string;
};

function row(input: RowInput): FundamentalRow {
  sequence += 1;
  const periodType =
    input.periodType ??
    (input.start === null
      ? "instant"
      : input.end.slice(5) === "12-31"
        ? "annual"
        : "year_to_date");

  return {
    observationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    subjectId: SUBJECT,
    concept: `us-gaap:${input.concept}`,
    periodType,
    asOf: input.end,
    periodStart: input.start,
    unit: "USD",
    currency: "USD",
    value: input.value,
    availableAt:
      input.availableAt ??
      `${Number(input.end.slice(0, 4)) + (periodType === "annual" ? 1 : 0)}-${periodType === "annual" ? "02-10" : input.end.slice(5, 7) === "06" ? "07-25" : input.end.slice(5, 7) === "03" ? "04-25" : "10-25"}T21:00:00.000Z`,
    recordedAt: "2026-11-01T00:00:00.000Z",
    sourceDocumentId: `0000000042-${input.end.slice(2, 4)}-${input.end.slice(5, 7)}0001`,
  };
}

/** Un flujo: ejercicio 2024 y 2025, primer semestre 2025 y 2026. */
function flow(
  concept: string,
  values: { fy24: string; fy25: string; h125: string; h126: string },
): FundamentalRow[] {
  return [
    row({
      concept,
      start: "2024-01-01",
      end: "2024-12-31",
      value: values.fy24,
    }),
    row({ concept, start: "2025-01-01", end: FY, value: values.fy25 }),
    row({
      concept,
      start: "2025-01-01",
      end: "2025-06-30",
      value: values.h125,
    }),
    row({ concept, start: "2026-01-01", end: H1, value: values.h126 }),
  ];
}

function instant(concept: string, end: string, value: string): FundamentalRow {
  return row({ concept, start: null, end, value });
}

function balance(end: string, scale = 1): FundamentalRow[] {
  const at = (value: number) => String(value * scale);
  return [
    instant("StockholdersEquity", end, at(500)),
    instant("CashAndCashEquivalentsAtCarryingValue", end, at(120)),
    instant("LongTermDebtNoncurrent", end, at(300)),
    instant("LongTermDebtCurrent", end, at(20)),
    instant("OperatingLeaseLiability", end, at(80)),
  ];
}

const BASE_ROWS: readonly FundamentalRow[] = [
  ...flow("Revenues", { fy24: "1000", fy25: "1100", h125: "520", h126: "600" }),
  ...flow("OperatingIncomeLoss", {
    fy24: "200",
    fy25: "230",
    h125: "100",
    h126: "130",
  }),
  ...flow(
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    { fy24: "180", fy25: "210", h125: "90", h126: "-40" },
  ),
  ...flow("IncomeTaxExpenseBenefit", {
    fy24: "40",
    fy25: "45",
    h125: "20",
    h126: "0",
  }),
  ...balance("2024-12-31"),
  ...balance(FY),
  ...balance(H1, 2),
];

const toFact = (item: LineItemValue): ConceptFact => ({
  value: item.value,
  currency: item.currency ?? "USD",
  unit: "monetary",
  concept: item.concept,
  asOf: item.asOf,
  availableAt: item.availableAt,
  sourceId: "sec-edgar",
  sourceDocumentId: item.sourceDocumentId,
  observationId: item.observationId,
  qualityFlags: [],
});

function decide(rows: readonly FundamentalRow[], cutoff = CUTOFF) {
  const series = buildAnnualFundamentals(rows, FY, cutoff);
  return buildTtmBasePeriod({ rows, series, cutoffDate: cutoff, toFact });
}

function ttmOf(rows: readonly FundamentalRow[]): TtmBasePeriod {
  const candidate = decide(rows);

  if (candidate?.status !== "ttm") {
    throw new Error(`expected a TTM base, got ${JSON.stringify(candidate)}`);
  }

  return candidate.basePeriod;
}

describe("ttm-base-period-1.0.0", () => {
  it("rolls the fiscal year forward to the last 10-Q with one concept per flow", () => {
    const basePeriod = ttmOf(BASE_ROWS);

    expect(basePeriod).toMatchObject({
      basis: "ttm",
      fiscalYearEnd: FY,
      periodEnd: H1,
      balance: { core: { basis: "quarter" }, leases: { basis: "quarter" } },
    });
    expect(basePeriod.flows.map((entry) => entry.item)).toEqual([
      "revenue",
      "operating_income",
      "pretax_income",
      "income_tax",
    ]);
    // 1100 + 600 − 520; un pretax que pasa a pérdida queda negativo, nunca 0.
    expect(ttmFlowValue(flowOf(basePeriod, "revenue")!)).toBe("1180");
    expect(ttmFlowValue(flowOf(basePeriod, "pretax_income")!)).toBe("80");
    expect(ttmFlowValue(flowOf(basePeriod, "income_tax")!)).toBe("25");
    expect(ttmBasePeriodMismatches(basePeriod)).toEqual([]);
    expect(basePeriodSchema.parse(basePeriod)).toEqual(basePeriod);
  });

  it("dates a TTM fact at the 10-Q with the last leg's availability and no observation of its own", () => {
    const basePeriod = ttmOf(BASE_ROWS);
    const fact = ttmFlowFact(flowOf(basePeriod, "revenue")!, H1);

    expect(fact).toMatchObject({
      value: "1180",
      asOf: H1,
      availableAt: "2026-07-25T21:00:00.000Z",
      observationId: null,
      qualityFlags: [TTM_QUALITY_FLAG],
      concept: "us-gaap:Revenues",
    });
  });

  it("uses the latest 10-Q visible at the cutoff date", () => {
    const q1 = [
      row({
        concept: "Revenues",
        start: "2026-01-01",
        end: "2026-03-31",
        value: "290",
        periodType: "quarter",
      }),
    ];

    expect(ttmOf([...BASE_ROWS, ...q1]).periodEnd).toBe(H1);
    // Las filas ya llegan elegidas `as_known`; un período que termina después
    // de la fecha del corte tampoco cuenta.
    expect(decide([...BASE_ROWS, ...q1], "2026-05-15")).toMatchObject({
      status: "annual",
      basePeriod: { reason: "ttm_leg_missing", item: "revenue" },
    });
  });

  it("stays annual without a 10-Q after the fiscal year", () => {
    const rows = BASE_ROWS.filter((entry) => entry.asOf <= FY);

    expect(decide(rows)).toMatchObject({
      status: "annual",
      basePeriod: { reason: "no_interim_after_fiscal_year", item: null },
    });
  });

  it("stays annual and names the flow whose comparable year-to-date is missing", () => {
    const rows = BASE_ROWS.filter(
      (entry) =>
        !(
          entry.concept === "us-gaap:IncomeTaxExpenseBenefit" &&
          entry.asOf === "2025-06-30"
        ),
    );

    expect(decide(rows)).toMatchObject({
      status: "annual",
      basePeriod: { reason: "ttm_leg_missing", item: "income_tax" },
    });
  });

  it("stays annual and names the flow the fiscal year itself lacks", () => {
    // MCD, 2026-11-18: el 10-K base no trae una partida que el TTM pide y el
    // armado caía con un TypeError en vez de quedarse en anual con motivo.
    const rows = BASE_ROWS.filter(
      (entry) =>
        !(
          entry.concept === "us-gaap:IncomeTaxExpenseBenefit" &&
          entry.asOf === FY
        ),
    );

    expect(decide(rows)).toMatchObject({
      status: "annual",
      basePeriod: { reason: "ttm_leg_missing", item: "income_tax" },
    });
  });

  it("never treats a null leg as zero", () => {
    const rows = BASE_ROWS.map((entry) =>
      entry.concept === "us-gaap:OperatingIncomeLoss" && entry.asOf === H1
        ? { ...entry, value: null }
        : entry,
    );

    expect(decide(rows)).toMatchObject({
      status: "annual",
      basePeriod: { reason: "ttm_leg_missing", item: "operating_income" },
    });
  });

  it("does not mix concepts across legs", () => {
    const rows = BASE_ROWS.map((entry) =>
      entry.concept === "us-gaap:Revenues" && entry.asOf === "2025-06-30"
        ? {
            ...entry,
            concept:
              "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
          }
        : entry,
    );

    expect(decide(rows)).toMatchObject({
      status: "annual",
      basePeriod: { reason: "ttm_leg_missing", item: "revenue" },
    });
  });

  it("does not take a quarter for a half-year comparable", () => {
    const rows = BASE_ROWS.map((entry) =>
      entry.concept === "us-gaap:Revenues" && entry.asOf === "2025-06-30"
        ? { ...entry, periodStart: "2025-04-01", periodType: "quarter" }
        : entry,
    );

    expect(decide(rows)).toMatchObject({
      status: "annual",
      basePeriod: { reason: "ttm_leg_missing", item: "revenue" },
    });
  });

  it("accepts a 52/53-week comparable a few days off", () => {
    expect(
      isComparablePrior(
        { periodStart: "2025-12-29", asOf: "2026-06-28" },
        { periodStart: "2024-12-30", asOf: "2025-06-29" },
      ),
    ).toBe(true);
    expect(
      isComparablePrior(
        { periodStart: "2025-12-29", asOf: "2026-06-28" },
        { periodStart: "2024-12-30", asOf: "2025-09-28" },
      ),
    ).toBe(false);
  });

  it("keeps the 10-K balance when the debt recipe does not close at the quarter", () => {
    const rows = BASE_ROWS.filter(
      (entry) =>
        !(entry.concept === "us-gaap:LongTermDebtCurrent" && entry.asOf === H1),
    );
    const candidate = decide(rows);

    expect(candidate).toMatchObject({
      status: "ttm",
      basePeriod: {
        balance: {
          core: {
            basis: "fiscal_year",
            reason: "debt_recipe_not_at_quarter",
          },
          leases: { basis: "quarter" },
        },
      },
    });
    expect(
      candidate?.status === "ttm" ? Object.keys(candidate.quarter) : [],
    ).toEqual(["operating_lease_liability"]);
  });

  it("keeps the 10-K balance when an item the 10-K had is missing at the quarter", () => {
    const rows = [...BASE_ROWS, instant("MinorityInterest", FY, "10")];

    expect(decide(rows)).toMatchObject({
      basePeriod: {
        balance: {
          core: {
            basis: "fiscal_year",
            reason: "balance_item_not_at_quarter",
            item: "minority_interest",
          },
        },
      },
    });
  });

  it("keeps the 10-K lease liability when the 10-Q reports only the noncurrent part", () => {
    const rows = [
      ...BASE_ROWS.filter(
        (entry) =>
          !(
            entry.concept === "us-gaap:OperatingLeaseLiability" &&
            entry.asOf === H1
          ),
      ),
      instant("OperatingLeaseLiabilityNoncurrent", H1, "150"),
    ];

    expect(decide(rows)).toMatchObject({
      basePeriod: {
        balance: {
          core: { basis: "quarter" },
          leases: {
            basis: "fiscal_year",
            reason: "lease_liability_not_at_quarter",
          },
        },
      },
    });
  });

  it("asks for the interest legs when EBIT is derived from pretax income", () => {
    const withoutOperating = BASE_ROWS.filter(
      (entry) => entry.concept !== "us-gaap:OperatingIncomeLoss",
    );
    const interest = flow("InterestExpense", {
      fy24: "12",
      fy25: "14",
      h125: "7",
      h126: "8",
    });

    expect(
      ttmOf([...withoutOperating, ...interest]).flows.map(
        (entry) => entry.item,
      ),
    ).toEqual(["revenue", "pretax_income", "income_tax", "interest_expense"]);
    expect(
      decide([...withoutOperating, ...interest.slice(0, 3)]),
    ).toMatchObject({
      basePeriod: { reason: "ttm_leg_missing", item: "interest_expense" },
    });
  });

  it("names a frozen leg that no longer matches its period or concept", () => {
    const basePeriod = ttmOf(BASE_ROWS);
    const revenue = flowOf(basePeriod, "revenue")!;
    const tampered: TtmBasePeriod = {
      ...basePeriod,
      flows: [
        {
          ...revenue,
          priorYtd: { ...revenue.priorYtd, asOf: "2025-03-31" },
        },
        {
          ...flowOf(basePeriod, "pretax_income")!,
          annual: {
            ...flowOf(basePeriod, "pretax_income")!.annual,
            concept: "us-gaap:ProfitLoss",
          },
        },
        flowOf(basePeriod, "income_tax")!,
      ],
    };

    expect(ttmBasePeriodMismatches(tampered)).toEqual([
      "basePeriod.flows.0.priorYtd",
      "basePeriod.flows.1",
    ]);
  });
});
