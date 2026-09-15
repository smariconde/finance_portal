import { describe, expect, it } from "vitest";

import {
  fixtureListingIndex,
  fixtureSubmissionsPayload,
  NYSE_FILER_CIK,
} from "../infrastructure/fixture-listing-events";

import {
  parseSecListingIndex,
  readSecItems,
  SEC_LISTING_INDEX_PARSER_VERSION,
} from "./parse-sec-listing-index";

type Payload = {
  formerNames: unknown;
  filings: { recent: Record<string, unknown[]>; files: unknown[] };
};

function payload(
  filer: Parameters<typeof fixtureListingIndex>[0] = "transfer",
): Payload {
  return fixtureSubmissionsPayload(fixtureListingIndex(filer)) as Payload;
}

describe("índice de presentaciones para eventos de listing", () => {
  it("lee ítems, quién presentó y el borde de cada nombre anterior", () => {
    const parsed = parseSecListingIndex(payload("transfer"));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.parserVersion).toBe(SEC_LISTING_INDEX_PARSER_VERSION);
    const certification = parsed.filings.find(
      (filing) => filing.form === "CERT",
    )!;
    const notice = parsed.filings.find((filing) => filing.form === "8-K")!;

    // El `CERT` lo presentó el mercado, no el emisor.
    expect(certification.submitterCik).toBe(NYSE_FILER_CIK);
    expect(notice.items).toEqual(["3.01", "7.01", "9.01"]);
    expect(parsed.coverage).toEqual({
      oldestAcceptedAt: "2025-02-20T21:05:00.000Z",
      hasHistoryFiles: false,
    });

    const renamed = parseSecListingIndex(payload("rename"));

    expect(renamed.ok && renamed.formerNames).toEqual([
      {
        name: "NOMBRE VIEJO SINTETICO INC",
        from: "1994-11-10T05:00:00.000Z",
        to: "2025-08-14T04:00:00.000Z",
      },
    ]);
  });

  it("no confunde ítems ilegibles con «sin ítems»", () => {
    expect(readSecItems("")).toEqual([]);
    // Un `EFFECT` real trae comas sueltas: no son ítems.
    expect(readSecItems(",,")).toEqual([]);
    expect(readSecItems("2.01, 3.01")).toEqual(["2.01", "3.01"]);
    expect(readSecItems("3.01,delisting")).toBeNull();
    expect(readSecItems(301)).toBeNull();
  });

  it("sin columna de ítems deja la evidencia en `null`", () => {
    const raw = payload();
    delete raw.filings.recent.items;
    const parsed = parseSecListingIndex(raw);

    expect(parsed.ok && parsed.filings.every((f) => f.items === null)).toBe(
      true,
    );
  });

  it("cuarentena columnas desalineadas y `formerNames` que no es lista", () => {
    const misaligned = payload();
    misaligned.filings.recent.items = ["3.01"];

    expect(parseSecListingIndex(misaligned)).toMatchObject({
      ok: false,
      code: "column_length_mismatch",
    });

    const broken = payload();
    broken.formerNames = { name: "X" };

    expect(parseSecListingIndex(broken)).toMatchObject({
      ok: false,
      code: "former_names_invalid",
    });

    expect(parseSecListingIndex({ filings: {} })).toMatchObject({ ok: false });
  });

  it("rechaza por posición un nombre anterior sin borde o invertido", () => {
    const raw = payload("rename");
    raw.formerNames = [
      { name: "SIN BORDE", from: "2000-01-01T05:00:00.000Z" },
      {
        name: "INVERTIDO",
        from: "2020-01-01T05:00:00.000Z",
        to: "2010-01-01T05:00:00.000Z",
      },
      { name: "VALIDO", from: null, to: "2010-01-01T05:00:00.000Z" },
    ];
    const parsed = parseSecListingIndex(raw);

    expect(parsed.ok && parsed.formerNames.map((entry) => entry.name)).toEqual([
      "VALIDO",
    ]);
    expect(parsed.ok && parsed.rejectedFormerNames).toBe(2);
  });
});
