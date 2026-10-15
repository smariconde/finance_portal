import { randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import type { RequestPacingPolicy } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  encodeOpenRouterBody,
  OPENROUTER_SOURCE_ID,
} from "@/modules/ai/application/openrouter-chat";
import { runModelLadder } from "@/modules/ai/application/run-model-ladder";
import {
  AI_SPEND_POLICY_VERSION,
  formatNanoUsd,
} from "@/modules/ai/domain/ai-spend";
import { SMOKE_TASK } from "@/modules/ai/domain/ai-task";
import {
  AI_MODEL_LADDER,
  AI_MODEL_LADDER_VERSION,
  worstCaseNanoUsd,
} from "@/modules/ai/domain/model-ladder";
import { createProviderBreaker } from "@/modules/ai/domain/provider-breaker";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getAiSpendStore } from "@/server/persistence/get-ai-spend-store";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/**
 * Llamada real de humo a la capa IA
 * ([ADR 0033](../docs/architecture/adr/0033-ai-layer-industry-resolution.md)).
 *
 *   pnpm ai:smoke                    # plan: escalera, peor caso y gasto de hoy; no llama
 *   pnpm ai:smoke --apply            # corre `ai-smoke-1.0.0` por la escalera (gasta)
 *   pnpm ai:smoke --rung 2 --apply   # sólo ese escalón
 *
 * La tarea pide devolver un token aleatorio tal cual: mide la cadena entera
 * —credencial agregada por la puerta, ZDR, schema estricto, costo informado,
 * libro de gasto— sin mandar nada que venga de una fuente. A diferencia del
 * resto de los comandos, el dry run no sale a la red: acá salir es gastar
 * dólares, no cuota.
 */
const { values } = parseArgs({
  options: {
    rung: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});

/** Una llamada por segundo y un techo que cubre la escalera entera dos veces. */
const AI_SMOKE_PACING: RequestPacingPolicy = Object.freeze({
  minIntervalMs: 1000,
  maxRequests: 6,
});

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(26)} ${String(value)}`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

let ladder = AI_MODEL_LADDER;

if (values.rung !== undefined) {
  const rung = AI_MODEL_LADDER.find(
    (candidate) => String(candidate.rung) === values.rung,
  );

  if (rung === undefined) {
    fail(
      `--rung necesita uno de ${AI_MODEL_LADDER.map((r) => r.rung).join(", ")}.`,
    );
  }

  ladder = [rung];
}

const entry = DEMO_SOURCE_REGISTRY.find(
  (candidate) => candidate.sourceId === OPENROUTER_SOURCE_ID,
);
const rights =
  entry === undefined
    ? null
    : evaluateIngestionRights(entry, {
        storesRawPayload: false,
        storesNormalizedValues: false,
        publicDisplay: false,
      });

if (rights === null || !rights.allowed) {
  fail(
    `${OPENROUTER_SOURCE_ID} no está aprobada para llamarse: ${rights?.blockedBy.join(", ") ?? "sin fila en el registro"}.`,
  );
}

const now = new Date().toISOString();
const nonce = `smoke-${randomBytes(6).toString("hex")}`;
const input = { nonce };
const messages = SMOKE_TASK.buildMessages(input);
const spend = getAiSpendStore();
const day = await spend.readDay(OPENROUTER_SOURCE_ID, now);

log("tarea", SMOKE_TASK.taskVersion);
log("escalera", AI_MODEL_LADDER_VERSION);
log("política de gasto", AI_SPEND_POLICY_VERSION);
log(
  "tope por tarea",
  day.declared === null
    ? "—"
    : `USD ${formatNanoUsd(day.declared.perTaskNanoUsd)}`,
);
log(
  "tope de hoy",
  day.effectiveDailyLimitNanoUsd === null
    ? "—"
    : `USD ${formatNanoUsd(day.effectiveDailyLimitNanoUsd)}`,
);
log(
  "gasto de hoy",
  `USD ${formatNanoUsd(day.countedNanoUsd)} contado · USD ${formatNanoUsd(day.chargedNanoUsd)} cobrado · ${day.attempts} intentos`,
);

for (const rung of ladder) {
  const body = encodeOpenRouterBody({
    rung,
    messages,
    maxOutputTokens: SMOKE_TASK.maxOutputTokens,
    output: SMOKE_TASK.output,
  });

  log(
    `escalón ${rung.rung}`,
    `${rung.model} · ${body.byteLength} bytes · peor caso USD ${formatNanoUsd(
      worstCaseNanoUsd(rung, body.byteLength, SMOKE_TASK.maxOutputTokens),
    )}`,
  );
}

if (!values.apply) {
  console.log(
    "\nDry run: no se llamó a ningún modelo. Usá --apply para gastar.",
  );
  process.exit(0);
}

const verdict = await checkSourceBudget(
  getSourceBudgetStore(),
  OPENROUTER_SOURCE_ID,
  ladder.length,
  now,
);

if (verdict.status !== "allowed") {
  fail(describeSourceRefusal(OPENROUTER_SOURCE_ID, verdict));
}

await syncDeclaredSourceRegistry(
  DEMO_SOURCE_REGISTRY,
  getSourceRegistryRepository(),
);

const result = await runModelLadder(SMOKE_TASK, input, {
  fetch: getSourceEgressFetch(AI_SMOKE_PACING),
  spend,
  breaker: createProviderBreaker(),
  ladder,
  now: () => new Date().toISOString(),
  elapsedMs: () => performance.now(),
  newId: () => randomUUID(),
});

console.log("");

for (const attempt of result.attempts) {
  console.log(
    `── escalón ${attempt.rung}: ${attempt.outcome}${attempt.detail ? ` (${attempt.detail})` : ""}`,
  );
  log("  pedido", attempt.requestedModel);
  log("  respondió", attempt.respondedModel ?? "—");
  log(
    "  tokens",
    attempt.promptTokens === null
      ? "—"
      : `${attempt.promptTokens} entrada · ${attempt.completionTokens} salida`,
  );
  log(
    "  latencia",
    attempt.latencyMs === null ? "—" : `${attempt.latencyMs} ms`,
  );
  log("  reservado", `USD ${formatNanoUsd(attempt.reservedNanoUsd)}`);
  log(
    "  cobrado",
    attempt.chargedNanoUsd === null
      ? `— (${attempt.status})`
      : `USD ${formatNanoUsd(attempt.chargedNanoUsd)}`,
  );
}

console.log("");
log(
  "resultado",
  result.outcome === "accepted"
    ? `aceptado en el escalón ${result.rung} (${result.model})`
    : result.outcome === "abstained"
      ? `abstención: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`
      : `frenado: ${result.code}${result.detail ? ` (${result.detail})` : ""}`,
);

const after = await spend.readDay(
  OPENROUTER_SOURCE_ID,
  new Date().toISOString(),
);

log(
  "gasto de hoy",
  `USD ${formatNanoUsd(after.countedNanoUsd)} contado · USD ${formatNanoUsd(after.chargedNanoUsd)} cobrado · ${after.attempts} intentos`,
);

process.exit(result.outcome === "accepted" ? 0 : 1);
