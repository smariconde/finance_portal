import { usMarketGraph } from "@/modules/identity/domain/us-market-graph";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

import { runModelLadder } from "@/modules/ai/application/run-model-ladder";
import { formatNanoUsd } from "@/modules/ai/domain/ai-spend";
import { buildCompanyConceptUrl } from "@/modules/corporate-actions/application/live-split-claim-source";
import { DECLARED_SUCCESSIONS } from "@/modules/corporate-actions/application/declared-successions";
import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import { parseSecCompanyConcept } from "@/modules/fundamentals/domain/parse-sec-company-concept";
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
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import {
  proposeEmployeeEquity,
  type ProposeEmployeeEquityResult,
} from "@/modules/valuation/application/propose-employee-equity";
import { readEmployeeEquity } from "@/modules/valuation/domain/employee-equity";
import { getAiLayer } from "@/server/ai/get-ai-layer";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getEmployeeEquityRepository } from "@/server/persistence/get-employee-equity-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Transcribe con la capa IA las opciones y unidades de empleados de una
 * empresa desde la nota de compensación en acciones de su último 10-K (`F4-05`,
 * [ADR 0040](../docs/architecture/adr/0040-failure-probability-employee-options.md)).
 *
 *   pnpm valuation:employee-equity --ticker JNJ            # pregunta y reporta, no escribe (sí gasta)
 *   pnpm valuation:employee-equity --ticker JNJ --apply    # también guarda la propuesta
 *   pnpm valuation:employee-equity --ticker JNJ --again --apply
 *
 * Por empresa: cuatro requests a la SEC —`submissions`, el 10-K y dos
 * `companyconcept` para corroborar con el XBRL del mismo 10-K— y la escalera.
 * No vuelve a preguntar por el mismo 10-K salvo con `--again`.
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
  ["sec-edgar", values.ticker.length * 4],
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
const repository = getEmployeeEquityRepository();
const secFetch: EgressFetch = getSourceEgressFetch(SEC_REQUEST_PACING);
const layer = getAiLayer();
// Una sola corrida para todas las empresas: el breaker y el techo del proceso
// cubren el comando entero, no cada empresa por separado.
const run = layer.runDependencies();
const decoder = new TextDecoder("utf-8");

async function fetchSec(url: string, accept: string) {
  return secFetch({ sourceId: "sec-edgar", url, accept });
}

async function fetchText(url: string, accept: string): Promise<string> {
  const response = await fetchSec(url, accept);

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

type Report = {
  readonly ticker: string;
  readonly cik: string;
  readonly result: ProposeEmployeeEquityResult;
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

  const result = await proposeEmployeeEquity(
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
      apply: values.apply,
      again: values.again,
    },
    {
      loadSubmissions: async (subjectCik) =>
        JSON.parse(
          await fetchText(buildSubmissionsUrl(subjectCik), "application/json"),
        ),
      loadAnnualReport: async (report) => fetchText(report.url, "text/html"),
      loadConceptFacts: async (subjectCik, concept) => {
        const response = await fetchSec(
          buildCompanyConceptUrl(subjectCik, concept),
          "application/json",
        );

        // Un `404` es un filer que nunca etiquetó el concepto: no corrobora.
        if (response.status === 404) return [];
        if (response.status !== 200) {
          throw new Error(`SEC respondió ${response.status} a companyconcept`);
        }

        const parsed = parseSecCompanyConcept(
          decoder.decode(response.body),
          concept,
        );

        if (!parsed.ok) {
          throw new Error(`companyconcept ilegible: ${parsed.code}`);
        }

        return parsed.facts;
      },
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
    `nota de compensación ${stored.evidence.byteLength} B${stored.evidence.truncated ? " (recortada)" : ""}`,
  );
  log(
    "XBRL del 10-K",
    `opciones ${proposal.xbrlOptionsOutstanding ?? "—"} · strike ${proposal.xbrlWeightedStrike ?? "—"}`,
  );

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

  if (proposal.transcription === null) {
    log("resultado", `${proposal.outcome} · ${proposal.reason}`);
  } else {
    const reading = readEmployeeEquity(
      proposal.transcription,
      proposal.fiscalYearEnd,
    );

    log(
      "resultado",
      `aceptado · escala ${proposal.transcription.scale} · confianza ${proposal.transcription.confidence}`,
    );

    if (reading.options.status === "outstanding") {
      log(
        "  opciones",
        `${reading.options.count} a ${reading.options.strike}${reading.options.strikeBasis === "printed" ? "" : " (strike desconocido: cota superior)"} · ${reading.options.maturityYears} años (${reading.options.maturityBasis})`,
      );
    } else {
      log("  opciones", "ninguna en la nota");
    }

    log(
      "  unidades",
      reading.unitsBasis === "outstanding"
        ? `${reading.unvestedUnits} acciones`
        : "ninguna en la nota",
    );
    log("  motivo", proposal.transcription.rationale);
  }

  log(
    "escrito",
    result.written ? `sí · propuesta ${proposal.proposalId}` : "no",
  );
}

console.log("");
log("cobrado en total", `USD ${formatNanoUsd(charged)}`);
log("contado contra el tope", `USD ${formatNanoUsd(counted)}`);
