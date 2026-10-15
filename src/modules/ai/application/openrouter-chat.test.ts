import { describe, expect, it } from "vitest";

import { SMOKE_TASK } from "@/modules/ai/domain/ai-task";
import { AI_MODEL_LADDER } from "@/modules/ai/domain/model-ladder";

import {
  buildOpenRouterBody,
  classifyOpenRouterResponse,
} from "./openrouter-chat";

const encode = (value: unknown) =>
  new TextEncoder().encode(
    typeof value === "string" ? value : JSON.stringify(value),
  );

describe("buildOpenRouterBody", () => {
  const body = buildOpenRouterBody({
    rung: AI_MODEL_LADDER[0]!,
    messages: SMOKE_TASK.buildMessages({ nonce: "n-1" }),
    maxOutputTokens: SMOKE_TASK.maxOutputTokens,
    output: SMOKE_TASK.output,
  });

  it("fija en el código las garantías de privacidad y el precio máximo", () => {
    // ADR 0033: ninguno de estos valores se puede relajar por entorno.
    expect(body.provider).toEqual({
      zdr: true,
      data_collection: "deny",
      require_parameters: true,
      max_price: { prompt: 0.6, completion: 2.4 },
    });
  });

  it("pide salida con JSON Schema estricto y un techo de tokens", () => {
    expect(body.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(body.max_tokens).toBe(SMOKE_TASK.maxOutputTokens);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "smoke_echo",
        strict: true,
        schema: SMOKE_TASK.output.jsonSchema,
      },
    });
  });

  it("no le ofrece herramientas al modelo ni nada que pueda pedir una URL", () => {
    expect(Object.keys(body).sort()).toEqual([
      "max_tokens",
      "messages",
      "model",
      "provider",
      "response_format",
      "usage",
    ]);
  });
});

describe("classifyOpenRouterResponse", () => {
  it("lee el sobre con el modelo que respondió, tokens y costo", () => {
    expect(
      classifyOpenRouterResponse(
        200,
        encode({
          id: "gen-1",
          model: "deepseek/deepseek-v4.1-flash-20260901",
          choices: [
            { message: { content: '{"echo":"n-1"}' }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 61, completion_tokens: 7, cost: 0.0000531 },
        }),
      ),
    ).toEqual({
      kind: "completed",
      respondedModel: "deepseek/deepseek-v4.1-flash-20260901",
      content: '{"echo":"n-1"}',
      finishReason: "stop",
      promptTokens: 61,
      completionTokens: 7,
      costUsd: 0.0000531,
    });
  });

  it("deja el costo en null cuando no vino, en vez de suponerlo cero", () => {
    const result = classifyOpenRouterResponse(
      200,
      encode({ model: "x/y", choices: [{ message: { content: "{}" } }] }),
    );

    expect(result).toMatchObject({ kind: "completed", costUsd: null });
  });

  it.each([
    [401, "unauthorized"],
    [402, "unauthorized"],
    [403, "unauthorized"],
    [408, "throttled"],
    [429, "throttled"],
    [500, "unavailable"],
    [503, "unavailable"],
    [400, "rejected"],
    [404, "rejected"],
  ] as const)("traduce el estado %i a %s", (status, kind) => {
    expect(classifyOpenRouterResponse(status, encode({ error: {} })).kind).toBe(
      kind,
    );
  });

  it("trata un 200 con error del proveedor de abajo como no disponible", () => {
    expect(
      classifyOpenRouterResponse(
        200,
        encode({ error: { code: 502, message: "upstream" } }),
      ).kind,
    ).toBe("unavailable");
  });

  it("no acepta un 200 que no es el sobre esperado", () => {
    for (const body of ["not json", "{}", '{"model":"x/y","choices":[]}']) {
      expect(classifyOpenRouterResponse(200, encode(body)).kind).toBe(
        "unreadable",
      );
    }
  });
});
