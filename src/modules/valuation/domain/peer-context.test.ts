import { describe, expect, it } from "vitest";

import { buildDemoValuationRun } from "../infrastructure/demo-valuation-run";
import { parseDecimal } from "./decimal-policy";
import type { MarketPriceComparison } from "./market-implied";
import {
  admitPeers,
  median,
  PEER_CONTEXT_VERSION,
  PEER_MINIMUM,
  peerContext,
  peerMetrics,
  peerWindowFrom,
  summarize,
  type PeerEntry,
  type PeerMetrics,
} from "./peer-context";
import type { BridgeItem } from "./valuation-input";
import type { ValuationRun } from "./valuation-run";

const RUN = buildDemoValuationRun();

function compared(close: string, value = "10"): MarketPriceComparison {
  return {
    status: "compared",
    version: "market-price-comparison-1.0.0",
    price: { marketDate: RUN.asOf, close, currency: "USD" },
    valuePerShare: value,
    valueToPrice: "0",
    priceToValue: parseDecimal(close, "close").dividedBy(value).toString(),
  };
}

function withBridge(patch: Partial<ValuationRun["input"]["bridge"]>) {
  return {
    ...RUN,
    input: { ...RUN.input, bridge: { ...RUN.input.bridge, ...patch } },
  };
}

function withEbit(ebitAdjusted: string | null) {
  return {
    ...RUN,
    input: {
      ...RUN.input,
      normalization: {
        ...RUN.input.normalization,
        base: { ...RUN.input.normalization.base, ebitAdjusted },
      },
    },
  };
}

const MISSING: BridgeItem = {
  status: "missing",
  amount: null,
  rationale: null,
};

function metric(value: string | null): PeerMetrics["priceToValue"] {
  return value === null
    ? { status: "null", reason: "no_close_at_as_of" }
    : { status: "value", value };
}

function peer(
  id: string,
  priceToValue: string | null,
  overrides: Partial<PeerEntry> = {},
): PeerEntry {
  return {
    legalEntityId: id,
    symbol: id.toUpperCase(),
    legalName: null,
    sector: "industrials",
    method: "fcff_base",
    status: "computed",
    asOf: RUN.asOf,
    currency: "USD",
    metrics: {
      priceToValue: metric(priceToValue),
      priceToEarnings: metric(priceToValue),
      enterpriseValueToEbit: metric(priceToValue),
    },
    ...overrides,
  };
}

describe(`${PEER_CONTEXT_VERSION}: cifras de una corrida`, () => {
  // FixtureCo: 12,3 M acciones, deuda 30 M, caja 12 M, EBIT ajustado 17,28 M.
  it("arma P/V, P/E y EV/EBIT con el EV y el EBIT del modelo", () => {
    const metrics = peerMetrics({
      run: RUN,
      comparison: compared("20"),
      netIncome: { value: "12300000", currency: "USD" },
    });

    expect(metrics.priceToValue).toEqual({ status: "value", value: "2" });
    // 20 × 12,3 M = 246 M; ÷ 12,3 M de ganancia.
    expect(metrics.priceToEarnings).toEqual({ status: "value", value: "20" });
    // (246 + 30 − 12) M ÷ 17,28 M.
    expect(metrics.enterpriseValueToEbit).toEqual({
      status: "value",
      value: parseDecimal("264000000", "ev").dividedBy("17280000").toFixed(),
    });
  });

  it("sin comparación con el precio, las tres llevan el mismo motivo", () => {
    const metrics = peerMetrics({
      run: RUN,
      comparison: {
        status: "unavailable",
        version: "market-price-comparison-1.0.0",
        reason: "split_after_share_basis",
        price: null,
      },
      netIncome: { value: "1", currency: "USD" },
    });

    for (const value of Object.values(metrics)) {
      expect(value).toEqual({
        status: "null",
        reason: "split_after_share_basis",
      });
    }
  });

  it.each([
    [null, "net_income_not_reported"],
    [{ value: "0", currency: "USD" }, "non_positive_net_income"],
    [{ value: "-5", currency: "USD" }, "non_positive_net_income"],
    [{ value: "5", currency: "EUR" }, "currency_mismatch"],
    [{ value: "5", currency: null }, "currency_mismatch"],
  ] as const)("P/E con ganancia %j es nulo: %s", (netIncome, reason) => {
    const metrics = peerMetrics({
      run: RUN,
      comparison: compared("20"),
      netIncome,
    });

    expect(metrics.priceToEarnings).toEqual({ status: "null", reason });
  });

  it.each([
    [null, "ebit_unavailable"],
    ["0", "non_positive_ebit"],
    ["-1", "non_positive_ebit"],
  ] as const)("EV/EBIT con EBIT %s es nulo: %s", (ebit, reason) => {
    const metrics = peerMetrics({
      run: withEbit(ebit),
      comparison: compared("20"),
      netIncome: null,
    });

    expect(metrics.enterpriseValueToEbit).toEqual({ status: "null", reason });
  });

  it("un reclamo missing no se completa con cero", () => {
    for (const key of ["debt", "leaseDebt", "minorityInterest", "excessCash"]) {
      const metrics = peerMetrics({
        run: withBridge({ [key]: MISSING }),
        comparison: compared("20"),
        netIncome: null,
      });

      expect(metrics.enterpriseValueToEbit).toEqual({
        status: "null",
        reason: "bridge_claim_missing",
      });
    }
  });

  it("un monto del puente en otra moneda no entra al EV", () => {
    const debt = RUN.input.bridge.debt;
    const metrics = peerMetrics({
      run: withBridge({
        debt: { ...debt, amount: { ...debt.amount!, currency: "EUR" } },
      }),
      comparison: compared("20"),
      netIncome: null,
    });

    expect(metrics.enterpriseValueToEbit).toEqual({
      status: "null",
      reason: "currency_mismatch",
    });
  });

  it("un EV no positivo es nulo, no un múltiplo negativo", () => {
    const cash = RUN.input.bridge.excessCash;
    const metrics = peerMetrics({
      run: withBridge({
        excessCash: {
          ...cash,
          amount: { ...cash.amount!, value: "1000000000" },
        },
      }),
      comparison: compared("20"),
      netIncome: null,
    });

    expect(metrics.enterpriseValueToEbit).toEqual({
      status: "null",
      reason: "non_positive_enterprise_value",
    });
  });
});

describe(`${PEER_CONTEXT_VERSION}: mediana y pares`, () => {
  it("mediana exacta con n impar y par", () => {
    const dec = (values: string[]) =>
      values.map((value) => parseDecimal(value, "v"));

    expect(median(dec(["3", "1", "2"])).toFixed()).toBe("2");
    expect(median(dec(["4", "1", "3", "2"])).toFixed()).toBe("2.5");
    expect(() => median([])).toThrow(RangeError);
  });

  it("la ventana empieza siete días antes del as_of", () => {
    expect(peerWindowFrom("2026-10-27")).toBe("2026-10-20");
  });

  it("debajo del mínimo no hay mediana, y los nulos se cuentan por motivo", () => {
    const summary = summarize(
      [peer("a", "1"), peer("b", "2"), peer("c", null)],
      "priceToValue",
    );

    expect(summary).toEqual({
      status: "insufficient",
      n: 2,
      minimum: PEER_MINIMUM,
      excluded: { no_close_at_as_of: 1 },
    });
  });

  it("cuenta cuántos de la mediana quedaron en revisión", () => {
    const summary = summarize(
      [
        peer("a", "1"),
        peer("b", "2", { status: "requires_review" }),
        peer("c", "4"),
      ],
      "priceToValue",
    );

    expect(summary).toMatchObject({
      status: "median",
      value: "2",
      n: 3,
      underReview: 1,
    });
  });

  it("excluye a la empresa, lo de fuera de la ventana, lo rechazado y otra moneda", () => {
    const company = {
      asOf: "2026-10-27",
      currency: "USD",
      subject: RUN.subject,
    };
    const result = admitPeers({
      company,
      candidates: [
        peer(RUN.subject.legalEntityId, "1", { asOf: "2026-10-27" }),
        peer("before", "1", { asOf: "2026-10-19" }),
        peer("edge", "1", { asOf: "2026-10-20" }),
        peer("after", "1", { asOf: "2026-10-28" }),
        peer("rejected", "1", { asOf: "2026-10-27", status: "rejected" }),
        peer("eur", "1", { asOf: "2026-10-27", currency: "EUR" }),
      ],
    });

    expect(result.admitted.map((entry) => entry.legalEntityId)).toEqual([
      "edge",
    ]);
    expect(result.excluded).toEqual({
      same_company: 1,
      outside_window: 2,
      rejected_run: 1,
      currency_mismatch: 1,
    });
  });
});

describe(`${PEER_CONTEXT_VERSION}: contexto`, () => {
  const company = { asOf: RUN.asOf, currency: "USD", subject: RUN.subject };
  const companyMetrics: PeerMetrics = {
    priceToValue: metric("3"),
    priceToEarnings: metric("30"),
    enterpriseValueToEbit: { status: "null", reason: "non_positive_ebit" },
  };

  it("separa el modelo, el sector y la empresa", () => {
    const context = peerContext({
      company,
      companyMetrics,
      sector: { status: "classified", code: "industrials" },
      candidates: [
        peer("a", "1"),
        peer("b", "2"),
        peer("c", "2"),
        peer("d", "1", { sector: "energy" }),
        peer("e", "1", { sector: null }),
      ],
    });

    // Modelo: 1, 1, 1, 2, 2 → 1. Sector: 1, 2, 2 → 2.
    expect(context.model).toMatchObject({ status: "median", value: "1", n: 5 });
    if (context.sector.status !== "classified") throw new Error("classified");
    expect(context.sector.peers).toHaveLength(3);
    expect(context.sector.summaries.priceToValue).toMatchObject({
      status: "median",
      value: "2",
    });
    expect(context.sector.companyVsSector.priceToValue).toEqual({
      status: "value",
      value: "0.5",
    });
    expect(context.sector.companyVsSector.enterpriseValueToEbit).toEqual({
      status: "null",
      reason: "company_metric_null",
    });
    expect(context.sectorVsModel).toEqual({ status: "value", value: "1" });
  });

  it("sin sector lo dice, y el modelo igual se lee", () => {
    const context = peerContext({
      company,
      companyMetrics,
      sector: { status: "unclassified", reason: "never_classified" },
      candidates: [peer("a", "1"), peer("b", "2"), peer("c", "3")],
    });

    expect(context.sector).toEqual({
      status: "unclassified",
      reason: "never_classified",
    });
    expect(context.model).toMatchObject({ status: "median", value: "2" });
    expect(context.sectorVsModel).toEqual({
      status: "null",
      reason: "no_median",
    });
  });

  it("con pares insuficientes no hay relativo", () => {
    const context = peerContext({
      company,
      companyMetrics,
      sector: { status: "classified", code: "industrials" },
      candidates: [peer("a", "1")],
    });

    if (context.sector.status !== "classified") throw new Error("classified");
    expect(context.sector.companyVsSector.priceToValue).toEqual({
      status: "null",
      reason: "no_median",
    });
    expect(context.model).toMatchObject({ status: "insufficient", n: 1 });
  });
});
