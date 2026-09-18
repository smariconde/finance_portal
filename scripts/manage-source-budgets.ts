import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import {
  budgetDayOf,
  declaredDailyBudget,
  SOURCE_BUDGET_POLICY_VERSION,
  SOURCE_DAILY_REQUEST_BUDGETS,
} from "@/modules/ingestion/domain/source-budget";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";

/**
 * Inspecciona y opera el presupuesto diario y el kill switch por fuente
 * (ADR 0020).
 *
 *   pnpm ingestion:sources                                          # estado y consumo
 *   pnpm ingestion:sources --source sec-edgar                       # con su historia
 *   pnpm ingestion:sources --source sec-edgar --disable --reason "…" --apply
 *   pnpm ingestion:sources --source sec-edgar --enable --reason "…" --apply
 *   pnpm ingestion:sources --source sec-edgar --limit 200 --reason "…" --apply
 *
 * Como el resto de los comandos controlados: dry run por defecto, `--reason`
 * obligatorio para escribir, y cada cambio queda en la historia con su actor.
 *
 * El tope declarado en código es el techo. `--limit` sólo puede bajarlo: subir la
 * cuota de una fuente es un diff revisable, no una palanca de runtime.
 */
const { values } = parseArgs({
  options: {
    source: { type: "string" },
    disable: { type: "boolean", default: false },
    enable: { type: "boolean", default: false },
    limit: { type: "string" },
    days: { type: "string", default: "7" },
    reason: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(26)} ${String(value)}`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const store = getSourceBudgetStore();
const now = new Date().toISOString();
const today = budgetDayOf(now);
const days = Math.min(Math.max(Number(values.days) || 7, 1), 90);
const fromDay = new Date(
  Date.parse(`${today}T00:00:00.000Z`) - (days - 1) * 86_400_000,
)
  .toISOString()
  .slice(0, 10);

log("política", SOURCE_BUDGET_POLICY_VERSION);
log("día UTC", today);

const actions = [
  values.disable,
  values.enable,
  values.limit !== undefined,
].filter(Boolean).length;

if (actions === 0) {
  const sourceIds =
    values.source === undefined
      ? Object.keys(SOURCE_DAILY_REQUEST_BUDGETS).sort()
      : [values.source];

  for (const sourceId of sourceIds) {
    const state = await store.readState(sourceId, now);

    console.log("");
    log(sourceId, state.control?.status ?? "enabled (sin control)");
    log(
      "  tope declarado",
      state.declaredLimit ?? "— (fuente sin presupuesto)",
    );
    log("  tope vigente", state.effectiveLimit ?? "—");
    log(
      "  consumo de hoy",
      state.control?.status === "disabled"
        ? `${state.used} (la fuente está frenada)`
        : state.effectiveLimit === null
          ? `${state.used} (fuente sin presupuesto)`
          : `${state.used} / ${state.effectiveLimit}`,
    );

    if (state.control !== null) {
      log(
        "  control vigente",
        `${state.control.actor} ${state.control.recordedAt}: ${state.control.reason}`,
      );
    }

    const usage = await store.listUsage({ sourceId, fromDay, toDay: today });

    for (const day of usage) {
      log(
        `  ${day.day}`,
        `${day.requests} requests (hasta ${day.lastRequestAt})`,
      );
    }

    if (values.source !== undefined) {
      const history = await store.listControlHistory(sourceId);

      for (const control of history) {
        log(
          `  ${control.recordedAt}`,
          `${control.status} límite ${control.dailyRequestLimit ?? "—"} · ${control.actor}: ${control.reason}`,
        );
      }
    }
  }

  process.exit(0);
}

if (actions > 1) {
  fail("Elegí una sola acción: --disable, --enable o --limit.");
}

if (values.source === undefined) {
  fail("Una acción necesita --source.");
}

const sourceId = values.source;
const reason = (values.reason ?? "").trim();

if (reason.length < 3) {
  fail("La acción exige --reason con al menos tres caracteres.");
}

const declared = declaredDailyBudget(sourceId);

if (declared === null) {
  fail(
    `${sourceId} no tiene presupuesto diario declarado: agregalo a SOURCE_DAILY_REQUEST_BUDGETS antes de operarlo.`,
  );
}

let dailyRequestLimit: number | null = null;

if (values.limit !== undefined) {
  const parsed = Number(values.limit);

  if (!Number.isInteger(parsed) || parsed < 0) {
    fail("--limit necesita un entero mayor o igual que cero.");
  }

  if (parsed > declared) {
    fail(
      `--limit ${parsed} supera el tope declarado de ${declared}: subirlo es un cambio de código revisable.`,
    );
  }

  dailyRequestLimit = parsed;
}

const current = await store.readState(sourceId, now);
const status = values.disable ? "disabled" : "enabled";

console.log("");
log("fuente", sourceId);
log("estado actual", current.control?.status ?? "enabled (sin control)");
log("tope actual", current.effectiveLimit ?? "—");
log("estado nuevo", status);
log("tope nuevo", dailyRequestLimit ?? `${declared} (el declarado)`);
log("motivo", reason);

if (DRY_RUN) {
  console.log("\nDry run: no se cambió nada. Usá --apply para aplicarlo.");
  process.exit(0);
}

const control = await store.setControl({
  controlId: randomUUID(),
  sourceId,
  status,
  dailyRequestLimit,
  reason,
  actor: "owner",
  now,
});

console.log("");
log("control", control.controlId);
log("vigente desde", control.recordedAt);
