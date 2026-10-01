import { describe, expect, it } from "vitest";

import {
  assessReferenceFreshness,
  latestSettledWeekday,
  selectStaleSecurities,
  sessionSettledAt,
} from "./price-freshness";

describe("latestSettledWeekday", () => {
  it("toma la rueda de hoy recién pasadas las 22:00 UTC", () => {
    // 2026-09-30 es miércoles.
    expect(latestSettledWeekday("2026-09-30T21:59:59.999Z")).toBe("2026-09-29");
    expect(latestSettledWeekday("2026-09-30T22:00:00.000Z")).toBe("2026-09-30");
  });

  it("salta el fin de semana hacia el viernes", () => {
    expect(latestSettledWeekday("2026-10-03T23:00:00.000Z")).toBe("2026-10-02");
    expect(latestSettledWeekday("2026-10-04T12:00:00.000Z")).toBe("2026-10-02");
    // Lunes antes del asentamiento: todavía es el viernes.
    expect(latestSettledWeekday("2026-10-05T15:00:00.000Z")).toBe("2026-10-02");
  });

  it("el instante de asentamiento es a las 22:00 UTC de la rueda", () => {
    expect(sessionSettledAt("2026-09-30")).toBe("2026-09-30T22:00:00.000Z");
  });
});

describe("assessReferenceFreshness", () => {
  const now = "2026-09-30T23:00:00.000Z";

  it("está al día con el cierre de la última rueda asentada", () => {
    expect(
      assessReferenceFreshness({
        latestClose: "2026-09-30",
        lastCheckedAt: null,
        now,
      }),
    ).toEqual({ status: "fresh", latestClose: "2026-09-30" });
  });

  it("está atrasada sin ese cierre ni una revisión posterior", () => {
    expect(
      assessReferenceFreshness({
        latestClose: "2026-09-29",
        lastCheckedAt: "2026-09-30T21:30:00.000Z",
        now,
      }),
    ).toEqual({
      status: "stale",
      latestClose: "2026-09-29",
      expectedSession: "2026-09-30",
    });
  });

  it("un feriado revisado después del asentamiento no se vuelve a pedir", () => {
    expect(
      assessReferenceFreshness({
        latestClose: "2026-09-29",
        lastCheckedAt: "2026-09-30T22:05:00.000Z",
        now,
      }),
    ).toEqual({ status: "fresh", latestClose: "2026-09-29" });
  });

  it("sin ningún nivel guardado siempre está atrasada", () => {
    expect(
      assessReferenceFreshness({
        latestClose: null,
        lastCheckedAt: "2026-09-30T22:05:00.000Z",
        now,
      }).status,
    ).toBe("stale");
  });
});

describe("selectStaleSecurities", () => {
  it("deja afuera a las que tienen la rueda o ya fueron revisadas, en orden", () => {
    const members = [
      { securityId: "a" },
      { securityId: "b" },
      { securityId: "c" },
      { securityId: "d" },
    ];

    expect(
      selectStaleSecurities({
        members,
        withTargetClose: new Set(["a"]),
        checkedSinceSettled: new Set(["c"]),
      }),
    ).toEqual([{ securityId: "b" }, { securityId: "d" }]);
  });
});
