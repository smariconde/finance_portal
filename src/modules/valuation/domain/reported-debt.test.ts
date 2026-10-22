import { describe, expect, it } from "vitest";

import { zeroDebtEvidenceFixture } from "../infrastructure/zero-debt-evidence-fixtures";
import {
  REPORTED_DEBT_EVIDENCE_VERSION,
  REPORTED_DEBT_VERSION,
  resolveReportedDebt,
  type DebtComponentKey,
  type ReportedDebtInput,
} from "./reported-debt";
import { ZERO_DEBT_EVIDENCE_VERSION } from "./zero-debt-evidence";

const CONCEPTS: Record<DebtComponentKey, string> = {
  longTermTotal: "us-gaap:LongTermDebt",
  longTermNoncurrent: "us-gaap:LongTermDebtNoncurrent",
  longTermCurrent: "us-gaap:LongTermDebtCurrent",
  currentTotal: "us-gaap:DebtCurrent",
  shortTermBorrowings: "us-gaap:ShortTermBorrowings",
  commercialPaper: "us-gaap:CommercialPaper",
  financeLeases: "us-gaap:FinanceLeaseLiability",
};

function debt(
  values: Partial<Record<DebtComponentKey, string>>,
  concepts: Partial<Record<DebtComponentKey, string>> = {},
): ReportedDebtInput {
  return Object.fromEntries(
    (Object.keys(CONCEPTS) as DebtComponentKey[]).map((key) => [
      key,
      values[key] === undefined
        ? null
        : { value: values[key], concept: concepts[key] ?? CONCEPTS[key] },
    ]),
  ) as ReportedDebtInput;
}

// Las formas son las medidas el 2026-10-19 sobre los filers seguidos; los
// montos, en millones, sólo para que el caso se lea.
describe("reported-debt-1.0.0", () => {
  it("prefers all current debt plus the noncurrent part (Johnson & Johnson)", () => {
    const result = resolveReportedDebt(
      debt({
        longTermTotal: "41438",
        longTermNoncurrent: "39438",
        longTermCurrent: "2000",
        currentTotal: "8500",
        shortTermBorrowings: "8495",
      }),
    );

    expect(result).toMatchObject({
      version: REPORTED_DEBT_VERSION,
      status: "resolved",
      recipe: "current_plus_noncurrent",
      total: "47938",
    });
    // Lo que la receta no lee queda nombrado, no descartado en silencio.
    expect(result.status === "resolved" && result.excluded).toStrictEqual([
      {
        component: "longTermTotal",
        concept: "us-gaap:LongTermDebt",
        reason: "not_in_recipe",
      },
      {
        component: "longTermCurrent",
        concept: "us-gaap:LongTermDebtCurrent",
        reason: "not_in_recipe",
      },
      {
        component: "shortTermBorrowings",
        concept: "us-gaap:ShortTermBorrowings",
        reason: "not_in_recipe",
      },
    ]);
  });

  it("adds short-term paper and finance leases to the long-term total (Apple)", () => {
    const result = resolveReportedDebt(
      debt({
        longTermTotal: "90678",
        longTermNoncurrent: "78328",
        longTermCurrent: "12350",
        commercialPaper: "7979",
        financeLeases: "1230",
      }),
    );

    expect(result).toMatchObject({
      status: "resolved",
      recipe: "long_term_total_plus_short_term",
      total: "99887",
    });
    expect(
      result.status === "resolved" &&
        result.included.map((entry) => entry.component),
    ).toStrictEqual(["longTermTotal", "commercialPaper", "financeLeases"]);
  });

  it("does not count current maturities tagged twice (Devon)", () => {
    const result = resolveReportedDebt(
      debt({
        longTermTotal: "8389",
        longTermNoncurrent: "7391",
        longTermCurrent: "998",
        shortTermBorrowings: "998",
        commercialPaper: "0",
        financeLeases: "23",
      }),
    );

    expect(result).toMatchObject({ status: "resolved", total: "8412" });
    expect(
      result.status === "resolved" &&
        result.excluded.filter((entry) => entry.reason !== "not_in_recipe"),
    ).toStrictEqual([
      {
        component: "shortTermBorrowings",
        concept: "us-gaap:ShortTermBorrowings",
        reason: "equals_current_maturities",
      },
      {
        component: "commercialPaper",
        concept: "us-gaap:CommercialPaper",
        reason: "short_term_borrowings_preferred",
      },
    ]);
  });

  it("adds short-term borrowings that differ from the current maturities", () => {
    expect(
      resolveReportedDebt(
        debt({
          longTermTotal: "87212",
          longTermCurrent: "7104",
          shortTermBorrowings: "2624",
        }),
      ),
    ).toMatchObject({ status: "resolved", total: "89836" });
  });

  it("keeps finance leases out of a noncurrent amount that already has them (Exxon)", () => {
    const result = resolveReportedDebt(
      debt(
        {
          longTermNoncurrent: "34241",
          longTermCurrent: "6200",
          currentTotal: "9296",
          commercialPaper: "3059",
          financeLeases: "2659",
        },
        {
          longTermNoncurrent: "us-gaap:LongTermDebtAndCapitalLeaseObligations",
        },
      ),
    );

    expect(result).toMatchObject({
      status: "resolved",
      recipe: "current_plus_noncurrent",
      total: "43537",
    });
    expect(
      result.status === "resolved" &&
        result.excluded.find((entry) => entry.component === "financeLeases"),
    ).toMatchObject({ reason: "included_in_noncurrent" });
  });

  it("builds the total from noncurrent and current maturities (American Tower)", () => {
    expect(
      resolveReportedDebt(
        debt(
          {
            longTermNoncurrent: "33833",
            longTermCurrent: "3388",
            financeLeases: "16",
          },
          {
            longTermNoncurrent:
              "us-gaap:LongTermDebtAndCapitalLeaseObligations",
          },
        ),
      ),
    ).toMatchObject({
      status: "resolved",
      recipe: "noncurrent_plus_current_maturities",
      total: "37221",
    });
  });

  it("leaves the debt unresolved when no recipe closes, never zero (Ford, Caterpillar)", () => {
    expect(resolveReportedDebt(debt({ financeLeases: "890" }))).toStrictEqual({
      version: REPORTED_DEBT_VERSION,
      status: "unresolved",
      reason: "no_recipe",
      present: ["financeLeases"],
    });
    // Sin los vencimientos corrientes, la no corriente más los préstamos no es
    // el total.
    expect(
      resolveReportedDebt(
        debt({ longTermNoncurrent: "30696", shortTermBorrowings: "5514" }),
      ),
    ).toMatchObject({
      status: "unresolved",
      present: ["longTermNoncurrent", "shortTermBorrowings"],
    });
    expect(resolveReportedDebt(debt({}))).toMatchObject({
      status: "unresolved",
      present: [],
    });
  });

  it("refuses a negative component instead of netting it", () => {
    expect(
      resolveReportedDebt(
        debt({ longTermTotal: "100", commercialPaper: "-5" }),
      ),
    ).toMatchObject({ status: "unresolved", reason: "negative_component" });
  });

  it("resolves a zero total when the filer publishes zero debt", () => {
    expect(resolveReportedDebt(debt({ longTermTotal: "0" }))).toMatchObject({
      status: "resolved",
      total: "0",
    });
  });
});

describe("reported-debt-1.1.0", () => {
  const evidence = zeroDebtEvidenceFixture("2025-12-31");

  it("is zero with evidence and no component at all (Intuitive Surgical)", () => {
    expect(resolveReportedDebt(debt({}), evidence)).toStrictEqual({
      version: REPORTED_DEBT_EVIDENCE_VERSION,
      status: "zero_with_evidence",
      evidence: ZERO_DEBT_EVIDENCE_VERSION,
      reportedZero: [],
      total: "0",
    });
  });

  it("names the components reported at zero", () => {
    expect(
      resolveReportedDebt(debt({ shortTermBorrowings: "0" }), evidence),
    ).toMatchObject({
      status: "zero_with_evidence",
      reportedZero: ["shortTermBorrowings"],
    });
  });

  it("takes finance leases as the debt when they are all there is (Vertex)", () => {
    expect(
      resolveReportedDebt(
        debt({ financeLeases: "112.2", commercialPaper: "0" }),
        evidence,
      ),
    ).toStrictEqual({
      version: REPORTED_DEBT_EVIDENCE_VERSION,
      status: "resolved",
      recipe: "finance_leases_only",
      included: [
        {
          component: "financeLeases",
          concept: CONCEPTS.financeLeases,
          amount: "112.2",
        },
      ],
      excluded: [
        {
          component: "commercialPaper",
          concept: CONCEPTS.commercialPaper,
          reason: "reported_zero",
        },
      ],
      total: "112.2",
    });
  });

  it("does not use the evidence against a borrowing with an amount (Moderna)", () => {
    expect(
      resolveReportedDebt(
        debt({ longTermNoncurrent: "590", financeLeases: "45" }),
        evidence,
      ),
    ).toStrictEqual({
      version: REPORTED_DEBT_VERSION,
      status: "unresolved",
      reason: "no_recipe",
      present: ["longTermNoncurrent", "financeLeases"],
    });
  });

  it("does not use evidence that no longer holds", () => {
    const material = zeroDebtEvidenceFixture("2025-12-31", { interest: "100" });

    expect(resolveReportedDebt(debt({}), material)).toMatchObject({
      version: REPORTED_DEBT_VERSION,
      status: "unresolved",
    });
  });

  it("keeps the 1.0.0 answer byte for byte when a recipe closes", () => {
    const input = debt({ longTermTotal: "1500", commercialPaper: "100" });

    expect(resolveReportedDebt(input, evidence)).toStrictEqual(
      resolveReportedDebt(input),
    );
    expect(resolveReportedDebt(input).version).toBe(REPORTED_DEBT_VERSION);
  });
});
