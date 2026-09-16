import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import {
  assertCompanyFactsJob,
  buildCompanyFactsJobPlan,
  createCompanyFactsJobExecutor,
  hasBudgetForCompanyFactsLoad,
  observeSourceSignals,
} from "@/modules/fundamentals/application/company-facts-backfill";
import { ingestCompanyFacts } from "@/modules/fundamentals/application/ingest-company-facts";
import {
  createLiveCompanyFactsSource,
  MAX_REQUESTS_PER_COMPANY_FACTS_LOAD,
  SEC_SOURCE_ID,
} from "@/modules/fundamentals/application/live-company-facts-source";
import { planCompanyFactsBackfill } from "@/modules/fundamentals/domain/plan-company-facts-backfill";
import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import {
  createPacedEgressFetch,
  SEC_REQUEST_PACING,
  type EgressFetch,
} from "@/modules/ingestion/application/egress-fetch";
import { runIngestionJob } from "@/modules/ingestion/application/run-ingestion-job";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { INGESTION_JOB_POLICY } from "@/modules/ingestion/domain/ingestion-job";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { getEgressClient } from "@/server/egress/get-egress-client";
import { getCorporateActionRepository } from "@/server/persistence/get-corporate-action-repository";
import { getIngestionJobStore } from "@/server/persistence/get-ingestion-job-store";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getObservationRepository } from "@/server/persistence/get-observation-repository";
import { getSourceDocumentRepository } from "@/server/persistence/get-source-document-repository";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Backfill durable de companyfacts sobre el universo constituido (ADR 0015).
 *
 *   pnpm fundamentals:backfill                         # plan: sin red ni escritura
 *   pnpm fundamentals:backfill --apply                 # crea o encuentra el job del plan
 *   pnpm fundamentals:backfill --cik 320193 --apply    # job acotado a filers del plan
 *   pnpm fundamentals:backfill --job <id>              # estado y próximo item, sin tomar la fuente
 *   pnpm fundamentals:backfill --job <id> --apply      # corre el job
 *   pnpm fundamentals:backfill --job <id> --apply --limit 20
 *
 * Correr toma el lease de `sec-edgar`: un segundo proceso no corre a la vez, y uno
 * que muere deja su empresa para el próximo cuando el lease vence. Ctrl-C una vez
 * termina la empresa en curso y suelta el lease; dos veces, sale ya y el lease
 * vence solo (o se libera con `pnpm ingestion:jobs --release`).
 *
 * Es un job manual y no un refresh programado: no hay cron.
 */
const { values } = parseArgs({
  options: {
    job: { type: "string" },
    cik: { type: "string", multiple: true, default: [] },
    limit: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(28)} ${String(value)}`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const store = getIngestionJobStore();
const universe = await getUniverseRepository().loadState({
  indexId: SP500_INDEX_ID,
});
const relationships = await getCorporateActionRepository().listRelationships();
const plannedAt = new Date().toISOString();
const plan = planCompanyFactsBackfill({
  graph: universe.graph,
  memberships: universe.memberships,
  relationships,
  indexId: SP500_INDEX_ID,
  cutoff: pointInTimeQuerySchema.parse({
    effectiveAt: plannedAt,
    revisionPolicy: "as_known",
    knownAt: plannedAt,
    sourcePolicyVersion: "source-policy-1.0.0",
  }),
});
const names = new Map(
  universe.graph.legalEntities.map((entity) => [
    entity.legalEntityId,
    entity.legalName,
  ]),
);
const labels = new Map(
  plan.subjects.map((subject) => [
    subject.cik,
    subject.symbols.length > 0
      ? subject.symbols.join("/")
      : `antecesor de ${names.get(subject.successorLegalEntityId ?? "") ?? "?"}`,
  ]),
);

if (values.job === undefined) {
  const requested = values.cik.map((cik) => cik.trim().padStart(10, "0"));
  const unknown = requested.filter(
    (cik) => !plan.subjects.some((subject) => subject.cik === cik),
  );

  if (unknown.length > 0) {
    fail(`Estos CIK no están en el plan del universo: ${unknown.join(", ")}.`);
  }

  const subjects =
    requested.length === 0
      ? plan.subjects
      : plan.subjects.filter((subject) => requested.includes(subject.cik));

  log("plan", plan.planVersion);
  log("miembros del índice", plan.members);
  log("filers", subjects.length);
  log(
    "antecesores de reporte",
    subjects.filter((subject) => subject.role === "reporting_predecessor")
      .length,
  );
  log(
    "peor caso de requests",
    subjects.length * MAX_REQUESTS_PER_COMPANY_FACTS_LOAD,
  );

  for (const rejection of plan.rejections) {
    log(`  rechazo ${rejection.code}`, rejection.subjectId);
  }

  for (const subject of subjects.slice(0, 5)) {
    log(`  ${subject.cik}`, labels.get(subject.cik));
  }

  if (subjects.length > 5) {
    log("  …", `${subjects.length - 5} más`);
  }

  if (subjects.length === 0) {
    fail("El plan está vacío: no hay nada que crear.");
  }

  if (DRY_RUN) {
    console.log("\nDry run: no se creó ningún job. Usá --apply para crearlo.");
    process.exit(0);
  }

  const creation = await store.createJob(buildCompanyFactsJobPlan(subjects), {
    now: new Date().toISOString(),
  });

  console.log("");
  log(creation.created ? "job creado" : "job ya abierto", creation.job.jobId);
  log("items", creation.job.itemCount);
  log("cursor", creation.job.cursor);
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

try {
  assertCompanyFactsJob(job);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const describeJob = async (jobId: string) => {
  const current = (await store.getJob(jobId))!;
  const counts = await store.countItems(jobId);

  log("job", `${current.jobId} ${current.status}`);
  log("cursor", `${current.cursor}/${current.itemCount}`);
  log(
    "items",
    Object.entries(counts)
      .map(([status, total]) => `${status} ${total}`)
      .join(", "),
  );
  log("espera de la fuente", current.notBefore ?? "—");

  return current;
};

console.log("");
await describeJob(job.jobId);
const lease = await store.getLease(job.sourceId);
log(
  "lease de la fuente",
  lease === null
    ? "libre"
    : `${lease.holder} (job ${lease.jobId}) vence ${lease.expiresAt}`,
);

if (DRY_RUN) {
  const next = await store.peekNext(job.jobId);
  log(
    "próximo item",
    next.item === null
      ? "—"
      : `${next.item.ordinal} ${next.item.subjectKey} ${labels.get(next.item.subjectKey) ?? ""}`,
  );
  console.log(
    "\nDry run: no se tomó la fuente. Usá --apply para correr el job.",
  );
  process.exit(0);
}

const attemptLimit =
  values.limit === undefined ? undefined : Number.parseInt(values.limit, 10);

if (attemptLimit !== undefined && !(attemptLimit > 0)) {
  fail("--limit tiene que ser un entero positivo.");
}

const registry = getSourceRegistryRepository();
await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

const egress = getEgressClient();
// Debajo del espaciador: lo que ve el observador es la fuente, no el presupuesto.
const signals = observeSourceSignals((async (request) => {
  const response = await egress(request);

  return {
    status: response.status,
    body: response.body,
    byteLength: response.byteLength,
    fetchedAt: response.fetchedAt,
    retryAfter: response.retryAfter,
  };
}) satisfies EgressFetch);
const paced = createPacedEgressFetch(signals.fetch, SEC_REQUEST_PACING, {
  elapsedMs: () => performance.now(),
  sleep: (ms) => sleep(ms),
});
const identity = createGraphIdentityResolver(() => universe.graph);
const ingestion = {
  sourceRegistry: registry,
  ingestionRuns: getIngestionRunRepository(),
  sourceDocuments: getSourceDocumentRepository(),
  observations: getObservationRepository(),
  identity,
  source: createLiveCompanyFactsSource({ fetch: paced }),
  now: () => new Date().toISOString(),
  newId: () => randomUUID(),
};

let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) {
    console.error("\nSegunda interrupción: salgo sin soltar el lease.");
    process.exit(130);
  }

  interrupted = true;
  console.error(
    "\nInterrumpido: termino la empresa en curso y suelto el lease.",
  );
});

const holder = `${hostname().replace(/[^A-Za-z0-9.-]/gu, "-")}/${process.pid}/${randomUUID().slice(0, 8)}`;
const startedAt = performance.now();
let lastAttemptAt = startedAt;

console.log("");
log("holder", holder);
log("ttl del lease", `${INGESTION_JOB_POLICY.leaseTtlMs / 1000} s`);

const result = await runIngestionJob(
  { jobId: job.jobId, holder, attemptLimit },
  {
    store,
    execute: createCompanyFactsJobExecutor({
      ingest: (cik) =>
        ingestCompanyFacts({ cik, mode: "personal", dryRun: false }, ingestion),
      takeSignal: signals.take,
    }),
    now: () => new Date().toISOString(),
    sleep: (ms) => sleep(ms),
    newLeaseToken: () => randomUUID(),
    startHeartbeat: (beat, intervalMs) => {
      const timer = setInterval(() => void beat(), intervalMs);
      timer.unref();
      return () => clearInterval(timer);
    },
    canStartItem: () => hasBudgetForCompanyFactsLoad(paced, SEC_REQUEST_PACING),
    shouldStop: () => interrupted,
    onAttempt: (attempt) => {
      const now = performance.now();
      const decision =
        attempt.decision.kind === "complete"
          ? "completo"
          : `${attempt.decision.kind}: ${attempt.decision.failure.message}`;

      console.log(
        `${String(attempt.ordinal).padStart(4)}/${job.itemCount} ${attempt.subjectKey} ${(labels.get(attempt.subjectKey) ?? "").padEnd(12)} intento ${attempt.attempt} ${decision} (${((now - lastAttemptAt) / 1000).toFixed(1)} s, ${paced.requestCount()} req)`,
      );
      lastAttemptAt = now;
    },
  },
);

console.log("");
log("parada", result.stopReason);

if (result.busyLease !== null) {
  log(
    "fuente ocupada por",
    `${result.busyLease.holder} hasta ${result.busyLease.expiresAt}`,
  );
}

if (result.takenOver !== null) {
  log(
    "lease vencido tomado de",
    `${result.takenOver.holder} (venció ${result.takenOver.expiresAt})`,
  );
}

for (const item of result.recovered) {
  log(`  recuperado ${item.ordinal}`, `${item.subjectKey} → ${item.status}`);
}

const byDecision = new Map<string, number>();
for (const attempt of result.attempts) {
  byDecision.set(
    attempt.decision.kind,
    (byDecision.get(attempt.decision.kind) ?? 0) + 1,
  );
}
for (const [kind, total] of byDecision) {
  log(`  intentos ${kind}`, total);
}

log("espera hasta", result.waitUntil ?? "—");
log("latidos fallidos", result.heartbeatFailures);
log("requests a la SEC", paced.requestCount());
log("segundos", ((performance.now() - startedAt) / 1000).toFixed(1));
console.log("");
await describeJob(job.jobId);
log(
  "lease de la fuente",
  (await store.getLease(job.sourceId)) === null ? "libre" : "tomado",
);
log("fuente", SEC_SOURCE_ID);

process.exit(0);
