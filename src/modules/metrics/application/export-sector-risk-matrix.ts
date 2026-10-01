import type { SourceRegistryEntry } from "@/modules/ingestion/domain/source-registry-entry";
import type { SortinoResult } from "@/modules/metrics/domain/sortino";

import type { SectorRiskMatrixReading } from "./load-sector-risk-matrix";

/** F7-06: una tabla rectangular que una planilla puede leer sin perder el contrato. */
export const SECTOR_RISK_EXPORT_VERSION = "sector-risk-export-1.0.0";
export const SECTOR_RISK_EXPORT_SOURCE_IDS = [
  "datahub-sp500-pddl",
  "yahoo-finance",
  "comafi-cedear",
  "caja-valores-cedear",
] as const;

export type SectorRiskExportSources = ReadonlyMap<string, SourceRegistryEntry>;

/** Todos aportan a la matriz, incluso los dos emisores que prueban una ausencia CEDEAR. */
export function canExportSectorRiskSources(
  sources: SectorRiskExportSources,
  at: string,
): boolean {
  return SECTOR_RISK_EXPORT_SOURCE_IDS.every((id) => {
    const source = sources.get(id);
    return (
      source !== undefined &&
      ["approved_personal", "approved_public_demo"].includes(
        source.approvalStatus,
      ) &&
      ["allowed", "owner_accepted"].includes(source.rights.export) &&
      source.rightsReviewedAt !== null &&
      (source.rightsReviewDueAt === null || source.rightsReviewDueAt > at)
    );
  });
}

/** El apóstrofo impide que nombres/símbolos de fuente se ejecuten como fórmulas. */
function csvText(value: string | null): string {
  if (value === null) return "";
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csvNumber(value: string | number | null): string {
  return value === null ? "" : String(value);
}

function sortinoValue(result: SortinoResult): string {
  return result.status === "computed" ? csvNumber(result.value) : "";
}

function sortinoReason(result: SortinoResult): string {
  return result.status === "null" ? csvText(result.reason) : "";
}

const HEADERS = [
  "record_type",
  "export_version",
  "sector_code",
  "sector_label",
  "as_of",
  "requested_as_of",
  "exported_at_utc",
  "identity_knowledge_cutoff_utc",
  "identity_revision_policy",
  "taxonomy_id",
  "taxonomy_version",
  "population_rule_version",
  "index_id",
  "unclassified_count",
  "matrix_version",
  "sortino_version",
  "return_basis_version",
  "metric_unit",
  "sortino_definition",
  "null_definition",
  "population_definition",
  "fit_definition",
  "comparison_definition",
  "minimum_acceptable_return",
  "frequency",
  "periods_per_year",
  "numerator",
  "window_boundary",
  "max_gap_calendar_days",
  "reference_id",
  "fit_version",
  "fit_n",
  "fit_slope",
  "fit_intercept",
  "fit_reason",
  "price_source_id",
  "price_source_url",
  "price_attribution",
  "population_source_id",
  "population_source_url",
  "population_attribution",
  "cedear_sources",
  "cedear_source_urls",
  "cedear_attribution",
  "rights_note",
  "subject_id",
  "ticker",
  "mic",
  "issuer_name",
  "cedear_status",
  "cedear_reason",
  "cedear_program_count",
  "cedear_ratio",
  "cedear_source_id",
  "sortino_2y",
  "sortino_2y_null_reason",
  "sortino_2y_null_market_date",
  "sortino_2y_window_start",
  "sortino_2y_base_date",
  "sortino_2y_returns",
  "sortino_2y_downside_returns",
  "sortino_2y_mean_excess_return",
  "sortino_2y_downside_deviation",
  "sortino_5y",
  "sortino_5y_null_reason",
  "sortino_5y_null_market_date",
  "sortino_5y_window_start",
  "sortino_5y_base_date",
  "sortino_5y_returns",
  "sortino_5y_downside_returns",
  "sortino_5y_mean_excess_return",
  "sortino_5y_downside_deviation",
  "reference_quadrant",
  "distance_to_reference_2y",
  "distance_to_reference_5y",
] as const;

/** Valores numéricos canónicos (punto decimal), sin redondeo de presentación. */
export function serializeSectorRiskMatrixCsv(
  reading: SectorRiskMatrixReading,
  sources: SectorRiskExportSources,
  exportedAt: string,
): string {
  const { matrix } = reading;
  const price = sources.get("yahoo-finance")!;
  const population = sources.get("datahub-sp500-pddl")!;
  const comafi = sources.get("comafi-cedear")!;
  const caja = sources.get("caja-valores-cedear")!;
  const fit = matrix.fit;

  const common = [
    csvText(matrix.sector.code),
    csvText(matrix.sector.label),
    csvText(matrix.asOf),
    csvText(reading.requestedAsOf),
    csvText(exportedAt),
    csvText(`${matrix.asOf}T23:59:59.999Z`),
    csvText("as_known"),
    csvText(matrix.sector.taxonomyId),
    csvText(matrix.sector.taxonomyVersion),
    csvText(reading.population.ruleVersion),
    csvText(reading.population.indexId),
    csvNumber(reading.population.unclassified),
    csvText(matrix.ruleVersion),
    csvText(matrix.formulaVersion),
    csvText(matrix.parameters.returnBasis),
    csvText("ratio (sin unidad)"),
    csvText(
      "mean(r_t - MAR) / sqrt(sum(min(0, r_t - MAR)^2) / N) * sqrt(k); N incluye todos los retornos diarios",
    ),
    csvText(
      "Un valor ausente lleva motivo; nunca equivale a cero. Sin historia, cierre, continuidad o downside suficiente no se calcula.",
    ),
    csvText(
      "Securities de miembros del índice clasificadas en el sector al cierre; excluye salidas anteriores (sesgo de supervivencia). Cada clase es un punto.",
    ),
    csvText(
      "Mínimos cuadrados: Sortino 5Y (Y) sobre Sortino 2Y (X), sólo securities con ambos valores; excluye la referencia. No representa valor justo.",
    ),
    csvText(
      "Distancia = Sortino de la security menos Sortino de la referencia en la misma ventana; cuadrante compara ambos valores con la referencia.",
    ),
    csvNumber(matrix.parameters.minimumAcceptableReturn),
    csvText(matrix.parameters.frequency),
    csvNumber(matrix.parameters.periodsPerYear),
    csvText(matrix.parameters.numerator),
    csvText(matrix.parameters.windowBoundary),
    csvNumber(matrix.parameters.maxGapCalendarDays),
    csvText(matrix.reference.benchmarkId),
    csvText(fit.formulaVersion),
    csvNumber(fit.n),
    fit.status === "computed" ? csvNumber(fit.slope) : "",
    fit.status === "computed" ? csvNumber(fit.intercept) : "",
    fit.status === "null" ? csvText(fit.reason) : "",
    csvText(price.sourceId),
    csvText(price.canonicalUrl),
    csvText(price.attribution),
    csvText(population.sourceId),
    csvText(population.canonicalUrl),
    csvText(population.attribution),
    csvText(`${comafi.sourceId}|${caja.sourceId}`),
    csvText(`${comafi.canonicalUrl}|${caja.canonicalUrl}`),
    csvText([comafi.attribution, caja.attribution].filter(Boolean).join("; ")),
    csvText(
      "Export personal. Yahoo, Comafi y Caja de Valores: owner_accepted, sin concesión contractual; Comafi prohíbe distribución. No redistribuir.",
    ),
  ];

  const measure = (result: SortinoResult) => [
    sortinoValue(result),
    sortinoReason(result),
    result.status === "null" ? csvText(result.marketDate) : "",
    csvText(result.windowStart),
    result.status === "computed" ? csvText(result.baseDate) : "",
    result.status === "computed" ? csvNumber(result.returns) : "",
    result.status === "computed" ? csvNumber(result.downsideReturns) : "",
    result.status === "computed" ? csvNumber(result.meanExcessReturn) : "",
    result.status === "computed" ? csvNumber(result.downsideDeviation) : "",
  ];

  const row = (
    kind: "reference" | "security",
    id: string | null,
    ticker: string | null,
    mic: string | null,
    issuer: string | null,
    cedear: {
      status: string;
      reason: string | null;
      count: number | null;
      ratio: string | null;
      sourceId: string | null;
    },
    two: SortinoResult,
    five: SortinoResult,
    quadrant: string | null,
    distance2y: string | null,
    distance5y: string | null,
  ) =>
    [
      csvText(kind),
      csvText(SECTOR_RISK_EXPORT_VERSION),
      ...common,
      csvText(id),
      csvText(ticker),
      csvText(mic),
      csvText(issuer),
      csvText(cedear.status),
      csvText(cedear.reason),
      csvNumber(cedear.count),
      csvText(cedear.ratio),
      csvText(cedear.sourceId),
      ...measure(two),
      ...measure(five),
      csvText(quadrant),
      csvNumber(distance2y),
      csvNumber(distance5y),
    ].join(",");

  const rows = [
    row(
      "reference",
      matrix.reference.benchmarkId,
      "^SP500TR",
      null,
      matrix.reference.label,
      {
        status: "not_applicable",
        reason: null,
        count: null,
        ratio: null,
        sourceId: null,
      },
      matrix.reference.sortino2y,
      matrix.reference.sortino5y,
      null,
      null,
      null,
    ),
    ...matrix.points.map((point) =>
      row(
        "security",
        point.securityId,
        point.ticker,
        point.mic,
        point.issuerName,
        point.cedear.status === "program"
          ? {
              status: point.cedear.programStatus,
              reason: null,
              count: point.cedear.programs,
              ratio:
                point.cedear.ratio === null
                  ? null
                  : `${point.cedear.ratio.depositaryUnits}:${point.cedear.ratio.underlyingUnits}`,
              sourceId: point.cedear.sourceId,
            }
          : {
              status: "none_known",
              reason: point.cedear.reason,
              count: null,
              ratio: null,
              sourceId: null,
            },
        point.sortino2y,
        point.sortino5y,
        point.quadrant,
        point.distanceToReference.window2y,
        point.distanceToReference.window5y,
      ),
    ),
  ];

  return `\uFEFF${HEADERS.join(",")}\r\n${rows.join("\r\n")}\r\n`;
}
