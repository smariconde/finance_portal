import { describe, expect, it } from "vitest";

import type {
  SectorRiskMatrix,
  SectorRiskPoint,
} from "@/modules/metrics/domain/sector-risk-matrix";
import type { SortinoResult } from "@/modules/metrics/domain/sortino";

import {
  circleOverlap,
  clipLine,
  describeCedear,
  describePoint,
  groupLabels,
  layoutMatrix,
  LOGO_MARK_RADIUS,
  niceAxis,
  placeLogoMarks,
  referenceCaptionBox,
  robustDomain,
  type PlotPoint,
} from "./matrix-layout";

const window = {
  windowYears: 2 as const,
  asOf: "2026-09-30",
  windowStart: "2024-09-30",
};

function value(v: string): SortinoResult {
  return {
    ...window,
    status: "computed",
    formulaVersion: "sortino-1.0.0",
    value: v,
    baseDate: "2024-09-30",
    returns: 501,
    downsideReturns: 230,
    meanExcessReturn: "0.001",
    downsideDeviation: "0.01",
  };
}

function missing(reason: "insufficient_history"): SortinoResult {
  return {
    ...window,
    status: "null",
    formulaVersion: "sortino-1.0.0",
    reason,
    marketDate: null,
  };
}

function point(
  id: string,
  x: SortinoResult,
  y: SortinoResult,
  overrides: Partial<SectorRiskPoint> = {},
): SectorRiskPoint {
  return {
    securityId: id,
    issuerLegalEntityId: `issuer-${id}`,
    issuerName: null,
    ticker: id.toUpperCase(),
    mic: "XNAS",
    cedear: { status: "none_known", reason: "no_program_recorded" },
    sortino2y: x,
    sortino5y: y,
    quadrant: null,
    distanceToReference: { window2y: null, window5y: null },
    ...overrides,
  };
}

function matrix(points: SectorRiskPoint[]): SectorRiskMatrix {
  return {
    ruleVersion: "sector-risk-matrix-1.0.0",
    formulaVersion: "sortino-1.0.0",
    parameters: {} as SectorRiskMatrix["parameters"],
    asOf: "2026-09-30",
    sector: {
      code: "communication-services",
      label: "Communication Services",
      taxonomyId: "sp500-wikipedia-gics-sector",
      taxonomyVersion: "pin",
    },
    reference: {
      benchmarkId: "sp500-total-return",
      label: "S&P 500 Total Return",
      sortino2y: value("1.5"),
      sortino5y: value("1.2"),
    },
    points,
    fit: {
      status: "computed",
      formulaVersion: "sector-fit-ols-1.0.0",
      n: 4,
      slope: "0.5",
      intercept: "0.2",
    },
  };
}

describe("robustDomain", () => {
  it("covers every value plus padding when nothing is extreme", () => {
    const [low, high] = robustDomain([0, 1, 2, 3]);

    expect(low).toBeLessThan(0);
    expect(high).toBeGreaterThan(3);
  });

  it("leaves an extreme value outside, to be drawn on the edge", () => {
    const [, high] = robustDomain([1, 1.1, 1.2, 1.3, 1.4, 50]);

    expect(high).toBeLessThan(50);
  });

  it("always includes the reference", () => {
    const [low] = robustDomain([1, 1.1, 1.2, 1.3], [-5]);

    expect(low).toBeLessThanOrEqual(-5);
  });

  it("opens a flat or empty range instead of dividing by zero", () => {
    expect(robustDomain([2, 2])).toEqual([1, 3]);
    expect(robustDomain([])).toEqual([-1, 1]);
  });
});

describe("niceAxis", () => {
  it("rounds the domain to a clean step with round ticks", () => {
    // Un rango de 5,1 con paso 0,5 daría 12 marcas; el paso es 1.
    expect(niceAxis([-1.93, 3.17])).toEqual({
      domain: [-2, 4],
      ticks: [-2, -1, 0, 1, 2, 3, 4],
    });
    // 0,81 con paso 0,1 son 9 marcas: el paso es 0,2.
    expect(niceAxis([0.12, 0.93]).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
});

describe("clipLine", () => {
  it("returns the visible stretch of the fit", () => {
    expect(clipLine(1, 0, [0, 10], [0, 5])).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
  });

  it("returns nothing when the line misses the plot", () => {
    expect(clipLine(0, 100, [0, 10], [0, 5])).toBeNull();
  });
});

describe("layoutMatrix", () => {
  it("draws only points with both windows and lists the rest with their reasons", () => {
    const layout = layoutMatrix(
      matrix([
        point("a", value("1"), value("1")),
        point("b", value("2"), missing("insufficient_history")),
      ]),
    );

    expect(layout.points.map((plotted) => plotted.id)).toEqual(["a"]);
    expect(layout.notDrawn).toEqual([
      expect.objectContaining({ id: "b", label: "B" }),
    ]);
  });

  it("puts an extreme point on the edge and keeps its exact value", () => {
    const layout = layoutMatrix(
      matrix([
        point("a", value("1"), value("1")),
        point("b", value("1.1"), value("1.1")),
        point("c", value("1.2"), value("1.2")),
        point("d", value("1.3"), value("1.3")),
        point("wild", value("40"), value("1.25")),
      ]),
    );
    const wild = layout.points.find((plotted) => plotted.id === "wild")!;

    expect(wild.clipX).toBe(1);
    expect(wild.x).toBe(layout.domainX[1]);
    expect(wild.rawX).toBe("40");
  });

  it("places the reference with its own label, never in a quadrant", () => {
    const layout = layoutMatrix(matrix([point("a", value("1"), value("1"))]));

    expect(layout.reference).toMatchObject({
      kind: "reference",
      label: "S&P 500 TR",
      rawX: "1.5",
      rawY: "1.2",
      quadrant: null,
    });
  });
});

describe("groupLabels", () => {
  const plotted = (id: string, x: number, y: number): PlotPoint => ({
    id,
    kind: "security",
    label: id,
    x,
    y,
    rawX: String(x),
    rawY: String(y),
    clipX: 0,
    clipY: 0,
    cedear: false,
    quadrant: null,
  });
  const plot = {
    width: 600,
    height: 400,
    domainX: [0, 3],
    domainY: [0, 2],
  } as const;

  it("merges two share classes that land on top of each other", () => {
    const groups = groupLabels(
      [plotted("GOOG", 2.06, 1.118), plotted("GOOGL", 2.077, 1.122)],
      plot,
    );

    expect(groups).toEqual([
      expect.objectContaining({
        anchorId: "GOOG",
        memberIds: ["GOOG", "GOOGL"],
        text: "GOOG · GOOGL",
        side: "right",
      }),
    ]);
  });

  it("returns the box it checked, so the text is written there", () => {
    const [group] = groupLabels([plotted("AAPL", 1.5, 1)], plot, {
      charWidth: 8,
      lineHeight: 16,
      gap: 8,
      overlap: 10,
    });

    // 1,5 de 3 → x = 300; 1 de 2 → y = 200. A la derecha, 8 px de hueco.
    expect(group!.box).toEqual({ x0: 308, y0: 192, x1: 340, y1: 208 });
  });

  it("clears the logo of a group member, not only the anchor's mark", () => {
    // GOOG ancla el rótulo como punto; GOOGL, a 2 px, lleva el logo.
    const [group] = groupLabels(
      [plotted("GOOG", 1.5, 1), plotted("GOOGL", 1.51, 1)],
      plot,
      undefined,
      null,
      (id) => (id === "GOOGL" ? LOGO_MARK_RADIUS : 5),
    );

    expect(group!.anchorId).toBe("GOOG");
    expect(group!.box.x0).toBeGreaterThanOrEqual(302 + LOGO_MARK_RADIUS);
  });

  it("pushes a label past a logo and never writes over one", () => {
    const radius = (id: string) => (id === "LOGO" ? LOGO_MARK_RADIUS : 5);
    const [own] = groupLabels(
      [plotted("LOGO", 1.5, 1)],
      plot,
      undefined,
      null,
      radius,
    );

    // El logo mide 12 de radio y la insignia CEDEAR sobresale: el rótulo
    // arranca 10 px más lejos que el de un punto.
    expect(own!.box.x0).toBe(300 + 18);

    // DOT queda a 20 px a la izquierda del logo: a su derecha lo pisaría.
    const groups = groupLabels(
      [plotted("DOT", 1.4, 1), plotted("LOGO", 1.5, 1)],
      plot,
      undefined,
      null,
      radius,
    );
    const dot = groups.find((group) => group.anchorId === "DOT")!;

    expect(dot.side).not.toBe("right");
    expect(
      dot.box.x1 <= 300 - 12 ||
        dot.box.x0 >= 300 + 12 ||
        dot.box.y1 <= 200 - 12 ||
        dot.box.y0 >= 200 + 12,
    ).toBe(true);
  });

  it("does not tie a label to a neighbour it merely sits next to", () => {
    // Medido sobre Communication Services: ECHO y GOOGL no se tapan, sólo
    // quedan cerca. Cada uno conserva su etiqueta; GOOG se une a GOOGL.
    const groups = groupLabels(
      [
        plotted("ECHO", 2.363, 1.22),
        plotted("GOOG", 2.062, 1.118),
        plotted("GOOGL", 2.077, 1.122),
      ],
      plot,
    );

    expect(groups.map((group) => group.text).sort()).toEqual([
      "ECHO",
      "GOOG · GOOGL",
    ]);
  });

  it("moves a label to another side before merging it", () => {
    const groups = groupLabels(
      // A 20 px: la etiqueta de AAAA a la derecha pisaría el punto BBBB.
      [plotted("AAAA", 1, 1), plotted("BBBB", 1.1, 1)],
      plot,
    );

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.anchorId === "AAAA")?.side).not.toBe(
      "right",
    );
  });

  it("does not write a label over the reference diamond or its caption", () => {
    // APP quedaba tapado por el rombo de la referencia, a su derecha.
    const reference = { ...plotted("ref", 1.1, 1), kind: "reference" as const };
    const [group] = groupLabels(
      [plotted("APP", 1, 1)],
      plot,
      undefined,
      reference,
    );

    expect(group!.side).not.toBe("right");
  });

  it("keeps distant points apart and summarizes a crowd", () => {
    const groups = groupLabels(
      [
        plotted("FOX", 1.117, 0.695),
        plotted("FOXA", 1.128, 0.704),
        plotted("LYV", 1.13, 0.7),
        plotted("CHTR", 0.1, 1.9),
      ],
      plot,
    );

    expect(groups.map((group) => group.text).sort()).toEqual([
      "CHTR",
      "FOX +2",
    ]);
  });
});

describe("placeLogoMarks", () => {
  const plotted = (
    id: string,
    x: number,
    y: number,
    cedear = false,
  ): PlotPoint => ({
    id,
    kind: "security",
    label: id,
    x,
    y,
    rawX: String(x),
    rawY: String(y),
    clipX: 0,
    clipY: 0,
    cedear,
    quadrant: null,
  });
  // Un píxel por cada centésima: las distancias se leen directo.
  const plot = {
    width: 300,
    height: 300,
    domainX: [0, 3],
    domainY: [0, 3],
  } as const;

  it("measures how much of a circle another one covers", () => {
    expect(circleOverlap(12, 0)).toBe(1);
    expect(circleOverlap(12, 24)).toBe(0);
    expect(circleOverlap(12, 30)).toBe(0);
    // Media distancia del diámetro: un poco menos de 40 %.
    expect(circleOverlap(12, 12)).toBeCloseTo(0.391, 3);
  });

  it("gives a logo to every mark that has room", () => {
    const marks = placeLogoMarks(
      [plotted("A", 0.5, 0.5), plotted("B", 1.5, 1.5), plotted("C", 2.5, 2.5)],
      plot,
    );

    expect([...marks].sort()).toEqual(["A", "B", "C"]);
  });

  it("keeps the second of two stacked marks as a dot, CEDEAR first", () => {
    // 10 px: se taparían más de la mitad.
    const marks = placeLogoMarks(
      [plotted("AAA", 1, 1), plotted("ZZZ", 1.1, 1, true)],
      plot,
    );

    expect([...marks]).toEqual(["ZZZ"]);
  });

  it("allows a small overlap and refuses a large one", () => {
    // 18 px: tapa ~23 %; 14 px: ~41 %.
    expect(
      placeLogoMarks([plotted("A", 1, 1), plotted("B", 1.18, 1)], plot).size,
    ).toBe(2);
    expect(
      placeLogoMarks([plotted("A", 1, 1), plotted("B", 1.14, 1)], plot).size,
    ).toBe(1);
  });

  it("never covers the reference diamond", () => {
    const reference = { ...plotted("ref", 1, 1), kind: "reference" as const };

    expect(placeLogoMarks([plotted("A", 1.05, 1)], plot, reference).size).toBe(
      0,
    );
  });

  it("never covers the reference caption", () => {
    // El rótulo «S&P 500 TR» va de 15 a ~95 px a la derecha del rombo y de
    // 22 a 8 px por encima: un logo 40 px a la derecha y 15 arriba lo pisaría.
    const reference = { ...plotted("ref", 1, 1), kind: "reference" as const };

    expect(
      placeLogoMarks([plotted("A", 1.4, 1.15)], plot, reference).size,
    ).toBe(0);
    expect(placeLogoMarks([plotted("A", 1.4, 0.8)], plot, reference).size).toBe(
      1,
    );
  });

  it("moves the reference caption inside the plot near its right or top edge", () => {
    const right = { ...plotted("ref", 2.8, 1.5), kind: "reference" as const };
    const top = { ...plotted("ref", 1, 2.9), kind: "reference" as const };
    const rightBox = referenceCaptionBox(right, plot, () => 72);
    const topBox = referenceCaptionBox(top, plot, () => 72);

    expect(rightBox.x1).toBeLessThan(280);
    expect(rightBox.x0).toBeGreaterThanOrEqual(0);
    expect(topBox.y0).toBeGreaterThan(10);
    expect(topBox.y1).toBeLessThanOrEqual(plot.height);
  });

  it("leaves room around the reference diamond", () => {
    const reference = { ...plotted("ref", 1, 1), kind: "reference" as const };

    expect(placeLogoMarks([plotted("A", 1.2, 1)], plot, reference).size).toBe(
      0,
    );
    expect(placeLogoMarks([plotted("A", 1.3, 0.7)], plot, reference).size).toBe(
      1,
    );
  });

  it("does not depend on the order the points arrive in", () => {
    const points = [
      plotted("B", 1, 1),
      plotted("A", 1.1, 1),
      plotted("C", 1.05, 1.1, true),
    ];

    expect([...placeLogoMarks(points, plot)]).toEqual([
      ...placeLogoMarks([...points].reverse(), plot),
    ]);
  });
});

describe("descriptions", () => {
  it("names a CEDEAR with its exact ratio and its status", () => {
    expect(
      describeCedear({
        status: "program",
        sourceId: "comafi-cedear",
        programs: 1,
        programStatus: "suspended",
        ratio: { depositaryUnits: "3.1", underlyingUnits: "1" },
      }),
    ).toBe("CEDEAR 3,1:1 (suspendido)");
    expect(
      describeCedear({
        status: "none_known",
        reason: "not_effective_at_cutoff",
      }),
    ).toBe("Sin programa vigente a la fecha");
  });

  it("reads a point as one sentence, with the reason when a window is missing", () => {
    expect(
      describePoint(
        point("rddt", value("1.406"), missing("insufficient_history"), {
          issuerName: "Reddit, Inc.",
        }),
      ),
    ).toBe(
      "RDDT, Reddit, Inc.; Sortino 2 años 1,41; 5 años Historia insuficiente; Sin CEDEAR",
    );
  });
});
