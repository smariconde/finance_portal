import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { runModelLadder } from "@/modules/ai/application/run-model-ladder";
import { formatNanoUsd } from "@/modules/ai/domain/ai-spend";
import { SEC_SIC_TAXONOMY_ID } from "@/modules/classification/domain/sec-sic-classification";
import { DECLARED_SUCCESSIONS } from "@/modules/corporate-actions/application/declared-successions";
import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import {
  SEC_REQUEST_PACING,
  type EgressFetch,
} from "@/modules/ingestion/application/egress-fetch";
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
import { DECLARED_INDUSTRY_ASSIGNMENTS } from "@/modules/valuation/application/declared-industry-assignments";
import {
  resolveCompanyIndustry,
  type ResolveCompanyIndustryResult,
} from "@/modules/valuation/application/resolve-company-industry";
import { DAMODARAN_INDUSTRY_TAXONOMY } from "@/modules/valuation/domain/industry-mapping";
import { getAiLayer } from "@/server/ai/get-ai-layer";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getIndustryResolutionRepository } from "@/server/persistence/get-industry-resolution-repository";
import { getReferenceDatasetRepository } from "@/server/persistence/get-reference-dataset-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Resuelve con la capa IA la industria de Damodaran de una empresa cuyo SIC es
 * ambiguo (`F5-03`,
 * [ADR 0033](../docs/architecture/adr/0033-ai-layer-industry-resolution.md)).
 *
 *   pnpm valuation:resolve-industry --ticker GOOGL            # resuelve y reporta, no escribe (sí gasta)
 *   pnpm valuation:resolve-industry --ticker GOOGL --apply    # también persiste la resolución
 *   pnpm valuation:resolve-industry --ticker GOOGL --again --apply
 *
 * Necesita el SIC observado (`pnpm valuation:assess --ticker … --apply`). Por
 * empresa: dos requests a la SEC —`submissions` y el 10-K— y la escalera. No
 * vuelve a preguntar si ya se preguntó por el mismo SIC y el mismo 10-K, salvo
 * con `--again`. Una empresa que no es ambigua no gasta nada.
 */
const { values } = parseArgs({
  options: {
    ticker: { type: "string", multiple: true, default: [] },
    apply: { type: "boolean", default: false },
    again: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(24)} ${String(value)}`);
}

if (values.ticker.length === 0) {
  fail("Indicá al menos un --ticker.");
}

const NOW = new Date().toISOString();
const query = pointInTimeQuerySchema.parse({
  effectiveAt: NOW,
  knownAt: NOW,
  revisionPolicy: "as_known",
  adjustmentPolicy: "as_known",
  sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
});

const registry = getSourceRegistryRepository();
await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

for (const sourceId of ["sec-edgar", "openrouter"]) {
  const entry = DEMO_SOURCE_REGISTRY.find(
    (candidate) => candidate.sourceId === sourceId,
  );
  const rights =
    entry === undefined
      ? null
      : evaluateIngestionRights(entry, {
          storesRawPayload: false,
          storesNormalizedValues: true,
          publicDisplay: false,
        });

  if (rights === null || !rights.allowed) {
    fail(
      `${sourceId} no está aprobada: ${rights?.blockedBy.join(", ") ?? "sin fila"}.`,
    );
  }
}

const budgets = getSourceBudgetStore();

for (const [sourceId, requests] of [
  ["sec-edgar", values.ticker.length * 3],
  ["openrouter", 1],
] as const) {
  const verdict = await checkSourceBudget(budgets, sourceId, requests, NOW);

  if (verdict.status !== "allowed") {
    fail(describeSourceRefusal(sourceId, verdict));
  }
}

const state = await getUniverseRepository().loadState({
  indexId: SP500_INDEX_ID,
  versions: "all",
});
const identity = createGraphIdentityResolver(() => state.graph);
const classifications = getClassificationRepository();
const referenceDatasets = getReferenceDatasetRepository();
const repository = getIndustryResolutionRepository();
const secFetch: EgressFetch = getSourceEgressFetch(SEC_REQUEST_PACING);
const layer = getAiLayer();
// Una sola corrida para todas las empresas: el breaker y el techo del proceso
// cubren el comando entero, no cada empresa por separado.
const run = layer.runDependencies();
const decoder = new TextDecoder("utf-8");

async function fetchText(url: string, accept: string): Promise<string> {
  const response = await secFetch({ sourceId: "sec-edgar", url, accept });

  if (response.status !== 200) {
    throw new Error(
      `SEC respondió ${response.status} para ${new URL(url).pathname}`,
    );
  }

  return decoder.decode(response.body);
}

function openCik(legalEntityId: string): string | null {
  return (
    state.graph.identifierAssignments.find(
      (candidate) =>
        candidate.identifierType === "cik" &&
        candidate.subjectType === "legal_entity" &&
        candidate.subjectId === legalEntityId &&
        candidate.validTo === null &&
        candidate.supersededAt === null,
    )?.normalizedValue ?? null
  );
}

function legalNameOf(legalEntityId: string): string | null {
  return (
    state.graph.legalEntities.find(
      (entity) =>
        entity.legalEntityId === legalEntityId &&
        entity.validTo === null &&
        entity.supersededAt === null,
    )?.legalName ?? null
  );
}

type Report = {
  readonly ticker: string;
  readonly cik: string;
  readonly result: ResolveCompanyIndustryResult;
};

const reports: Report[] = [];

for (const ticker of values.ticker) {
  const resolution = await identity.resolve({ symbol: ticker }, query);

  const legalEntityId =
    resolution.status === "resolved" ? resolution.legalEntityId : null;

  if (legalEntityId === null) {
    fail(`${ticker}: no resuelve en el grafo (${resolution.status}).`);
  }
  const cik = openCik(legalEntityId);

  if (cik === null) {
    fail(`${ticker}: resuelve pero no tiene CIK vigente.`);
  }

  const result = await resolveCompanyIndustry(
    {
      legalEntityId,
      cik,
      companyName: legalNameOf(legalEntityId) ?? ticker,
      annualReportCiks: [
        cik,
        ...DECLARED_SUCCESSIONS.filter(
          (succession) => succession.successorCik === cik,
        ).map((succession) => succession.predecessorCik),
      ],
      query,
      declarations: DECLARED_INDUSTRY_ASSIGNMENTS,
      apply: values.apply,
      again: values.again,
    },
    {
      loadSicAssertions: async () =>
        classifications.loadClassifications({
          taxonomyId: SEC_SIC_TAXONOMY_ID,
        }),
      industryRelease: async (pointInTime) => {
        const reading = await readReferenceDataset(
          DAMODARAN_INDUSTRY_TAXONOMY,
          pointInTime,
          referenceDatasets,
        );

        return reading === null
          ? null
          : new Map(reading.rows.map((row) => [row.key, row.label]));
      },
      loadSubmissions: async (subjectCik) =>
        JSON.parse(
          await fetchText(buildSubmissionsUrl(subjectCik), "application/json"),
        ),
      loadAnnualReport: async (report) => fetchText(report.url, "text/html"),
      registry: DEMO_SOURCE_REGISTRY,
      runLadder: (task, input) => runModelLadder(task, input, run),
      repository,
      now: () => new Date().toISOString(),
      newId: () => randomUUID(),
      sha256: (text) => createHash("sha256").update(text).digest("hex"),
    },
  );

  reports.push({ ticker, cik, result });

  if (result.status === "asked" && result.ladder.outcome === "stopped") {
    // Un freno es de la corrida, no de la empresa: el breaker, la clave o la
    // cuota. Seguir con la siguiente sería pagar por la misma falla.
    break;
  }
}

if (values.json) {
  console.log(JSON.stringify(reports, null, 2));
  process.exit(0);
}

log("modo", values.apply ? "apply" : "dry run (gasta, no escribe)");
log("corte", NOW);

let charged = 0;
let counted = 0;

for (const { ticker, cik, result } of reports) {
  console.log(`\n── ${ticker} · CIK ${cik}`);
  log(
    "SIC",
    result.status === "asked" ? result.record.sic : (result.sic ?? "—"),
  );

  if (result.status === "skipped") {
    log("resultado", `sin preguntar · ${result.reason}`);
    log("candidatas", result.candidates.join(", ") || "—");

    if (result.previous !== null) {
      const previous = result.previous.resolution;
      log(
        "  la vez anterior",
        `${previous.outcome} ${previous.industryKey ?? previous.reason} · ${previous.resolvedAt}`,
      );
    }

    continue;
  }

  const { record, ladder, annualReport, evidence } = result;

  log(
    "10-K",
    `${annualReport.accessionNumber} · aceptado ${annualReport.acceptedAt}`,
  );
  log(
    "evidencia",
    evidence
      .map(
        (item) =>
          `${item.evidenceId} ${item.section} ${item.byteLength} B${item.truncated ? " (recortado)" : ""}`,
      )
      .join(" · "),
  );
  log("candidatas", record.candidates.join(", "));

  for (const attempt of ladder.attempts) {
    charged += attempt.chargedNanoUsd ?? 0;
    counted +=
      attempt.status === "charged"
        ? (attempt.chargedNanoUsd ?? 0)
        : attempt.status === "uncharged"
          ? 0
          : attempt.reservedNanoUsd;
    log(
      `  escalón ${attempt.rung}`,
      `${attempt.outcome}${attempt.detail ? ` (${attempt.detail})` : ""} · ${attempt.respondedModel ?? attempt.requestedModel} · ${attempt.promptTokens ?? "—"}+${attempt.completionTokens ?? "—"} tokens · ${attempt.latencyMs ?? "—"} ms · USD ${attempt.chargedNanoUsd === null ? `— (${attempt.status})` : formatNanoUsd(attempt.chargedNanoUsd)}`,
    );
  }

  log(
    "resultado",
    record.outcome === "resolved"
      ? `${record.industryKey} · confianza ${record.confidence} · cita ${record.citedEvidenceIds.join(", ")}`
      : `${record.outcome} · ${record.reason}`,
  );

  if (record.rationale !== null) {
    log("  motivo", record.rationale);
  }

  log(
    "escrito",
    result.written ? `sí · resolución ${record.resolutionId}` : "no",
  );
}

console.log("");
log("cobrado en total", `USD ${formatNanoUsd(charged)}`);
log("contado contra el tope", `USD ${formatNanoUsd(counted)}`);
