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

describe("extractEquityCompensationFromText", () => {
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
