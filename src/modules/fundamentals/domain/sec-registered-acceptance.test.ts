import { describe, expect, it } from "vitest";

import type { SecFiling } from "./parse-sec-submissions";
import { reconcileRegisteredAcceptances } from "./sec-registered-acceptance";

function filing(accessionNumber: string, acceptedAt: string | null): SecFiling {
  return {
    accessionNumber,
    form: "10-Q",
    filingDate: "2026-08-03",
    reportDate: "2026-06-30",
    acceptedAt,
  };
}

describe("sec-registered-acceptance-1.0.0", () => {
  it("keeps the registered acceptance when the file reads it shifted (ExxonMobil)", () => {
    // Registrado el 2026-09-14, antes de que la SEC regenerara el archivo:
    // 18:55:38 UTC son las 14:55 de Nueva York. El archivo nuevo dice 22:55.
    const result = reconcileRegisteredAcceptances(
      [filing("0000034088-26-000093", "2026-08-03T22:55:38.000Z")],
      new Map([["0000034088-26-000093", "2026-08-03T18:55:38.000Z"]]),
    );

    expect(result.kept).toStrictEqual(["0000034088-26-000093"]);
    expect(result.conflicting).toStrictEqual([]);
    expect(result.filings[0]?.acceptedAt).toBe("2026-08-03T18:55:38.000Z");
  });

  it("uses the offset of the instant, five hours in winter", () => {
    expect(
      reconcileRegisteredAcceptances(
        [filing("a", "2026-02-06T04:44:31.000Z")],
        new Map([["a", "2026-02-05T23:44:31.000Z"]]),
      ).kept,
    ).toStrictEqual(["a"]);
  });

  it("also keeps it when the registered one is the shifted reading", () => {
    // Un registro capturado de un archivo corrido sigue siendo el registro: el
    // documento no se reescribe, y el desacuerdo es el reloj.
    expect(
      reconcileRegisteredAcceptances(
        [filing("a", "2026-08-03T18:55:38.000Z")],
        new Map([["a", "2026-08-03T22:55:38.000Z"]]),
      ).filings[0]?.acceptedAt,
    ).toBe("2026-08-03T22:55:38.000Z");
  });

  it("leaves equal or unregistered filings alone", () => {
    const filings = [
      filing("same", "2026-08-03T18:55:38Z"),
      filing("new", "2026-09-01T15:00:00.000Z"),
    ];
    const result = reconcileRegisteredAcceptances(
      filings,
      new Map([["same", "2026-08-03T18:55:38.000Z"]]),
    );

    expect(result.filings).toStrictEqual(filings);
    expect(result.kept).toStrictEqual([]);
    expect(result.conflicting).toStrictEqual([]);
  });

  it("names any other difference as a conflict instead of choosing", () => {
    const result = reconcileRegisteredAcceptances(
      [
        filing("hour", "2026-08-03T19:55:38.000Z"),
        filing("missing", null),
        filing("appeared", "2026-08-03T18:55:38.000Z"),
      ],
      new Map<string, string | null>([
        ["hour", "2026-08-03T18:55:38.000Z"],
        ["missing", "2026-08-03T18:55:38.000Z"],
        ["appeared", null],
      ]),
    );

    expect(result.conflicting).toStrictEqual(["hour", "missing", "appeared"]);
    expect(result.kept).toStrictEqual([]);
  });
});
