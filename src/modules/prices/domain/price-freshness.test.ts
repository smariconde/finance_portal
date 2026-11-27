import { describe, expect, it } from "vitest";

import {
  assessReferenceFreshness,
  latestSettledSession,
  latestSettledWeekday,
  PRICE_FRESHNESS_RULE_VERSION,
  selectStaleSecurities,
  sessionSettledAt,
  sessionSettledInstant,
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

describe("latestSettledSession (sector-price-freshness-2.0.0)", () => {
  it("es la versión vigente", () => {
    expect(PRICE_FRESHNESS_RULE_VERSION).toBe("sector-price-freshness-2.0.0");
  });

  it("asienta una hora después del cierre regular, en horario de verano", () => {
    // 2026-09-30, miércoles: cierre 16:00 EDT = 20:00 UTC.
    expect(latestSettledSession("2026-09-30T20:59:59.999Z")).toEqual({
      session: "2026-09-29",
      settledAt: "2026-09-29T21:00:00.000Z",
      basis: "declared_calendar",
    });
    expect(latestSettledSession("2026-09-30T21:00:00.000Z").session).toBe(
      "2026-09-30",
    );
  });

  it("en horario estándar el cierre de las 16:00 se asienta a las 22:00 UTC", () => {
    expect(latestSettledSession("2026-11-25T21:59:59.999Z").session).toBe(
      "2026-11-24",
    );
    expect(latestSettledSession("2026-11-25T22:00:00.000Z")).toEqual({
      session: "2026-11-25",
      settledAt: "2026-11-25T22:00:00.000Z",
      basis: "declared_calendar",
    });
  });

  it("Thanksgiving no es una sesión: queda la del miércoles", () => {
    expect(latestSettledSession("2026-11-26T23:30:00.000Z").session).toBe(
      "2026-11-25",
    );
  });

  it("el cierre temprano del viernes siguiente se asienta a su hora", () => {
    // 13:00 EST = 18:00 UTC; asentado a las 19:00 UTC.
    expect(latestSettledSession("2026-11-27T18:59:59.999Z").session).toBe(
      "2026-11-25",
    );
    expect(latestSettledSession("2026-11-27T19:00:00.000Z")).toEqual({
      session: "2026-11-27",
      settledAt: "2026-11-27T19:00:00.000Z",
      basis: "declared_calendar",
    });
    expect(sessionSettledInstant("2026-11-27")).toBe(
      "2026-11-27T19:00:00.000Z",
    );
  });

  it("salta el fin de semana hacia el viernes", () => {
    expect(latestSettledSession("2026-11-29T12:00:00.000Z").session).toBe(
      "2026-11-27",
    );
  });

  it("la sesión es la fecha de Nueva York, no la UTC", () => {
    // 01:00 UTC del jueves = 20:00 EST del miércoles.
    expect(latestSettledSession("2026-11-26T01:00:00.000Z").session).toBe(
      "2026-11-25",
    );
  });

  it("fuera de lo declarado rige el día hábil a las 22:00 UTC y lo nombra", () => {
    expect(latestSettledSession("2029-01-03T22:30:00.000Z")).toEqual({
      session: "2029-01-03",
      settledAt: "2029-01-03T22:00:00.000Z",
      basis: "undeclared_weekday",
    });
    // El 1 de enero de 2029 no está declarado: no se lo supone feriado, pero
    // antes de las 22:00 UTC todavía no cuenta y se vuelve a lo declarado.
    expect(latestSettledSession("2029-01-01T12:00:00.000Z")).toEqual({
      session: "2028-12-29",
      settledAt: "2028-12-29T22:00:00.000Z",
      basis: "declared_calendar",
    });
  });

  it("un día que no opera se asienta con la regla anterior", () => {
    expect(sessionSettledInstant("2026-11-26")).toBe(
      sessionSettledAt("2026-11-26"),
    );
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
        lastCheckedAt: "2026-09-30T20:30:00.000Z",
        now,
      }),
    ).toEqual({
      status: "stale",
      latestClose: "2026-09-29",
      expectedSession: "2026-09-30",
    });
  });

  it("una rueda sin cierre revisada después de asentarse no se vuelve a pedir", () => {
    expect(
      assessReferenceFreshness({
        latestClose: "2026-09-29",
        lastCheckedAt: "2026-09-30T22:05:00.000Z",
        now,
      }),
    ).toEqual({ status: "fresh", latestClose: "2026-09-29" });
  });

  it("en un feriado de la NYSE no pide nada: le alcanza la sesión anterior", () => {
    expect(
      assessReferenceFreshness({
        latestClose: "2026-11-25",
        lastCheckedAt: null,
        now: "2026-11-26T23:30:00.000Z",
      }),
    ).toEqual({ status: "fresh", latestClose: "2026-11-25" });
  });

  it("un cierre temprano pide la rueda desde su hora", () => {
    expect(
      assessReferenceFreshness({
        latestClose: "2026-11-25",
        lastCheckedAt: null,
        now: "2026-11-27T19:30:00.000Z",
      }),
    ).toEqual({
      status: "stale",
      latestClose: "2026-11-25",
      expectedSession: "2026-11-27",
    });
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
