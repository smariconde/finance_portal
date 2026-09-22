import { describe, expect, it } from "vitest";

import {
  admitSourceRequests,
  budgetDayOf,
  declaredDailyBudget,
  describeSourceRefusal,
  nextBudgetDayStart,
  resolveEffectiveDailyLimit,
  SOURCE_DAILY_REQUEST_BUDGETS,
  sourceControlSchema,
  type SourceBudgetState,
} from "./source-budget";

const NOW = "2026-09-18T22:30:00.000Z";

function control(overrides: Partial<Record<string, unknown>> = {}) {
  return sourceControlSchema.parse({
    controlId: "11111111-1111-4111-8111-111111111111",
    sourceId: "sec-edgar",
    status: "enabled",
    dailyRequestLimit: null,
    reason: "motivo",
    actor: "owner",
    recordedAt: NOW,
    supersededAt: null,
    ...overrides,
  });
}

function state(overrides: Partial<SourceBudgetState> = {}): SourceBudgetState {
  return {
    sourceId: "sec-edgar",
    day: "2026-09-18",
    used: 0,
    declaredLimit: 2000,
    effectiveLimit: 2000,
    control: null,
    ...overrides,
  };
}

describe("topes declarados", () => {
  it("son los de la matriz de cuotas y no se deducen de la allowlist", () => {
    expect(declaredDailyBudget("sec-edgar")).toBe(2000);
    expect(declaredDailyBudget("datahub-sp500-pddl")).toBe(10);
    expect(declaredDailyBudget("yahoo-finance")).toBe(700);
    expect(Object.keys(SOURCE_DAILY_REQUEST_BUDGETS).sort()).toEqual([
      "datahub-sp500-pddl",
      "sec-edgar",
      "yahoo-finance",
    ]);
  });

  it("una fuente sin tope declarado no tiene cuota", () => {
    expect(declaredDailyBudget("openfigi")).toBeNull();
    expect(resolveEffectiveDailyLimit("openfigi", null)).toBeNull();
  });

  it("un control puede bajar el declarado y nunca subirlo", () => {
    expect(
      resolveEffectiveDailyLimit(
        "sec-edgar",
        control({ dailyRequestLimit: 50 }),
      ),
    ).toBe(50);
    expect(
      resolveEffectiveDailyLimit(
        "sec-edgar",
        control({ dailyRequestLimit: 99_999 }),
      ),
    ).toBe(2000);
  });

  it("una fuente deshabilitada tiene tope cero", () => {
    expect(
      resolveEffectiveDailyLimit("sec-edgar", control({ status: "disabled" })),
    ).toBe(0);
  });
});

describe("día del presupuesto", () => {
  it("es el día UTC, no el local", () => {
    expect(budgetDayOf("2026-09-18T22:30:00.000Z")).toBe("2026-09-18");
    // 21:30 en Buenos Aires del 18 es el 19 en UTC.
    expect(budgetDayOf("2026-09-19T00:30:00.000Z")).toBe("2026-09-19");
  });

  it("se repone a las 00:00Z del día siguiente, también a fin de mes y de año", () => {
    expect(nextBudgetDayStart(NOW)).toBe("2026-09-19T00:00:00.000Z");
    expect(nextBudgetDayStart("2026-09-30T23:59:59.000Z")).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(nextBudgetDayStart("2026-12-31T12:00:00.000Z")).toBe(
      "2027-01-01T00:00:00.000Z",
    );
    expect(nextBudgetDayStart("2028-02-28T12:00:00.000Z")).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });
});

describe("reserva", () => {
  it("admite mientras queden llamadas para el peor caso pedido", () => {
    expect(admitSourceRequests(state({ used: 1934 }), 66, NOW)).toMatchObject({
      status: "allowed",
      remaining: 66,
    });
    expect(admitSourceRequests(state({ used: 1935 }), 66, NOW)).toMatchObject({
      status: "daily_budget_exhausted",
      limit: 2000,
      used: 1935,
      resumesAt: "2026-09-19T00:00:00.000Z",
    });
  });

  it("el kill switch gana sobre el presupuesto, y se nombra distinto", () => {
    expect(
      admitSourceRequests(
        state({
          used: 0,
          effectiveLimit: 0,
          control: control({ status: "disabled", reason: "sondeo manual" }),
        }),
        1,
        NOW,
      ),
    ).toEqual({ status: "source_disabled", reason: "sondeo manual" });
  });

  it("falla cerrado sin tope declarado", () => {
    expect(
      admitSourceRequests(
        state({ declaredLimit: null, effectiveLimit: null }),
        1,
        NOW,
      ),
    ).toEqual({ status: "budget_undeclared" });
  });
});

describe("mensajes", () => {
  it("nombran la fuente y el motivo, sin inventar un default", () => {
    expect(
      describeSourceRefusal("sec-edgar", {
        status: "daily_budget_exhausted",
        limit: 2000,
        used: 2000,
        resumesAt: "2026-09-19T00:00:00.000Z",
      }),
    ).toContain("2026-09-19T00:00:00.000Z");
    expect(
      describeSourceRefusal("sec-edgar", {
        status: "source_disabled",
        reason: "sondeo manual",
      }),
    ).toContain("sondeo manual");
    expect(
      describeSourceRefusal("openfigi", { status: "budget_undeclared" }),
    ).toContain("no declared daily request budget");
  });
});
