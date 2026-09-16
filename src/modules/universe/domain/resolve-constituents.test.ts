import { describe, expect, it } from "vitest";

import {
  FIXTURE_CONSTITUENT_CLAIMS,
  FIXTURE_TICKER_ASSIGNMENTS,
} from "../infrastructure/fixture-universe-source";

import {
  CONSTITUENT_MATCH_RULE_VERSION,
  resolveConstituents,
  type ConstituentRejectionCode,
} from "./resolve-constituents";
import type {
  CompanyTickerAssignment,
  IndexConstituentClaim,
} from "./universe-source-records";

function claim(
  symbol: string,
  overrides: Partial<IndexConstituentClaim> = {},
): IndexConstituentClaim {
  return { symbol, name: `${symbol} Synthetic`, sector: null, ...overrides };
}

function assignment(
  overrides: Partial<CompanyTickerAssignment> = {},
): CompanyTickerAssignment {
  return {
    cik: "9900001",
    name: "Andes Synthetic Corp",
    ticker: "ANDES",
    exchange: "Nasdaq",
    ...overrides,
  };
}

function codesOf(
  resolution: ReturnType<typeof resolveConstituents>,
): Record<string, ConstituentRejectionCode> {
  return Object.fromEntries(
    resolution.rejections.map((rejection) => [
      rejection.claimSymbol,
      rejection.code,
    ]),
  );
}

describe("resolución de constituyentes contra asignaciones autoritativas", () => {
  it("resuelve el símbolo a su emisor, con el CIK normalizado a diez dígitos", () => {
    const resolution = resolveConstituents(
      [claim("ANDES")],
      [assignment({ cik: "9900001" })],
    );

    expect(resolution.matchRuleVersion).toBe(CONSTITUENT_MATCH_RULE_VERSION);
    expect(resolution.rejections).toEqual([]);
    expect(resolution.resolved).toHaveLength(1);
    expect(resolution.resolved[0]).toMatchObject({
      claimSymbol: "ANDES",
      assignedSymbol: "ANDES",
      // El relleno es la convención declarada del tipo, no un recorte del valor.
      normalizedCik: "0009900001",
      matchKind: "exact",
      venue: { mic: "XNAS", country: "US", quoteCurrency: "USD" },
    });
  });

  it("mantiene separadas dos clases del mismo emisor", () => {
    const resolution = resolveConstituents(
      [claim("NWND"), claim("NWNDA")],
      [
        assignment({ cik: "9900002", ticker: "NWND" }),
        assignment({ cik: "9900002", ticker: "NWNDA" }),
      ],
    );

    expect(resolution.rejections).toEqual([]);
    expect(resolution.resolved.map((one) => one.assignedSymbol)).toEqual([
      "NWND",
      "NWNDA",
    ]);
    // Mismo emisor, dos símbolos: el CIK no distingue instrumentos.
    expect(
      new Set(resolution.resolved.map((one) => one.normalizedCik)).size,
    ).toBe(1);
  });

  it("admite la divergencia de separador y la declara en vez de silenciarla", () => {
    const resolution = resolveConstituents(
      [claim("PAMPA.B")],
      [assignment({ cik: "9900003", ticker: "PAMPA-B", exchange: "NYSE" })],
    );

    expect(resolution.resolved[0]).toMatchObject({
      // Ambas formas originales sobreviven al match.
      claimSymbol: "PAMPA.B",
      assignedSymbol: "PAMPA-B",
      matchKind: "separator_relaxed",
      venue: { mic: "XNYS" },
    });
  });

  it("no relaja separadores cuando la forma relajada alcanza a dos tickers", () => {
    const resolution = resolveConstituents(
      [claim("PAMPA.B")],
      [
        assignment({ cik: "9900003", ticker: "PAMPA-B", exchange: "NYSE" }),
        assignment({ cik: "9900007", ticker: "PAMPAB", exchange: "NYSE" }),
      ],
    );

    expect(resolution.resolved).toEqual([]);
    expect(resolution.rejections[0]).toMatchObject({
      claimSymbol: "PAMPA.B",
      code: "ambiguous_issuer",
      candidates: ["PAMPA-B", "PAMPAB"],
    });
  });

  it("rechaza el ticker asignado a dos emisores en vez de elegir uno", () => {
    const resolution = resolveConstituents(
      [claim("SALAD")],
      [
        assignment({ cik: "9900005", ticker: "SALAD", exchange: "NYSE" }),
        assignment({ cik: "9900006", ticker: "SALAD", exchange: "Nasdaq" }),
      ],
    );

    expect(resolution.resolved).toEqual([]);
    expect(resolution.rejections[0]).toMatchObject({
      code: "ambiguous_issuer",
      // Los dos candidatos quedan registrados para la revisión manual.
      candidates: ["0009900005", "0009900006"],
    });
  });

  it("rechaza un emisor único listado en dos venues sin elegir un primario", () => {
    const resolution = resolveConstituents(
      [claim("ANDES")],
      [
        assignment({ ticker: "ANDES", exchange: "NYSE" }),
        assignment({ ticker: "ANDES", exchange: "Nasdaq" }),
      ],
    );

    expect(resolution.rejections[0]).toMatchObject({
      code: "ambiguous_venue",
      candidates: ["NYSE", "Nasdaq"],
    });
  });

  it("no inventa un venue para un mercado fuera del mapa versionado", () => {
    const resolution = resolveConstituents(
      [claim("RIACH")],
      [assignment({ cik: "9900004", ticker: "RIACH", exchange: "OTC" })],
    );

    expect(resolution.resolved).toEqual([]);
    expect(resolution.rejections[0]).toMatchObject({
      code: "unmapped_venue",
      candidates: ["OTC"],
    });
  });

  it("rechaza una asignación sin mercado declarado", () => {
    const resolution = resolveConstituents(
      [claim("ANDES")],
      [assignment({ exchange: null })],
    );

    expect(resolution.rejections[0]?.code).toBe("missing_exchange");
  });

  it("no resuelve un símbolo que ninguna asignación autoritativa cubre", () => {
    const resolution = resolveConstituents([claim("QUILM")], [assignment()]);

    expect(resolution.rejections[0]).toMatchObject({
      code: "issuer_not_assigned",
      candidates: [],
    });
  });

  it("rechaza el símbolo repetido dentro del mismo lote", () => {
    const resolution = resolveConstituents(
      [claim("ANDES"), claim("andes")],
      [assignment()],
    );

    expect(resolution.resolved).toHaveLength(1);
    expect(resolution.rejections[0]?.code).toBe("duplicate_claim_symbol");
  });

  it("recorre el corpus sintético dejando cada caso difícil nombrado", () => {
    const resolution = resolveConstituents(
      FIXTURE_CONSTITUENT_CLAIMS,
      FIXTURE_TICKER_ASSIGNMENTS,
    );

    expect(resolution.resolved.map((one) => one.assignedSymbol)).toEqual([
      "ANDES",
      "NWND",
      "NWNDA",
      "PAMPA-B",
    ]);
    expect(codesOf(resolution)).toEqual({
      RIACH: "unmapped_venue",
      QUILM: "issuer_not_assigned",
      SALAD: "ambiguous_issuer",
    });
  });
});
