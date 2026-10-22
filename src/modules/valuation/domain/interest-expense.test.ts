import { describe, expect, it } from "vitest";

import type {
  FiscalYear,
  LineItemId,
  LineItemValue,
} from "./annual-fundamentals";
import { interestExpenseOf, netInterestForEbit } from "./interest-expense";

let sequence = 0;

function year(
  items: Partial<Record<LineItemId, string | [string, string]>>,
): FiscalYear {
  return {
    fiscalYearEnd: "2025-12-31",
    items: Object.fromEntries(
      Object.entries(items).map(([item, spec]) => {
        sequence += 1;
        const [value, currency] = Array.isArray(spec) ? spec : [spec, "USD"];
        const entry: LineItemValue = {
          item: item as LineItemId,
          concept: `us-gaap:${item}`,
          value,
          unit: currency,
          currency,
          asOf: "2025-12-31",
          observationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
          availableAt: "2026-02-01T21:00:00.000Z",
          recordedAt: "2026-02-02T00:00:00.000Z",
          sourceDocumentId: null,
        };
        return [item, entry];
      }),
    ),
  };
}

const read = (reading: ReturnType<typeof interestExpenseOf>) =>
  reading === null
    ? null
    : { value: reading.value.toString(), basis: reading.basis };

describe("interestExpenseOf", () => {
  it("prefers the gross expense over every substitute", () => {
    expect(
      read(
        interestExpenseOf(
          year({
            interest_expense: "100",
            interest_expense_debt: "90",
            interest_net_nonoperating: "-80",
            interest_paid: "95",
          }),
        ),
      ),
    ).toEqual({ value: "100", basis: "gross" });
  });

  it("adds finance-lease interest to the debt's, which excludes it (Walmart)", () => {
    expect(
      read(
        interestExpenseOf(
          year({
            interest_expense_debt: "2318",
            finance_lease_interest_expense: "383",
          }),
        ),
      ),
    ).toEqual({ value: "2701", basis: "debt_plus_finance_leases" });
    expect(
      read(interestExpenseOf(year({ interest_expense_debt: "2318" }))),
    ).toEqual({ value: "2318", basis: "debt_plus_finance_leases" });
  });

  it("takes a net that is an expense, with its sign flipped (Waste Management)", () => {
    expect(
      read(interestExpenseOf(year({ interest_net_nonoperating: "-912" }))),
    ).toEqual({ value: "912", basis: "net_nonoperating" });
  });

  it("does not take net interest income as an expense, and falls to what was paid", () => {
    expect(
      read(
        interestExpenseOf(
          year({ interest_net_nonoperating: "50", interest_paid: "323" }),
        ),
      ),
    ).toEqual({ value: "323", basis: "interest_paid" });
    expect(interestExpenseOf(year({ interest_net_nonoperating: "50" }))).toBe(
      null,
    );
  });

  it("is null, never zero, without any basis", () => {
    expect(interestExpenseOf(year({ pretax_income: "10" }))).toBeNull();
    expect(interestExpenseOf(undefined)).toBeNull();
  });

  it("refuses to add two currencies", () => {
    expect(
      interestExpenseOf(
        year({
          interest_expense_debt: ["10", "USD"],
          finance_lease_interest_expense: ["5", "EUR"],
        }),
      ),
    ).toBeNull();
  });
});

describe("netInterestForEbit", () => {
  it("subtracts net interest income on the way to EBIT (Nike)", () => {
    expect(
      read(netInterestForEbit(year({ interest_net_nonoperating: "50" }))),
    ).toEqual({ value: "-50", basis: "net_nonoperating" });
  });

  it("matches the expense when one is reported", () => {
    expect(
      read(netInterestForEbit(year({ interest_net_nonoperating: "-912" }))),
    ).toEqual({ value: "912", basis: "net_nonoperating" });
    expect(read(netInterestForEbit(year({ interest_expense: "7" })))).toEqual({
      value: "7",
      basis: "gross",
    });
  });
});
