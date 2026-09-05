import { describe, expect, it } from "vitest";

import {
  COMPANY_TICKERS_EXCHANGE_PARSER_VERSION,
  parseCompanyTickersExchange,
} from "@/modules/universe/domain/parse-company-tickers-exchange";

/**
 * La forma reproduce la del payload real verificado el 2026-09-05: encabezado
 * `["cik","name","ticker","exchange"]`, filas posicionales, `cik` numérico y
 * `exchange` anulable. Los valores son sintéticos.
 */
function payload(
  data: unknown[][],
  fields = ["cik", "name", "ticker", "exchange"],
) {
  return { fields, data };
}

describe("parseCompanyTickersExchange", () => {
  it("reads the tabular payload into authoritative assignments", () => {
    const result = parseCompanyTickersExchange(
      payload([
        [320193, "Apple Inc.", "AAPL", "Nasdaq"],
        [1067983, "BERKSHIRE HATHAWAY INC", "BRK-B", "NYSE"],
      ]),
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.parserVersion).toBe(
      COMPANY_TICKERS_EXCHANGE_PARSER_VERSION,
    );
    expect(result.ok && result.assignments).toEqual([
      {
        cik: "320193",
        name: "Apple Inc.",
        ticker: "AAPL",
        exchange: "Nasdaq",
      },
      {
        cik: "1067983",
        name: "BERKSHIRE HATHAWAY INC",
        ticker: "BRK-B",
        exchange: "NYSE",
      },
    ]);
  });

  it("reads the header instead of trusting column positions", () => {
    // Un índice hardcodeado seguiría "funcionando" después de un reordenamiento y
    // asignaría nombres como tickers. Es el modo de falla silencioso que importa.
    const result = parseCompanyTickersExchange(
      payload(
        [["AAPL", "Nasdaq", 320193, "Apple Inc."]],
        ["ticker", "exchange", "cik", "name"],
      ),
    );

    expect(result.ok && result.assignments).toEqual([
      { cik: "320193", name: "Apple Inc.", ticker: "AAPL", exchange: "Nasdaq" },
    ]);
    expect(result.ok && result.fieldOrder).toEqual([
      "ticker",
      "exchange",
      "cik",
      "name",
    ]);
  });

  it("keeps a null exchange as an absence instead of inventing a venue", () => {
    // Hay filers sin mercado declarado en el archivo real. El rechazo por
    // `missing_exchange` le corresponde al resolver, no al parser.
    const result = parseCompanyTickersExchange(
      payload([[320193, "Apple Inc.", "AAPL", null]]),
    );

    expect(result.ok && result.assignments[0].exchange).toBeNull();
  });

  it("treats an empty exchange string as the same absence", () => {
    const result = parseCompanyTickersExchange(
      payload([[320193, "Apple Inc.", "AAPL", "   "]]),
    );

    expect(result.ok && result.assignments[0].exchange).toBeNull();
  });

  it("does not deduplicate a CIK that lists more than one class", () => {
    // Dos clases del mismo emisor son dos asignaciones. Colapsarlas acá elegiría
    // un instrumento en silencio; distinguirlas es trabajo del grafo de identidad.
    const result = parseCompanyTickersExchange(
      payload([
        [1067983, "BERKSHIRE HATHAWAY INC", "BRK-A", "NYSE"],
        [1067983, "BERKSHIRE HATHAWAY INC", "BRK-B", "NYSE"],
      ]),
    );

    expect(result.ok && result.assignments).toHaveLength(2);
  });

  it("does not collapse two issuers that claim the same ticker", () => {
    // Es evidencia de ambigüedad y le corresponde a `resolve-constituents.ts`
    // rechazarla por `ambiguous_issuer`, no al parser resolverla.
    const result = parseCompanyTickersExchange(
      payload([
        [1, "Primero SA", "DUP", "NYSE"],
        [2, "Segundo SA", "DUP", "Nasdaq"],
      ]),
    );

    expect(result.ok && result.assignments).toHaveLength(2);
  });

  it("accepts a CIK written as a zero-padded string", () => {
    const result = parseCompanyTickersExchange(
      payload([["0000320193", "Apple Inc.", "AAPL", "Nasdaq"]]),
    );

    // Se conservan los dígitos significativos; el relleno a diez es normalización
    // de identidad y vive en el grafo, no acá.
    expect(result.ok && result.assignments[0].cik).toBe("320193");
  });

  it("rejects the row, not the batch, when a single row is unusable", () => {
    const result = parseCompanyTickersExchange(
      payload([
        [320193, "Apple Inc.", "AAPL", "Nasdaq"],
        [0, "Cero SA", "ZERO", "NYSE"],
        [-5, "Negativo SA", "NEG", "NYSE"],
        [1.5, "Fraccion SA", "FRA", "NYSE"],
        [10, "", "EMPTY", "NYSE"],
        [11, "Sin ticker SA", "   ", "NYSE"],
        [12, "Exchange raro SA", "ODD", 42],
        [13, "Corta SA", "SHORT"],
      ]),
    );

    expect(result.ok && result.assignments).toHaveLength(1);
    expect(result.ok && result.rejections).toEqual([
      { row: 1, code: "cik_invalid", field: "cik" },
      { row: 2, code: "cik_invalid", field: "cik" },
      { row: 3, code: "cik_invalid", field: "cik" },
      { row: 4, code: "name_missing", field: "name" },
      { row: 5, code: "ticker_missing", field: "ticker" },
      { row: 6, code: "exchange_invalid", field: "exchange" },
      { row: 7, code: "row_arity_mismatch", field: null },
    ]);
  });

  it("passes an unmapped exchange label through instead of rejecting it", () => {
    // El parser no conoce el mapa de venues. Una etiqueta que no está en
    // `venue-map-1.0.0` es un `unmapped_venue` del resolver, no una fila inválida:
    // decidirlo acá dispersaría la regla en dos lugares.
    const result = parseCompanyTickersExchange(
      payload([[320193, "Apple Inc.", "AAPL", "Bolsa Inventada"]]),
    );

    expect(result.ok && result.assignments[0].exchange).toBe("Bolsa Inventada");
    expect(result.ok && result.rejections).toEqual([]);
  });

  it("never echoes the value of a cell it rejects", () => {
    const result = parseCompanyTickersExchange(
      payload([
        [320193, "Apple Inc.", "AAPL", "Nasdaq"],
        ["cik-invalido-secreto", "Mala SA", "BAD", "NYSE"],
      ]),
    );

    // El rechazo nombra la fila y la columna, nunca el contenido (`TM-02`).
    expect(result.ok && result.rejections).toEqual([
      { row: 1, code: "cik_invalid", field: "cik" },
    ]);
    expect(JSON.stringify(result)).not.toContain("secreto");
  });

  it("quarantines the whole batch when the payload is not the tabular shape", () => {
    for (const broken of [
      null,
      "",
      [],
      { fields: ["cik"] },
      { data: [[1]] },
      { fields: "cik,name", data: [] },
    ]) {
      const result = parseCompanyTickersExchange(broken);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.code).toBe("payload_not_tabular");
    }
  });

  it("quarantines the batch when a field that identity depends on is absent", () => {
    const result = parseCompanyTickersExchange(
      payload([[320193, "Apple Inc.", "AAPL"]], ["cik", "name", "ticker"]),
    );

    expect(!result.ok && result.code).toBe("required_field_missing");
  });

  it("quarantines the batch when the header does not determine a position", () => {
    const result = parseCompanyTickersExchange(
      payload(
        [[320193, "Apple Inc.", "AAPL", "Nasdaq"]],
        ["cik", "name", "ticker", "cik"],
      ),
    );

    expect(!result.ok && result.code).toBe("duplicate_field");
  });

  it("quarantines a batch that parses but yields nothing usable", () => {
    // Un archivo que se lee y no deja una sola asignación no es un universo
    // vacío: es un parser roto, y no debe reemplazar al lote anterior (`TM-05`).
    const result = parseCompanyTickersExchange(
      payload([
        [0, "Cero SA", "ZERO", "NYSE"],
        ["x", "Mala SA", "BAD", "NYSE"],
      ]),
    );

    expect(!result.ok && result.code).toBe("no_usable_rows");
  });

  it("distinguishes an empty file from a broken one", () => {
    const result = parseCompanyTickersExchange(payload([]));

    // Sin filas tampoco hay lote publicable, y el motivo se nombra igual.
    expect(!result.ok && result.code).toBe("no_usable_rows");
  });
});
