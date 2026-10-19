import { describe, expect, it } from "vitest";

import {
  AI_MODEL_LADDER,
  AI_MODEL_LADDER_1_0_0,
  AI_MODEL_LADDER_VERSION,
  openRouterMaxPrice,
  worstCaseNanoUsd,
} from "./model-ladder";
import { createProviderBreaker } from "./provider-breaker";

describe("escalera de modelos", () => {
  it("es la que decidieron los evals de la ADR 0035: tres familias, en orden", () => {
    expect(AI_MODEL_LADDER_VERSION).toBe("ai-model-ladder-1.1.0");
    expect(
      AI_MODEL_LADDER.map((rung) => [
        rung.rung,
        rung.model,
        rung.reasoning?.effort ?? null,
      ]),
    ).toEqual([
      [1, "openai/gpt-5.6-luna", null],
      [2, "google/gemini-3.8-flash", "low"],
      [3, "google/gemini-3.8-flash", null],
      [4, "deepseek/deepseek-v4.1-flash", null],
    ]);
    expect(
      new Set(AI_MODEL_LADDER.map((rung) => rung.model.split("/")[0])).size,
    ).toBe(3);
  });

  it("conserva la 1.0.0 que nombran las resoluciones guardadas", () => {
    expect(AI_MODEL_LADDER_1_0_0.map((rung) => rung.model)).toEqual([
      "deepseek/deepseek-v4.1-flash",
      "openai/gpt-5.6-luna",
      "google/gemini-3.8-flash",
    ]);
  });

  it("deriva el max_price de OpenRouter del precio entero del escalón", () => {
    expect(AI_MODEL_LADDER.map(openRouterMaxPrice)).toEqual([
      { prompt: 0.25, completion: 1.5 },
      { prompt: 1.35, completion: 6.75 },
      { prompt: 1.35, completion: 6.75 },
      { prompt: 0.6, completion: 2.4 },
    ]);
  });
});

describe("worstCaseNanoUsd", () => {
  it("acota la entrada por bytes y la salida por max_tokens", () => {
    const [first, , third] = AI_MODEL_LADDER_1_0_0;

    // 100 KB de pedido y 1.000 tokens de salida en el escalón 1:
    // 102.400 × 600 + 1.000 × 2.400 nanodólares = USD 0,0638.
    expect(worstCaseNanoUsd(first!, 102_400, 1000)).toBe(63_840_000);
    // El escalón 3 con el techo de bytes de la allowlist sigue dentro de los
    // USD 0,10 de una tarea sólo si el pedido es menor: el tope manda.
    expect(worstCaseNanoUsd(third!, 256 * 1024, 1000)).toBeGreaterThan(
      100_000_000,
    );
  });

  it("rechaza tamaños que no son enteros no negativos", () => {
    const [first] = AI_MODEL_LADDER_1_0_0;

    expect(() => worstCaseNanoUsd(first!, -1, 10)).toThrow(RangeError);
    expect(() => worstCaseNanoUsd(first!, 10, 0)).toThrow(RangeError);
    expect(() => worstCaseNanoUsd(first!, 1.5, 10)).toThrow(RangeError);
  });
});

describe("breaker del proveedor", () => {
  it("abre con tres fallas seguidas y un éxito lo repone", () => {
    const breaker = createProviderBreaker();

    breaker.recordTransportFailure();
    breaker.recordTransportFailure();
    expect(breaker.isOpen()).toBe(false);

    breaker.recordSuccess();
    breaker.recordTransportFailure();
    breaker.recordTransportFailure();
    expect(breaker.isOpen()).toBe(false);

    breaker.recordTransportFailure();
    expect(breaker.isOpen()).toBe(true);
    expect(breaker.consecutiveFailures()).toBe(3);
  });

  it("no acepta un umbral que no sea un entero positivo", () => {
    expect(() => createProviderBreaker(0)).toThrow(RangeError);
  });
});
