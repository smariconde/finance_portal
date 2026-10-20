import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";

import { runValuation } from "@/modules/valuation/application/run-valuation";
import { replayValuationRun } from "@/modules/valuation/application/replay-valuation-run";
import { valuationInputSchema } from "@/modules/valuation/domain/valuation-input";
import { getValuationRunRepository } from "@/server/persistence/get-valuation-run-repository";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    apply: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});
if (!values.file)
  throw new Error("Indicá --file con el snapshot privado del ciclo.");
if (statSync(values.file).size > 512_000)
  throw new Error("El snapshot supera 512 kB.");
const input = valuationInputSchema.parse(
  JSON.parse(readFileSync(values.file, "utf8")),
);
if (input.method !== "normalized_fcff")
  throw new Error("El snapshot debe declarar normalized_fcff.");
const repository = values.apply ? getValuationRunRepository() : null;
const computed = runValuation(input, {
  now: () => new Date().toISOString(),
  newValuationRunId: randomUUID,
});
const run = repository === null ? computed : await repository.record(computed);
if (run.method !== "normalized_fcff")
  throw new Error("La corrida persistida no corresponde al método.");
if (values.json) console.log(JSON.stringify(run, null, 2));
else {
  console.log(
    `${run.assetProfile} · ${run.engineVersion} · ${run.status} · ${repository === null ? "dry run, sin escritura" : "persistida"}`,
  );
  const result = run.result;
  if (result !== null) {
    console.log(
      `${result.valuePerShare} ${run.currency}/acción · experimental · screening`,
    );
    console.log(
      `Margen normalizado ${result.cycleComparison!.historicalMargin} · objetivo ${result.cycleComparison!.targetMargin} · actual ${result.cycleComparison!.currentMargin}`,
    );
    console.log(
      `Comparación a margen actual: ${result.cycleComparison!.currentMarginValuePerShare} ${run.currency}/acción`,
    );
  }
  if (run.failure !== null)
    console.log(`${run.failure.code}: ${run.failure.subjects.join(", ")}`);
  console.log(`input ${run.inputHash} · result ${run.resultHash ?? "—"}`);
  console.log(`replay ${replayValuationRun(run).outcome}`);
}
if (run.status === "rejected") process.exitCode = 1;
