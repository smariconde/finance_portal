import { describe, expect, it } from "vitest";

import {
  SETTLED_SESSION_RULE_VERSION,
  SETTLEMENT_DELAY_MINUTES,
  settleSession,
} from "./settled-session";

const bars = [
  { marketDate: "2026-09-28" },
  { marketDate: "2026-09-29" },
  { marketDate: "2026-09-30" },
];

// Sesión real del 2026-09-30 medida sobre `^SP500TR`.
const session = {
  marketDate: "2026-09-30",
  regularEnd: "2026-09-30T20:00:00.000Z",
  lastPriceAt: "2026-09-30T20:38:11.000Z",
};
const NEW_YORK = -4 * 3600;

describe("settleSession", () => {
  it("keeps today's bar once it was priced after the bell and an hour went by", () => {
    const settled = settleSession(
      bars,
      { session, gmtOffsetSeconds: NEW_YORK },
      "2026-09-30T23:22:48.000Z",
    );

    expect(settled.bars).toHaveLength(3);
    expect(settled.unsettled).toEqual([]);
  });

  it("leaves out today's bar while the session is open", () => {
    const settled = settleSession(
      bars,
      {
        session: { ...session, lastPriceAt: "2026-09-30T17:05:00.000Z" },
        gmtOffsetSeconds: NEW_YORK,
      },
      "2026-09-30T17:05:30.000Z",
    );

    expect(settled.bars.map((bar) => bar.marketDate)).toEqual([
      "2026-09-28",
      "2026-09-29",
    ]);
    expect(settled.unsettled).toEqual(["2026-09-30"]);
  });

  it("waits the settlement delay even when a price is stamped after the bell", () => {
    expect(
      settleSession(
        bars,
        {
          session: { ...session, lastPriceAt: "2026-09-30T20:01:00.000Z" },
          gmtOffsetSeconds: NEW_YORK,
        },
        "2026-09-30T20:30:00.000Z",
      ).unsettled,
    ).toEqual(["2026-09-30"]);
    expect(SETTLEMENT_DELAY_MINUTES).toBe(60);
  });

  it("does not trust a late download whose last price predates the bell", () => {
    // Un índice que todavía no publicó su valor de cierre sigue mostrando el
    // último intradía aunque la sesión haya terminado.
    expect(
      settleSession(
        bars,
        {
          session: { ...session, lastPriceAt: "2026-09-30T19:59:00.000Z" },
          gmtOffsetSeconds: NEW_YORK,
        },
        "2026-09-30T23:00:00.000Z",
      ).unsettled,
    ).toEqual(["2026-09-30"]);
  });

  it("keeps every bar when the declared session is a later day than the series", () => {
    // Descarga de un lunes antes de la apertura: la sesión es la de hoy y la
    // última barra es del viernes.
    const settled = settleSession(
      bars.slice(0, 2),
      {
        session: {
          marketDate: "2026-09-30",
          regularEnd: "2026-09-30T20:00:00.000Z",
          lastPriceAt: "2026-09-29T20:00:00.000Z",
        },
        gmtOffsetSeconds: NEW_YORK,
      },
      "2026-09-30T12:00:00.000Z",
    );

    expect(settled.bars).toHaveLength(2);
    expect(settled.unsettled).toEqual([]);
  });

  it("without a declared session, leaves out the bar of the download's market date", () => {
    // 01:00 UTC del 1 de octubre son las 21:00 del 30 de septiembre en Nueva
    // York: esa rueda no se puede probar cerrada y queda afuera.
    expect(
      settleSession(
        bars,
        { session: null, gmtOffsetSeconds: NEW_YORK },
        "2026-10-01T01:00:00.000Z",
      ).unsettled,
    ).toEqual(["2026-09-30"]);
  });

  it("declares its rule version", () => {
    expect(SETTLED_SESSION_RULE_VERSION).toBe("settled-session-1.0.0");
  });
});
