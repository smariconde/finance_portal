import { describe, expect, it } from "vitest";

import { schwabConnectionStatus } from "@/modules/trading/domain/schwab-connection-status";

const CONNECTION = {
  connectedAt: "2026-11-13T15:00:00.000Z",
  refreshExpiresAt: "2026-11-20T15:00:00.000Z",
};

describe("schwabConnectionStatus", () => {
  it("is not connected without a connection", () => {
    expect(schwabConnectionStatus(null, "2026-11-13T15:00:00.000Z")).toEqual({
      status: "not_connected",
    });
  });

  it.each([
    ["2026-11-19T14:59:59.999Z", "connected"],
    ["2026-11-19T15:00:00.000Z", "expiring"],
    ["2026-11-20T14:59:59.999Z", "expiring"],
    ["2026-11-20T15:00:00.000Z", "expired"],
  ])("at %s reads %s", (now, status) => {
    expect(schwabConnectionStatus(CONNECTION, now)).toEqual({
      status,
      ...CONNECTION,
      warnFrom: "2026-11-19T15:00:00.000Z",
    });
  });
});

describe("schwabConnectionStatus 1.1.0", () => {
  const connection = {
    connectedAt: "2026-11-13T22:20:00.000Z",
    refreshExpiresAt: "2026-11-20T22:20:00.000Z",
  };

  it("names a failed renewal instead of claiming the connection works", () => {
    expect(
      schwabConnectionStatus(
        connection,
        "2026-11-14T03:00:00.000Z",
        "refresh_failed",
      ).status,
    ).toBe("renewal_failed");
  });

  it("goes back to connected after a later renewal or login", () => {
    expect(
      schwabConnectionStatus(
        connection,
        "2026-11-14T03:00:00.000Z",
        "access_refreshed",
      ).status,
    ).toBe("connected");
  });

  it("still says expired once the login lapsed", () => {
    expect(
      schwabConnectionStatus(
        connection,
        "2026-11-21T00:00:00.000Z",
        "refresh_failed",
      ).status,
    ).toBe("expired");
  });
});
