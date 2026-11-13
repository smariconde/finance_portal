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
