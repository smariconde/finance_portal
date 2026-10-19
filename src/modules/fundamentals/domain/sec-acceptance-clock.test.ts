import { describe, expect, it } from "vitest";

import { applyNewYorkOffsetTwice } from "../infrastructure/fixture-sec-filer";
import {
  ACCEPTANCE_CLOCK_CORRECTED_FLAG,
  acceptanceClockFlags,
  correctSecAcceptance,
  readSecAcceptanceClock,
  SEC_ACCEPTANCE_CLOCK_VERSION,
} from "./sec-acceptance-clock";

/** `count` presentaciones a la misma hora de Nueva York, una por día hábil. */
function filings(
  count: number,
  utcTime: string,
  firstDay = "2026-01-05",
): string[] {
  const first = Date.parse(`${firstDay}T${utcTime}Z`);

  return Array.from({ length: count }, (_, day) =>
    new Date(first + day * 86_400_000).toISOString(),
  );
}

describe("readSecAcceptanceClock", () => {
  // Tardes y mañanas de EDGAR en UTC: 18:44 y 07:30 de Nueva York en invierno.
  const evenings = filings(20, "23:44:31.000");
  const mornings = filings(10, "12:30:00.000");
  const published = [...evenings, ...mornings];

  it("reads a file whose acceptances fit EDGAR's hours as published UTC", () => {
    expect(readSecAcceptanceClock(published)).toEqual({
      version: SEC_ACCEPTANCE_CLOCK_VERSION,
      clock: "published_utc",
      acceptances: 30,
      outsideAsPublished: 0,
      // Corrigiendo, las mañanas caerían a las 2:30 y 3:30.
      outsideCorrected: 10,
    });
  });

  it("detects the New York offset applied twice and restores every acceptance", () => {
    const shifted = published.map(applyNewYorkOffsetTwice);
    const reading = readSecAcceptanceClock(shifted);

    expect(reading).toMatchObject({
      clock: "new_york_offset_applied_twice",
      outsideAsPublished: 20,
      outsideCorrected: 0,
    });
    expect(
      shifted.map((instant) =>
        correctSecAcceptance(instant, "new_york_offset_applied_twice"),
      ),
    ).toEqual(published);
  });

  it("restores summer acceptances with the four-hour offset", () => {
    // 18:44:31 de Nueva York en julio es 22:44:31Z.
    const summer = filings(20, "22:44:31.000", "2026-07-06");
    const shifted = summer.map(applyNewYorkOffsetTwice);

    expect(shifted[0]).toBe("2026-07-07T02:44:31.000Z");
    expect(readSecAcceptanceClock(shifted).clock).toBe(
      "new_york_offset_applied_twice",
    );
    expect(
      correctSecAcceptance(shifted[0]!, "new_york_offset_applied_twice"),
    ).toBe(summer[0]);
  });

  it("keeps the published reading when nothing contradicts it, because a wrong correction is look-ahead", () => {
    // Un filer chico que presenta siempre a media tarde: las dos lecturas encajan.
    const afternoons = filings(12, "19:00:00.000");

    expect(readSecAcceptanceClock(afternoons)).toMatchObject({
      clock: "published_utc",
      outsideAsPublished: 0,
      outsideCorrected: 0,
    });
  });

  it("does not correct a file on the strength of a couple of SEC notices issued at night", () => {
    // Avisos `EFFECT` que la SEC emite fuera de horario: afuera leídos como se
    // publican, adentro corregidos. Dos no alcanzan para adelantar el resto.
    const notices = filings(2, "03:30:00.000");

    expect(
      readSecAcceptanceClock([...filings(20, "19:00:00.000"), ...notices]),
    ).toMatchObject({ clock: "published_utc", outsideAsPublished: 2 });
  });

  it("refuses a file that fits EDGAR's hours under neither reading", () => {
    expect(readSecAcceptanceClock(filings(20, "09:30:00.000"))).toMatchObject({
      clock: "undetermined",
      outsideAsPublished: 20,
      outsideCorrected: 20,
    });
  });

  it("names a file with nothing to read", () => {
    expect(readSecAcceptanceClock([])).toMatchObject({
      clock: "no_acceptances",
      acceptances: 0,
    });
  });
});

describe("acceptanceClockFlags", () => {
  it("flags a run only when one of its files was corrected", () => {
    const corrected = readSecAcceptanceClock(
      filings(20, "23:44:31.000").map(applyNewYorkOffsetTwice),
    );
    const published = readSecAcceptanceClock(filings(20, "23:44:31.000"));

    expect(acceptanceClockFlags([published, null])).toEqual([]);
    expect(acceptanceClockFlags([published, corrected, null])).toEqual([
      ACCEPTANCE_CLOCK_CORRECTED_FLAG,
    ]);
  });
});
