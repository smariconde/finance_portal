import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  DECLARED_EVAL_DOCUMENTS,
  DECLARED_EVAL_TARGETS,
  DECLARED_INDUSTRY_EVAL_BASES,
  DECLARED_MIX_EVAL_BASES,
} from "@/modules/ai-evals/application/declared-eval-cases";
import {
  AI_EVAL_CORPUS_MANIFEST_PATH,
  AI_EVAL_CORPUS_VERSION,
  evalCorpusDirectory,
  evalCorpusManifestSchema,
  sha256Hex,
  type EvalCorpusDocument,
  type EvalCorpusExtract,
  type EvalExtractSection,
} from "@/modules/ai-evals/infrastructure/eval-corpus";
import { SEC_SOURCE_ID } from "@/modules/fundamentals/application/live-company-facts-source";
import {
  extractGeographicRevenue,
  SEC_10K_GEOGRAPHIC_REVENUE_VERSION,
} from "@/modules/fundamentals/domain/sec-10k-geographic-revenue";
import {
  extractTenKSections,
  SEC_10K_SECTIONS_VERSION,
} from "@/modules/fundamentals/domain/sec-10k-sections";
import { SEC_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { readReferenceDataset } from "@/modules/reference-data/application/read-reference-dataset";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { COUNTRY_RISK_DATASET } from "@/modules/valuation/domain/cost-of-capital";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getIndustryResolutionRepository } from "@/server/persistence/get-industry-resolution-repository";
import { getOperationsMixRepository } from "@/server/persistence/get-operations-mix-repository";
import { getReferenceDatasetRepository } from "@/server/persistence/get-reference-dataset-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Captura del corpus congelado de los evals de la capa IA (`F5-07`,
 * [ADR 0035](../docs/architecture/adr/0035-ai-layer-evals.md), decisión 2).
 *
 *   pnpm ai:eval-capture             # el plan: documentos, secciones y requests; sin red
 *   pnpm ai:eval-capture --apply     # baja cada 10-K declarado, lo recorta y lo congela
 *
 * Una request por documento. Cada 10-K se recorta con los mismos lectores y
 * techos que usan las tareas, y sólo se guardan las secciones que algún caso
 * lee: Item 1 y nota de segmentos para la industria, la tabla geográfica para
 * el mix, y el Item 1 también para las empresas cuyo caso de abstención del mix
 * lo usa en lugar de la tabla. El documento entero no se conserva.
 *
 * Lee de la base personal sólo dos cosas, y ninguna entra como evidencia: los
 * nombres de país y región de la release vigente (sin sus valores) y el hash de
 * la evidencia que guardó cada corrida de producción, para decir si el extracto
 * recapturado es el mismo que leyó el modelo.
 */
const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;
const REGIONS_DATASET = "damodaran.country-risk-regions";

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(26)} ${String(value)}`);
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
const industryCiks = new Set(DECLARED_INDUSTRY_EVAL_BASES.map((b) => b.cik));
const mixCiks = new Set(DECLARED_MIX_EVAL_BASES.map((b) => b.cik));
const mixAbstentionCiks = new Set(DECLARED_EVAL_TARGETS.mixAbstentions);

function sectionsFor(cik: string): EvalExtractSection[] {
  const sections: EvalExtractSection[] = [];

  if (industryCiks.has(cik) || mixAbstentionCiks.has(cik)) {
    sections.push("item_1_business");
  }
  if (industryCiks.has(cik)) sections.push("segment_note");
  if (mixCiks.has(cik)) sections.push("geographic_revenue");

  return sections;
}

const documents = DECLARED_EVAL_DOCUMENTS.filter(
  (document) => sectionsFor(document.cik).length > 0,
);

log("corpus", AI_EVAL_CORPUS_VERSION);
log(
  "lectores",
  `${SEC_10K_SECTIONS_VERSION}, ${SEC_10K_GEOGRAPHIC_REVENUE_VERSION}`,
);
log("documentos", documents.length);
log("requests", documents.length);
log("modo", DRY_RUN ? "dry run: no escribe nada" : "apply: congela el corpus");
console.log("");

for (const document of documents) {
  console.log(
    `  ${document.cik}  ${document.ticker.padEnd(6)} ${document.accessionNumber}  ${sectionsFor(document.cik).join(", ")}`,
  );
}

if (DRY_RUN) {
  console.log("\nDry run: no se bajó nada. Pasá --apply para congelarlo.");
  process.exit(0);
}

// -------------------------------------------------------------- presupuesto
const NOW = new Date().toISOString();
const budget = await checkSourceBudget(
  getSourceBudgetStore(),
  SEC_SOURCE_ID,
  documents.length,
  NOW,
);

if (budget.status !== "allowed") {
  fail(describeSourceRefusal(SEC_SOURCE_ID, budget));
}

await syncDeclaredSourceRegistry(
  DEMO_SOURCE_REGISTRY,
  getSourceRegistryRepository(),
);

// ------------------------------------------- nombres de lugar, sin sus valores
const query = pointInTimeQuerySchema.parse({
  effectiveAt: NOW,
  knownAt: NOW,
  revisionPolicy: "as_known",
  adjustmentPolicy: "as_known",
  sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
});
const referenceDatasets = getReferenceDatasetRepository();
const [countries, regions] = await Promise.all([
  readReferenceDataset(COUNTRY_RISK_DATASET, query, referenceDatasets),
  readReferenceDataset(REGIONS_DATASET, query, referenceDatasets),
]);

if (countries === null || regions === null) {
  fail("No hay release de riesgo país visible: corré pnpm damodaran:record.");
}

// ------------------------------------------- hashes de producción, para comparar
const state = await getUniverseRepository().loadState({
  indexId: SP500_INDEX_ID,
  versions: "all",
});

function legalEntityOf(cik: string): string | null {
  return (
    state.graph.identifierAssignments.find(
      (candidate) =>
        candidate.identifierType === "cik" &&
        candidate.subjectType === "legal_entity" &&
        candidate.normalizedValue === cik,
    )?.subjectId ?? null
  );
}

const industryRepository = getIndustryResolutionRepository();
const mixRepository = getOperationsMixRepository();

async function productionHashes(
  cik: string,
): Promise<Map<EvalExtractSection, string>> {
  const hashes = new Map<EvalExtractSection, string>();
  const legalEntityId = legalEntityOf(cik);

  if (legalEntityId === null) return hashes;

  const industry = await industryRepository.latestForSubject(legalEntityId);

  for (const item of industry?.evidence ?? []) {
    hashes.set(item.section, item.sha256);
  }

  const mix = await mixRepository.latestForSubject(legalEntityId);

  for (const item of mix?.evidence ?? []) {
    hashes.set(item.section as EvalExtractSection, item.sha256);
  }

  return hashes;
}

// ------------------------------------------------------------------ captura
const fetch = getSourceEgressFetch(SEC_REQUEST_PACING);
const decoder = new TextDecoder("utf-8");
const captured: EvalCorpusDocument[] = [];
const files = new Map<string, string>();
const differences: string[] = [];

for (const document of documents) {
  const response = await fetch({
    sourceId: SEC_SOURCE_ID,
    url: document.documentUrl,
    accept: "text/html",
  });

  if (response.status !== 200) {
    fail(`${document.documentUrl} devolvió ${response.status}.`);
  }

  const html = decoder.decode(response.body);
  const sections = extractTenKSections(html);
  const geographic = extractGeographicRevenue(html);
  const production = await productionHashes(document.cik);
  const extracts: EvalCorpusExtract[] = [];

  for (const wanted of sectionsFor(document.cik)) {
    const cut =
      wanted === "item_1_business"
        ? sections.business
        : wanted === "segment_note"
          ? sections.segments
          : (geographic?.section ?? null);

    // La tarea manda la nota de segmentos sólo si el lector la encuentra.
    if (cut === null && wanted === "segment_note") continue;

    if (cut === null) {
      fail(`${document.ticker}: el lector no encontró ${wanted}.`);
    }

    const path = `${document.cik}/${wanted}.txt`;
    const sha256 = sha256Hex(cut.text);
    const stored = production.get(wanted);

    if (stored !== undefined && stored !== sha256) {
      differences.push(`${document.ticker} ${wanted}`);
    }

    extracts.push({
      section: wanted,
      path,
      readerVersion:
        wanted === "geographic_revenue"
          ? SEC_10K_GEOGRAPHIC_REVENUE_VERSION
          : SEC_10K_SECTIONS_VERSION,
      bytes: Buffer.byteLength(cut.text, "utf8"),
      sha256,
      truncated: cut.truncated,
    });
    files.set(path, cut.text);
  }

  captured.push({
    cik: document.cik,
    accessionNumber: document.accessionNumber,
    sourceUrl: document.documentUrl,
    fetchedAt: response.fetchedAt,
    rawBytes: response.byteLength,
    rawSha256: sha256Hex(response.body),
    extracts,
  });

  console.log(
    [
      `  ${document.ticker.padEnd(6)}`,
      `${formatBytes(response.byteLength).padStart(9)} →`,
      extracts
        .map((extract) => `${extract.section} ${formatBytes(extract.bytes)}`)
        .join(", "),
    ].join(" "),
  );
}

// ------------------------------------------------------------------ escritura
const manifest = evalCorpusManifestSchema.parse({
  corpusVersion: AI_EVAL_CORPUS_VERSION,
  sourceId: SEC_SOURCE_ID,
  attribution:
    "U.S. Securities and Exchange Commission, EDGAR (https://www.sec.gov/edgar). Informacion publica copiada con cita, sin el sello ni los logos de la SEC y sin afiliacion.",
  exposureKeys: {
    countryReleaseId: countries.release.releaseId,
    regionReleaseId: regions.release.releaseId,
    publishedLabel: countries.release.publishedLabel,
    countries: countries.rows.map((row) => row.key),
    regions: regions.rows.map((row) => row.key),
  },
  documents: captured,
});

const directory = evalCorpusDirectory();

// El corpus se reescribe entero: un documento que dejó de declararse no queda.
rmSync(directory, { recursive: true, force: true });

for (const [path, text] of files) {
  const target = join(directory, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, text, "utf8");
}

writeFileSync(
  AI_EVAL_CORPUS_MANIFEST_PATH,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

const total = [...files.values()].reduce(
  (sum, text) => sum + Buffer.byteLength(text, "utf8"),
  0,
);

console.log("");
log("corpus", formatBytes(total));
log(
  "distinto de producción",
  differences.length === 0 ? "ninguno" : differences.join("; "),
);
console.log(`\nCongelado en ${directory}. Revisá el diff antes de commitear.`);
process.exit(0);
