import { parseArgs } from "node:util";

import { readLineageObservations } from "@/modules/corporate-actions/application/read-lineage-observations";
import { DECLARED_GATE_SAMPLE } from "@/modules/fundamentals/application/declared-gate-sample";
import {
  GATE_SAMPLE_VERSION,
  selectBatch,
  type GateSampleEntry,
} from "@/modules/fundamentals/domain/gate-reconciliation-sample";
import {
  checkCoherence,
  edgarFilingUrl,
  isReported,
  RECONCILIATION_ANCHORS,
  RECONCILIATION_VERSION,
  type AnchorReading,
} from "@/modules/fundamentals/domain/reconciliation-anchors";
import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import type { BasisRow } from "@/modules/corporate-actions/domain/split-adjustment";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";
import { getCorporateActionRepository } from "@/server/persistence/get-corporate-action-repository";
import { getObservationRepository } from "@/server/persistence/get-observation-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";

/**
 * Hoja de reconciliación de la muestra del gate (`F2-07`, incremento 2).
 *
 * Arma, por empresa, las anclas del último ejercicio publicado, leídas por el
 * mismo camino que usa la aplicación (`readLineageObservations`), con el
 * concepto que dio cada número, la presentación que lo publicó y su URL pública.
 * Eso es lo que un humano abre al lado del filing para reconciliar.
 *
 * Lo que sí decide solo es la coherencia interna: que el balance cierre y que la
 * EPS diluida por las acciones diluidas dé el resultado. No prueba que el número
 * sea el del filing —para eso hay que abrirlo—, pero sí detecta lo que se rompe
 * cuando una unidad, un signo o una escala se perdieron en la ingesta.
 *
 *   pnpm gate:reconcile                 # la tanda 1
 *   pnpm gate:reconcile --batch 2
 *   pnpm gate:reconcile --ticker JPM
 *   pnpm gate:reconcile --json
 *
 * No sale a la red y no escribe nada.
 */
const { values } = parseArgs({
  options: {
    batch: { type: "string", default: "1" },
    ticker: { type: "string", multiple: true, default: [] },
    json: { type: "boolean", default: false },
  },
});

const batch = Number.parseInt(values.batch, 10);

if (!Number.isInteger(batch)) {
  console.error("--batch toma un entero.");
  process.exit(2);
}

const selected: readonly GateSampleEntry[] =
  values.ticker.length > 0
    ? DECLARED_GATE_SAMPLE.filter((entry) =>
        values.ticker.includes(entry.ticker),
      )
    : selectBatch(DECLARED_GATE_SAMPLE, batch);

if (selected.length === 0) {
  console.error("La selección no incluye ninguna empresa declarada.");
  process.exit(2);
}

const observations = getObservationRepository();
const corporateActions = getCorporateActionRepository();
const state = await getUniverseRepository().loadState({
  indexId: SP500_INDEX_ID,
});
const identity = createGraphIdentityResolver(() => state.graph);

const NOW = new Date().toISOString();

/** Vista actual: para reconciliar contra el filing más reciente que lo enmendó. */
const query = pointInTimeQuerySchema.parse({
  effectiveAt: NOW,
  revisionPolicy: "latest_restated",
  adjustmentPolicy: "as_known",
  sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
});

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(26)} ${String(value)}`);
}

/**
 * Cierre del último ejercicio publicado. Todas las anclas se piden a esa fecha,
 * también las de balance: mezclar el balance del último trimestre con el
 * resultado del ejercicio obligaría a abrir dos presentaciones para reconciliar
 * una sola hoja, y el residuo dejaría de decir algo sobre un filing.
 */
function latestFiscalYearEnd(rows: readonly BasisRow[]): string | null {
  const annual = RECONCILIATION_ANCHORS.filter(
    (definition) => definition.periodType === "annual",
  ).flatMap((definition) => definition.concepts);

  const ends = rows
    .filter(
      (row) =>
        row.observation.periodType === "annual" &&
        annual.includes(row.observation.concept) &&
        row.value !== null,
    )
    .map((row) => row.observation.asOf)
    .sort();

  return ends[ends.length - 1] ?? null;
}

/**
 * El ancla del ejercicio pedido. Entre conceptos alternativos gana el declarado
 * primero, y el informe dice cuál fue.
 */
function pickAnchor(
  rows: readonly BasisRow[],
  definition: (typeof RECONCILIATION_ANCHORS)[number],
  fiscalYearEnd: string | null,
): AnchorReading {
  for (const concept of definition.concepts) {
    const candidates = rows
      .filter(
        (row) =>
          row.observation.concept === concept &&
          row.observation.periodType === definition.periodType &&
          row.value !== null &&
          (fiscalYearEnd === null || row.observation.asOf === fiscalYearEnd),
      )
      .sort((left, right) =>
        right.observation.asOf.localeCompare(left.observation.asOf),
      );

    const best = candidates[0];

    if (best !== undefined) {
      return {
        anchor: definition.anchor,
        concept,
        value: best.value,
        unit: best.observation.unit,
        currency: best.observation.currency,
        asOf: best.observation.asOf,
        sourceDocumentId: best.observation.sourceDocumentId,
        availableAt: best.observation.availableAt,
      };
    }
  }

  return {
    anchor: definition.anchor,
    concept: null,
    value: null,
    unit: null,
    currency: null,
    asOf: null,
    sourceDocumentId: null,
    availableAt: null,
  };
}

type CompanyReport = {
  readonly ticker: string;
  readonly archetype: string;
  readonly cik: string;
  readonly fiscalYearEnd: string | null;
  readonly readings: readonly AnchorReading[];
  readonly coherence: ReturnType<typeof checkCoherence>;
};

const reports: CompanyReport[] = [];

for (const entry of selected) {
  const resolution = await identity.resolve({ symbol: entry.ticker }, query);

  // `IdentityResolution` no es una unión discriminada: el id sigue siendo
  // nullable después de mirar el estado, así que se comprueba explícitamente.
  const legalEntityId =
    resolution.status === "resolved" ? resolution.legalEntityId : null;

  if (legalEntityId === null) {
    console.error(
      `${entry.ticker}: no resuelve en el grafo de identidad (${resolution.status}).`,
    );
    process.exit(2);
  }

  const assignment = state.graph.identifierAssignments.find(
    (candidate) =>
      candidate.identifierType === "cik" &&
      candidate.subjectType === "legal_entity" &&
      candidate.subjectId === legalEntityId,
  );

  if (assignment === undefined) {
    console.error(`${entry.ticker}: resuelve pero no tiene CIK asignado.`);
    process.exit(2);
  }

  const selection = await readLineageObservations(
    {
      legalEntityId,
      metricIds: RECONCILIATION_ANCHORS.flatMap(
        (definition) => definition.concepts,
      ),
    },
    query,
    { corporateActions, observations },
  );

  const fiscalYearEnd = latestFiscalYearEnd(selection.rows);
  const readings = RECONCILIATION_ANCHORS.map((definition) =>
    pickAnchor(selection.rows, definition, fiscalYearEnd),
  );

  reports.push({
    ticker: entry.ticker,
    archetype: entry.archetype,
    cik: assignment.normalizedValue,
    fiscalYearEnd,
    readings,
    coherence: checkCoherence(readings),
  });
}

if (values.json) {
  console.log(
    JSON.stringify(
      { version: RECONCILIATION_VERSION, sample: GATE_SAMPLE_VERSION, reports },
      null,
      2,
    ),
  );
} else {
  log("reconciliación", RECONCILIATION_VERSION);
  log("muestra", GATE_SAMPLE_VERSION);
  log("empresas", reports.length);

  for (const report of reports) {
    console.log(
      `\n── ${report.ticker} · ${report.archetype} · CIK ${report.cik} · ejercicio ${report.fiscalYearEnd ?? "—"}`,
    );

    for (const anchor of report.readings) {
      if (!isReported(anchor)) {
        console.log(`  ${anchor.anchor.padEnd(16)} no reportada`);
        continue;
      }

      console.log(
        `  ${anchor.anchor.padEnd(16)} ${anchor.value} ${anchor.currency ?? anchor.unit} · ${anchor.asOf} · ${anchor.concept}`,
      );
      console.log(
        `  ${"".padEnd(16)} ${edgarFilingUrl(report.cik, anchor.sourceDocumentId!)}`,
      );
    }

    for (const check of report.coherence) {
      console.log(
        `  ${check.check.padEnd(16)} ${check.status}${
          check.residualPct === null ? "" : ` · residuo ${check.residualPct} %`
        }${check.missing.length === 0 ? "" : ` · falta ${check.missing.join(", ")}`}`,
      );
    }
  }

  const unreported = reports.flatMap((report) =>
    report.readings.filter((anchor) => !isReported(anchor)),
  ).length;
  const notEvaluable = reports.flatMap((report) =>
    report.coherence.filter((check) => check.status === "not_evaluable"),
  ).length;
  const residual = reports.flatMap((report) =>
    report.coherence.filter((check) => check.status === "residual"),
  ).length;

  console.log("");
  log(
    "anclas no reportadas",
    `${unreported} de ${reports.length * RECONCILIATION_ANCHORS.length}`,
  );
  log("chequeos sin evaluar", notEvaluable);
  log("chequeos con residuo", residual);
}
