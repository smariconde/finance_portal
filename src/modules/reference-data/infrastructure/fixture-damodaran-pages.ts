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

export function fixtureCountryRiskPage(count = 101): string {
  const rows = Array.from({ length: count }, (_, index) => [
    `Country ${String(index + 1).padStart(3, "0")}`,
    "Baa1",
    "1.36%",
    "2.07%",
    "6.30%",
    "25.00%",
    "NA",
    "NA",
  ]);

  return page(
    "<p>Country Default Spreads and Risk Premiums</p><p>Last updated: January 5, 2026</p>",
    table([
      ["My paper on equity risk premiums:", "", "", "https://example.invalid"],
    ]) +
      table([
        [
          "Country",
          "Moody's rating",
          "Adj. Default Spread",
          "Country Risk Premium",
          "Equity Risk Premium",
          "Corporate Tax Rate",
          "Sovereignn CDS",
          "ERP based on sovereign CDSS",
        ],
        ...rows,
        [
          "Turkey (updated February 2026)",
          "Ba3",
          "3.06%",
          "4.66%",
          "8.89%",
          "25.00%",
          "2.85%",
          "8.56%",
        ],
        [
          "United States",
          "Aa1",
          "0.23%",
          "0.35%",
          "4.58%",
          "25.00%",
          "NA",
          "NA",
        ],
        Array(8).fill(""),
      ]),
  );
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
