import { describe, expect, it } from "vitest";

import {
  buildXlsx,
  buildZip,
  workbookParts,
  type SheetFixture,
} from "../infrastructure/fixture-xlsx";
import {
  XLSX_MAX_PART_BYTES,
  decodeXmlText,
  readXlsxSheets,
} from "./xlsx-sheet-reader";

const SHEET: SheetFixture = {
  name: "Regional breakdown",
  rows: [
    ["Country", "GDP", "Region"],
    ["St. Vincent & the Grenadines", { n: "1063.5" }, "Caribbean"],
    ["United States", { n: "2.1863536781947081E-3" }, "North America"],
    ["Nowhere", { error: "#N/A" }, { inline: "Other <region>" }],
  ],
};

function read(bytes: Uint8Array, sheets = [SHEET.name]) {
  return readXlsxSheets(bytes, sheets);
}

describe("xlsx-sheet-reader-1.0.0", () => {
  it("reads shared strings, numbers as their source text, inline strings and errors", () => {
    const result = read(buildXlsx([SHEET]));
    if (!result.ok) throw new Error(result.code);

    const rows = result.sheets.get(SHEET.name)!;

    expect(rows.map((row) => row.index)).toEqual([1, 2, 3, 4]);
    expect(rows[1]!.cells.get("A")).toEqual({
      kind: "string",
      text: "St. Vincent & the Grenadines",
    });
    // El double tal cual lo guarda el libro: nunca pasa por `number`.
    expect(rows[2]!.cells.get("B")).toEqual({
      kind: "number",
      text: "2.1863536781947081E-3",
    });
    expect(rows[3]!.cells.get("B")).toEqual({ kind: "error", text: "#N/A" });
    expect(rows[3]!.cells.get("C")).toEqual({
      kind: "string",
      text: "Other <region>",
    });
  });

  it("skips a styled cell with no value instead of inventing an empty one", () => {
    const result = read(
      buildXlsx([{ name: SHEET.name, rows: [["Country", null, "Region"]] }]),
    );
    if (!result.ok) throw new Error(result.code);

    expect([...result.sheets.get(SHEET.name)![0]!.cells.keys()]).toEqual([
      "A",
      "C",
    ]);
  });

  it("drops phonetic guides from rich shared strings", () => {
    const bytes = buildXlsx([SHEET], (parts) => {
      parts.set(
        "xl/sharedStrings.xml",
        parts
          .get("xl/sharedStrings.xml")!
          .replace(
            '<si><t xml:space="preserve">Country</t></si>',
            '<si><r><t>Coun</t></r><r><t>try</t></r><rPh sb="0" eb="1"><t>x</t></rPh></si>',
          ),
      );
    });
    const result = read(bytes);
    if (!result.ok) throw new Error(result.code);

    expect(result.sheets.get(SHEET.name)![0]!.cells.get("A")?.text).toBe(
      "Country",
    );
  });

  it("names a sheet the workbook does not have", () => {
    expect(read(buildXlsx([SHEET]), ["Regional Weighted Averages"])).toEqual({
      ok: false,
      code: "sheet_missing",
    });
  });

  it.each([
    ["random bytes", new Uint8Array(64).fill(7), "not_a_zip"],
    ["an empty file", new Uint8Array(0), "not_a_zip"],
  ])("rejects %s as not a zip", (_, bytes, code) => {
    expect(read(bytes)).toEqual({ ok: false, code });
  });

  it("rejects a ZIP64 archive instead of guessing its sizes", () => {
    const bytes = buildZip(
      [...workbookParts([SHEET])].map(([name, data]) => ({ name, data })),
      { entryCountOverride: 0xffff },
    );

    expect(read(bytes)).toEqual({ ok: false, code: "zip64_unsupported" });
  });

  it.each([
    ["../evil.xml", "entry_name_unsafe"],
    ["/etc/passwd", "entry_name_unsafe"],
    ["xl\\workbook.xml", "entry_name_unsafe"],
  ])("rejects the entry name %s", (name, code) => {
    const parts = [...workbookParts([SHEET])].map(([entry, data]) => ({
      name: entry,
      data,
    }));

    expect(read(buildZip([...parts, { name, data: "x" }]))).toEqual({
      ok: false,
      code,
    });
  });

  it("rejects a duplicated entry, which could shadow the one that was checked", () => {
    const parts = [...workbookParts([SHEET])].map(([name, data]) => ({
      name,
      data,
    }));

    expect(read(buildZip([...parts, parts[1]!]))).toEqual({
      ok: false,
      code: "entry_duplicated",
    });
  });

  it("rejects an encrypted part it has to open, and ignores one it does not", () => {
    const parts = [...workbookParts([SHEET])].map(([name, data]) => ({
      name,
      data,
    }));
    const encrypt = (target: string) =>
      buildZip(
        parts.map((part) =>
          part.name === target ? { ...part, flags: 0x1 } : part,
        ),
      );

    expect(read(encrypt("xl/sharedStrings.xml"))).toEqual({
      ok: false,
      code: "entry_encrypted",
    });
    expect(read(encrypt("[Content_Types].xml")).ok).toBe(true);
  });

  it("rejects a compression method other than stored or deflate", () => {
    const parts = [...workbookParts([SHEET])].map(([name, data]) => ({
      name,
      data,
      method: name === "xl/workbook.xml" ? 12 : 8,
    }));

    expect(read(buildZip(parts))).toEqual({
      ok: false,
      code: "compression_unsupported",
    });
  });

  it("reads stored parts as well as deflated ones", () => {
    const parts = [...workbookParts([SHEET])].map(([name, data]) => ({
      name,
      data,
      method: 0,
    }));

    expect(read(buildZip(parts)).ok).toBe(true);
  });

  it("refuses a part whose declared size exceeds the ceiling, before inflating it", () => {
    const parts = [...workbookParts([SHEET])].map(([name, data]) => ({
      name,
      data,
      declaredSize:
        name === "xl/sharedStrings.xml" ? XLSX_MAX_PART_BYTES + 1 : undefined,
    }));

    expect(read(buildZip(parts))).toEqual({
      ok: false,
      code: "part_too_large",
    });
  });

  it("stops a bomb at its declared size instead of inflating it whole", () => {
    // 3 MB de ceros declarados como 1 KB: el inflado se corta en el techo.
    const bomb = "0".repeat(3 * 1024 * 1024);
    const parts = [...workbookParts([SHEET])].map(([name, data]) =>
      name === "xl/sharedStrings.xml"
        ? { name, data: bomb, declaredSize: 1024 }
        : { name, data },
    );

    expect(read(buildZip(parts))).toEqual({
      ok: false,
      code: "size_mismatch",
    });
  });

  it("rejects a part whose CRC does not match the central directory", () => {
    const parts = [...workbookParts([SHEET])].map(([name, data]) => ({
      name,
      data,
      declaredCrc: name === "xl/workbook.xml" ? 0xdeadbeef : undefined,
    }));

    expect(read(buildZip(parts))).toEqual({
      ok: false,
      code: "crc_mismatch",
    });
  });

  it("rejects a DOCTYPE or an entity declaration anywhere it reads", () => {
    const bytes = buildXlsx([SHEET], (parts) => {
      parts.set(
        "xl/sharedStrings.xml",
        `<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY x "boom">]><sst><si><t>&x;</t></si></sst>`,
      );
    });

    expect(read(bytes)).toEqual({
      ok: false,
      code: "xml_declaration_forbidden",
    });
  });

  it("rejects a shared string index the table does not have", () => {
    const bytes = buildXlsx([SHEET], (parts) => {
      parts.set("xl/sharedStrings.xml", "<sst></sst>");
    });

    expect(read(bytes)).toEqual({ ok: false, code: "shared_string_missing" });
  });

  it("rejects a cell without a valid reference", () => {
    const bytes = buildXlsx([SHEET], (parts) => {
      parts.set(
        "xl/worksheets/sheet1.xml",
        `<worksheet><sheetData><row r="1"><c t="s"><v>0</v></c></row></sheetData></worksheet>`,
      );
    });

    expect(read(bytes)).toEqual({ ok: false, code: "cell_reference_invalid" });
  });

  it("resolves an absolute relationship target and refuses one that climbs out", () => {
    const absolute = buildXlsx([SHEET], (parts) => {
      parts.set(
        "xl/_rels/workbook.xml.rels",
        parts
          .get("xl/_rels/workbook.xml.rels")!
          .replace('Target="worksheets/', 'Target="/xl/worksheets/'),
      );
    });
    const climbing = buildXlsx([SHEET], (parts) => {
      parts.set(
        "xl/_rels/workbook.xml.rels",
        parts
          .get("xl/_rels/workbook.xml.rels")!
          .replace('Target="worksheets/', 'Target="../worksheets/'),
      );
    });

    expect(read(absolute).ok).toBe(true);
    expect(read(climbing)).toEqual({ ok: false, code: "entry_name_unsafe" });
  });
});

describe("decodeXmlText", () => {
  it("decodes the predefined and numeric entities once", () => {
    expect(decodeXmlText("A &amp;amp; B &#233; &#xE9; &lt;")).toBe(
      "A &amp; B é é <",
    );
  });

  it("rejects any other named entity", () => {
    expect(() => decodeXmlText("&nbsp;")).toThrow("xml_entity_unknown");
  });
});
