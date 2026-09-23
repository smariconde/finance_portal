import { describe, expect, it } from "vitest";

import {
  isValidIsin,
  parseCedearRatio,
  parseInvestorScope,
  parseProgramStatus,
  ratiosEqual,
} from "./cedear-claim";

describe("isValidIsin", () => {
  it("accepts well-formed ISINs whose check digit matches", () => {
    for (const isin of ["ARFXCD000010", "USFXA0000014", "USFXSPY00004"]) {
      expect(isValidIsin(isin)).toBe(true);
    }
  });

  it("rejects a mistyped check digit, a wrong shape and an empty value", () => {
    expect(isValidIsin("ARFXCD000011")).toBe(false);
    expect(isValidIsin("ARFXCD00001")).toBe(false);
    expect(isValidIsin("arfxcd000010")).toBe(false);
    // Un CUSIP no es un ISIN: es lo que trae el programa sobre un bono.
    expect(isValidIsin("478160AJ3")).toBe(false);
    expect(isValidIsin("")).toBe(false);
  });
});

describe("parseCedearRatio", () => {
  it("reads the hand-written forms of the same ratio", () => {
    expect(parseCedearRatio("20:1")).toEqual({
      ok: true,
      ratio: { depositaryUnits: "20", underlyingUnits: "1" },
    });
    expect(parseCedearRatio("144 : 1\n")).toEqual({
      ok: true,
      ratio: { depositaryUnits: "144", underlyingUnits: "1" },
    });
    expect(parseCedearRatio("1 :4")).toEqual({
      ok: true,
      ratio: { depositaryUnits: "1", underlyingUnits: "4" },
    });
  });

  it("canonicalizes decimals and leading zeros without losing precision", () => {
    expect(parseCedearRatio("007:1")).toEqual({
      ok: true,
      ratio: { depositaryUnits: "7", underlyingUnits: "1" },
    });
    expect(parseCedearRatio("2.50:1")).toEqual({
      ok: true,
      ratio: { depositaryUnits: "2.5", underlyingUnits: "1" },
    });
  });

  it("never interprets a ratio written without a colon", () => {
    // `3.1` parece un `3:1` mal tipeado, pero adivinarlo es inventar el precio
    // de conversión: se rechaza por nombre.
    expect(parseCedearRatio("3.1")).toEqual({
      ok: false,
      code: "ratio_malformed",
    });
    expect(parseCedearRatio("25.1")).toEqual({
      ok: false,
      code: "ratio_malformed",
    });
  });

  it("names an absent ratio and a zero side separately", () => {
    expect(parseCedearRatio("")).toEqual({ ok: false, code: "ratio_absent" });
    expect(parseCedearRatio(null)).toEqual({ ok: false, code: "ratio_absent" });
    expect(parseCedearRatio("0:1")).toEqual({
      ok: false,
      code: "ratio_malformed",
    });
    expect(parseCedearRatio("1:0.0")).toEqual({
      ok: false,
      code: "ratio_malformed",
    });
  });
});

describe("ratiosEqual", () => {
  it("compares fractions, not text", () => {
    expect(
      ratiosEqual(
        { depositaryUnits: "2", underlyingUnits: "1" },
        { depositaryUnits: "4", underlyingUnits: "2" },
      ),
    ).toBe(true);
    expect(
      ratiosEqual(
        { depositaryUnits: "2.5", underlyingUnits: "1" },
        { depositaryUnits: "5", underlyingUnits: "2" },
      ),
    ).toBe(true);
    expect(
      ratiosEqual(
        { depositaryUnits: "2", underlyingUnits: "1" },
        { depositaryUnits: "4", underlyingUnits: "1" },
      ),
    ).toBe(false);
  });
});

describe("parseProgramStatus", () => {
  it("maps each observation the issuer writes to one status", () => {
    expect(parseProgramStatus("Habilitado para emitir y cancelar")).toBe(
      "active",
    );
    expect(parseProgramStatus("Inhabilitado para emitir y cancelar***")).toBe(
      "suspended",
    );
    // La errata del emisor.
    expect(parseProgramStatus("Inhablitado para emitir")).toBe("suspended");
    expect(
      parseProgramStatus("Inhablitado para emitir-Habilitado para cancelar"),
    ).toBe("suspended");
    // La misma idea escrita al revés.
    expect(
      parseProgramStatus(
        "Habilitado para cancelar y *inhabilitado para emitir",
      ),
    ).toBe("suspended");
    expect(parseProgramStatus("* Programa dado de baja*")).toBe("terminated");
  });

  it("never defaults to active", () => {
    expect(parseProgramStatus(undefined)).toBe("unknown");
    expect(parseProgramStatus("En revisión")).toBe("unknown");
  });
});

describe("parseInvestorScope", () => {
  it("reads both spellings and leaves the unknown as null", () => {
    expect(parseInvestorScope("Calificado y no Calificado")).toBe(
      "all_investors",
    );
    expect(parseInvestorScope("Calificado y No Calificado")).toBe(
      "all_investors",
    );
    expect(parseInvestorScope("Calificado")).toBe("qualified_only");
    expect(parseInvestorScope("Otro")).toBeNull();
    expect(parseInvestorScope(undefined)).toBeNull();
  });
});
