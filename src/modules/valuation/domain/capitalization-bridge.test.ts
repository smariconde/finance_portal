import { describe, expect, it } from "vitest";

import {
  LINE_ITEMS,
  type AnnualFundamentals,
  type LineItemId,
  type LineItemValue,
} from "./annual-fundamentals";
import {
  buildCapitalization,
  capitalizationFactsFromSeries,
  capitalizationMismatches,
  EBIT_FROM_PRETAX_VERSION,
  listCapitalizationFacts,
  type CapitalizationContext,
} from "./capitalization-bridge";
import type { MonetaryFact } from "./valuation-facts";

const BASE = "2026-05-31";

const CONTEXT: CapitalizationContext = {
  baseRevenue: "46309000000",
  industryKey: null,
  preTaxCostOfDebt: "0.0458",
};

function line(item: LineItemId, value: string): LineItemValue {
  return {
    item,
    concept: LINE_ITEMS.find((definition) => definition.item === item)!
      .concepts[0]!,
    value,
    unit: "USD",
    currency: "USD",
    asOf: BASE,
    observationId: "00000000-0000-4000-8000-000000000001",
    availableAt: "2026-07-20T21:00:00.000Z",
    recordedAt: "2026-07-21T00:00:00.000Z",
    sourceDocumentId: "0000320187-26-000001",
  };
}

function series(
  items: Partial<Record<LineItemId, string>>,
): AnnualFundamentals {
  return {
    version: "annual-fundamentals-1.6.0",
    fiscalYears: [
      {
        fiscalYearEnd: BASE,
        items: Object.fromEntries(
          Object.entries({ revenue: "46309000000", ...items }).map(
            ([id, value]) => [id, line(id as LineItemId, value)],
          ),
        ),
      },
    ],
  };
}

function toFact(item: LineItemValue): MonetaryFact {
  return {
    value: item.value,
    currency: "USD",
    unit: "monetary",
    asOf: item.asOf,
    availableAt: item.availableAt,
    sourceId: "sec-edgar",
    sourceDocumentId: item.sourceDocumentId,
    observationId: item.observationId,
    qualityFlags: [],
  };
}

describe(EBIT_FROM_PRETAX_VERSION, () => {
  // La forma de Nike: sin resultado operativo ni intereses brutos, con el neto
  // de intereses como ingreso.
  const nike = capitalizationFactsFromSeries(
    series({
      pretax_income: "3900000000",
      interest_net_nonoperating: "161000000",
    }),
    toFact,
  )!;

  it("derives EBIT from pretax income and the net interest, and says so", () => {
    expect(nike.reportedEbit).toBeNull();
    expect(nike.ebitDerivation).toMatchObject({
      version: EBIT_FROM_PRETAX_VERSION,
      pretaxIncome: { value: "3900000000" },
      interest: { basis: "net_nonoperating" },
    });

    const capitalization = buildCapitalization(nike, CONTEXT);

    // Un neto de ingreso se resta: 3.900 − 161 = 3.739.
    expect(capitalization.ledger.ebit).toMatchObject({
      basis: "pretax_plus_interest",
      reported: "3739000000",
      adjusted: "3739000000",
    });
    expect(capitalizationMismatches(capitalization, CONTEXT)).toEqual([]);
    expect(
      listCapitalizationFacts(capitalization).map((entry) => entry.path),
    ).toEqual(
      expect.arrayContaining([
        "capitalization.ebitDerivation.pretaxIncome",
        "capitalization.ebitDerivation.interest.facts.0",
      ]),
    );
  });

  it("adds the gross interest expense (Merck)", () => {
    const merck = capitalizationFactsFromSeries(
      series({ pretax_income: "21067000000", interest_expense: "1357000000" }),
      toFact,
    )!;

    expect(buildCapitalization(merck, CONTEXT).ledger.ebit.reported).toBe(
      "22424000000",
    );
  });

  it("does not derive when operating income is published: the bridge stays as it was", () => {
    const published = capitalizationFactsFromSeries(
      series({
        operating_income: "4000000000",
        pretax_income: "3900000000",
        interest_expense: "100000000",
      }),
      toFact,
    )!;
    const capitalization = buildCapitalization(published, CONTEXT);

    expect("ebitDerivation" in published).toBe(false);
    expect("ebitDerivation" in capitalization).toBe(false);
    expect("basis" in capitalization.ledger.ebit).toBe(false);
  });

  it("leaves EBIT unpublished without interest to add", () => {
    const facts = capitalizationFactsFromSeries(
      series({ pretax_income: "3900000000" }),
      toFact,
    )!;

    expect(facts.ebitDerivation).toBeUndefined();
    expect(buildCapitalization(facts, CONTEXT).ledger.ebit.reported).toBeNull();
  });

  it("names a derivation edited by hand, dated elsewhere or next to a published EBIT", () => {
    const capitalization = buildCapitalization(nike, CONTEXT);
    const edited = structuredClone(capitalization);
    edited.ebitDerivation!.pretaxIncome.value = "4900000000";
    const shifted = structuredClone(capitalization);
    shifted.ebitDerivation!.interest.facts[0]!.asOf = "2025-05-31";
    const doubled = structuredClone(capitalization);
    doubled.reportedEbit = toFact(line("operating_income", "3739000000"));

    expect(capitalizationMismatches(edited, CONTEXT)).toEqual([
      "capitalization.ledger",
    ]);
    expect(capitalizationMismatches(shifted, CONTEXT)).toEqual([
      "capitalization.ebitDerivation.interest.facts.0",
    ]);
    expect(capitalizationMismatches(doubled, CONTEXT)).toEqual(
      expect.arrayContaining(["capitalization.ebitDerivation"]),
    );
  });
});
