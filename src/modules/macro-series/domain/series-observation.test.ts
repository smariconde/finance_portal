import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { BcraSeriesPoint } from "./bcra-monetary-parser";
import { reconcileWithCatalog } from "./catalog-reconciliation";
import {
  checkDefinitionBasis,
  materializeObservationPlan,
  planObservations,
  resolveSeriesAt,
  type PlanObservationsInput,
  type SeriesObservation,
} from "./series-observation";

const KEY = "bcra-monetarias-v4:1";
const FIRST = "2026-11-02T12:00:00.000Z";
const SECOND = "2026-11-09T12:00:00.000Z";

function points(...pairs: [string, string][]): BcraSeriesPoint[] {
  return pairs
    .map(([periodOn, value]) => ({ periodOn, value }))
    .sort((left, right) => right.periodOn.localeCompare(left.periodOn));
}

function stored(
  input: Omit<
    PlanObservationsInput,
    "seriesKey" | "acceptMassChange" | "rejections" | "open"
  > &
    Partial<PlanObservationsInput>,
  at = FIRST,
): SeriesObservation[] {
  const plan = planObservations({
    seriesKey: KEY,
    rejections: [],
    open: [],
    acceptMassChange: false,
    ...input,
  });

  return [
    ...materializeObservationPlan(plan, {
      observedAt: at,
      recordedAt: at,
      ingestionRunId: randomUUID(),
    }),
  ];
}

/** Aplica revisiones sobre lo guardado como lo haría el repositorio. */
function apply(
  history: readonly SeriesObservation[],
  revisions: readonly SeriesObservation[],
): SeriesObservation[] {
  const next = history.map((observation) =>
    revisions.some(
      (revision) =>
        revision.periodOn === observation.periodOn &&
        observation.supersededAt === null,
    )
      ? { ...observation, supersededAt: revisions[0]!.availableAt }
      : observation,
  );

  return [...next, ...revisions];
}

function query(at: string) {
  return {
    effectiveAt: at,
    knownAt: at,
    revisionPolicy: "as_known" as const,
    knowledgeBasis: "public_availability" as const,
    adjustmentPolicy: "as_known" as const,
    sourcePolicyVersion: "source-policy-1.0.0",
  };
}

const baseline = points(
  ["2026-10-27", "100"],
  ["2026-10-28", "101"],
  ["2026-10-29", "102"],
);

describe("planObservations", () => {
  it("opens revision 0 for every point of a first download", () => {
    const plan = planObservations({
      seriesKey: KEY,
      points: baseline,
      rejections: [],
      coverage: "complete",
      open: [],
      acceptMassChange: false,
    });

    expect(plan.counts).toMatchObject({ fetched: 3, new: 3, unchanged: 0 });
    expect(plan.windowStartsOn).toBeNull();
  });

  it("writes nothing for the same values and revises a changed one", () => {
    const open = stored({ points: baseline, coverage: "complete" });
    const same = planObservations({
      seriesKey: KEY,
      points: baseline,
      rejections: [],
      coverage: "window",
      open,
      acceptMassChange: false,
    });
    const revised = planObservations({
      seriesKey: KEY,
      points: points(
        ["2026-10-27", "100"],
        ["2026-10-28", "101.5"],
        ["2026-10-29", "102"],
      ),
      rejections: [],
      coverage: "window",
      open,
      acceptMassChange: false,
    });

    expect(same.changes).toHaveLength(0);
    expect(same.counts.unchanged).toBe(3);
    expect(revised.changes).toEqual([
      expect.objectContaining({
        kind: "revised",
        periodOn: "2026-10-28",
        value: "101.5",
      }),
    ]);
  });

  it("compares only what the window covers and names where it starts", () => {
    const open = stored({ points: baseline, coverage: "complete" });
    const plan = planObservations({
      seriesKey: KEY,
      points: points(
        ["2026-10-28", "101"],
        ["2026-10-29", "102"],
        ["2026-10-30", "103"],
      ),
      rejections: [],
      coverage: "window",
      open,
      acceptMassChange: false,
    });

    // El 27 quedó fuera de la ventana: no se da por retirado.
    expect(plan.windowStartsOn).toBe("2026-10-28");
    expect(plan.changes).toEqual([
      expect.objectContaining({ kind: "new", periodOn: "2026-10-30" }),
    ]);
  });

  it("withdraws a stored point the window no longer carries, and reinstates it later", () => {
    const open = stored({ points: baseline, coverage: "complete" });
    const withdrawal = planObservations({
      seriesKey: KEY,
      points: points(["2026-10-27", "100"], ["2026-10-29", "102"]),
      rejections: [],
      coverage: "window",
      open,
      acceptMassChange: false,
    });
    const afterWithdrawal = apply(
      open,
      materializeObservationPlan(withdrawal, {
        observedAt: SECOND,
        recordedAt: SECOND,
        ingestionRunId: randomUUID(),
      }),
    );
    const reinstated = planObservations({
      seriesKey: KEY,
      points: baseline,
      rejections: [],
      coverage: "window",
      open: afterWithdrawal.filter(
        (observation) => observation.supersededAt === null,
      ),
      acceptMassChange: false,
    });

    expect(withdrawal.changes).toEqual([
      expect.objectContaining({
        kind: "withdrawn",
        periodOn: "2026-10-28",
        value: null,
      }),
    ]);
    expect(reinstated.changes).toEqual([
      expect.objectContaining({
        kind: "reinstated",
        periodOn: "2026-10-28",
        value: "101",
      }),
    ]);
  });

  it("never withdraws a point rejected for its value, and defers on a rejection without date", () => {
    const open = stored({ points: baseline, coverage: "complete" });
    const withDate = planObservations({
      seriesKey: KEY,
      points: points(["2026-10-27", "100"], ["2026-10-29", "102"]),
      rejections: [
        { row: 1, variableId: 1, field: "valor", periodOn: "2026-10-28" },
      ],
      coverage: "window",
      open,
      acceptMassChange: false,
    });
    const withoutDate = planObservations({
      seriesKey: KEY,
      points: points(["2026-10-27", "100"], ["2026-10-29", "102"]),
      rejections: [{ row: 1, variableId: 1, field: "fecha" }],
      coverage: "window",
      open,
      acceptMassChange: false,
    });

    expect(withDate.changes).toHaveLength(0);
    expect(withDate.counts.rejected).toBe(1);
    expect(withoutDate.changes).toHaveLength(0);
    expect(withoutDate.withdrawalsDeferred).toBe(true);
  });

  it("refuses a run that would revise more than a tenth of what it compared", () => {
    const thirty = Array.from({ length: 30 }, (_, index): [string, string] => [
      `2026-09-${String(index + 1).padStart(2, "0")}`,
      String(100 + index),
    ]);
    const open = stored({ points: points(...thirty), coverage: "complete" });
    // Mil veces más: lo que haría un cambio de unidad que el catálogo no avisó.
    const scaled = points(
      ...thirty.map(([date, value]): [string, string] => [date, `${value}000`]),
    );
    const refused = planObservations({
      seriesKey: KEY,
      points: scaled,
      rejections: [],
      coverage: "window",
      open,
      acceptMassChange: false,
    });
    const accepted = planObservations({
      seriesKey: KEY,
      points: scaled,
      rejections: [],
      coverage: "window",
      open,
      acceptMassChange: true,
    });

    expect(refused.guard).toEqual({ compared: 30, changed: 30, refused: true });
    expect(refused.changes).toHaveLength(0);
    expect(accepted.changes).toHaveLength(30);
  });
});

describe("checkDefinitionBasis", () => {
  const basis = {
    frequency: "daily",
    unit: "En millones de ARS",
    currencyCode: "ML",
  } as const;

  it("pins the first basis and refuses a later unit change", () => {
    expect(checkDefinitionBasis(null, basis)).toEqual({ status: "pinned" });
    expect(checkDefinitionBasis(basis, { ...basis })).toEqual({
      status: "matches",
    });
    expect(
      checkDefinitionBasis(basis, { ...basis, unit: "En miles de ARS" }),
    ).toMatchObject({ status: "definition_basis_changed" });
  });
});

describe("resolveSeriesAt", () => {
  const open = stored({ points: baseline, coverage: "complete" });
  const revision = planObservations({
    seriesKey: KEY,
    points: points(["2026-10-27", "100"], ["2026-10-29", "102.5"]),
    rejections: [],
    coverage: "window",
    open,
    acceptMassChange: false,
  });
  const history = apply(
    open,
    materializeObservationPlan(revision, {
      observedAt: SECOND,
      recordedAt: SECOND,
      ingestionRunId: randomUUID(),
    }),
  );

  it("sees nothing before the first capture", () => {
    expect(
      resolveSeriesAt(history, query("2026-11-01T00:00:00.000Z")).points,
    ).toEqual([]);
  });

  it("answers the value known at each cutoff, and hides a withdrawal without zeroing it", () => {
    const before = resolveSeriesAt(history, query("2026-11-05T00:00:00.000Z"));
    const after = resolveSeriesAt(history, query("2026-11-10T00:00:00.000Z"));

    expect(before.points.map((point) => point.value)).toEqual([
      "100",
      "101",
      "102",
    ]);
    expect(
      after.points.map((point) => [
        point.periodOn,
        point.value,
        point.revision,
      ]),
    ).toEqual([
      ["2026-10-27", "100", 0],
      ["2026-10-29", "102.5", 1],
    ]);
    expect(after.withdrawn).toBe(1);
  });

  it("counts points dated after the effective date instead of hiding them silently", () => {
    const ahead = stored({
      points: points(["2026-11-01", "1"], ["2026-11-15", "2"]),
      coverage: "complete",
    });
    const reading = resolveSeriesAt(ahead, query("2026-11-05T00:00:00.000Z"));

    expect(reading.points.map((point) => point.periodOn)).toEqual([
      "2026-11-01",
    ]);
    expect(reading.aheadOfEffective).toBe(1);
  });

  it("reads the current view with latest_restated", () => {
    const reading = resolveSeriesAt(history, {
      effectiveAt: "2026-11-10T00:00:00.000Z",
      knownAt: null,
      revisionPolicy: "latest_restated",
      knowledgeBasis: "public_availability",
      adjustmentPolicy: "as_known",
      sourcePolicyVersion: "source-policy-1.0.0",
    });

    expect(reading.points).toHaveLength(2);
  });
});

describe("reconcileWithCatalog", () => {
  const open = stored({ points: baseline, coverage: "complete" });

  it("reconciles the catalog's last value against the stored point at that date", () => {
    expect(
      reconcileWithCatalog({
        lastReportedOn: "2026-10-28",
        lastReportedValue: "101",
        stored: true,
        open: open.filter(
          (observation) => observation.periodOn >= "2026-10-28",
        ),
      }),
    ).toEqual({
      status: "reconciled",
      periodOn: "2026-10-28",
      value: "101",
      storedThroughOn: "2026-10-29",
    });
  });

  it("names a mismatch, a missing date, a series never downloaded and a catalog without value", () => {
    expect(
      reconcileWithCatalog({
        lastReportedOn: "2026-10-29",
        lastReportedValue: "103",
        stored: true,
        open,
      }),
    ).toEqual({
      status: "mismatch",
      periodOn: "2026-10-29",
      published: "103",
      stored: "102",
    });
    expect(
      reconcileWithCatalog({
        lastReportedOn: "2026-10-30",
        lastReportedValue: "103",
        stored: true,
        open: [],
      }),
    ).toEqual({ status: "not_at_date", periodOn: "2026-10-30" });
    expect(
      reconcileWithCatalog({
        lastReportedOn: "2026-10-30",
        lastReportedValue: "103",
        stored: false,
        open: [],
      }),
    ).toEqual({ status: "not_stored" });
    expect(
      reconcileWithCatalog({
        lastReportedOn: null,
        lastReportedValue: null,
        stored: true,
        open,
      }),
    ).toEqual({ status: "no_catalog_value" });
  });
});
