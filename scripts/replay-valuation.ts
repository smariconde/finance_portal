import { parseArgs } from "node:util";

import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import {
  replayValuationRun,
  type ValuationReplay,
} from "@/modules/valuation/application/replay-valuation-run";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";
import { getValuationRunRepository } from "@/server/persistence/get-valuation-run-repository";

/**
 * Replay de corridas persistidas (`F5-06`).
 *
 *   pnpm valuation:replay --run <uuid>          # una corrida por su ID
 *   pnpm valuation:replay --ticker AAPL         # las corridas de la empresa (hasta 200)
 *   pnpm valuation:replay --ticker AAPL --json
 *
 * Vuelve a calcular cada corrida desde su snapshot y compara `input_hash`,
 * `result_hash` y estado con los guardados. No construye el egress ni la capa
 * IA y no lee las tablas de propuestas: la industria y el mix de la IA viajan en
 * el snapshot. No escribe. Sale con 1 si alguna corrida diverge, y también si
 * no había ninguna: un replay que no reprodujo nada no prueba nada.
 */
const { values } = parseArgs({
  options: {
    run: { type: "string", multiple: true, default: [] },
    ticker: { type: "string", multiple: true, default: [] },
    json: { type: "boolean", default: false },
  },
});

if (values.run.length === 0 && values.ticker.length === 0) {
  console.error("Indicá al menos un --run o un --ticker.");
  process.exit(2);
}

const repository = getValuationRunRepository();
const runs: ValuationRun[] = [];

for (const valuationRunId of values.run) {
  const run = await repository.findById(valuationRunId);

  if (run === null) {
    console.error(`${valuationRunId}: no existe esa corrida.`);
    process.exit(2);
  }

  runs.push(run);
}

if (values.ticker.length > 0) {
  const now = new Date().toISOString();
  const state = await getUniverseRepository().loadState({
    indexId: SP500_INDEX_ID,
    versions: "all",
  });
  const identity = createGraphIdentityResolver(() => state.graph);
  const query = pointInTimeQuerySchema.parse({
    effectiveAt: now,
    knownAt: now,
    revisionPolicy: "as_known",
    adjustmentPolicy: "as_known",
    sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
  });

  for (const ticker of values.ticker) {
    const resolution = await identity.resolve({ symbol: ticker }, query);

    if (resolution.status !== "resolved" || resolution.legalEntityId === null) {
      console.error(
        `${ticker}: no resuelve en el grafo (${resolution.status}).`,
      );
      process.exit(2);
    }

    runs.push(
      ...(await repository.list({
        legalEntityId: resolution.legalEntityId,
        limit: 200,
      })),
    );
  }
}

const reports = runs.map((run) => ({
  run,
  replay: replayValuationRun(run),
}));

function describeDecisions(run: ValuationRun): string {
  const { industry, operationsMix } = run.input.qualitativeDecisions;
  const industryText =
    industry === null
      ? "sin industria"
      : industry.basis === "ai_resolution"
        ? `${industry.industryKey} (IA: ${industry.resolution.respondedModel})`
        : `${industry.industryKey} (${industry.basis})`;
  const mixText =
    operationsMix === null
      ? "sin mix"
      : operationsMix.source === "ai_proposal"
        ? `mix IA ${operationsMix.lines.length} líneas (${operationsMix.proposal.respondedModel})`
        : "mix del owner";

  return `${industryText} · ${mixText}`;
}

function describe(replay: ValuationReplay): string {
  return replay.outcome === "reproduced"
    ? `reproducida · input ${replay.replayed.inputHash.slice(0, 12)} · result ${replay.replayed.resultHash?.slice(0, 12) ?? "—"}`
    : `DIVERGE en ${replay.divergences.join(", ")} · guardado ${replay.recorded.inputHash.slice(0, 12)}/${replay.recorded.resultHash?.slice(0, 12) ?? "—"} · ahora ${replay.replayed.inputHash.slice(0, 12)}/${replay.replayed.resultHash?.slice(0, 12) ?? "—"}`;
}

if (values.json) {
  console.log(
    JSON.stringify(
      reports.map(({ run, replay }) => ({
        ...replay,
        legalEntityId: run.subject.legalEntityId,
        asOf: run.asOf,
        qualitativeDecisions: run.input.qualitativeDecisions,
      })),
      null,
      2,
    ),
  );
} else {
  for (const { run, replay } of reports) {
    console.log(`\n── ${run.valuationRunId} · ${run.asOf} · ${run.status}`);
    console.log(`${"decisiones".padEnd(14)} ${describeDecisions(run)}`);
    console.log(`${"replay".padEnd(14)} ${describe(replay)}`);
  }

  const diverged = reports.filter(
    ({ replay }) => replay.outcome === "diverged",
  ).length;
  console.log(
    `\n${reports.length} corridas · ${reports.length - diverged} reproducidas · ${diverged} divergentes`,
  );
}

if (reports.length === 0) {
  console.error("Sin corridas que reproducir.");
  process.exit(1);
}

process.exit(
  reports.some(({ replay }) => replay.outcome === "diverged") ? 1 : 0,
);
