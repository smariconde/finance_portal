import { describe, expect, it } from "vitest";

import {
  planPreparesSession,
  preparedSessionOf,
  tradingSessionOf,
} from "./trading-session";

describe("tradingSessionOf (trading-session-ny-1.0.0)", () => {
  it("fecha por el reloj de Nueva York", () => {
    expect(tradingSessionOf("2026-11-13T21:05:00Z")).toBe("2026-11-13");
    expect(tradingSessionOf("2026-11-14T00:30:00Z")).toBe("2026-11-13");
  });
});

describe("preparedSessionOf (trading-session-ny-2.0.0)", () => {
  it("antes del cierre regular de un día hábil es la sesión de hoy", () => {
    expect(preparedSessionOf("2026-11-24T13:00:00Z")).toBe("2026-11-24");
    expect(preparedSessionOf("2026-11-24T20:59:59Z")).toBe("2026-11-24");
  });

  it("pasado el cierre regular prepara la próxima sesión", () => {
    expect(preparedSessionOf("2026-11-24T21:00:00Z")).toBe("2026-11-25");
  });

  it("la noche antes de Thanksgiving y el feriado preparan el viernes", () => {
    expect(preparedSessionOf("2026-11-25T23:00:00Z")).toBe("2026-11-27");
    expect(preparedSessionOf("2026-11-26T15:00:00Z")).toBe("2026-11-27");
  });

  it("después del cierre temprano del viernes prepara el lunes", () => {
    // 13:00 EST = 18:00 UTC.
    expect(preparedSessionOf("2026-11-27T17:59:59Z")).toBe("2026-11-27");
    expect(preparedSessionOf("2026-11-27T18:00:00Z")).toBe("2026-11-30");
    expect(preparedSessionOf("2026-11-29T22:00:00Z")).toBe("2026-11-30");
  });

  it("fuera de lo declarado no supone calendario", () => {
    expect(preparedSessionOf("2029-01-06T15:00:00Z")).toBe("2029-01-06");
    // El último día declarado, pasado el cierre: no hay próxima sesión declarada.
    expect(preparedSessionOf("2028-12-29T23:00:00Z")).toBe("2028-12-29");
  });
});

describe("planPreparesSession", () => {
  it("vincula un plan del domingo con el trade del lunes", () => {
    expect(planPreparesSession("2026-11-29T22:00:00Z", "2026-11-30")).toBe(
      true,
    );
  });

  it("vincula un plan del feriado con el viernes siguiente", () => {
    expect(planPreparesSession("2026-11-26T15:00:00Z", "2026-11-27")).toBe(
      true,
    );
  });

  it("un plan escrito después del cierre vale también para el post-market del día", () => {
    expect(planPreparesSession("2026-11-24T21:30:00Z", "2026-11-24")).toBe(
      true,
    );
    expect(planPreparesSession("2026-11-24T21:30:00Z", "2026-11-25")).toBe(
      true,
    );
  });

  it("un plan de la mañana no prepara la sesión del día siguiente", () => {
    expect(planPreparesSession("2026-11-24T13:00:00Z", "2026-11-25")).toBe(
      false,
    );
  });
});
