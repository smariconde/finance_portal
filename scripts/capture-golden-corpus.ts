import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import {
  buildCompanyFactsUrl,
  buildSubmissionsUrl,
  SEC_SOURCE_ID,
} from "@/modules/fundamentals/application/live-company-facts-source";
import { COMPANY_FACTS_DATASET_ID } from "@/modules/fundamentals/application/ingest-company-facts";
import {
  parseJsonPreservingNumbers,
  stringifyJsonPreservingNumbers,
} from "@/modules/fundamentals/domain/exact-json";
import { planCompanyFactsRefresh } from "@/modules/fundamentals/domain/plan-company-facts-refresh";
import {
  reduceSecCompanyFacts,
  reduceSecSubmissions,
  SEC_CORPUS_REDUCER_VERSION,
} from "@/modules/fundamentals/domain/reduce-sec-corpus";
import {
  GOLDEN_CORPUS_MANIFEST_PATH,
  goldenCorpusManifestSchema,
  loadGoldenCorpusManifest,
  sha256Hex,
  type GoldenCorpusEntry,
} from "@/modules/fundamentals/infrastructure/golden-sec-corpus";
import { SEC_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getObservationRepository } from "@/server/persistence/get-observation-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Captura del corpus congelado que sirve de oráculo de regresión (`F2-06`).
 *
 *   pnpm fixtures:capture                       # el conjunto y lo que pesaría, sin red
 *   pnpm fixtures:capture --cik 320193          # baja ese filer y dice qué escribiría
 *   pnpm fixtures:capture --apply               # baja el conjunto seguido y lo congela
 *
 * Dos requests por filer —submissions y companyfacts— y ninguno más: el corpus no
 * necesita los archivos históricos del índice, que son de la ingesta.
 *
 * Es un comando manual, se corre pocas veces y su salida entra al repositorio por
 * un diff. La descarga pasa por el mismo egress medido que una ingesta: el Fair
 * Access de la SEC es sobre el ritmo y no distingue para qué se baja.
 *
 * El derecho a conservar lo descargado es el que la [ADR 0023] revisó, así que
 * este comando lo pide explícitamente: si alguien lo devolviera a `unknown`, el
 * comando se niega antes de abrir un socket.
 */
const { values } = parseArgs({
  options: {
    cik: { type: "string", multiple: true, default: [] },
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

function formatBytes(bytes: number): string {
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} kB`;
}

// ------------------------------------------------------------------- derechos
const declared = DEMO_SOURCE_REGISTRY.find(
  (entry) => entry.sourceId === SEC_SOURCE_ID,
);

if (declared === undefined) {
  fail(`${SEC_SOURCE_ID} no está en el registro declarado.`);
}

const rights = evaluateIngestionRights(declared, {
  // Lo que distingue a este comando de una ingesta: lo descargado se conserva.
  storesRawPayload: true,
  storesNormalizedValues: false,
  publicDisplay: false,
});

if (!rights.allowed) {
  fail(
    `Congelar extractos de ${SEC_SOURCE_ID} necesita derechos que la fuente no declara: ${rights.blockedBy.join(", ")} (ADR 0023).`,
  );
}

// ------------------------------------------------------------------- el plan
const universe = await getUniverseRepository().loadState({
  indexId: SP500_INDEX_ID,
});
const published = await getObservationRepository().listPublishedSubjects({
  sourceId: SEC_SOURCE_ID,
  datasetId: COMPANY_FACTS_DATASET_ID,
});
const plan = planCompanyFactsRefresh({ published, graph: universe.graph });
const requested = values.cik.map((cik) => cik.trim().padStart(10, "0"));
const unknown = requested.filter(
  (cik) => !plan.subjects.some((subject) => subject.cik === cik),
);

if (unknown.length > 0) {
  fail(`Estos CIK no tienen fundamentals publicados: ${unknown.join(", ")}.`);
}

const subjects =
  requested.length > 0
    ? plan.subjects.filter((subject) => requested.includes(subject.cik))
    : plan.subjects;

if (subjects.length === 0) {
  fail("El conjunto está vacío: todavía no hay fundamentals publicados.");
}

log("reductor", SEC_CORPUS_REDUCER_VERSION);
log("fuente", SEC_SOURCE_ID);
log("filers", subjects.length);
log("requests", subjects.length * 2);
log("modo", DRY_RUN ? "dry run: no escribe nada" : "apply: congela el corpus");
console.log("");

// -------------------------------------------------------------- presupuesto
const budget = await checkSourceBudget(
  getSourceBudgetStore(),
  SEC_SOURCE_ID,
  subjects.length * 2,
  new Date().toISOString(),
);

if (budget.status !== "allowed") {
  fail(describeSourceRefusal(SEC_SOURCE_ID, budget));
}

await syncDeclaredSourceRegistry(
  DEMO_SOURCE_REGISTRY,
  getSourceRegistryRepository(),
);

const fetch = getSourceEgressFetch(SEC_REQUEST_PACING);
const decoder = new TextDecoder("utf-8", { fatal: true });

async function download(url: string): Promise<{
  readonly text: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly fetchedAt: string;
}> {
  const response = await fetch({
    sourceId: SEC_SOURCE_ID,
    url,
    accept: "application/json",
  });

  if (response.status !== 200) {
    fail(`${url} devolvió ${response.status}.`);
  }

  return {
    text: decoder.decode(response.body),
    bytes: response.byteLength,
    sha256: sha256Hex(response.body),
    fetchedAt: response.fetchedAt,
  };
}

// ------------------------------------------------------------------ captura
const entries: GoldenCorpusEntry[] = [];
const files = new Map<string, string>();

for (const subject of subjects) {
  const label = subject.symbols.join("/") || subject.cik;

  for (const dataset of ["sec.submissions", "sec.companyfacts"] as const) {
    const url =
      dataset === "sec.submissions"
        ? buildSubmissionsUrl(subject.cik)
        : buildCompanyFactsUrl(subject.cik);
    const raw = await download(url);
    const payload = parseJsonPreservingNumbers(raw.text);
    const reduction =
      dataset === "sec.submissions"
        ? reduceSecSubmissions(payload)
        : reduceSecCompanyFacts(payload);
    const text = stringifyJsonPreservingNumbers(reduction.document);
    const bytes = Buffer.byteLength(text, "utf8");
    const path = `${subject.cik}/${dataset === "sec.submissions" ? "submissions" : "companyfacts"}.json`;

    const entityName =
      dataset === "sec.companyfacts"
        ? ((payload as { entityName?: unknown }).entityName ?? label)
        : ((payload as { name?: unknown }).name ?? label);

    entries.push({
      path,
      dataset,
      cik: subject.cik,
      entityName: String(entityName),
      sourceUrl: url,
      fetchedAt: raw.fetchedAt,
      rawBytes: raw.bytes,
      rawSha256: raw.sha256,
      bytes,
      sha256: sha256Hex(text),
      anchorOn: reduction.anchorOn,
      floorOn: reduction.floorOn,
      counts: { ...reduction.counts },
    });
    files.set(path, text);

    console.log(
      [
        `  ${subject.cik}`,
        label.padEnd(8),
        dataset.padEnd(16),
        `${formatBytes(raw.bytes).padStart(9)} →${formatBytes(bytes).padStart(9)}`,
        `desde ${reduction.floorOn}`,
        Object.entries(reduction.counts)
          .map(([key, value]) => `${key} ${value}`)
          .join(", "),
      ].join("  "),
    );
  }
}

const rawTotal = entries.reduce((total, entry) => total + entry.rawBytes, 0);
const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);

console.log("");
log("descargado", formatBytes(rawTotal));
log("corpus", formatBytes(total));
log("reducción", `${((1 - total / rawTotal) * 100).toFixed(1)} %`);

if (DRY_RUN) {
  console.log("\nDry run: no se escribió nada. Pasá --apply para congelarlo.");
  process.exit(0);
}

// ------------------------------------------------------------------ escritura
const previous = loadGoldenCorpusManifest();
const manifest = goldenCorpusManifestSchema.parse({
  ...previous,
  reducerVersion: SEC_CORPUS_REDUCER_VERSION,
  // Un filer que no se volvió a capturar conserva su entrada: capturar uno no
  // borra el resto del corpus.
  entries: [
    ...previous.entries.filter(
      (entry) =>
        !entries.some(
          (fresh) => fresh.cik === entry.cik && fresh.dataset === entry.dataset,
        ),
    ),
    ...entries,
  ].sort((left, right) =>
    left.cik === right.cik
      ? left.dataset.localeCompare(right.dataset)
      : left.cik.localeCompare(right.cik),
  ),
});

for (const [path, text] of files) {
  const absolute = join(dirname(GOLDEN_CORPUS_MANIFEST_PATH), path);

  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, text, "utf8");
}

writeFileSync(
  GOLDEN_CORPUS_MANIFEST_PATH,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(`\nCorpus congelado: ${manifest.entries.length} archivos.`);
