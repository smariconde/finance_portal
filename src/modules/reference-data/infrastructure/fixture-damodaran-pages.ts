import { buildXlsx, type CellFixture } from "./fixture-xlsx";

/**
 * Páginas sintéticas con la forma de las de Damodaran (ADR 0032).
 *
 * Los términos del sitio no permiten redistribuir sus datos, así que ninguna
 * página capturada entra al repositorio: estas reproducen la **forma** —el
 * encabezado de Excel, las columnas y sus títulos, `NA`, los porcentajes, la
 * nota «(updated …)»— con valores inventados. Lo que prueban es el parser, no las
 * cifras.
 */
function table(rows: readonly (readonly string[])[]): string {
  return `<table>${rows
    .map(
      (cells) =>
        `<tr>${cells.map((cell) => `<td class=xl1>${cell}</td>`).join("")}</tr>`,
    )
    .join("\n")}</table>`;
}

function page(intro: string, body: string): string {
  // La exportación de Excel abre con estilos largos antes del texto.
  return `<html><head><style>${"td{mso-number-format:General;}".repeat(800)}</style></head><body>${intro}${body}</body></html>`;
}

export const FIXTURE_BETA_HEADERS = [
  "Industry Name",
  "Number of firms",
  "Beta",
  "D/E Ratio",
  "Effective Tax rate",
  "Unlevered beta",
  "Cash/Firm value",
  "Unlevered beta corrected for cash",
  "HiLo Risk",
  "Standard deviation of equity",
  "Standard deviation in operating income (last 10 years)",
];

export type FixtureBetaRow = readonly [string, ...string[]];

export function fixtureBetaRows(count = 52): FixtureBetaRow[] {
  const rows: FixtureBetaRow[] = Array.from({ length: count }, (_, index) => [
    `Industry ${String(index + 1).padStart(2, "0")}`,
    String(10 + index),
    "1.10",
    "25.00%",
    "12.50%",
    "0.95",
    "4.00%",
    "1.00",
    "0.5000",
    "40.00%",
    "20.00%",
  ]);

  rows.push(
    [
      "Software (System &amp; Application)",
      "300",
      "1.28",
      "5.58%",
      "5.51%",
      "1.23",
      "1.83%",
      "1.25",
      "0.5741",
      "56.79%",
      "48.63%",
    ],
    [
      "Total Market (without financials)",
      "4800",
      "0.99",
      "17.29%",
      "7.10%",
      "0.88",
      "2.60%",
      "0.90",
      "0.5345",
      "52.76%",
      "NA",
    ],
  );

  return rows;
}

export function fixtureBetasPage(
  options: {
    headers?: readonly string[];
    rows?: readonly FixtureBetaRow[];
  } = {},
): string {
  return page(
    "<p>Betas by Sector (US)</p><p>Date of Analysis : Data used is as of January 2026</p>",
    table([
      options.headers ?? FIXTURE_BETA_HEADERS,
      ...(options.rows ?? fixtureBetaRows()),
      Array(11).fill(""),
    ]),
  );
}

export const FIXTURE_EVA_HEADERS = [
  "Industry Name",
  "Number of Firms",
  "Beta",
  "ROE",
  "Cost of Equity",
  "(ROE - COE)",
  "BV of Equity",
  "Equity EVA (US $ millions)",
  "ROC",
  "Cost of Capital",
  "(ROC - WACC)",
  "BV of Capital",
  "EVA (US $ millions)",
];

/** Con las rarezas de la página: `$ ( … )`, `NA` en bancos y `####`. */
export function fixtureEvaPage(
  options: { headers?: readonly string[] } = {},
): string {
  const rows = Array.from({ length: 52 }, (_, index) => [
    `Industry ${String(index + 1).padStart(2, "0")}`,
    String(10 + index),
    "1.10",
    "12.00%",
    "9.00%",
    "3.00%",
    "$1,234.50",
    "$ (12.30)",
    "15.00%",
    "8.00%",
    "7.00%",
    "$2,000.00",
    "$ 140.00",
  ]);

  rows.push(
    [
      "Computers/Peripherals",
      "36",
      "1.35",
      "-0.17%",
      "9.97%",
      "-10.15%",
      "$114,471.67",
      "$ (11,614.98)",
      "44.76%",
      "9.71%",
      "35.05%",
      "$325,075.43",
      "$ 113,949.60",
    ],
    [
      "Bank (Money Center)",
      "15",
      "0.76",
      "12.86%",
      "7.34%",
      "5.52%",
      "$1,117,569.40",
      "$ 61,645.89",
      "NA",
      "4.98%",
      "NA",
      "$2,609,713.24",
      "NA",
    ],
    [
      "Total Market (without financials)",
      "4822",
      "0.99",
      "17.60%",
      "8.37%",
      "9.23%",
      "$9,797,425.27",
      "############",
      "15.07%",
      "7.72%",
      "7.35%",
      "$16,491,841.00",
      "$ 1,211,939.24",
    ],
  );

  return page(
    "<p>Date of Analysis : Data used is as of January 2026</p>",
    table([
      options.headers ?? FIXTURE_EVA_HEADERS,
      ...rows,
      Array(13).fill(""),
    ]),
  );
}

export const FIXTURE_MARGIN_HEADERS = [
  "Industry Name",
  "Number of firms",
  "Gross Margin",
  "Net Margin",
  "Pre-tax, Pre-stock compensation Operating Margin",
  "Pre-tax Unadjusted Operating Margin",
  "After-tax Unadjusted Operating Margin",
  "Pre-tax Lease adjusted Margin",
  "After-tax Lease Adjusted Margin",
  "Pre-tax Lease & R&D adj Margin",
  "After-tax Lease & R&D adj Margin",
  "EBITDA/Sales",
  "EBITDASG&A/Sales",
  "EBITDAR&D/Sales",
  "COGS/Sales",
  "R&D/Sales",
  "SG&A/ Sales",
  "Stock-Based Compensation/Sales",
  "Lease Expense/Sales",
];

/** Estructura sintética de la tabla de márgenes; no contiene cifras de NYU. */
export function fixtureMarginPage(
  options: { headers?: readonly string[]; targetMargin?: string } = {},
): string {
  const row = (label: string, margin: string) => [
    label,
    "12",
    "40.00%",
    "2.00%",
    "11.00%",
    "8.00%",
    "7.00%",
    "9.00%",
    "8.00%",
    margin,
    "8.50%",
    "15.00%",
    "21.00%",
    "16.00%",
    "60.00%",
    "4.00%",
    "18.00%",
    "3.00%",
    "2.00%",
  ];
  return page(
    "<p>Date of Analysis: Data used is as of January 2026</p>",
    table([
      options.headers ?? FIXTURE_MARGIN_HEADERS,
      ...Array.from({ length: 51 }, (_, index) =>
        row(`Industry ${String(index + 1).padStart(2, "0")}`, "12.50%"),
      ),
      row(
        "Total Market (without financials)",
        options.targetMargin ?? "14.00%",
      ),
      Array(FIXTURE_MARGIN_HEADERS.length).fill(""),
    ]),
  );
}

export const FIXTURE_BREAKDOWN_HEADERS = [
  "Country",
  "GDP (in millions) in 2024",
  "Moody's rating",
  "Sovereign CDS",
  "Adj. Default Spread",
  "Equity Risk Premium",
  "Country Risk Premium",
  "Corporate Tax Rate",
  "Region",
] as const;

const FIXTURE_REGIONS = [
  "Africa",
  "Asia",
  "Australia & New Zealand",
  "Caribbean",
  "Central and South America",
  "Eastern Europe",
  "Middle East",
  "North America",
  "Western Europe",
] as const;

/**
 * El libro de riesgo país, sintético: las dos hojas que se leen con la forma
 * del archivo de Damodaran —encabezados, filas resumen de región reconocidas
 * por región vacía y peso 1, agrupaciones al pie— y cifras inventadas.
 */
export function fixtureCountryRiskWorkbook(
  options: {
    readonly countries?: number;
    readonly breakdownHeaders?: readonly string[];
  } = {},
): Uint8Array {
  const count = options.countries ?? 101;
  const countries: CellFixture[][] = Array.from(
    { length: count },
    (_, index) => [
      `Country ${String(index + 1).padStart(3, "0")}`,
      { n: "1000.5" },
      "Baa1",
      "NA",
      { n: "1.3599999999999999E-2" },
      { n: "6.3E-2" },
      { n: "2.07E-2" },
      { n: "0.25" },
      FIXTURE_REGIONS[index % FIXTURE_REGIONS.length]!,
    ],
  );

  const breakdown: CellFixture[][] = [
    [...(options.breakdownHeaders ?? FIXTURE_BREAKDOWN_HEADERS)],
    [
      "St. Vincent & the Grenadines",
      { n: "1063.5" },
      "B3",
      "NA",
      { n: "5.1747824426647708E-2" },
      { n: "0.122441761564857" },
      { n: "8.0441761564857009E-2" },
      { n: "0.3" },
      "Caribbean",
    ],
    ...countries,
    [
      "United States",
      { n: "28750956.130731199" },
      "Aa1",
      { n: "5.5999999999999999E-3" },
      { n: "2.1863536781947081E-3" },
      { n: "4.4200000000000003E-2" },
      { n: "2.1863536781947081E-3" },
      { n: "0.25" },
      "North America",
    ],
    [
      "Côte d'Ivoire",
      { n: "87113.18" },
      "Ba2",
      { error: "#N/A" },
      { n: "2.3955593224632577E-2" },
      { n: "7.9238862496570334E-2" },
      { n: "3.7238862496570338E-2" },
      { n: "0.25" },
      "Africa",
    ],
  ];

  const weighted: CellFixture[][] = [
    [
      "Country",
      "GDP (in millions) in 2024",
      "Moody's rating",
      "Adj. Default Spread",
      "Equity Risk Premium",
      "Country Risk Premium",
      "Corporate Tax Rate",
      "Region",
      "GDP Weight",
      "Weight*Default Spread",
    ],
  ];

  FIXTURE_REGIONS.forEach((region, index) => {
    // Un país de detalle, que nombra su región, y la fila que la cierra.
    weighted.push([
      `Member of ${region}`,
      { n: "100" },
      "A1",
      { n: "5.614592162023261E-3" },
      { n: "5.0727858397633677E-2" },
      { n: "8.727858397633674E-3" },
      { n: "0.25" },
      region,
      { n: "1" },
      { n: "5.614592162023261E-3" },
    ]);
    weighted.push([
      region,
      { n: String(1000 * (index + 1)) },
      null,
      { n: "4.7486708416285141E-2" },
      { n: "0.11581787578987807" },
      { n: index === 7 ? "2.028087891797981E-3" : "7.3817875789878071E-2" },
      { n: "0.27390173905276305" },
      null,
      { n: index % 2 === 0 ? "1.0000000000000007" : "0.99999999999999989" },
    ]);
  });
  // Las agrupaciones del pie no tienen peso: no son filas resumen.
  weighted.push(["For updating industry averages"], [null, "ERP"]);
  weighted.push(["Global", { n: "5.503557485521765E-2" }]);

  return buildXlsx([
    { name: "Explanation and FAQ", rows: [["Read me"]] },
    { name: "Regional breakdown", rows: breakdown },
    { name: "Regional Weighted Averages", rows: weighted },
  ]);
}

export function fixtureImpliedErpPage(): string {
  const rows = Array.from({ length: 66 }, (_, index) => {
    const year = String(1960 + index);
    return [
      year,
      "4.00%",
      "2.00%",
      "100.00",
      "4.00",
      "2.00",
      "4.18%",
      "4.61%",
      index === 0 ? "" : "4.23%",
    ];
  });

  return page(
    "<p>Historical Implied Equity Risk Premiums</p><p>Date : January 2026</p>",
    table([
      [
        "Year",
        "Earnings Yield",
        "Dividend Yield",
        "S&amp;P 500",
        "Earnings*",
        "Dividends*",
        "T.Bond Rate",
        "Smoothed Growth",
        "Implied ERP (FCFE)",
      ],
      ...rows,
      Array(9).fill(""),
    ]),
  );
}

const RATING_BANDS: readonly (readonly [string, string, string, string])[] = [
  ["-100000", "0.199999", "D2/D", "19.00%"],
  ["0.2", "0.649999", "C2/C", "16.00%"],
  ["0.65", "0.799999", "Ca2/CC", "12.61%"],
  ["0.8", "1.249999", "Caa/CCC", "8.85%"],
  ["1.25", "1.499999", "B3/B-", "5.09%"],
  ["1.5", "1.749999", "B2/B", "3.21%"],
  ["1.75", "1.999999", "B1/B+", "2.75%"],
  ["2", "2.2499999", "Ba2/BB", "1.83%"],
  ["2.25", "2.49999", "Ba1/BB+", "1.38%"],
  ["2.5", "2.999999", "Baa2/BBB", "1.11%"],
  ["3", "4.249999", "A3/A-", "0.89%"],
  ["4.25", "5.499999", "A2/A", "0.78%"],
  ["5.5", "6.499999", "A1/A+", "0.70%"],
  ["6.5", "8.499999", "Aa2/AA", "0.55%"],
  ["8.50", "100000", "Aaa/AAA", "0.40%"],
];

export function fixtureRatingsPage(): string {
  return page(
    "<p>Ratings, Interest Coverage Ratios and Default Spread</p><p>Date of Analysis : Data used is as of January 2026</p>",
    table([
      [
        "For large non-financial service firms",
        "",
        "",
        "For financial service firms",
      ],
      [
        ">",
        "&le; to",
        "Rating is",
        "Spread is",
        "",
        "greater than",
        "&le; to",
        "Rating is",
        "Spread is",
      ],
      ...RATING_BANDS.map((band, index) => [
        ...band,
        "",
        String(index * 0.25),
        String(index * 0.25 + 0.249999),
        band[2],
        band[3],
      ]),
      Array(9).fill(""),
    ]),
  );
}
