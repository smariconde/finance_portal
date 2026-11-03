import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { BcraCatalogEntry } from "./bcra-monetary-parser";
import {
  planCatalog,
  resolveDefinitionAt,
  type PlanCatalogInput,
  type SeriesDefinition,
} from "./series-definition";

const FIRST = "2026-11-02T12:00:00.000Z";
const SECOND = "2026-12-02T12:00:00.000Z";

function entry(
  variableId: number,
  overrides: Partial<BcraCatalogEntry> = {},
): BcraCatalogEntry {
  return {
    variableId,
    description: `Variable ${variableId}`,
    category: "Principales Variables",
    seriesType: "Saldos",
    frequency: "daily",
    unit: "En millones de ARS",
    currencyCode: "ML",
    firstReportedOn: "1996-01-02",
    lastReportedOn: "2026-10-29",
    lastReportedValue: "100",
    ...overrides,
  };
}

function plan(
  entries: readonly BcraCatalogEntry[],
  current: readonly SeriesDefinition[],
  overrides: Partial<PlanCatalogInput> = {},
) {
  return planCatalog({
    entries,
    methodologies: new Map(
      entries.map((row) => [row.variableId, `Metodología ${row.variableId}`]),
    ),
    rejections: [],
    current,
    observedAt: current.length === 0 ? FIRST : SECOND,
    recordedAt: current.length === 0 ? FIRST : SECOND,
    sourceDocumentId:
      "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias?offset=0&limit=1000",
    parserVersion: "bcra-monetarias-v4-1.0.0",
    ingestionRunId: randomUUID(),
    acceptWithdrawals: false,
    newId: () => randomUUID(),
    ...overrides,
  });
}

const tenVariables = Array.from({ length: 10 }, (_, index) => entry(index + 1));

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

describe("planCatalog", () => {
  it("opens one definition per variable, available from the observation", () => {
    const first = plan(tenVariables, []);

    expect(first.opened).toHaveLength(10);
    expect(first.opened[0]).toMatchObject({
      seriesKey: "bcra-monetarias-v4:1",
      externalId: "1",
      methodology: "Metodología 1",
      validFrom: FIRST,
      availableAt: FIRST,
    });
  });

  it("writes nothing when only the last value and last date moved", () => {
    const current = plan(tenVariables, []).opened;
    const next = plan(
      tenVariables.map((row) => ({
        ...row,
        lastReportedOn: "2026-11-30",
        lastReportedValue: "999",
      })),
      current,
    );

    expect(next.unchanged).toBe(10);
    expect(next.opened).toHaveLength(0);
    expect(next.superseded).toHaveLength(0);
  });

  it("supersedes a variable whose unit, frequency, currency or methodology changed", () => {
    const current = plan(tenVariables, []).opened;
    const next = plan(
      tenVariables.map((row) =>
        row.variableId === 2 ? { ...row, unit: "En miles de ARS" } : row,
      ),
      current,
      {
        methodologies: new Map(
          tenVariables.map((row) => [
            row.variableId,
            row.variableId === 3
              ? "Otra metodología"
              : `Metodología ${row.variableId}`,
          ]),
        ),
      },
    );

    expect(next.superseded.map((pair) => pair.next.seriesKey)).toEqual([
      "bcra-monetarias-v4:2",
      "bcra-monetarias-v4:3",
    ]);
    expect(next.unchanged).toBe(8);
  });

  it("closes a variable the catalog stopped listing, below the guard", () => {
    const current = plan(tenVariables, []).opened;
    const next = plan(tenVariables.slice(1), current);

    expect(next.withdrawn.map((definition) => definition.seriesKey)).toEqual([
      "bcra-monetarias-v4:1",
    ]);
    expect(next.withdrawn[0]!.validTo).toBe(SECOND);
  });

  it("refuses to close more than a tenth of the catalog unless the owner accepts it", () => {
    const current = plan(tenVariables, []).opened;
    const refused = plan(tenVariables.slice(2), current);
    const accepted = plan(tenVariables.slice(2), current, {
      acceptWithdrawals: true,
    });

    expect(refused.guard).toEqual({ withdrawals: 2, open: 10, refused: true });
    expect(refused.withdrawn).toHaveLength(0);
    expect(accepted.withdrawn).toHaveLength(2);
  });

  it("never closes a variable the parser rejected, and defers when a row had no id", () => {
    const current = plan(tenVariables, []).opened;
    const rejectedWithId = plan(tenVariables.slice(1), current, {
      rejections: [{ row: 0, variableId: 1, field: "moneda" }],
    });
    const rejectedWithoutId = plan(tenVariables.slice(1), current, {
      rejections: [{ row: 0, variableId: null, field: "idVariable" }],
    });

    expect(rejectedWithId.withdrawn).toHaveLength(0);
    expect(rejectedWithId.withdrawalsDeferred).toBe(false);
    expect(rejectedWithoutId.withdrawn).toHaveLength(0);
    expect(rejectedWithoutId.withdrawalsDeferred).toBe(true);
  });

  it("counts variables published without a methodology and keeps them null", () => {
    const first = plan(tenVariables, [], {
      methodologies: new Map([[1, "Texto"]]),
    });

    expect(first.methodologyMissing).toBe(9);
    expect(first.opened[1]!.methodology).toBeNull();
  });

  it("refuses an observation that does not follow the open definition", () => {
    const current = plan(tenVariables, []).opened;

    expect(() => plan(tenVariables, current, { observedAt: FIRST })).toThrow(
      /does not follow/u,
    );
  });
});

describe("resolveDefinitionAt", () => {
  it("sees nothing before the first capture and the superseded version before the change", () => {
    const first = plan(tenVariables, []).opened.filter(
      (definition) => definition.seriesKey === "bcra-monetarias-v4:2",
    );
    const next = plan(
      tenVariables.map((row) =>
        row.variableId === 2 ? { ...row, unit: "En miles de ARS" } : row,
      ),
      plan(tenVariables, []).opened.map((definition) =>
        definition.seriesKey === "bcra-monetarias-v4:2"
          ? first[0]!
          : definition,
      ),
    ).superseded[0]!;
    const history = [
      { ...next.previous, supersededAt: next.next.availableAt },
      next.next,
    ];

    expect(
      resolveDefinitionAt(history, query("2026-11-01T00:00:00.000Z")),
    ).toBeNull();
    expect(
      resolveDefinitionAt(history, query("2026-11-15T00:00:00.000Z"))?.unit,
    ).toBe("En millones de ARS");
    expect(
      resolveDefinitionAt(history, query("2026-12-15T00:00:00.000Z"))?.unit,
    ).toBe("En miles de ARS");
  });
});
