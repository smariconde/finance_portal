import { describe, expect, it } from "vitest";

import {
  EQUITY_COMPENSATION_CEILING_BYTES,
  extractEquityCompensation,
  extractEquityCompensationFromText,
  rankEquityCompensationAnchors,
  SEC_10K_EQUITY_COMPENSATION_VERSION,
} from "./sec-10k-equity-compensation";

/**
 * Textos sintéticos con las formas medidas el 2026-10-20 sobre seis 10-K
 * reales: tabla de opciones con vida promedio (Johnson & Johnson), vida en
 * prosa y montos en millones (Salesforce), sólo RSU (Apple), saldo «end of
 * year» con opciones en prosa (Ford). Ninguno es un extracto real.
 */
const FILLER = "Lorem ipsum operating results discussion. ".repeat(60);

const EQUITY_STATEMENT =
  "Consolidated Statements of Shareholders' Equity Balance at December 31, 2024 1,234 5,678 Stock compensation 418 Balance at December 31, 2025 1,300 5,900 Balance at December 31, 2023 1,100 5,500 Stock compensation 356";

const TABLE_NOTE =
  "16. Common stock, stock option plans and stock compensation agreements. A summary of option activity under the Plan is presented below: (Shares in Thousands) Outstanding Shares Weighted Average Exercise Price Shares at December 29, 2024 112,629 $144.69 Options granted 12,367 156.15 Options exercised (29,742) 128.09 Options canceled/forfeited (2,182) 160.90 Shares at December 28, 2025 93,072 $151.14. Average contractual life remaining in years 5.5. Restricted share units: Shares at December 28, 2025 12,136 2,111.";

const PROSE_NOTE =
  "NOTE 6. SHARE-BASED COMPENSATION Under our plans we may issue restricted stock units (RSUs) and stock options. Activity for RSUs was as follows (in millions): Outstanding, beginning of year 95.7 Granted 56.2 Vested (39.6) Forfeited (8.1) Outstanding, end of year 104.2. Stock Options: at December 31, 2025, stock options outstanding were 4.2 million; all are fully vested and will expire in 2030.";

const RSU_ONLY_NOTE =
  "Note 11 – Share-Based Compensation. Restricted Stock Units: a summary of the Company's RSU activity is as follows: Number of RSUs (in thousands) Balance as of September 28, 2024 163,326 RSUs granted 73,466 RSUs vested (76,845) RSUs forfeited (8,373) Balance as of September 27, 2025 151,574.";

const INCENTIVE_PROGRAM_NOTE =
  "18. Incentive Program The 2003 Incentive Program provides for grants of stock options and restricted stock. Restricted Stock and Restricted Stock Units: awards granted, vested and forfeited. Restricted stock and units outstanding 2025 Shares (thousands) Issued and outstanding at January 1 39,595 85.29 Awards issued in 2025 10,327 Vested (8,716) Forfeited (552) Issued and outstanding at December 31 40,654 92.45";

// La forma de las filas de Coca-Cola y Procter & Gamble (`1.1.0`), con cifras
// inventadas.
const ON_DATE_NOTE =
  "13. STOCK-BASED COMPENSATION PLANS. Stock option activity during the year ended December 31, 2025 was as follows: Shares (In millions) Weighted-Average Exercise Price Weighted-Average Remaining Contractual Term Outstanding on January 1, 2025 40 $ 50.00 Granted 4 70.00 Exercised (6) 45.00 Outstanding on December 31, 2025 38 $ 53.00 5.0 years Exercisable on December 31, 2025 25 $ 51.00";

const SMALL_CAPS_NOTE =
  "Note 7: SHARE-BASED COMPENSATION. A summary of options outstanding under the plans as of June 30, 2026, and activity during the year then ended is presented below: Options (in thousands) Weighted Average Exercise Price OUTSTANDING AT JULY 1, 2025 90,000 $ 120.00 Granted 9,000 150.00 Exercised (10,000) 90.00 Forfeited/expired (600) 150.00 OUTSTANDING AT JUNE 30, 2026 88,400 $ 126.00 Exercisable 60,000 $ 115.00";

describe("extractEquityCompensationFromText", () => {
  it("reads balance rows dated with «on» and rows in small caps (1.1.0)", () => {
    for (const note of [ON_DATE_NOTE, SMALL_CAPS_NOTE]) {
      const result = extractEquityCompensationFromText(
        `${FILLER} ${EQUITY_STATEMENT} ${FILLER} ${FILLER} ${note} ${FILLER}`,
      );

      expect(result?.version).toBe(SEC_10K_EQUITY_COMPENSATION_VERSION);
      expect(result?.section.text).toContain("Granted");
      expect(result?.section.text).not.toContain("Consolidated Statements");
    }
  });

  it("reads the balance rows 1.1.0 skipped (1.2.0)", () => {
    // Merck, Deckers, Align y Costco: sin preposición, con coma, «Unvested» y
    // «at the end of <año>». Montos sintéticos.
    for (const row of [
      "Outstanding December 31, 2025 1,247 $ 87.95",
      "Nonvested, March 31, 2026 365,872 114.20",
      "Unvested as of December 31, 2025 1,250 $ 256.80",
      "Outstanding at the end of 2026 2,000 $ 728.17",
    ]) {
      const note = `Stock-based compensation. The following table summarizes award activity. Number of Units Weighted-Average Grant Date Fair Value Granted 1,088 933.56 Vested and delivered (1,303) 669.59 Forfeited (93) 696.05 ${row} restricted stock units vested and forfeited.`;
      const result = extractEquityCompensationFromText(
        `${FILLER} ${note} ${FILLER}`,
      );

      expect(result?.section.text).toContain(row);
    }
  });

  it("does not take a small-caps equity statement for the note (Costco)", () => {
    const statement =
      "Stock-based compensation — — 822 — — 822 Release of vested restricted stock units (RSUs), including tax effects 1,337 — (315) — — (315) Repurchases of common stock (1,004) — (18) — (680) (698) Cash dividends declared — — — — (8,589) (8,589) BALANCE AT SEPTEMBER 1, 2024 443,126 2 7,829 (1,828) 17,619 23,622 Net income — — — — 8,099 8,099 Stock-based compensation — — 864 — — 864 Release of vested RSUs, including tax effects 1,054 — (393) — — (393) BALANCE AT AUGUST 31, 2025 443,237 2 8,282";

    expect(
      rankEquityCompensationAnchors(`${FILLER} ${statement} ${FILLER}`).every(
        (anchor) => anchor.score === 0,
      ),
    ).toBe(true);
  });

  it("reads an incentive program note whose balance rows print no year", () => {
    const result = extractEquityCompensationFromText(
      `${FILLER} ${EQUITY_STATEMENT} ${FILLER} ${INCENTIVE_PROGRAM_NOTE} ${FILLER}`,
    );

    expect(result?.section.text).toContain(
      "Issued and outstanding at December 31 40,654",
    );
  });

  it("cuts the note with its option and unit tables", () => {
    const result = extractEquityCompensationFromText(
      `${FILLER} ${EQUITY_STATEMENT} ${FILLER} ${TABLE_NOTE} ${FILLER}`,
    );

    expect(result?.version).toBe(SEC_10K_EQUITY_COMPENSATION_VERSION);
    expect(result?.section.section).toBe("equity_compensation");
    expect(result?.section.text).toContain("93,072 $151.14");
    expect(result?.section.text).toContain("12,136");
    expect(result?.section.text).toContain("5.5");
  });

  it("does not take the equity statement for the note", () => {
    const anchors = rankEquityCompensationAnchors(
      `${FILLER} ${EQUITY_STATEMENT} ${FILLER}`,
    );

    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.every((anchor) => anchor.score === 0)).toBe(true);
    expect(
      extractEquityCompensationFromText(`${FILLER} ${EQUITY_STATEMENT}`),
    ).toBeNull();
  });

  it("reads an end-of-year balance row and options written in prose", () => {
    const result = extractEquityCompensationFromText(
      `${FILLER} ${EQUITY_STATEMENT} ${FILLER} ${PROSE_NOTE} ${FILLER}`,
    );

    expect(result?.section.text).toContain("Outstanding, end of year 104.2");
    expect(result?.section.text).toContain("will expire in 2030");
  });

  it("cuts a note that only has units", () => {
    const result = extractEquityCompensationFromText(
      `${FILLER} ${RSU_ONLY_NOTE} ${FILLER}`,
    );

    expect(result?.section.text).toContain("151,574");
  });

  it("starts at the first anchor of the winning group", () => {
    const text = `${FILLER} ${TABLE_NOTE.replace("Restricted share units:", `${"The plan text continues. ".repeat(20)} Restricted share units activity:`)} ${FILLER}`;
    const result = extractEquityCompensationFromText(text);

    expect(result?.section.text.indexOf("16. Common stock")).toBeLessThan(250);
  });

  it("is null without a note", () => {
    expect(extractEquityCompensationFromText(FILLER)).toBeNull();
  });

  it("respects the byte ceiling", () => {
    const long = `${TABLE_NOTE} ${"Shares at December 28, 2025 1,000 vested granted options. ".repeat(400)}`;
    const result = extractEquityCompensationFromText(long);

    expect(result?.section.byteLength).toBeLessThanOrEqual(
      EQUITY_COMPENSATION_CEILING_BYTES,
    );
    expect(result?.section.truncated).toBe(true);
  });

  it("reads the visible text of the HTML document", () => {
    const html = `<html><body><p>${FILLER}</p><table><tr><td>${RSU_ONLY_NOTE}</td></tr></table></body></html>`;

    expect(extractEquityCompensation(html)?.section.text).toContain("151,574");
  });
});
