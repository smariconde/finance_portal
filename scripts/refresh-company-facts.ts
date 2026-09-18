import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import {
  assertCompanyFactsRefreshJob,
  buildCompanyFactsRefreshJobPlan,
  createCompanyFactsRefreshAdmission,
  createCompanyFactsRefreshJobExecutor,
  MAX_REQUESTS_PER_REFRESH_ITEM,
} from "@/modules/fundamentals/application/company-facts-refresh-job";
import { observeSourceSignals } from "@/modules/fundamentals/application/company-facts-backfill";
import {
  COMPANY_FACTS_DATASET_ID,
  ingestCompanyFacts,
} from "@/modules/fundamentals/application/ingest-company-facts";
import {
  createLiveCompanyFactsSource,
  SEC_SOURCE_ID,
} from "@/modules/fundamentals/application/live-company-facts-source";
import { refreshCompanyFacts } from "@/modules/fundamentals/application/refresh-company-facts";
import { planCompanyFactsRefresh } from "@/modules/fundamentals/domain/plan-company-facts-refresh";
import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import {
  createPacedEgressFetch,
  SEC_REQUEST_PACING,
} from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { runIngestionJob } from "@/modules/ingestion/application/run-ingestion-job";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { INGESTION_JOB_POLICY } from "@/modules/ingestion/domain/ingestion-job";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import {
  getMeteredEgressFetch,
  getSourceEgressFetch,
} from "@/server/egress/get-source-egress-fetch";
import { getIngestionJobStore } from "@/server/persistence/get-ingestion-job-store";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getObservationRepository } from "@/server/persistence/get-observation-repository";
import { getRefreshStateStore } from "@/server/persistence/get-refresh-state-store";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceDocumentRepository } from "@/server/persistence/get-source-document-repository";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Refresh de fundamentals del conjunto seguido (ADR 0021).
 *
 *   pnpm fundamentals:refresh                       # el conjunto y sus marcas, sin red
 *   pnpm fundamentals:refresh --cik 320193          # sondea ese filer y dice qué haría
 *   pnpm fundamentals:refresh --cik 320193 --apply  # lo refresca si hay algo nuevo
 *   pnpm fundamentals:refresh --all --apply         # crea (o encuentra) el job de la vuelta
 *   pnpm fundamentals:refresh --job <id>            # estado del job, sin tomar la fuente
 *   pnpm fundamentals:refresh --job <id> --apply    # lo corre bajo el lease; --limit lo acota
 *
 * Sin `--cik` ni `--job` no sale una sola llamada: el conjunto seguido son los
 * filers con fundamentals publicados, y eso lo contesta PostgreSQL. Cada filer
 * cuesta **un** request —el índice de presentaciones— y sólo baja companyfacts el
 * que presentó algo nuevo desde la última vuelta.
 *
 * Correr el job toma el lease de `sec-edgar`: un segundo proceso no corre a la
 * vez, y uno que muere deja su filer para el próximo cuando el lease vence.
 * Ctrl-C una vez termina el filer en curso y suelta el lease.
 *
 * Es un comando manual y no un refresh programado: no hay cron.
 */
const { values } = parseArgs({
  options: {
    cik: { type: "string", multiple: true, default: [] },
    all: { type: "boolean", default: false },
    job: { type: "string" },
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

if (values.cik.length > 0 && (values.all || values.job !== undefined)) {
  fail("--cik no se combina con --all ni con --job.");
}

const store = getIngestionJobStore();
const universe = await getUniverseRepository().loadState({
  indexId: SP500_INDEX_ID,
});
const published = await getObservationRepository().listPublishedSubjects({
  sourceId: SEC_SOURCE_ID,
  datasetId: COMPANY_FACTS_DATASET_ID,
});
const plan = planCompanyFactsRefresh({ published, graph: universe.graph });
const refreshState = getRefreshStateStore();
const marks = new Map(
  (
    await refreshState.list({
      sourceId: SEC_SOURCE_ID,
      datasetId: COMPANY_FACTS_DATASET_ID,
    })
  ).map((state) => [state.subjectKey, state]),
);

const names = new Map(
  universe.graph.legalEntities.map((entity) => [
    entity.legalEntityId,
    entity.legalName,
  ]),
);
const labels = new Map(
  plan.subjects.map((subject) => [
    subject.cik,
    subject.symbols.join("/") ||
      names.get(subject.legalEntityId) ||
      subject.cik,
  ]),
);
const requested = values.cik.map((cik) => cik.trim().padStart(10, "0"));
const unknown = requested.filter(
  (cik) => !plan.subjects.some((subject) => subject.cik === cik),
);

if (unknown.length > 0) {
  fail(`Estos CIK no tienen fundamentals publicados: ${unknown.join(", ")}.`);
}

if (values.job === undefined) {
  log("plan", plan.planVersion);
  log("fuente / dataset", `${SEC_SOURCE_ID} / ${COMPANY_FACTS_DATASET_ID}`);
  log("sujetos publicados", plan.published);
  log("filers seguidos", plan.subjects.length);
  log("con marca de agua", marks.size);

  for (const rejection of plan.rejections) {
    log(`  rechazo ${rejection.code}`, rejection.subjectId);
  }
}

// ---------------------------------------------------------------- el conjunto
if (values.job === undefined && requested.length === 0 && !values.all) {
  log("una vuelta de sondeo", `${plan.subjects.length} requests`);
  log(
    "peor caso si todos cambiaron",
    `${plan.subjects.length * MAX_REQUESTS_PER_REFRESH_ITEM} requests`,
  );
  console.log("");

  for (const subject of plan.subjects) {
    const mark = marks.get(subject.cik);

    console.log(
      [
        `  ${subject.cik}`,
        (subject.symbols.join("/") || "sin símbolo vigente").padEnd(20),
        `${String(subject.observations).padStart(6)} filas`,
        mark === undefined
          ? "sin sondear             "
          : `mirado ${mark.lastCheckedAt.slice(0, 10)}      `,
        mark === undefined
          ? `última publicación ${subject.latestAvailableAt.slice(0, 10)}`
          : `marca ${mark.watermarkAcceptedAt.slice(0, 10)} ${mark.watermarkAccession}`,
        names.get(subject.legalEntityId) ?? "",
      ].join("  "),
    );
  }

  if (plan.subjects.length === 0) {
    console.log(
      "  El conjunto está vacío: todavía no hay fundamentals publicados.",
    );
  }

  console.log(
    "\nPasá --cik para sondear un filer o --all --apply para planear la vuelta completa.",
  );
  process.exit(0);
}

// ------------------------------------------------------------- el job: planear
if (values.all) {
  if (plan.subjects.length === 0) {
    fail("El conjunto está vacío: no hay nada que refrescar.");
  }

  log("items", plan.subjects.length);
  log(
    "peor caso de requests",
    plan.subjects.length * MAX_REQUESTS_PER_REFRESH_ITEM,
  );

  if (DRY_RUN) {
    console.log("\nDry run: no se creó ningún job. Usá --apply para crearlo.");
    process.exit(0);
  }

  const creation = await store.createJob(
    buildCompanyFactsRefreshJobPlan(plan.subjects),
    { now: new Date().toISOString() },
  );

  console.log("");
  log(creation.created ? "job creado" : "job ya abierto", creation.job.jobId);
  log("items", creation.job.itemCount);
  log("cursor", creation.job.cursor);
  console.log(
    `\nCorrelo con: pnpm fundamentals:refresh --job ${creation.job.jobId} --apply`,
  );
  process.exit(0);
}

// ----------------------------------------------- red: la cuota del día primero
const budgetVerdict = await checkSourceBudget(
  getSourceBudgetStore(),
  SEC_SOURCE_ID,
  1,
  new Date().toISOString(),
);

if (budgetVerdict.status !== "allowed") {
  fail(describeSourceRefusal(SEC_SOURCE_ID, budgetVerdict));
}

const registry = getSourceRegistryRepository();
const identity = createGraphIdentityResolver(() => universe.graph);
const ingestionRuns = getIngestionRunRepository();
const now = () => new Date().toISOString();
const newId = () => randomUUID();

function buildDependencies(fetch: ReturnType<typeof getSourceEgressFetch>) {
  const source = createLiveCompanyFactsSource({ fetch });

  return {
    sourceRegistry: registry,
    ingestionRuns,
    refreshState,
    probeSource: source,
    ingest: (cik: string) =>
      ingestCompanyFacts(
        { cik, mode: "personal" as const, dryRun: false },
        {
          sourceRegistry: registry,
          ingestionRuns,
          sourceDocuments: getSourceDocumentRepository(),
          observations: getObservationRepository(),
          identity,
          source,
          now,
          newId,
        },
      ),
    now,
    newId,
  };
}

// --------------------------------------------------------- un filer a la vez
if (values.job === undefined) {
  await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

  const paced = getSourceEgressFetch(SEC_REQUEST_PACING);
  const dependencies = buildDependencies(paced);

  for (const cik of requested) {
    const startedAt = performance.now();
    const outcome = await refreshCompanyFacts(
      { cik, mode: "personal", dryRun: DRY_RUN },
      dependencies,
    );

    console.log("");
    log(labels.get(cik) ?? cik, `CIK ${cik}`);
    log("  sondeo", `${outcome.probeRun.status} ${outcome.probeRun.runId}`);

    if (outcome.probeRun.failure !== null) {
      log(
        "  falla",
        `${outcome.probeRun.failure.code}: ${outcome.probeRun.failure.message}`,
      );
    }

    log("  flags", outcome.probeRun.qualityFlags.join(", ") || "—");
    log(
      "  marca anterior",
      outcome.previous === null
        ? "—"
        : `${outcome.previous.acceptedAt} ${outcome.previous.accessionNumber}`,
    );

    if (outcome.decision !== null) {
      log("  veredicto", outcome.decision.reason);
      log("  presentaciones relevantes", outcome.decision.relevant);
      log("  nuevas", outcome.decision.newFilings.length);

      for (const filing of outcome.decision.newFilings.slice(-5)) {
        log(
          `    ${filing.form}`,
          `${filing.accessionNumber} aceptada ${filing.acceptedAt}`,
        );
      }

      if (outcome.decision.withoutAcceptance > 0) {
        log("  sin aceptación", outcome.decision.withoutAcceptance);
      }
    }

    if (outcome.ingestion !== null) {
      log(
        "  companyfacts",
        `${outcome.ingestion.run.status} ${outcome.ingestion.run.runId}`,
      );
      log("  publicadas", outcome.ingestion.publication?.published ?? 0);
      log("  duplicadas", outcome.ingestion.publication?.duplicates ?? 0);

      if (outcome.ingestion.window?.window != null) {
        log("  ancla de la ventana", outcome.ingestion.window.window.anchorOn);
      }
    }

    log(
      "  marca nueva",
      outcome.state === null
        ? "sin cambios"
        : `${outcome.state.watermarkAcceptedAt} ${outcome.state.watermarkAccession}`,
    );
    log("  segundos", ((performance.now() - startedAt) / 1000).toFixed(1));
  }

  console.log("");
  log("requests a la SEC", paced.requestCount());

  if (DRY_RUN) {
    console.log(
      "\nDry run: se sondeó, no se escribió nada y no se bajó companyfacts. " +
        "Usá --apply para refrescar.",
    );
  }

  process.exit(0);
}

// ----------------------------------------------------------- el job: correrlo
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
  assertCompanyFactsRefreshJob(job);
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

await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

// El observador va entre el ritmo y el contador: una negativa del presupuesto
// diario no es una señal de la SEC (ADR 0020).
const signals = observeSourceSignals(getMeteredEgressFetch());
const jobFetch = createPacedEgressFetch(signals.fetch, SEC_REQUEST_PACING, {
  elapsedMs: () => performance.now(),
  sleep: (ms) => sleep(ms),
});
const dependencies = buildDependencies(jobFetch);

let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) {
    console.error("\nSegunda interrupción: salgo sin soltar el lease.");
    process.exit(130);
  }

  interrupted = true;
  console.error("\nInterrumpido: termino el filer en curso y suelto el lease.");
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
    execute: createCompanyFactsRefreshJobExecutor({
      refresh: (cik) =>
        refreshCompanyFacts(
          { cik, mode: "personal", dryRun: false },
          dependencies,
        ),
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
    admitItem: createCompanyFactsRefreshAdmission({
      fetch: jobFetch,
      pacing: SEC_REQUEST_PACING,
      budgets: getSourceBudgetStore(),
      now: () => new Date().toISOString(),
    }),
    shouldStop: () => interrupted,
    onAttempt: (attempt) => {
      const at = performance.now();
      const decision =
        attempt.decision.kind === "complete"
          ? "completo"
          : `${attempt.decision.kind}: ${attempt.decision.failure.message}`;

      console.log(
        `${String(attempt.ordinal).padStart(4)}/${job.itemCount} ${attempt.subjectKey} ${(labels.get(attempt.subjectKey) ?? "").padEnd(12)} intento ${attempt.attempt} ${decision} (${((at - lastAttemptAt) / 1000).toFixed(1)} s, ${jobFetch.requestCount()} req)`,
      );
      lastAttemptAt = at;
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
log("requests a la SEC", jobFetch.requestCount());
log("segundos", ((performance.now() - startedAt) / 1000).toFixed(1));
console.log("");
await describeJob(job.jobId);
log(
  "lease de la fuente",
  (await store.getLease(job.sourceId)) === null ? "libre" : "tomado",
);

const refreshed = await refreshState.list({
  sourceId: SEC_SOURCE_ID,
  datasetId: COMPANY_FACTS_DATASET_ID,
});

log("filers con marca", refreshed.length);

process.exit(0);
