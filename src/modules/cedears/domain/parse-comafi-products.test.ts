import { describe, expect, it } from "vitest";

import {
  FIXTURE_CEDEAR_ISINS,
  FIXTURE_UNDERLYING_ISINS,
  fixtureComafiProducts,
} from "../infrastructure/fixture-cedear-publications";

import { parseComafiProducts } from "./parse-comafi-products";

function parsed() {
  const publication = parseComafiProducts(fixtureComafiProducts());

  if (!publication.ok) {
    throw new Error(`the fixture must parse: ${publication.code}`);
  }

  return publication;
}

function claimOf(isin: string) {
  const claim = parsed().claims.find(
    (candidate) => candidate.cedearIsin === isin,
  );

  if (claim === undefined) {
    throw new Error(`no claim for ${isin}`);
  }

  return claim;
}

describe("parseComafiProducts", () => {
  it("turns each valid row into a claim and names every other row", () => {
    const publication = parsed();

    expect(publication.rowsSeen).toBe(9);
    expect(publication.claims.map((claim) => claim.cedearIsin).sort()).toEqual(
      [
        FIXTURE_CEDEAR_ISINS.alpha,
        FIXTURE_CEDEAR_ISINS.beta,
        FIXTURE_CEDEAR_ISINS.gammaA,
        FIXTURE_CEDEAR_ISINS.conflict,
        FIXTURE_CEDEAR_ISINS.etf,
        FIXTURE_CEDEAR_ISINS.foreign,
      ].sort(),
    );
    expect(publication.rejections).toEqual([
      {
        rowLabel: FIXTURE_CEDEAR_ISINS.malformedRatio,
        code: "ratio_malformed",
      },
      { rowLabel: "FIXTURE SIN ISIN", code: "cedear_isin_absent" },
    ]);
    expect(publication.skipped).toEqual([
      { cedearIsin: FIXTURE_CEDEAR_ISINS.corporate, reason: "debt_program" },
    ]);
  });

  it("lists every row with a valid ISIN, including the ones it rejects", () => {
    // Una fila rechazada sigue estando listada: retirar su programa por un
    // error de tipeo sería leer el error como una baja.
    const { listedIsins } = parsed();

    expect(listedIsins.has(FIXTURE_CEDEAR_ISINS.malformedRatio)).toBe(true);
    expect(listedIsins.has(FIXTURE_CEDEAR_ISINS.corporate)).toBe(true);
    expect(listedIsins.size).toBe(8);
  });

  it("reads a list description with a tag split in the middle of a word", () => {
    const alpha = claimOf(FIXTURE_CEDEAR_ISINS.alpha);

    expect(alpha).toEqual({
      cedearIsin: FIXTURE_CEDEAR_ISINS.alpha,
      cajaValoresCode: "8001",
      programName: "FIXTURE ALPHA CORP",
      // El ticker de la descripción es el mismo: no es una segunda evidencia.
      originSymbols: ["FXA"],
      originMarket: "NYSE",
      reportedUnderlyingIsin: FIXTURE_UNDERLYING_ISINS.alpha,
      ratio: { depositaryUnits: "10", underlyingUnits: "1" },
      status: "active",
      investorScope: "all_investors",
    });
  });

  it("reads a description written as lines separated by <br />", () => {
    const beta = claimOf(FIXTURE_CEDEAR_ISINS.beta);

    expect(beta.programName).toBe("FIXTURE BETA INC");
    expect(beta.originMarket).toBe("NYSE");
    expect(beta.status).toBe("suspended");
    expect(beta.investorScope).toBe("all_investors");
    expect(beta.ratio).toEqual({
      depositaryUnits: "144",
      underlyingUnits: "1",
    });
  });

  it("keeps a second ticker only when it says something else", () => {
    expect(claimOf(FIXTURE_CEDEAR_ISINS.conflict).originSymbols).toEqual([
      "FXZ",
      "FXA",
    ]);
    expect(claimOf(FIXTURE_CEDEAR_ISINS.gammaA).originSymbols).toEqual([
      "FXC/A",
    ]);
  });

  it("does not report an underlying ISIN that fails its check digit", () => {
    expect(claimOf(FIXTURE_CEDEAR_ISINS.conflict).reportedUnderlyingIsin).toBe(
      null,
    );
  });

  it("refuses two rows with the same ISIN instead of picking one", () => {
    const payload = fixtureComafiProducts() as { products: unknown[] };
    const publication = parseComafiProducts({
      products: [...payload.products, payload.products[0]],
    });

    expect(publication.ok).toBe(true);

    if (publication.ok) {
      expect(
        publication.claims.some(
          (claim) => claim.cedearIsin === FIXTURE_CEDEAR_ISINS.alpha,
        ),
      ).toBe(false);
      expect(publication.rejections).toContainEqual({
        rowLabel: FIXTURE_CEDEAR_ISINS.alpha,
        code: "duplicate_cedear_isin",
      });
    }
  });

  it("rejects a payload of another shape and an empty registry", () => {
    expect(parseComafiProducts({ items: [] })).toEqual({
      ok: false,
      code: "payload_unparsable",
    });
    expect(parseComafiProducts(null)).toEqual({
      ok: false,
      code: "payload_unparsable",
    });
    // Vacío no es «el emisor dio de baja todo»: se rechaza la publicación.
    expect(parseComafiProducts({ products: [] })).toEqual({
      ok: false,
      code: "no_programs",
    });
  });

  it("never echoes the value it rejects", () => {
    const payload = fixtureComafiProducts({ alphaRatio: "SECRETO:1" }) as {
      products: unknown[];
    };
    const publication = parseComafiProducts(payload);

    expect(
      JSON.stringify(publication.ok ? publication.rejections : []),
    ).not.toContain("SECRETO");
  });
});
