import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { SMOKE_TASK, type AiTask } from "@/modules/ai/domain/ai-task";
import { createProviderBreaker } from "@/modules/ai/domain/provider-breaker";
import { createInMemoryAiSpendStore } from "@/modules/ai/infrastructure/in-memory-ai-spend-store";
import {
  RequestBudgetExhaustedError,
  type EgressFetch,
  type EgressFetchResponse,
} from "@/modules/ingestion/application/egress-fetch";
import { SourceRequestRefusedError } from "@/modules/ingestion/domain/source-budget";

import { runModelLadder } from "./run-model-ladder";

const NOW = "2026-10-15T12:00:00.000Z";
const NONCE = "nonce-7f3a";

type Step =
  | { readonly status: number; readonly body: unknown }
  | { readonly throws: unknown };

function completion(
  content: string,
  overrides: { model?: string; cost?: number | null } = {},
): Step {
  return {
    status: 200,
    body: {
      model: overrides.model ?? "fixture/answer",
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 60,
        completion_tokens: 8,
        ...(overrides.cost === null ? {} : { cost: overrides.cost ?? 0.00005 }),
      },
    },
  };
}

const echo = (value: string) => completion(JSON.stringify({ echo: value }));

function egressError(code: string): Error {
  return Object.assign(new Error(`Egress blocked (${code})`), {
    name: "EgressBlockedError",
    code,
  });
}

function harness(
  steps: readonly Step[],
  options: { perDayNanoUsd?: number } = {},
) {
  const queue = [...steps];
  const fetch = vi.fn<EgressFetch>(async (request) => {
    const step = queue.shift();

    if (step === undefined) {
      throw new Error("The fake egress was called more times than expected.");
    }

    if ("throws" in step) {
      throw step.throws;
    }

    const body = new TextEncoder().encode(JSON.stringify(step.body));

    return {
      status: step.status,
      body,
      byteLength: body.byteLength,
      fetchedAt: NOW,
      retryAfter: null,
      request,
    } as EgressFetchResponse;
  });
  const spend = createInMemoryAiSpendStore({
    limits: {
      openrouter: {
        perTaskNanoUsd: 100_000_000,
        perDayNanoUsd: options.perDayNanoUsd ?? 1_000_000_000,
      },
    },
  });
  const breaker = createProviderBreaker();
  let clock = 0;

  return {
    fetch,
    spend,
    breaker,
    dependencies: {
      fetch,
      spend,
      breaker,
      now: () => NOW,
      elapsedMs: () => {
        clock += 250;
        return clock;
      },
      newId: () => randomUUID(),
    },
  };
}

describe("runModelLadder", () => {
  it("termina en el primer escalón que da una respuesta aceptada", async () => {
    const { dependencies, fetch, spend } = harness([echo(NONCE)]);

    const result = await runModelLadder(
      SMOKE_TASK,
      { nonce: NONCE },
      dependencies,
    );

    expect(result).toMatchObject({
      outcome: "accepted",
      rung: 1,
      model: "fixture/answer",
      output: { echo: NONCE },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toMatchObject({
      sourceId: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      method: "POST",
    });
    // El adaptador no ve la clave: la agrega la puerta.
    expect(JSON.stringify(fetch.mock.calls[0]![0])).not.toMatch(
      /authorization|bearer/i,
    );
    expect(result.attempts).toEqual([
      expect.objectContaining({
        rung: 1,
        requestedModel: "deepseek/deepseek-v4.1-flash",
        respondedModel: "fixture/answer",
        outcome: "accepted",
        status: "charged",
        chargedNanoUsd: 50_000,
        promptTokens: 60,
        completionTokens: 8,
        latencyMs: 250,
      }),
    ]);
    expect((await spend.readDay("openrouter", NOW)).countedNanoUsd).toBe(
      50_000,
    );
  });

  it("reserva antes de llamar el peor caso que calcula la escalera", async () => {
    const { dependencies } = harness([echo(NONCE)]);

    const result = await runModelLadder(
      SMOKE_TASK,
      { nonce: NONCE },
      dependencies,
    );
    const [attempt] = result.attempts;
    const [call] = dependencies.fetch.mock.calls;

    expect(attempt!.reservedNanoUsd).toBe(
      call![0].body!.byteLength * 600 + SMOKE_TASK.maxOutputTokens * 2400,
    );
  });

  it("sube de escalón cuando la salida no valida, la policy rechaza o el modelo se abstiene", async () => {
    const abstaining: AiTask<{ nonce: string }, { echo: string }> = {
      ...SMOKE_TASK,
      judge: (output, input) =>
        output.echo === "?"
          ? { verdict: "abstain", reason: "not_enough_evidence" }
          : SMOKE_TASK.judge(output, input),
    };
    const { dependencies } = harness([
      completion("not json at all"),
      echo("?"),
      echo(NONCE),
    ]);

    const result = await runModelLadder(
      abstaining,
      { nonce: NONCE },
      dependencies,
    );

    expect(result).toMatchObject({ outcome: "accepted", rung: 3 });
    expect(
      result.attempts.map((attempt) => [attempt.rung, attempt.outcome]),
    ).toEqual([
      [1, "schema_invalid"],
      [2, "abstained"],
      [3, "accepted"],
    ]);
  });

  it("se abstiene con el motivo del último escalón si todos se abstienen", async () => {
    const task: AiTask<{ nonce: string }, { echo: string }> = {
      ...SMOKE_TASK,
      judge: () => ({ verdict: "abstain", reason: "not_enough_evidence" }),
    };
    const { dependencies } = harness([echo("a"), echo("b"), echo("c")]);

    expect(
      await runModelLadder(task, { nonce: NONCE }, dependencies),
    ).toMatchObject({
      outcome: "abstained",
      reason: "not_enough_evidence",
    });
  });

  it("se abstiene como escalera agotada si el último escalón fue rechazado", async () => {
    const { dependencies } = harness([echo("x"), echo("y"), echo("z")]);

    const result = await runModelLadder(
      SMOKE_TASK,
      { nonce: NONCE },
      dependencies,
    );

    expect(result).toMatchObject({
      outcome: "abstained",
      reason: "ladder_exhausted",
      detail: "policy_rejected",
    });
    expect(result.attempts.map((attempt) => attempt.detail)).toEqual([
      "echo_mismatch",
      "echo_mismatch",
      "echo_mismatch",
    ]);
  });

  it("no llama si el peor caso no entra en el día, y se abstiene con ai_budget_exhausted", async () => {
    const { dependencies, fetch, spend } = harness([echo(NONCE)], {
      perDayNanoUsd: 1000,
    });

    const result = await runModelLadder(
      SMOKE_TASK,
      { nonce: NONCE },
      dependencies,
    );

    expect(result).toMatchObject({
      outcome: "abstained",
      reason: "ai_budget_exhausted",
      detail: "daily_budget_exhausted",
      attempts: [],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect((await spend.readDay("openrouter", NOW)).attempts).toBe(0);
  });

  it("deja la reserva por su peor caso cuando se corta el transporte, y sube", async () => {
    const { dependencies, spend, breaker } = harness([
      { throws: egressError("deadline_exceeded") },
      echo(NONCE),
    ]);

    const result = await runModelLadder(
      SMOKE_TASK,
      { nonce: NONCE },
      dependencies,
    );
    const [cut] = result.attempts;

    expect(result).toMatchObject({ outcome: "accepted", rung: 2 });
    expect(cut).toMatchObject({
      outcome: "transport_error",
      detail: "deadline_exceeded",
      status: "unsettled",
    });
    expect((await spend.readDay("openrouter", NOW)).countedNanoUsd).toBe(
      cut!.reservedNanoUsd + 50_000,
    );
    expect(breaker.consecutiveFailures()).toBe(0);
  });

  it("abre el breaker con tres fallas seguidas y frena la tarea siguiente sin llamar", async () => {
    const { dependencies, fetch } = harness([
      { status: 503, body: { error: {} } },
      { status: 429, body: { error: {} } },
      { throws: egressError("transport_error") },
    ]);

    const first = await runModelLadder(
      SMOKE_TASK,
      { nonce: NONCE },
      dependencies,
    );

    expect(first).toMatchObject({
      outcome: "abstained",
      reason: "ladder_exhausted",
    });
    expect(
      first.attempts.map((attempt) => [attempt.outcome, attempt.status]),
    ).toEqual([
      ["provider_unavailable", "uncharged"],
      ["provider_throttled", "uncharged"],
      ["transport_error", "unsettled"],
    ]);

    const second = await runModelLadder(
      SMOKE_TASK,
      { nonce: NONCE },
      dependencies,
    );

    expect(second).toMatchObject({ outcome: "stopped", code: "breaker_open" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("frena la corrida ante una clave rechazada, sin probar otro escalón", async () => {
    const { dependencies, fetch } = harness([
      { status: 401, body: { error: {} } },
    ]);

    expect(
      await runModelLadder(SMOKE_TASK, { nonce: NONCE }, dependencies),
    ).toMatchObject({ outcome: "stopped", code: "provider_unauthorized" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sube sin cobrar ni acercar el breaker ante un 4xx del pedido", async () => {
    const { dependencies, breaker } = harness([
      { status: 404, body: { error: { message: "No endpoints found" } } },
      echo(NONCE),
    ]);

    const result = await runModelLadder(
      SMOKE_TASK,
      { nonce: NONCE },
      dependencies,
    );

    expect(result).toMatchObject({ outcome: "accepted", rung: 2 });
    expect(result.attempts[0]).toMatchObject({
      outcome: "provider_rejected",
      status: "uncharged",
    });
    expect(breaker.consecutiveFailures()).toBe(0);
  });

  it("libera la reserva y frena cuando nuestro propio control niega la salida", async () => {
    const refusals: ReadonlyArray<[unknown, string]> = [
      [
        new SourceRequestRefusedError("openrouter", {
          status: "source_disabled",
          reason: "owner stop",
        }),
        "source_disabled",
      ],
      [
        new SourceRequestRefusedError("openrouter", {
          status: "daily_budget_exhausted",
          limit: 100,
          used: 100,
          resumesAt: "2026-10-16T00:00:00.000Z",
        }),
        "request_budget_exhausted",
      ],
      [
        new RequestBudgetExhaustedError("openrouter", 12),
        "request_budget_exhausted",
      ],
      [egressError("credential_missing"), "egress_refused"],
    ];

    for (const [error, code] of refusals) {
      const { dependencies, spend, breaker } = harness([{ throws: error }]);

      const result = await runModelLadder(
        SMOKE_TASK,
        { nonce: NONCE },
        dependencies,
      );

      expect(result).toMatchObject({ outcome: "stopped", code });
      expect(result.attempts[0]).toMatchObject({
        outcome: "egress_refused",
        status: "uncharged",
      });
      expect((await spend.readDay("openrouter", NOW)).countedNanoUsd).toBe(0);
      expect(breaker.consecutiveFailures()).toBe(0);
    }
  });

  it("cuenta el peor caso cuando el proveedor no informa el costo", async () => {
    const { dependencies } = harness([
      completion(JSON.stringify({ echo: NONCE }), { cost: null }),
    ]);

    const result = await runModelLadder(
      SMOKE_TASK,
      { nonce: NONCE },
      dependencies,
    );

    expect(result.attempts[0]).toMatchObject({
      outcome: "accepted",
      status: "unsettled",
      chargedNanoUsd: null,
    });
  });
});
