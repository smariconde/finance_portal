import { describe, expect, it } from "vitest";

import {
  parseSp500Constituents,
  SP500_CONSTITUENTS_PARSER_VERSION,
} from "@/modules/universe/domain/parse-sp500-constituents";

/**
 * El encabezado reproduce el del archivo real verificado el 2026-09-05. Los
 * valores son sintéticos salvo la forma: campos entrecomillados con comas
 * adentro, que es lo que trae el 99 % de las filas reales.
 */
const HEADER =
  "Symbol,Security,GICS Sector,GICS Sub-Industry,Headquarters Location,Date added,CIK,Founded";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("parseSp500Constituents", () => {
  it("reads the published rows into index membership claims", () => {
    const result = parseSp500Constituents(
      csv(
        'MMM,3M,Industrials,Industrial Conglomerates,"Saint Paul, Minnesota",1957-03-04,66740,1902',
        'AOS,A. O. Smith,Industrials,Building Products,"Milwaukee, Wisconsin",2017-07-26,91142,1916',
      ),
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.parserVersion).toBe(
      SP500_CONSTITUENTS_PARSER_VERSION,
    );
    expect(result.ok && result.claims).toEqual([
      { symbol: "MMM", name: "3M", sector: "Industrials" },
      { symbol: "AOS", name: "A. O. Smith", sector: "Industrials" },
    ]);
  });

  it("keeps a quoted comma inside its field instead of splitting the row", () => {
    // `"Saint Paul, Minnesota"` es un campo, no dos. Un `split(",")` correría
    // todas las columnas siguientes y el `CIK` terminaría leyéndose como fecha.
    const result = parseSp500Constituents(
      csv(
        'MMM,3M,Industrials,Conglomerates,"Saint Paul, Minnesota",1957-03-04,66740,1902',
      ),
    );

    expect(result.ok && result.claims).toEqual([
      { symbol: "MMM", name: "3M", sector: "Industrials" },
    ]);
    expect(result.ok && result.rejections).toEqual([]);
  });

  it("reads an escaped quote and a newline inside a quoted field", () => {
    const result = parseSp500Constituents(
      csv(
        'ACME,"The ""Big"" Co","Industrials",Sub,"Line one\nLine two",2020-01-01,1,1900',
      ),
    );

    expect(result.ok && result.claims).toEqual([
      { symbol: "ACME", name: 'The "Big" Co', sector: "Industrials" },
    ]);
  });

  it("reads the header by name instead of trusting column positions", () => {
    const result = parseSp500Constituents(
      ["GICS Sector,CIK,Security,Symbol", "Industrials,66740,3M,MMM"].join(
        "\n",
      ),
    );

    expect(result.ok && result.claims).toEqual([
      { symbol: "MMM", name: "3M", sector: "Industrials" },
    ]);
  });

  it("ignores the CIK the list publishes, because it is not authoritative", () => {
    // La lista deriva de Wikipedia. Tomar su CIK crearía un join irreversible
    // sobre una fuente que el registro declara universo de desarrollo; la
    // identidad del filer sólo la puede decir la SEC.
    const result = parseSp500Constituents(
      csv("MMM,3M,Industrials,Sub,Saint Paul,1957-03-04,999999999,1902"),
    );

    expect(JSON.stringify(result)).not.toContain("999999999");
    expect(result.ok && Object.keys(result.claims[0])).toEqual([
      "symbol",
      "name",
      "sector",
    ]);
  });

  it("accepts CRLF as readily as LF", () => {
    const result = parseSp500Constituents(
      [HEADER, "MMM,3M,Industrials,Sub,Saint Paul,1957-03-04,66740,1902"].join(
        "\r\n",
      ),
    );

    // Un lector que sólo entienda `\n` deja un `\r` pegado a la última celda.
    expect(result.ok && result.claims[0].symbol).toBe("MMM");
  });

  it("does not turn the trailing newline into an empty row", () => {
    const result = parseSp500Constituents(
      `${csv("MMM,3M,Industrials,Sub,Saint Paul,1957-03-04,66740,1902")}\n`,
    );

    expect(result.ok && result.claims).toHaveLength(1);
    expect(result.ok && result.rejections).toEqual([]);
  });

  it("keeps a missing sector as an absence rather than a label", () => {
    const result = parseSp500Constituents(
      csv("MMM,3M,,Sub,Saint Paul,1957-03-04,66740,1902"),
    );

    expect(result.ok && result.claims[0].sector).toBeNull();
  });

  it("preserves the class separator the list writes", () => {
    // `BRK.B` acá y `BRK-B` en la SEC son el mismo ticker escrito por dos
    // convenciones. Normalizarlo en el parser borraría la evidencia que
    // `constituent-match-1.0.0` necesita para declarar el match relajado.
    const result = parseSp500Constituents(
      csv(
        "BRK.B,Berkshire Hathaway,Financials,Sub,Omaha,2010-02-16,1067983,1839",
      ),
    );

    expect(result.ok && result.claims[0].symbol).toBe("BRK.B");
  });

  it("rejects the row, not the batch, when a single row is unusable", () => {
    const result = parseSp500Constituents(
      csv(
        "MMM,3M,Industrials,Sub,Saint Paul,1957-03-04,66740,1902",
        ",Sin simbolo,Industrials,Sub,Ciudad,2020-01-01,2,1900",
        "NONAME,,Industrials,Sub,Ciudad,2020-01-01,3,1900",
        "SHORT,Fila corta,Industrials",
      ),
    );

    expect(result.ok && result.claims).toHaveLength(1);
    expect(result.ok && result.rejections).toEqual([
      { row: 1, code: "symbol_missing", column: "symbol" },
      { row: 2, code: "name_missing", column: "security" },
      { row: 3, code: "row_arity_mismatch", column: null },
    ]);
  });

  it("never echoes the value of a row it rejects", () => {
    const result = parseSp500Constituents(
      csv(
        "MMM,3M,Industrials,Sub,Saint Paul,1957-03-04,66740,1902",
        "SHORT,fila-rota-secreta",
      ),
    );

    expect(JSON.stringify(result)).not.toContain("secreta");
  });

  it("quarantines a file with no header", () => {
    for (const broken of ["", "\n", "   \n   "]) {
      const result = parseSp500Constituents(broken);

      expect(!result.ok && result.code).toBe("header_missing");
    }
  });

  it("quarantines a file missing a column the claim depends on", () => {
    const result = parseSp500Constituents(
      ["Security,GICS Sector,CIK", "3M,Industrials,66740"].join("\n"),
    );

    expect(!result.ok && result.code).toBe("required_column_missing");
  });

  it("quarantines a header that does not determine a position", () => {
    const result = parseSp500Constituents(
      ["Symbol,Security,Symbol", "MMM,3M,MMM"].join("\n"),
    );

    expect(!result.ok && result.code).toBe("duplicate_column");
  });

  it("quarantines a list that reads but yields no constituent", () => {
    // Una lista vacía rebalanceando cerraría cada membresía vigente y vaciaría el
    // índice por omisión. Se nombra el motivo en vez de publicar nada (`TM-05`).
    const result = parseSp500Constituents(csv("", ""));

    expect(!result.ok && result.code).toBe("no_usable_rows");
  });
});
