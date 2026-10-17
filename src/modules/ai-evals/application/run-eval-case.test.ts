import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createProviderBreaker } from "@/modules/ai/domain/provider-breaker";
import { createInMemoryAiSpendStore } from "@/modules/ai/infrastructure/in-memory-ai-spend-store";
import type {
  EgressFetch,
  EgressFetchResponse,
} from "@/modules/ingestion/application/egress-fetch";

import { EVAL_VARIANTS } from "../domain/eval-variants";
import { loadEvalCases } from "../infrastructure/load-eval-cases";

import { runEvalCase } from "./run-eval-case";

const NOW = "2026-10-17T12:00:00.000Z";
const { cases } = loadEvalCases();
const amazon = cases.find((c) => c.caseId === "industry/AMZN/baseline")!;
const [baseline, lowEffort] = EVAL_VARIANTS;

function harness(perDayNanoUsd = 1_000_000_000) {
  const bodies: unknown[] = [];
  const fetch: EgressFetch = async (request) => {
    bodies.push(JSON.parse(new TextDecoder().decode(request.body!)));

    const body = new TextEncoder().encode(
      JSON.stringify({
        model: "fixture/answer",
        choices: [
          {
            message: {
              content: JSON.stringify({
                decision: "resolved",
                industryKey: "retail-general",
                confidence: "high",
                evidenceIds: ["E1"],
                rationale: "Online retail is most of the revenue.",
                abstainReason: null,
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5000, completion_tokens: 200, cost: 0.002 },
      }),
    );

    return {
      status: 200,
      body,
      byteLength: body.byteLength,
      fetchedAt: NOW,
      retryAfter: null,
      request,
    } as EgressFetchResponse;
  };
  const spend = createInMemoryAiSpendStore({
    limits: { openrouter: { perTaskNanoUsd: 100_000_000, perDayNanoUsd } },
  });
  let clock = 0;

  return {
    bodies,
    spend,
    dependencies: {
      fetch,
      spend,
      breaker: createProviderBreaker(),
      now: () => NOW,
      elapsedMs: () => (clock += 300),
      newId: () => randomUUID(),
    },
  };
}

describe("runEvalCase", () => {
  it("measures one rung, keeps the output it saw and marks the spend as an eval of that variant", async () => {
    const { dependencies, spend } = harness();

    const result = await runEvalCase(amazon, baseline!, 2, dependencies);

    expect(result).toMatchObject({
      status: "measured",
      attempt: {
        variantId: "ai-model-ladder-1.0.0",
        caseId: "industry/AMZN/baseline",
        rung: 2,
        requestedModel: "openai/gpt-5.6-luna",
        outcome: "accepted",
        finishReason: "stop",
        output: { industryKey: "retail-general" },
        countedNanoUsd: 2_000_000,
      },
    });

    const day = await spend.readDay("openrouter", NOW);
    expect(day.attempts).toBe(1);
  });

  it("asks for the variant's reasoning effort", async () => {
    const { dependencies, bodies } = harness();

    await runEvalCase(amazon, lowEffort!, 1, dependencies);

    expect(bodies[0]).toMatchObject({ reasoning: { effort: "low" } });
  });

  it("stops without a measurement when the day's cap does not admit the call", async () => {
    const { dependencies } = harness(1);

    expect(await runEvalCase(amazon, baseline!, 1, dependencies)).toEqual({
      status: "stopped",
      code: "ai_budget_exhausted",
      detail: "daily_budget_exhausted",
    });
  });
});
