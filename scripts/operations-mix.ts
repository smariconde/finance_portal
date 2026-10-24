import { usMarketGraph } from "@/modules/identity/domain/us-market-graph";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

import { runModelLadder } from "@/modules/ai/application/run-model-ladder";
import { formatNanoUsd } from "@/modules/ai/domain/ai-spend";
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
  type PointInTimeQuery,
} from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { readAnnualFundamentals } from "@/modules/valuation/application/assess-company";
import { DECLARED_OPERATIONS_MIXES } from "@/modules/valuation/application/declared-operations-mixes";
import {
  proposeOperationsMix,
  type ProposeOperationsMixResult,
} from "@/modules/valuation/application/propose-operations-mix";
import { COUNTRY_RISK_DATASET } from "@/modules/valuation/domain/cost-of-capital";
import { weightsOfProposal } from "@/modules/valuation/domain/operations-mix";
import { getAiLayer } from "@/server/ai/get-ai-layer";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getOperationsMixRepository } from "@/server/persistence/get-operations-mix-repository";
import { getReferenceDatasetRepository } from "@/server/persistence/get-reference-dataset-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";
import { createFundamentalReaders } from "@/server/valuation/fundamental-readers";

/**
 * Propone con la capa IA el mix de operaciones de una empresa: transcribe la
 * tabla de ingresos por geografía de su último 10-K y la mapea a países y
 * regiones de Damodaran (`F5-05`,
 * [ADR 0034](../docs/architecture/adr/0034-operations-weighted-country-risk.md)).
 *
 *   pnpm valuation:operations-mix --ticker AAPL            # pregunta y reporta, no escribe (sí gasta)
 *   pnpm valuation:operations-mix --ticker AAPL --apply    # también guarda la propuesta
 *   pnpm valuation:operations-mix --ticker AAPL --again --apply
 *
 * Necesita los fundamentals ingeridos (los ingresos del ejercicio son el control
 * de la policy) y el riesgo país registrado (`pnpm damodaran:record`). Por
 * empresa: dos requests a la SEC —`submissions` y el 10-K— y la escalera. No
 * vuelve a preguntar por el mismo 10-K salvo con `--again`, y una empresa que el
 * owner declaró no gasta nada.
 */
const { values } = parseArgs({
  options: {
    ticker: { type: "string", multiple: true, default: [] },
    apply: { type: "boolean", default: false },
    again: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const REGIONS_DATASET = "damodaran.country-risk-regions";

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
const identity = createGraphIdentityResolver(() => usMarketGraph(state.graph));
const referenceDatasets = getReferenceDatasetRepository();
const repository = getOperationsMixRepository();
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

/** El CIK vigente o, para un antecesor del linaje, el último que tuvo. */
function cikOf(legalEntityId: string): string | null {
  const assignments = state.graph.identifierAssignments.filter(
    (candidate) =>
      candidate.identifierType === "cik" &&
      candidate.subjectType === "legal_entity" &&
      candidate.subjectId === legalEntityId,
  );
  const open = assignments.find(
    (candidate) =>
      candidate.validTo === null && candidate.supersededAt === null,
  );

  return (open ?? assignments[0])?.normalizedValue ?? null;
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

const fundamentalReaders = createFundamentalReaders(cikOf);

async function releaseKeys(datasetId: string, pointInTime: PointInTimeQuery) {
  const reading = await readReferenceDataset(
    datasetId,
    pointInTime,
    referenceDatasets,
  );

  return reading === null
    ? null
    : {
        releaseId: reading.release.releaseId,
        keys: reading.rows.map((row) => row.key),
      };
}

type Report = {
  readonly ticker: string;
  readonly cik: string;
  readonly result: ProposeOperationsMixResult;
};

const reports: Report[] = [];

for (const ticker of values.ticker) {
  const resolution = await identity.resolve({ symbol: ticker }, query);
  const legalEntityId =
    resolution.status === "resolved" ? resolution.legalEntityId : null;

  if (legalEntityId === null) {
    fail(`${ticker}: no resuelve en el grafo (${resolution.status}).`);
  }

  const cik = cikOf(legalEntityId);

  if (cik === null) {
    fail(`${ticker}: resuelve pero no tiene CIK.`);
  }

  const result = await proposeOperationsMix(
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
      declarations: DECLARED_OPERATIONS_MIXES,
      apply: values.apply,
      again: values.again,
    },
    {
      countryRelease: (pointInTime) =>
        releaseKeys(COUNTRY_RISK_DATASET, pointInTime),
      regionRelease: (pointInTime) => releaseKeys(REGIONS_DATASET, pointInTime),
      annualFundamentals: async (subjectId, pointInTime) =>
        (
          await readAnnualFundamentals(
            subjectId,
            pointInTime,
            fundamentalReaders,
          )
        ).series,
      loadSubmissions: async (subjectCik) =>
        JSON.parse(
          await fetchText(buildSubmissionsUrl(subjectCik), "application/json"),
        ),
      loadAnnualReport: async (report) => fetchText(report.url, "text/html"),
      registry: DEMO_SOURCE_REGISTRY,
      runLadder: (task, input) => runModelLadder(task, input, run),
      repository,
      now: () => new Date().toISOString(),
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

  if (result.status === "skipped") {
    log("resultado", `sin preguntar · ${result.reason}`);

    if (result.previous !== null) {
      const previous = result.previous.proposal;
      log(
        "  la vez anterior",
        `${previous.outcome}${previous.reason === null ? "" : ` ${previous.reason}`} · ${previous.proposedAt}`,
      );
    }

    continue;
  }

  const { stored, ladder, annualReport } = result;
  const { proposal } = stored;

  log(
    "10-K",
    `${annualReport.accessionNumber} · ejercicio ${proposal.fiscalYearEnd}`,
  );
  log(
    "evidencia",
    stored.evidence
      .map(
        (item) =>
          `${item.evidenceId} ${item.section} ${item.byteLength} B${item.truncated ? " (recortado)" : ""}`,
      )
      .join(" · "),
  );
  log("ingresos del ejercicio", `USD ${proposal.expectedRevenue}`);

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

  if (proposal.outcome !== "accepted") {
    log("resultado", `${proposal.outcome} · ${proposal.reason}`);
  } else {
    log(
      "resultado",
      `aceptado · total ${proposal.printedTotal} ${proposal.unit} · confianza ${proposal.confidence}`,
    );

    for (const line of stored.lines) {
      log(
        `  ${line.label}`.slice(0, 24),
        `${line.printedAmount} · ${line.basis}${line.exposureKeys.length > 0 ? ` → ${line.exposureKeys.join(" + ")}` : ""}`,
      );
    }

    log(
      "pesos",
      weightsOfProposal(stored.lines)
        .map(
          (exposure) =>
            `${exposure.exposureKeys.join("+") || "resto del mundo"} ${(Number(exposure.weight) * 100).toFixed(1)} %`,
        )
        .join(" · "),
    );
  }

  if (proposal.rationale !== null) {
    log("  motivo", proposal.rationale);
  }

  log(
    "escrito",
    result.written ? `sí · propuesta ${proposal.proposalId}` : "no",
  );
}

console.log("");
log("cobrado en total", `USD ${formatNanoUsd(charged)}`);
log("contado contra el tope", `USD ${formatNanoUsd(counted)}`);
