import { describe, expect, it } from "vitest";

import { DEMO_IDENTITY_GRAPH } from "@/modules/identity/infrastructure/demo-identity-fixtures";
import { InMemoryPriceRepository } from "@/modules/prices/infrastructure/in-memory-price-repository";

import { parseDecimal } from "../domain/decimal-policy";
import type { ValuationRun } from "../domain/valuation-run";
import { buildDemoValuationRun } from "../infrastructure/demo-valuation-run";
import { fixtureFinancialValuation } from "../infrastructure/fixture-financial-valuation";
import { createInMemoryValuationRunRepository } from "../infrastructure/in-memory-valuation-run-repository";
import { runExcessReturn } from "./run-excess-return";
import {
  readValuedCompanies,
  VALUED_COMPANIES_VERSION,
} from "./read-valued-companies";

const SUBJECT = buildDemoValuationRun();
const TODAY = "2026-11-16";
const universe = {
  loadState: async () => ({ graph: DEMO_IDENTITY_GRAPH, memberships: [] }),
};

function uuid(index: number, prefix: string): string {
  return `${prefix.repeat(8)}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/** Otra empresa, con la misma corrida de referencia y otra identidad. */
function otherCompany(index: number, overrides: Partial<ValuationRun> = {}) {
  return {
    ...SUBJECT,
    valuationRunId: uuid(index, "6"),
    inputHash: String(index).padStart(64, "a"),
    subject: {
      ...SUBJECT.subject,
      legalEntityId: uuid(index, "5"),
      securityId: uuid(index, "7"),
      listingId: null,
    },
    ...overrides,
  } satisfies ValuationRun;
}

describe("readValuedCompanies", () => {
  it("lists the latest run of each company with its close at the run's as_of", async () => {
    const value = parseDecimal(SUBJECT.result!.valuePerShare, "value");
    const older = {
      ...SUBJECT,
      valuationRunId: uuid(9, "6"),
      inputHash: "9".repeat(64),
      asOf: "2024-01-02",
    } satisfies ValuationRun;
    const runs = createInMemoryValuationRunRepository([older, SUBJECT]);
    const prices = new InMemoryPriceRepository();
    await prices.writeSeries(
      [
        {
          securityId: SUBJECT.subject.securityId,
          marketDate: SUBJECT.asOf,
          close: value.times(2).toFixed(),
          currency: "USD",
        },
      ],
      [],
    );

    const reading = await readValuedCompanies(
      { today: TODAY },
      { runs, universe, prices },
    );

    expect(reading.version).toBe(VALUED_COMPANIES_VERSION);
    expect(reading.companies).toHaveLength(1);
    const [company] = reading.companies;
    expect(company).toMatchObject({
      ticker: "FXCO",
      method: "fcff_base",
      status: SUBJECT.status,
      asOf: SUBJECT.asOf,
      valuePerShare: SUBJECT.result!.valuePerShare,
      comparisonGap: null,
    });
    expect(parseDecimal(company!.priceToValue!, "p/v").toFixed()).toBe("2");
    // Ningún ID interno viaja a la página.
    expect(JSON.stringify(reading)).not.toContain(
      SUBJECT.subject.legalEntityId,
    );
  });

  it("keeps a rejected run and a missing close as named gaps, never as zero", async () => {
    const rejected = otherCompany(1, {
      status: "rejected",
      result: null,
      resultHash: null,
      failure: {
        code: "policy_check_failed",
        message: "Rejected.",
        subjects: [],
      },
    } as Partial<ValuationRun>);
    const runs = createInMemoryValuationRunRepository([SUBJECT, rejected]);

    const reading = await readValuedCompanies(
      { today: TODAY },
      { runs, universe, prices: new InMemoryPriceRepository() },
    );

    expect(reading.companies).toHaveLength(2);
    const byStatus = Object.fromEntries(
      reading.companies.map((company) => [company.status, company]),
    );
    expect(byStatus.rejected).toMatchObject({
      valuePerShare: null,
      priceToValue: null,
      comparisonGap: "no_value_per_share",
    });
    expect(byStatus[SUBJECT.status]).toMatchObject({
      priceToValue: null,
      close: null,
      comparisonGap: "no_close_at_as_of",
    });
  });

  it("reads an excess-return run with the financial comparison", async () => {
    const runs = createInMemoryValuationRunRepository();
    await runs.record(
      runExcessReturn(fixtureFinancialValuation(), {
        now: () => "2026-03-02T22:00:00.000Z",
        newValuationRunId: () => "70000000-0000-4000-8000-000000000001",
      }),
    );

    const reading = await readValuedCompanies(
      { today: TODAY },
      { runs, universe, prices: new InMemoryPriceRepository() },
    );

    expect(reading.companies).toHaveLength(1);
    expect(reading.companies[0]).toMatchObject({
      method: "excess_return",
      priceToValue: null,
      comparisonGap: "no_close_at_as_of",
    });
    expect(reading.companies[0]!.valuePerShare).not.toBeNull();
  });
});
