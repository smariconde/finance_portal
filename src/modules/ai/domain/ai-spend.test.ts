import { describe, expect, it } from "vitest";

import {
  admitAiSpend,
  AI_SPEND_LIMITS,
  countedNanoUsd,
  formatNanoUsd,
  parseUsdToNanoUsd,
  providerCostToNanoUsd,
  resolveEffectiveDailySpendLimit,
} from "./ai-spend";

const LIMITS = { perTaskNanoUsd: 1000, perDayNanoUsd: 5000 };

describe("topes declarados en dólares", () => {
  it("son USD 0,10 por tarea y USD 1,00 por día, sólo para OpenRouter", () => {
    // ADR 0033, decisión 4. Subirlos es un diff revisable, y una fuente que no
    // figura no reserva nada.
    expect(AI_SPEND_LIMITS).toEqual({
      openrouter: { perTaskNanoUsd: 100_000_000, perDayNanoUsd: 1_000_000_000 },
    });
  });
});

describe("providerCostToNanoUsd", () => {
  it("convierte el costo informado sin cobrar el ruido de la doble precisión", () => {
    expect(providerCostToNanoUsd(0.1)).toBe(100_000_000);
    expect(providerCostToNanoUsd(0.000123)).toBe(123_000);
    expect(providerCostToNanoUsd(0)).toBe(0);
  });

  it("redondea hacia arriba lo que no entra en un nanodólar", () => {
    expect(providerCostToNanoUsd(0.0000000001)).toBe(1);
    expect(providerCostToNanoUsd(0.0000012345)).toBe(1235);
  });

  it("no inventa un costo para un valor negativo o no finito", () => {
    for (const value of [-0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(providerCostToNanoUsd(value)).toBeNull();
    }
  });
});

describe("formatNanoUsd y parseUsdToNanoUsd", () => {
  it("muestran y leen USD exactos, sin pasar por un double", () => {
    expect(formatNanoUsd(1_000_000_000)).toBe("1.000000000");
    expect(formatNanoUsd(37)).toBe("0.000000037");
    expect(parseUsdToNanoUsd("0.50")).toBe(500_000_000);
    expect(parseUsdToNanoUsd("1")).toBe(1_000_000_000);
    expect(parseUsdToNanoUsd("0.000000001")).toBe(1);
  });

  it("rechaza un importe con signo, exponente o más de nueve decimales", () => {
    for (const text of ["-1", "1e-3", "0.0000000001", "abc", "", "01"]) {
      expect(parseUsdToNanoUsd(text)).toBeNull();
    }
  });
});

describe("countedNanoUsd", () => {
  it("cuenta lo cobrado, cero si no se cobró y el peor caso si no se sabe", () => {
    const base = { reservedNanoUsd: 500, chargedNanoUsd: null };

    expect(
      countedNanoUsd({ ...base, status: "charged", chargedNanoUsd: 12 }),
    ).toBe(12);
    expect(countedNanoUsd({ ...base, status: "uncharged" })).toBe(0);
    expect(countedNanoUsd({ ...base, status: "unsettled" })).toBe(500);
    expect(countedNanoUsd({ ...base, status: "reserved" })).toBe(500);
  });
});

describe("admitAiSpend", () => {
  const admit = (overrides: Partial<Parameters<typeof admitAiSpend>[0]>) =>
    admitAiSpend({
      limits: LIMITS,
      control: null,
      taskSpentNanoUsd: 0,
      daySpentNanoUsd: 0,
      worstCaseNanoUsd: 100,
      resumesAt: "2026-10-16T00:00:00.000Z",
      ...overrides,
    });

  it("admite justo hasta el tope, incluido", () => {
    expect(admit({ taskSpentNanoUsd: 900, worstCaseNanoUsd: 100 })).toBeNull();
    expect(admit({ daySpentNanoUsd: 4900, worstCaseNanoUsd: 100 })).toBeNull();
  });

  it("niega el primer nanodólar de más, por tarea y por día", () => {
    expect(admit({ taskSpentNanoUsd: 901 })?.status).toBe(
      "task_budget_exhausted",
    );
    expect(admit({ daySpentNanoUsd: 4901 })?.status).toBe(
      "daily_budget_exhausted",
    );
  });

  it("falla cerrado sin tope declarado y frena con el kill switch", () => {
    expect(admit({ limits: null })).toEqual({ status: "spend_undeclared" });

    const disabled = {
      controlId: "00000000-0000-4000-8000-000000000001",
      sourceId: "openrouter",
      status: "disabled" as const,
      dailyRequestLimit: null,
      dailySpendLimitNanoUsd: null,
      reason: "owner stop",
      actor: "owner",
      recordedAt: "2026-10-15T00:00:00.000Z",
      supersededAt: null,
    };

    expect(admit({ control: disabled })).toEqual({
      status: "source_disabled",
      reason: "owner stop",
    });
  });

  it("deja que un control baje el tope del día y nunca que lo suba", () => {
    const control = (dailySpendLimitNanoUsd: number | null) => ({
      controlId: "00000000-0000-4000-8000-000000000002",
      sourceId: "openrouter",
      status: "enabled" as const,
      dailyRequestLimit: null,
      dailySpendLimitNanoUsd,
      reason: "owner cap",
      actor: "owner",
      recordedAt: "2026-10-15T00:00:00.000Z",
      supersededAt: null,
    });

    expect(resolveEffectiveDailySpendLimit(LIMITS, control(200))).toBe(200);
    expect(resolveEffectiveDailySpendLimit(LIMITS, control(9_999_999))).toBe(
      5000,
    );
    expect(resolveEffectiveDailySpendLimit(LIMITS, control(null))).toBe(5000);
    expect(resolveEffectiveDailySpendLimit(LIMITS, control(0))).toBe(0);
  });
});
