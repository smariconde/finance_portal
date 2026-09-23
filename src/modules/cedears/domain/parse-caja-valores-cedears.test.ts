import { describe, expect, it } from "vitest";

import {
  FIXTURE_CEDEAR_ISINS,
  FIXTURE_UNDERLYING_ISINS,
  fixtureCajaValoresHtml,
} from "../infrastructure/fixture-cedear-publications";

import { parseCajaValoresCedears } from "./parse-caja-valores-cedears";

describe("parseCajaValoresCedears", () => {
  it("reads both tables into claims", () => {
    const publication = parseCajaValoresCedears(fixtureCajaValoresHtml());

    expect(publication.ok).toBe(true);

    if (!publication.ok) {
      return;
    }

    expect(publication.rowsSeen).toBe(3);
    expect(publication.rejections).toEqual([]);
    expect(publication.listedIsins.size).toBe(3);
    expect(
      publication.claims.find(
        (claim) => claim.cedearIsin === FIXTURE_CEDEAR_ISINS.delta,
      ),
    ).toEqual({
      cedearIsin: FIXTURE_CEDEAR_ISINS.delta,
      cajaValoresCode: "8602",
      programName: "FIXTURE DELTA CO",
      // «Símbolo BYMA» es el símbolo del CEDEAR, no un ticker de origen.
      originSymbols: ["FXD"],
      originMarket: "NASDAQ GS",
      reportedUnderlyingIsin: FIXTURE_UNDERLYING_ISINS.delta,
      ratio: { depositaryUnits: "5", underlyingUnits: "1" },
      status: "active",
      investorScope: "all_investors",
    });
  });

  it("decodes entities in the program name", () => {
    const publication = parseCajaValoresCedears(fixtureCajaValoresHtml());

    expect(
      publication.ok &&
        publication.claims.find(
          (claim) => claim.cedearIsin === FIXTURE_CEDEAR_ISINS.cajaEtf,
        )?.programName,
    ).toBe("FIXTURE S&P ETF");
  });

  it("refuses the whole page when a column moves", () => {
    // Con una columna agregada el ratio se leería del monto máximo: eso tiene
    // que ser un rechazo entero y no cincuenta ratios equivocados.
    expect(
      parseCajaValoresCedears(fixtureCajaValoresHtml({ shiftColumns: true })),
    ).toEqual({ ok: false, code: "payload_unparsable" });
  });

  it("refuses a page without the CEDEAR tables", () => {
    expect(
      parseCajaValoresCedears("<html><body><p>Mantenimiento</p></body></html>"),
    ).toEqual({ ok: false, code: "payload_unparsable" });
  });
});
