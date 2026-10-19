import { describe, expect, it } from "vitest";

import {
  annualFundamentalsConcepts,
  buildAnnualFundamentals,
  chooseFiscalYearAnchor,
  type FundamentalRow,
} from "./annual-fundamentals";

const SUBJECT = "11111111-1111-4111-8111-111111111111";
let sequence = 0;

function row(
  concept: string,
  asOf: string,
  value: string | null,
  overrides: Partial<FundamentalRow> = {},
): FundamentalRow {
  sequence += 1;
  const year = Number.parseInt(asOf.slice(0, 4), 10);

  return {
    observationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    subjectId: SUBJECT,
    concept: `us-gaap:${concept}`,
    periodType: "annual",
    asOf,
    periodStart: new Date(
      Date.parse(`${asOf}T00:00:00.000Z`) - 364 * 86_400_000,
    )
      .toISOString()
      .slice(0, 10),
    unit: "USD",
    currency: "USD",
    value,
    availableAt: `${year + 1}-02-01T21:00:00.000Z`,
    recordedAt: `${year + 1}-02-02T00:00:00.000Z`,
    sourceDocumentId: `0000000042-${year}-000001`,
    ...overrides,
  };
}

describe("annual fundamentals 1.1.0", () => {
  it("reads only the declared concepts, well under the lineage read ceiling", () => {
    const concepts = annualFundamentalsConcepts();
    expect(new Set(concepts).size).toBe(concepts.length);
    expect(concepts.length).toBeLessThanOrEqual(64);
  });

  it("recognizes 52/53-week fiscal years and skips trailing twelve months", () => {
    const rows = [
      row("Revenues", "2023-09-30", "100", { periodStart: "2022-10-02" }),
      row("Revenues", "2024-09-28", "110", { periodStart: "2023-10-01" }),
      // Doce meses móviles a fin de trimestre: no es un ejercicio.
      row("Revenues", "2024-12-28", "115", { periodStart: "2023-12-31" }),
    ];

    const series = buildAnnualFundamentals(rows, "2024-09-28", "2025-06-30");

    expect(series.fiscalYears.map((year) => year.fiscalYearEnd)).toEqual([
      "2024-09-28",
      "2023-09-30",
    ]);
  });

  it("reads one fiscal year when two filings date its close a day apart (1.1.0)", () => {
    // Deere: el ejercicio 2016 etiquetado 2016-10-31 en una presentación y
    // 2016-10-30 en otra, con valores apenas distintos.
    const rows = [
      row("ResearchAndDevelopmentExpense", "2017-10-29", "1373"),
      row("ResearchAndDevelopmentExpense", "2016-10-31", "1389.1", {
        availableAt: "2017-12-15T21:00:00.000Z",
      }),
      row("ResearchAndDevelopmentExpense", "2016-10-30", "1393.7", {
        availableAt: "2018-12-14T21:00:00.000Z",
      }),
    ];

    const series = buildAnnualFundamentals(rows, "2017-10-29", "2018-12-31");

    expect(
      series.fiscalYears.map((year) => [
        year.fiscalYearEnd,
        year.items.research_development?.value,
      ]),
    ).toEqual([
      ["2017-10-29", "1373"],
      // Gana la publicada último, que es la vista más reciente del ejercicio.
      ["2016-10-30", "1393.7"],
    ]);
  });

  it("prefers recurring R&D over R&D that includes acquired in-process R&D (1.1.0)", () => {
    const series = buildAnnualFundamentals(
      [
        row("ResearchAndDevelopmentExpense", "2025-12-28", "109"),
        row(
          "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost",
          "2025-12-28",
          "14665",
        ),
      ],
      "2025-12-28",
      "2026-06-30",
    );

    expect(series.fiscalYears[0]?.items.research_development).toMatchObject({
      concept:
        "us-gaap:ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost",
      value: "14665",
    });
  });

  it("does not take the noncurrent lease liability for the total (1.1.0)", () => {
    const series = buildAnnualFundamentals(
      [
        row("Revenues", "2025-12-31", "100"),
        row("OperatingLeaseLiabilityNoncurrent", "2025-12-31", "80", {
          periodType: "instant",
          periodStart: null,
        }),
      ],
      "2025-12-31",
      "2026-06-30",
    );
    const items = series.fiscalYears[0]?.items;

    expect(items?.operating_lease_liability).toBeUndefined();
    expect(items?.operating_lease_liability_noncurrent?.value).toBe("80");
  });

  it("takes alternatives in declared order and names the concept used", () => {
    const rows = [
      row(
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "2024-12-31",
        "90",
      ),
      row("Revenues", "2024-12-31", "100"),
    ];
    const [latest] = buildAnnualFundamentals(
      rows,
      "2024-12-31",
      "2025-06-30",
    ).fiscalYears;

    expect(latest?.items.revenue).toMatchObject({
      concept: "us-gaap:Revenues",
      value: "100",
    });
  });

  it("falls back to the next alternative and never fills a missing item", () => {
    const rows = [
      row(
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "2024-12-31",
        "90",
      ),
      row("Revenues", "2024-12-31", null),
    ];
    const [latest] = buildAnnualFundamentals(
      rows,
      "2024-12-31",
      "2025-06-30",
    ).fiscalYears;

    expect(latest?.items.revenue?.concept).toBe(
      "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    );
    expect(latest?.items.operating_income).toBeUndefined();
  });

  it("reads balance-sheet items as instants at the fiscal year end", () => {
    const rows = [
      row("Revenues", "2024-12-31", "100"),
      row("Assets", "2024-12-31", "500", {
        periodType: "instant",
        periodStart: null,
      }),
      row("Assets", "2024-09-30", "480", {
        periodType: "instant",
        periodStart: null,
      }),
    ];
    const [latest] = buildAnnualFundamentals(
      rows,
      "2024-12-31",
      "2025-06-30",
    ).fiscalYears;

    expect(latest?.items.assets).toMatchObject({ value: "500" });
  });

  it("drops fiscal years that close after the cutoff", () => {
    const rows = [
      row("Revenues", "2023-12-31", "100"),
      row("Revenues", "2024-12-31", "110"),
    ];

    expect(
      buildAnnualFundamentals(rows, "2024-12-31", "2024-06-30").fiscalYears,
    ).toHaveLength(1);
  });

  it("keeps a negative value as reported", () => {
    const rows = [row("OperatingIncomeLoss", "2024-12-31", "-25")];
    const [latest] = buildAnnualFundamentals(
      rows,
      "2024-12-31",
      "2025-06-30",
    ).fiscalYears;

    expect(latest?.items.operating_income?.value).toBe("-25");
  });
});

describe("chooseFiscalYearAnchor", () => {
  const rows = [
    row("Revenues", "2024-12-31", "100"),
    row("Revenues", "2025-12-31", "110"),
  ];

  it("prefers the latest lineage anchor whose month and day match published years", () => {
    // El sucesor registró como ancla el cierre de un 10-Q.
    expect(chooseFiscalYearAnchor(["2026-06-30", "2025-12-31"], rows)).toBe(
      "2025-12-31",
    );
  });

  it("matches by month and day, so a historical cutoff still finds its years", () => {
    expect(chooseFiscalYearAnchor(["2026-12-31"], rows)).toBe("2026-12-31");
  });

  it("returns null instead of inventing an anchor", () => {
    expect(chooseFiscalYearAnchor([], rows)).toBeNull();
    expect(chooseFiscalYearAnchor(["2026-06-30"], rows)).toBeNull();
  });
});
