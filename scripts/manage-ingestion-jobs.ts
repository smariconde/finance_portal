import { parseArgs } from "node:util";

import { ingestionJobReasonSchema } from "@/modules/ingestion/domain/ingestion-job";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { getIngestionJobStore } from "@/server/persistence/get-ingestion-job-store";

/**
 * Inspección y recuperación manual de jobs de ingesta (ADR 0015).
 *
 *   pnpm ingestion:jobs                                   # jobs recientes y leases
 *   pnpm ingestion:jobs --job <id>                        # detalle, items con problemas y bitácora
 *   pnpm ingestion:jobs --job <id> --pause --reason "…"   # dry run; --apply para pausar
 *   pnpm ingestion:jobs --job <id> --resume --reason "…" --apply
 *   pnpm ingestion:jobs --job <id> --cancel --reason "…" --apply
 *   pnpm ingestion:jobs --job <id> --requeue 17 --reason "…" --apply
 *   pnpm ingestion:jobs --release sec-edgar --reason "…" --apply
 *
 * Toda acción exige un motivo, que queda redactado en la bitácora con actor
 * `owner`. `--release` declara muerto al holder sin esperar a que venza: si el
 * proceso seguía vivo, su próxima escritura falla y su intento se repite.
 */
const { values } = parseArgs({
  options: {
    job: { type: "string" },
    pause: { type: "boolean", default: false },
    resume: { type: "boolean", default: false },
    cancel: { type: "boolean", default: false },
    requeue: { type: "string" },
    release: { type: "string" },
    reason: { type: "string" },
    events: { type: "string", default: "20" },
    apply: { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;
const store = getIngestionJobStore();

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(28)} ${String(value)}`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const actions = [
  values.pause && "pause",
  values.resume && "resume",
  values.cancel && "cancel",
  values.requeue !== undefined && "requeue",
  values.release !== undefined && "release",
].filter((action): action is string => typeof action === "string");

if (actions.length > 1) {
  fail(`Una acción por vez: ${actions.join(", ")}.`);
}

const action = actions[0] ?? null;
const now = new Date().toISOString();

function requireReason(): string {
  const parsed = ingestionJobReasonSchema.safeParse(values.reason ?? "");

  if (!parsed.success) {
    fail("La acción exige --reason con al menos tres caracteres.");
  }

  return parsed.data;
}

if (action === "release") {
  const reason = requireReason();
  const lease = await store.getLease(values.release!);

  log("fuente", values.release);
  log(
    "lease",
    lease === null
      ? "libre"
      : `${lease.holder} (job ${lease.jobId}) vence ${lease.expiresAt}`,
  );

  if (DRY_RUN) {
    console.log("\nDry run: no se liberó nada. Usá --apply para liberar.");
    process.exit(0);
  }

  const forced = await store.forceReleaseLease(values.release!, {
    now,
    reason,
  });
  log(
    "liberado",
    forced.released === null ? "no había lease" : forced.released.holder,
  );

  for (const item of forced.recovered) {
    log(`  recuperado ${item.ordinal}`, `${item.subjectKey} → ${item.status}`);
  }

  process.exit(0);
}

if (values.job === undefined) {
  if (action !== null) {
    fail("La acción necesita --job.");
  }

  for (const job of await store.listJobs({ limit: 20 })) {
    const counts = await store.countItems(job.jobId);
    log(
      job.jobId,
      `${job.kind} ${job.status} ${job.cursor}/${job.itemCount} · completos ${counts.completed}, fallados ${counts.failed}, envenenados ${counts.poisoned} · ${job.createdAt}`,
    );
  }

  for (const entry of DEMO_SOURCE_REGISTRY) {
    const lease = await store.getLease(entry.sourceId);

    if (lease !== null) {
      log(
        `lease ${entry.sourceId}`,
        `${lease.holder} (job ${lease.jobId}) vence ${lease.expiresAt}`,
      );
    }
  }

  process.exit(0);
}

if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
    values.job,
  )
) {
  fail(`--job tiene que ser el UUID de un job: ${values.job}`);
}

const job = await store.getJob(values.job);

if (job === null) {
  fail(`No existe el job ${values.job}.`);
}

const counts = await store.countItems(job.jobId);
const lease = await store.getLease(job.sourceId);

log("job", `${job.jobId} ${job.kind}`);
log(
  "estado",
  `${job.status}${job.statusReason ? ` (${job.statusReason})` : ""}`,
);
log("fuente", `${job.sourceId} · ${job.datasetId}`);
log("versiones", `${job.parserVersion} · ${job.selectionVersion ?? "—"}`);
log("cursor", `${job.cursor}/${job.itemCount}`);
log(
  "items",
  Object.entries(counts)
    .map(([status, total]) => `${status} ${total}`)
    .join(", "),
);
log("espera de la fuente", job.notBefore ?? "—");
log(
  "lease de la fuente",
  lease === null
    ? "libre"
    : `${lease.holder} (job ${lease.jobId}) vence ${lease.expiresAt}`,
);

if (action === null) {
  const troubled = await store.listItems({
    jobId: job.jobId,
    statuses: ["failed", "poisoned", "running"],
    limit: 50,
  });

  for (const item of troubled) {
    log(
      `  ${item.status} ${item.ordinal}`,
      `${item.subjectKey} · ${item.attempts} intentos · ${item.lastFailure?.code ?? "—"}: ${item.lastFailure?.message ?? ""}`,
    );
  }

  console.log("");

  for (const event of await store.listEvents({
    jobId: job.jobId,
    limit: Number.parseInt(values.events, 10) || 20,
  })) {
    console.log(
      `${String(event.sequence).padStart(6)} ${event.occurredAt} ${event.eventType.padEnd(22)} ${event.ordinal ?? ""} ${event.actor} ${JSON.stringify(event.detail)}`,
    );
  }

  process.exit(0);
}

const reason = requireReason();

if (DRY_RUN) {
  console.log(`\nDry run: ${action} no se aplicó. Usá --apply para aplicarlo.`);
  process.exit(0);
}

switch (action) {
  case "pause":
    log("pausado", (await store.pauseJob(job.jobId, { now, reason })).status);
    break;
  case "resume":
    log(
      "reanudado",
      (await store.resumeJob(job.jobId, { now, reason })).status,
    );
    break;
  case "cancel":
    log(
      "cancelado",
      (await store.cancelJob(job.jobId, { now, reason })).status,
    );
    break;
  case "requeue": {
    const ordinal = Number.parseInt(values.requeue!, 10);

    if (!(ordinal >= 0)) {
      fail("--requeue necesita el ordinal del item.");
    }

    const requeued = await store.requeueItem(job.jobId, ordinal, {
      now,
      reason,
    });
    log(
      "reencolado",
      `${requeued.item.subjectKey} · cursor ${requeued.job.cursor}`,
    );
    break;
  }
}

process.exit(0);
