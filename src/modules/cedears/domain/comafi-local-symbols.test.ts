import { describe, it, expect } from "vitest";
import { readXlsxSheets } from "@/modules/reference-data/domain/xlsx-sheet-reader";
import { fixtureComafiSymbols } from "../infrastructure/fixture-comafi-symbols";
import { fixtureComafiProducts } from "../infrastructure/fixture-cedear-publications";
import { parseComafiProducts } from "./parse-comafi-products";
import { withComafiLocalSymbols } from "./comafi-local-symbols";

function fixture() {
  const publication = parseComafiProducts(fixtureComafiProducts());
  const book = readXlsxSheets(fixtureComafiSymbols(), [
    "LISTA TOTAL DE CEDEARS",
  ]);
  if (!publication.ok || !book.ok) throw new Error("invalid fixture");
  return { publication, rows: book.sheets.get("LISTA TOTAL DE CEDEARS")! };
}

describe("Comafi local identity", () => {
  it("matches ISIN and local code, preserving the JSON ratio", () => {
    const { publication, rows } = fixture();
    const result = withComafiLocalSymbols(publication, rows);
    if (!result.ok) throw new Error(result.code);
    expect(result.claims[0]).toMatchObject({
      ...publication.claims[0],
      bymaSymbol: "FXAL",
    });
    expect(result.claims[1]?.bymaSymbol).toBeNull();
  });
  it("refuses a shifted header", () => {
    const { publication, rows } = fixture();
    expect(withComafiLocalSymbols(publication, rows.slice(1))).toEqual({
      ok: false,
      code: "payload_unparsable",
    });
  });
  it("does not choose duplicate, mismatched or invalid symbols", () => {
    const { publication, rows } = fixture();
    for (const data of [
      [...rows, rows[1]!],
      [
        rows[0]!,
        {
          ...rows[1]!,
          cells: new Map([
            ...rows[1]!.cells,
            ["D", { kind: "number" as const, text: "9999" }],
          ]),
        },
      ],
      [
        rows[0]!,
        {
          ...rows[1]!,
          cells: new Map([
            ...rows[1]!.cells,
            ["C", { kind: "string" as const, text: "../AAPL" }],
          ]),
        },
      ],
    ]) {
      const result = withComafiLocalSymbols(publication, data);
      if (!result.ok) throw new Error(result.code);
      expect(result.claims[0]?.bymaSymbol).toBeNull();
    }
  });
});
