import { describe, expect, it } from "vitest";

import {
  checkCoherence,
  edgarFilingUrl,
  isReported,
  RECONCILIATION_ANCHORS,
  ReconciliationError,
  type AnchorId,
  type AnchorReading,
} from "@/modules/fundamentals/domain/reconciliation-anchors";

function reading(
  anchor: AnchorId,
  value: string | null,
  concept = `us-gaap:${anchor}`,
): AnchorReading {
  return {
    anchor,
    concept: value === null ? null : concept,
    value,
    unit: "monetary",
    currency: "USD",
    asOf: "2025-12-31",
    sourceDocumentId: "0000320193-26-000001",
    availableAt: "2026-01-30T21:00:00.000Z",
  };
}

/** Balance que cierra exacto y una EPS coherente con el resultado. */
function healthy(): AnchorReading[] {
  return [
    reading("assets", "1000"),
    reading("liabilities", "600"),
    reading("equity", "400"),
    reading("net_income", "200"),
    reading("eps_diluted", "2"),
    reading("diluted_shares", "100"),
  ];
}

function statusOf(
  readings: readonly AnchorReading[],
  check: "balance_sheet" | "earnings_per_share",
) {
  return checkCoherence(readings).find((result) => result.check === check)!;
}

describe("RECONCILIATION_ANCHORS", () => {
  it("declares every alternative concept in an explicit order", () => {
    for (const definition of RECONCILIATION_ANCHORS) {
      expect(definition.concepts.length).toBeGreaterThan(0);
      expect(new Set(definition.concepts).size).toBe(
        definition.concepts.length,
      );
    }
  });

  it("puts balance-sheet anchors on an instant and result anchors on a period", () => {
    const byAnchor = new Map(
      RECONCILIATION_ANCHORS.map((definition) => [
        definition.anchor,
        definition.periodType,
      ]),
    );

    expect(byAnchor.get("assets")).toBe("instant");
    expect(byAnchor.get("equity")).toBe("instant");
    expect(byAnchor.get("revenue")).toBe("annual");
    expect(byAnchor.get("eps_diluted")).toBe("annual");
  });
});

describe("checkCoherence", () => {
  it("accepts a balance sheet that closes", () => {
    expect(statusOf(healthy(), "balance_sheet")).toEqual({
      check: "balance_sheet",
      status: "ok",
      residualPct: "0.0000",
      missing: [],
    });
  });

  it("accepts earnings per share consistent with the result", () => {
    expect(statusOf(healthy(), "earnings_per_share").status).toBe("ok");
  });

  it("names a scale error, which is what the residual exists to catch", () => {
    // Acciones en miles contra un resultado en unidades: el residuo se va a
    // órdenes de magnitud, no a puntos porcentuales.
    const readings = healthy().map((candidate) =>
      candidate.anchor === "diluted_shares"
        ? reading("diluted_shares", "100000")
        : candidate,
    );
    const result = statusOf(readings, "earnings_per_share");

    expect(result.status).toBe("residual");
    expect(result.residualPct).toBe("99900.0000");
  });

  it("tolerates the residual a parent-only equity leaves", () => {
    // Patrimonio sin participaciones no controlantes: el resto es legítimo.
    const readings = healthy().map((candidate) =>
      candidate.anchor === "equity" ? reading("equity", "395") : candidate,
    );

    expect(statusOf(readings, "balance_sheet").status).toBe("ok");
    expect(statusOf(readings, "balance_sheet").residualPct).toBe("0.5000");
  });

  it("refuses to call an unevaluable check a pass", () => {
    const readings = healthy().filter(
      (candidate) => candidate.anchor !== "liabilities",
    );

    expect(statusOf(readings, "balance_sheet")).toEqual({
      check: "balance_sheet",
      status: "not_evaluable",
      residualPct: null,
      missing: ["liabilities"],
    });
  });

  it("treats an unreported anchor as missing and never as zero", () => {
    const readings = healthy().map((candidate) =>
      candidate.anchor === "equity" ? reading("equity", null) : candidate,
    );
    const result = statusOf(readings, "balance_sheet");

    expect(result.status).toBe("not_evaluable");
    expect(result.missing).toEqual(["equity"]);
    expect(result.residualPct).toBeNull();
  });

  it("lists every missing anchor at once", () => {
    expect(statusOf([], "earnings_per_share").missing).toEqual([
      "net_income",
      "eps_diluted",
      "diluted_shares",
    ]);
  });

  it("declines a percentage when the reference is zero", () => {
    // Un resultado de cero no admite porcentaje: decirlo es más honesto que
    // dividir por cero o inventar un 100 %.
    const readings = healthy().map((candidate) =>
      candidate.anchor === "net_income"
        ? reading("net_income", "0")
        : candidate,
    );
    const result = statusOf(readings, "earnings_per_share");

    expect(result.status).toBe("not_evaluable");
    expect(result.residualPct).toBeNull();
  });

  it("handles a negative result without taking its absolute value as the answer", () => {
    const readings = [
      reading("net_income", "-200"),
      reading("eps_diluted", "-2"),
      reading("diluted_shares", "100"),
    ];

    expect(statusOf(readings, "earnings_per_share").status).toBe("ok");
  });

  it("names a sign that does not match between result and EPS", () => {
    const readings = [
      reading("net_income", "-200"),
      reading("eps_diluted", "2"),
      reading("diluted_shares", "100"),
    ];
    const result = statusOf(readings, "earnings_per_share");

    expect(result.status).toBe("residual");
    expect(result.residualPct).toBe("200.0000");
  });

  it("refuses a value that is not a canonical decimal", () => {
    const readings = [
      reading("assets", "1e3"),
      reading("liabilities", "600"),
      reading("equity", "400"),
    ];

    expect(() => checkCoherence(readings)).toThrowError(ReconciliationError);
  });
});

describe("isReported", () => {
  it("separates a reported anchor from one the filer does not publish", () => {
    expect(isReported(reading("assets", "1000"))).toBe(true);
    expect(isReported(reading("assets", null))).toBe(false);
  });
});

describe("edgarFilingUrl", () => {
  it("builds the public index of the filing that published the number", () => {
    expect(edgarFilingUrl("0000320193", "0000320193-20-000096")).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019320000096/0000320193-20-000096-index.htm",
    );
  });
});
