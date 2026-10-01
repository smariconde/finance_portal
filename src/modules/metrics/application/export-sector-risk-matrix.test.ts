import { describe, expect, it } from "vitest";

import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  SECTOR_FIT_VERSION,
  SECTOR_RISK_MATRIX_VERSION,
} from "@/modules/metrics/domain/sector-risk-matrix";
import {
  SORTINO_FORMULA_VERSION,
  SORTINO_PARAMETERS,
  type SortinoResult,
} from "@/modules/metrics/domain/sortino";

import type { SectorRiskMatrixReading } from "./load-sector-risk-matrix";
import {
  canExportSectorRiskSources,
  SECTOR_RISK_EXPORT_SOURCE_IDS,
  serializeSectorRiskMatrixCsv,
} from "./export-sector-risk-matrix";

const AT = "2026-10-01T15:00:00.000Z";
const AS_OF = "2026-09-30";
const sources = new Map(
  DEMO_SOURCE_REGISTRY.filter((entry) =>
    SECTOR_RISK_EXPORT_SOURCE_IDS.some((id) => id === entry.sourceId),
  ).map((entry) => [entry.sourceId, entry]),
);

function computed(windowYears: 2 | 5, value: string): SortinoResult {
  return {
    status: "computed",
    formulaVersion: SORTINO_FORMULA_VERSION,
    windowYears,
    asOf: AS_OF,
    windowStart: `${2026 - windowYears}-09-30`,
    baseDate: `${2026 - windowYears}-09-30`,
    returns: windowYears * 252,
    downsideReturns: 120,
    meanExcessReturn: "0.001",
    downsideDeviation: "0.002",
    value,
  };
}

const noHistory: SortinoResult = {
  status: "null",
  formulaVersion: SORTINO_FORMULA_VERSION,
  windowYears: 5,
  asOf: AS_OF,
  windowStart: "2021-09-30",
  reason: "insufficient_history",
  marketDate: null,
};

const reading: SectorRiskMatrixReading = {
  requestedAsOf: "2026-10-01",
  quality: {
    ruleVersion: "sector-risk-quality-1.0.0",
    status: "degraded",
    score: 60,
    population: 1,
    computed2y: 1,
    computed5y: 0,
    comparable: 0,
    seriesWithoutRows: 0,
    daysSinceClose: 1,
    components: {
      completeness: 50,
      freshness: 100,
      comparability: 0,
      validation: 100,
      agreement: null,
    },
  },
  population: {
    ruleVersion: "sector-population-1.0.0",
    indexId: "sp500",
    unclassified: 1,
  },
  seriesWithoutRows: 0,
  matrix: {
    ruleVersion: SECTOR_RISK_MATRIX_VERSION,
    formulaVersion: SORTINO_FORMULA_VERSION,
    parameters: SORTINO_PARAMETERS,
    asOf: AS_OF,
    sector: {
      code: "energy",
      label: "Energy",
      taxonomyId: "sp500-wikipedia-gics-sector",
      taxonomyVersion: "abc123",
    },
    reference: {
      benchmarkId: "sp500-total-return",
      label: "S&P 500 Total Return",
      sortino2y: computed(2, "1.123456789"),
      sortino5y: computed(5, "0.987654321"),
    },
    fit: {
      status: "null",
      formulaVersion: SECTOR_FIT_VERSION,
      n: 1,
      reason: "too_few_points",
    },
    points: [
      {
        securityId: "security-1",
        issuerLegalEntityId: "issuer-1",
        ticker: '=HYPERLINK("https://bad.invalid")',
        mic: "XNYS",
        issuerName: 'Issuer, "A"',
        cedear: {
          status: "program",
          sourceId: "comafi-cedear",
          programStatus: "active",
          programs: 1,
          ratio: { depositaryUnits: "3", underlyingUnits: "1" },
        },
        sortino2y: computed(2, "-0.123456789"),
        sortino5y: noHistory,
        quadrant: null,
        distanceToReference: { window2y: "-1.246913578", window5y: null },
      },
    ],
  },
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (character === "\n" && !quoted) {
      row.push(cell.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  return rows;
}

describe("sector risk CSV export", () => {
  it("fails closed when a contributing source is missing, restricted or past review", () => {
    expect(canExportSectorRiskSources(sources, AT)).toBe(true);
    const missing = new Map(sources);
    missing.delete("caja-valores-cedear");
    expect(canExportSectorRiskSources(missing, AT)).toBe(false);

    const restricted = new Map(sources);
    restricted.set("yahoo-finance", {
      ...sources.get("yahoo-finance")!,
      rights: { ...sources.get("yahoo-finance")!.rights, export: "restricted" },
    });
    expect(canExportSectorRiskSources(restricted, AT)).toBe(false);

    const expired = new Map(sources);
    expired.set("comafi-cedear", {
      ...sources.get("comafi-cedear")!,
      rightsReviewDueAt: "2026-09-30T00:00:00.000Z",
    });
    expect(canExportSectorRiskSources(expired, AT)).toBe(false);
  });

  it("exports the reference, exact values, null reasons and source attribution in rectangular CSV", () => {
    const csv = serializeSectorRiskMatrixCsv(reading, sources, AT);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [headers, reference, security] = parseCsv(csv.slice(1));
    expect(reference).toHaveLength(headers!.length);
    expect(security).toHaveLength(headers!.length);
    const ref = Object.fromEntries(
      headers!.map((name, i) => [name, reference![i]]),
    );
    const point = Object.fromEntries(
      headers!.map((name, i) => [name, security![i]]),
    );

    expect(ref.record_type).toBe("reference");
    expect(ref.export_version).toBe("sector-risk-export-1.0.0");
    expect(ref.sortino_2y).toBe("1.123456789");
    expect(point.record_type).toBe("security");
    expect(point.sortino_2y).toBe("-0.123456789");
    expect(point.sortino_5y).toBe("");
    expect(point.sortino_5y_null_reason).toBe("insufficient_history");
    expect(point.sortino_2y_downside_returns).toBe("120");
    expect(point.sortino_2y_mean_excess_return).toBe("0.001");
    expect(point.sortino_2y_downside_deviation).toBe("0.002");
    expect(point.metric_unit).toBe("ratio (sin unidad)");
    expect(point.cedear_source_urls).toContain("comafi.com.ar");
    expect(point.distance_to_reference_5y).toBe("");
    expect(point.cedear_source_id).toBe("comafi-cedear");
    expect(point.cedear_ratio).toBe("3:1");
    expect(point.ticker).toBe('\'=HYPERLINK("https://bad.invalid")');
    expect(point.issuer_name).toBe('Issuer, "A"');
    expect(point.sortino_definition).toContain("sqrt(k)");
    expect(point.price_attribution).toBe("Yahoo Finance");
    expect(point.population_attribution).toContain("PDDL");
    expect(point.exported_at_utc).toBe(AT);
    expect(point.identity_knowledge_cutoff_utc).toBe(
      "2026-09-30T23:59:59.999Z",
    );
  });
});
