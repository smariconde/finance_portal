import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import {
  planSecSicClassification,
  projectClassificationPlan,
  SEC_SIC_TAXONOMY_ID,
} from "@/modules/classification/domain/sec-sic-classification";
import type { SubjectClassification } from "@/modules/classification/domain/subject-classification";
import { readLineageObservations } from "@/modules/corporate-actions/application/read-lineage-observations";
import { COMPANY_FACTS_DATASET_ID } from "@/modules/fundamentals/application/ingest-company-facts";
import {
  createLiveCompanyFactsSource,
  SEC_SOURCE_ID,
} from "@/modules/fundamentals/application/live-company-facts-source";
import { REFRESH_PROBE_DATASET_ID } from "@/modules/fundamentals/application/refresh-company-facts";
import { SEC_SUBMISSIONS_PARSER_VERSION } from "@/modules/fundamentals/domain/parse-sec-submissions";
import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import { SEC_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import {
  assessCompany,
  type CompanyAssessment,
} from "@/modules/valuation/application/assess-company";
import { readReferenceDataset } from "@/modules/reference-data/application/read-reference-dataset";
import { DECLARED_INDUSTRY_ASSIGNMENTS } from "@/modules/valuation/application/declared-industry-assignments";
import { annualFundamentalsConcepts } from "@/modules/valuation/domain/annual-fundamentals";
import { DAMODARAN_INDUSTRY_TAXONOMY } from "@/modules/valuation/domain/industry-mapping";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getCorporateActionRepository } from "@/server/persistence/get-corporate-action-repository";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getObservationRepository } from "@/server/persistence/get-observation-repository";
import { getReferenceDatasetRepository } from "@/server/persistence/get-reference-dataset-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Evaluación a demanda de una empresa (`F3-01`, gate de la Fase 3).
 *
 *   pnpm valuation:assess --ticker AAPL             # sondea su SIC (1 request) y evalúa, sin escribir
 *   pnpm valuation:assess --ticker AAPL --apply     # además registra el SIC observado
 *   pnpm valuation:assess --ticker AAPL --offline   # sólo lo guardado: sin red ni escritura
 *   pnpm valuation:assess --ticker AAPL --json
 *
 * Los fundamentals no se bajan acá: si la empresa no tiene, la evaluación lo
 * nombra y el camino es `pnpm fundamentals:ingest --ticker … --apply`.
 */
const { values } = parseArgs({
  options: {
    ticker: { type: "string", multiple: true, default: [] },
    apply: { type: "boolean", default: false },
    offline: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

if (values.ticker.length === 0) {
  console.error("Indicá al menos un --ticker.");
  process.exit(2);
}

if (values.apply && values.offline) {
  console.error(
    "--apply registra lo que se observa; con --offline no hay nada.",
  );
  process.exit(2);
}

/**
 * Corte de la evaluación: «lo que se sabe ahora». Se toma **después** de observar
 * el SIC de cada empresa, porque esa observación queda fechada con su descarga y
 * un corte anterior no la vería.
 */
function queryAt(instant: string) {
  return pointInTimeQuerySchema.parse({
    effectiveAt: instant,
    knownAt: instant,
    revisionPolicy: "as_known",
    adjustmentPolicy: "as_known",
    sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
  });
}

const NOW = new Date().toISOString();
const query = queryAt(NOW);

const classifications = getClassificationRepository();
const observations = getObservationRepository();
const corporateActions = getCorporateActionRepository();
const ingestionRuns = getIngestionRunRepository();
const referenceDatasets = getReferenceDatasetRepository();
const state = await getUniverseRepository().loadState({
  indexId: SP500_INDEX_ID,
  versions: "all",
});
const identity = createGraphIdentityResolver(() => state.graph);

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

let probeSource: ReturnType<typeof createLiveCompanyFactsSource> | null = null;

if (!values.offline) {
  const registry = getSourceRegistryRepository();
  await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);
  const entry = await registry.findBySourceId(SEC_SOURCE_ID);

  if (entry === null || !entry.datasets.includes(REFRESH_PROBE_DATASET_ID)) {
    console.error("La fuente sec-edgar no declara el dataset de submissions.");
    process.exit(1);
  }

  const rights = evaluateIngestionRights(entry, {
    storesRawPayload: false,
    storesNormalizedValues: true,
    publicDisplay: false,
  });

  if (!rights.allowed) {
    console.error(`Derechos sin aprobar: ${rights.blockedBy.join(", ")}`);
    process.exit(1);
  }

  const verdict = await checkSourceBudget(
    getSourceBudgetStore(),
    SEC_SOURCE_ID,
    values.ticker.length,
    NOW,
  );

  if (verdict.status !== "allowed") {
    console.error(describeSourceRefusal(SEC_SOURCE_ID, verdict));
    process.exit(1);
  }

  probeSource = createLiveCompanyFactsSource({
    fetch: getSourceEgressFetch(SEC_REQUEST_PACING),
  });
}

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(24)} ${String(value)}`);
}

type Report = {
  readonly ticker: string;
  readonly cik: string;
  readonly sicObservation: {
    readonly status: "not_requested" | "not_published" | "observed";
    readonly code: string | null;
    readonly written: boolean;
    readonly change: "opened" | "superseded" | "unchanged" | null;
  };
  readonly assessment: CompanyAssessment;
};

const reports: Report[] = [];

for (const ticker of values.ticker) {
  const resolution = await identity.resolve({ symbol: ticker }, query);
  const legalEntityId =
    resolution.status === "resolved" ? resolution.legalEntityId : null;

  if (legalEntityId === null) {
    console.error(`${ticker}: no resuelve en el grafo (${resolution.status}).`);
    process.exit(2);
  }

  const cik = cikOf(legalEntityId);

  if (cik === null) {
    console.error(`${ticker}: resuelve pero no tiene CIK vigente.`);
    process.exit(2);
  }

  const stored = await classifications.loadClassifications({
    taxonomyId: SEC_SIC_TAXONOMY_ID,
  });
  let assertions: readonly SubjectClassification[] = stored;
  let sicObservation: Report["sicObservation"] = {
    status: "not_requested",
    code: null,
    written: false,
    change: null,
  };

  if (probeSource !== null) {
    const probe = await probeSource.probe(cik);

    if (probe.industry === null) {
      sicObservation = {
        status: "not_published",
        code: null,
        written: false,
        change: null,
      };
    } else {
      const plan = planSecSicClassification({
        observation: {
          subjectId: legalEntityId,
          reading: probe.industry,
          observedAt: probe.fetchedAt,
          sourceId: SEC_SOURCE_ID,
          sourceDocumentId: `submissions/CIK${cik}.json`,
        },
        stored,
        recordedAt: new Date().toISOString(),
        taxonomyVersion: SEC_SUBMISSIONS_PARSER_VERSION,
        newId: () => randomUUID(),
        hashContent: (input) =>
          createHash("sha256").update(input).digest("hex"),
      });
      const change =
        plan.counts.superseded > 0
          ? "superseded"
          : plan.counts.opened > 0
            ? "opened"
            : "unchanged";

      if (values.apply && change !== "unchanged") {
        await classifications.applyClassificationPlan(plan);
      }

      assertions =
        values.apply && change !== "unchanged"
          ? await classifications.loadClassifications({
              taxonomyId: SEC_SIC_TAXONOMY_ID,
            })
          : projectClassificationPlan(stored, plan);
      sicObservation = {
        status: "observed",
        code: probe.industry.sic,
        written: values.apply && change !== "unchanged",
        change,
      };
    }
  }

  const assessment = await assessCompany(
    {
      legalEntityId,
      query: queryAt(new Date().toISOString()),
      fundamentalsSourceId: SEC_SOURCE_ID,
      cik,
      industryDeclarations: DECLARED_INDUSTRY_ASSIGNMENTS,
    },
    {
      loadSicAssertions: async () => assertions,
      readFundamentals: async (subjectId, pointInTime) => {
        const selection = await readLineageObservations(
          {
            legalEntityId: subjectId,
            metricIds: [...annualFundamentalsConcepts()],
          },
          pointInTime,
          { corporateActions, observations },
        );

        return selection.rows.map((row) => ({
          observationId: row.observation.observationId,
          subjectId: row.observation.subjectId,
          concept: row.observation.concept,
          periodType: row.observation.periodType,
          asOf: row.observation.asOf,
          periodStart: row.observation.periodStart,
          unit: row.observation.unit,
          currency: row.observation.currency,
          value: row.value,
          availableAt: row.observation.availableAt,
          recordedAt: row.observation.recordedAt,
          sourceDocumentId: row.observation.sourceDocumentId,
        }));
      },
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
      fiscalYearAnchors: async (subjectIds) => {
        const anchors = await Promise.all(
          subjectIds.map(async (subjectId) => {
            const subjectCik = cikOf(subjectId);

            if (subjectCik === null) {
              return null;
            }

            const run = await ingestionRuns.findLatestAnchored(
              SEC_SOURCE_ID,
              COMPANY_FACTS_DATASET_ID,
              subjectCik,
            );

            return run?.selectionAnchorOn ?? null;
          }),
        );

        return anchors.filter((anchor): anchor is string => anchor !== null);
      },
    },
  );

  reports.push({ ticker, cik, sicObservation, assessment });
}

if (values.json) {
  console.log(JSON.stringify(reports, null, 2));
  process.exit(0);
}

log("modo", values.offline ? "offline" : values.apply ? "apply" : "dry run");
log("corte", NOW);

for (const report of reports) {
  const { assessment, sicObservation } = report;
  const { selection } = assessment;
  const series = assessment.fundamentals.series;

  console.log(`\n── ${report.ticker} · CIK ${report.cik}`);
  log(
    "SIC",
    assessment.sic === null
      ? "sin aserción vigente al corte"
      : `${assessment.sic.label} · desde ${assessment.sic.availableAt}`,
  );
  if (sicObservation.status !== "not_requested") {
    log(
      "observación SIC",
      sicObservation.status === "not_published"
        ? "submissions no publica SIC"
        : `${sicObservation.code} · ${sicObservation.change}${sicObservation.written ? " · escrito" : ""}`,
    );
  }
  if (assessment.sic !== null) {
    log(
      "perfiles por SIC",
      Object.entries(assessment.sic.profiles)
        .map(([profile, present]) => `${profile} ${present ? "sí" : "no"}`)
        .join(" · "),
    );
  }
  log(
    "industria",
    assessment.industry.status === "mapped"
      ? `${assessment.industry.industryLabel} · ${assessment.industry.basis}`
      : assessment.industry.status === "ambiguous"
        ? `ambigua entre ${assessment.industry.candidates.join(", ")}`
        : `sin mapear · ${assessment.industry.reason}`,
  );
  log(
    "ejercicios",
    series === null
      ? "sin fundamentals ingeridos"
      : `${series.fiscalYears.length} · último ${series.fiscalYears[0]?.fiscalYearEnd ?? "—"}`,
  );
  for (const signal of assessment.fundamentalSignals) {
    const measures = Object.entries(signal.measures)
      .map(([key, value]) => `${key} ${value}`)
      .join(", ");
    log(
      `  ${signal.profile}`,
      `${signal.state}${signal.basis.length > 0 ? ` · ${signal.basis.join(", ")}` : ""}${signal.missing.length > 0 ? ` · falta ${signal.missing.join(", ")}` : ""}${measures === "" ? "" : ` · ${measures}`}`,
    );
  }
  log("completitud", assessment.completeness.version);
  for (const item of assessment.completeness.checks) {
    const measures = Object.entries(item.measures)
      .map(([key, value]) => `${key} ${value}`)
      .join(", ");
    log(
      `  ${item.check}`,
      `${item.status}${item.missing.length > 0 ? ` · falta ${item.missing.join(", ")}` : ""}${measures === "" ? "" : ` · ${measures}`}`,
    );
  }
  log(
    "selección",
    `${selection.status} · ${selection.assetProfile ?? "—"} · ${selection.recommendedMethod ?? "—"}`,
  );
  if (selection.unsupportedReasons.length > 0) {
    log(
      "  motivo",
      `${selection.unsupportedReasons.join(", ")}${selection.requiredInputs.length > 0 ? ` · ${selection.requiredInputs.join(", ")}` : ""}`,
    );
  }
  if (selection.activatedRules.length > 0) {
    log("  reglas", selection.activatedRules.join(", "));
  }
  if (selection.alternatives.length > 0) {
    log("  alternativas", selection.alternatives.join(", "));
  }
  log(
    "rigor",
    `${assessment.rigor.level}${assessment.rigor.degradedBy.length > 0 ? ` · bajó por ${assessment.rigor.degradedBy.join(", ")}` : ""}`,
  );
  if (assessment.rigor.declarations.length > 0) {
    log("  declara", assessment.rigor.declarations.join(", "));
  }
}
