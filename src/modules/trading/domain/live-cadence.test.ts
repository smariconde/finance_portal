import { describe, expect, it } from "vitest";

import {
  isNewYorkRegularSession,
  liveCadence,
  liveFreshness,
} from "./live-cadence";

describe("isNewYorkRegularSession", () => {
  it.each([
    // 2026-11-13 is a Friday, after the switch to EST (UTC−5).
    ["2026-11-13T14:29:59Z", false],
    ["2026-11-13T14:30:00Z", true],
    ["2026-11-13T20:59:59Z", true],
    ["2026-11-13T21:00:00Z", false],
    // Saturday and Sunday.
    ["2026-11-14T16:00:00Z", false],
    ["2026-11-15T16:00:00Z", false],
    // Summer time (EDT, UTC−4): the bell rings at 13:30 UTC.
    ["2026-07-15T13:30:00Z", true],
    ["2026-07-15T20:00:00Z", false],
  ])("%s → %s", (now, expected) => {
    expect(isNewYorkRegularSession(now)).toBe(expected);
  });
});

describe("liveCadence", () => {
  it("reads the account each minute and quotes each 15 s in session", () => {
    expect(liveCadence("2026-11-13T15:00:00Z")).toEqual({
      session: "regular",
      accountMs: 60_000,
      quotesMs: 15_000,
    });
  });

  it("slows both to five minutes outside the session", () => {
    expect(liveCadence("2026-11-14T15:00:00Z")).toMatchObject({
      accountMs: 300_000,
      quotesMs: 300_000,
    });
  });
});

describe("liveFreshness", () => {
  const base = { readAt: "2026-11-13T15:00:00Z", intervalMs: 60_000 };

  it("is live within two periods", () => {
    expect(
      liveFreshness({
        ...base,
        now: "2026-11-13T15:02:00Z",
        lastAttemptFailed: false,
      }),
    ).toEqual({ light: "live" });
  });

  it("goes stale past two periods", () => {
    expect(
      liveFreshness({
        ...base,
        now: "2026-11-13T15:02:01Z",
        lastAttemptFailed: false,
      }),
    ).toEqual({ light: "stale", reason: "older_than_cadence" });
  });

  it("goes stale when the last refresh failed, however recent the reading", () => {
    expect(
      liveFreshness({
        ...base,
        now: "2026-11-13T15:00:05Z",
        lastAttemptFailed: true,
      }),
    ).toEqual({ light: "stale", reason: "refresh_failed" });
  });

  it("goes stale on an unreadable instant", () => {
    expect(
      liveFreshness({
        ...base,
        readAt: "nope",
        now: "2026-11-13T15:00:05Z",
        lastAttemptFailed: false,
      }),
    ).toMatchObject({ light: "stale" });
  });
});
