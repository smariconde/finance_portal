import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { createLiveCedearSource } from "@/modules/cedears/application/live-cedear-source";
import { recordCedearRegistry } from "@/modules/cedears/application/record-cedear-registry";
import { CEDEAR_DEPOSITARIES } from "@/modules/cedears/domain/cedear-depositaries";
import { CEDEAR_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getCedearRegistryRepository } from "@/server/persistence/get-cedear-registry-repository";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Registra los programas CEDEAR de los dos emisores
 * ([ADR 0027](../docs/architecture/adr/0027-cedear-registry-sources.md)).
 *
 * Es un job controlado y no un gate: se corre a mano y en dry run por defecto.
 * Publicar exige `--apply`.
 *
 *   pnpm cedears:record                                  # los dos emisores, en seco
 *   pnpm cedears:record --source comafi-cedear --apply
 *   pnpm cedears:record --apply --accept-withdrawals     # destraba el guard de bajas
 *
 * Una request por emisor trae su registro entero. Sólo se registran los programas
 * cuyo subyacente ya está en el grafo; el resto se cuenta y se nombra. Lo que se
 * guarda son hechos normalizados: ni el JSON de Comafi ni el HTML de Caja de
 * Valores se conservan.
 */
const { values } = parseArgs({
  options: {
    source: { type: "string", multiple: true, default: [] },
    apply: { type: "boolean", default: false },
    "accept-withdrawals": { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;
const known = CEDEAR_DEPOSITARIES.map((depositary) => depositary.sourceId);
const sources = values.source.length === 0 ? known : values.source;

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(28)} ${String(value)}`);
}

function tally(codes: readonly string[]): string {
  const counts = new Map<string, number>();

  for (const code of codes) {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  return (
    [...counts]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([code, count]) => `${code} ${count}`)
      .join(", ") || "—"
  );
}

for (const sourceId of sources) {
  if (!known.includes(sourceId)) {
    console.error(
      `${sourceId}: no es un emisor declarado (${known.join(", ")}).`,
    );
    process.exit(2);
  }
}

const registry = getSourceRegistryRepository();
const sync = await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

log("registro creado", sync.created.join(", ") || "—");
log("registro actualizado", sync.updated.join(", ") || "—");

// Antes de la primera llamada: una fuente frenada, o sin cuota del día, sale con
// el motivo en vez de fallar contra el primer request (ADR 0020).
const budgets = getSourceBudgetStore();

for (const sourceId of sources) {
  const verdict = await checkSourceBudget(
    budgets,
    sourceId,
    1,
    new Date().toISOString(),
  );

  if (verdict.status !== "allowed") {
    console.error(describeSourceRefusal(sourceId, verdict));
    process.exit(2);
  }
}

const universe = getUniverseRepository();
const source = createLiveCedearSource({
  sourceRegistry: registry,
  fetch: getSourceEgressFetch(CEDEAR_REQUEST_PACING),
});
const repository = getCedearRegistryRepository();
const runs = getIngestionRunRepository();

console.log("");
log("emisores", sources.join(", "));
log("modo", DRY_RUN ? "dry run (no escribe)" : "apply");

for (const sourceId of sources) {
  const outcome = await recordCedearRegistry(
    { sourceId, acceptWithdrawals: values["accept-withdrawals"] },
    {
      source,
      repository,
      ingestionRuns: runs,
      loadGraph: async () =>
        (await universe.loadState({ indexId: SP500_INDEX_ID })).graph,
      now: () => new Date().toISOString(),
      newId: () => randomUUID(),
      hashContent: (input) => createHash("sha256").update(input).digest("hex"),
      dryRun: DRY_RUN,
    },
  );
  const { plan } = outcome;

  console.log("");
  log(sourceId, outcome.parserVersion);
  log("  observado", outcome.observedAt);
  log("  bytes", outcome.byteLength);
  log("  filas", plan.counts.rowsSeen);
  log("  resueltas", plan.counts.resolved);
  log("  programas nuevos", plan.counts.programsOpened);
  log("  estado cambiado", plan.counts.statusChanged);
  log("  ratio cambiado", plan.counts.ratiosChanged);
  log("  sin cambios", plan.counts.unchanged);
  log("  retirados", plan.counts.withdrawn);
  log("  no reafirmados", plan.counts.notReasserted);
  log(
    "  fuera del universo",
    tally(plan.outsideUniverse.map((row) => row.reason)),
  );
  log("  rechazadas", tally(plan.rejections.map((row) => row.code)));
  log("  marcas", tally(plan.flagged.flatMap((row) => row.flags)));
  log("  evidencia cambiada", plan.evidenceChanged.length);

  if (values.verbose) {
    for (const rejection of plan.rejections) {
      log("    rechazo", `${rejection.code} ${rejection.label ?? "—"}`);
    }

    for (const row of plan.flagged) {
      log(
        "    marca",
        `${row.symbol} ${row.cedearIsin} ${row.flags.join(",")}`,
      );
    }

    for (const row of plan.withdrawn) {
      log("    retirado", `${row.symbol} ${row.cedearIsin}`);
    }

    for (const row of plan.evidenceChanged) {
      log("    evidencia", `${row.symbol} ${row.cedearIsin}`);
    }
  }

  if (plan.refusal !== null) {
    // El guard de bajas: una baja masiva se parece más a una respuesta rota que
    // a una decisión del emisor. Destrabarlo es una decisión del owner.
    log(
      "  ⚠ negado",
      `${plan.refusal.code}: ${plan.refusal.withdrawn} de ${plan.refusal.open} programas; revisá la fuente y usá --accept-withdrawals si es real`,
    );
  }

  if (outcome.runId !== null) {
    log("  corrida", `${outcome.runStatus} ${outcome.runId}`);
    log(
      "  escrito",
      outcome.summary === null
        ? "nada"
        : Object.entries(outcome.summary.applied)
            .map(([key, count]) => `${key} ${count}`)
            .join(", "),
    );
  }
}

if (DRY_RUN) {
  console.log("\nDry run: no se escribió nada. Usá --apply para registrar.");
}

process.exit(0);
