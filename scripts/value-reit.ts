import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";

import { runReit } from "@/modules/valuation/application/run-reit";
import { replayReitRun } from "@/modules/valuation/application/run-reit";
import { reitInputSchema } from "@/modules/valuation/domain/reit-input";
import { getValuationRunRepository } from "@/server/persistence/get-valuation-run-repository";

/** Owner-supplied frozen snapshot. No network, AI or implicit data estimation. */
const { values } = parseArgs({
  options: {
    file: { type: "string" },
    apply: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});
if (!values.file)
  throw new Error("Indicá --file con el snapshot REIT privado.");
if (statSync(values.file).size > 512_000)
  throw new Error("El snapshot supera 512 kB.");
const input = reitInputSchema.parse(
  JSON.parse(readFileSync(values.file, "utf8")),
);
const repository = values.apply ? getValuationRunRepository() : null;
const computed = runReit(input, {
  now: () => new Date().toISOString(),
  newValuationRunId: randomUUID,
});
const run = repository === null ? computed : await repository.record(computed);
if (run.method !== "affo_nav")
  throw new Error("La corrida persistida no corresponde al método.");
if (values.json) console.log(JSON.stringify(run, null, 2));
else {
  console.log(
    `${run.assetProfile} · ${run.engineVersion} · ${run.status} · ${repository === null ? "dry run, sin escritura" : "persistida"}`,
  );
  if (run.result !== null)
    console.log(
      `${run.result.base.valuePerShare} ${run.currency}/acción por AFFO · NAV ${run.result.base.nav?.valuePerShare ?? "declarado ausente"} · experimental · screening`,
    );
  if (run.failure !== null)
    console.log(`${run.failure.code}: ${run.failure.subjects.join(", ")}`);
  console.log(`input ${run.inputHash} · result ${run.resultHash ?? "—"}`);
  console.log(`replay ${replayReitRun(run).outcome}`);
}
if (run.status === "rejected") process.exitCode = 1;
