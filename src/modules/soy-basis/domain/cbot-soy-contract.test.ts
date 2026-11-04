import { describe, expect, it } from "vitest";

import { cbotSoyFrontContract } from "./cbot-soy-contract";

describe("cbot-soy-front-contract-1.0.0", () => {
  // Days measured against Yahoo's single contracts on 2026-11-04 (ADR 0071).
  it.each([
    ["2025-07-14", "ZSN25"],
    ["2025-07-15", "ZSQ25"],
    ["2025-11-14", "ZSX25"],
    ["2025-11-17", "ZSF26"],
    ["2026-10-29", "ZSX26"],
    ["2026-11-03", "ZSX26"],
  ])("on %s Yahoo's front month is %s", (marketOn, contract) => {
    expect(cbotSoyFrontContract(marketOn).contract).toBe(contract);
  });

  it("keeps the expiring contract through its last trading day", () => {
    expect(cbotSoyFrontContract("2026-11-13")).toMatchObject({
      contract: "ZSX26",
      lastTradeOn: "2026-11-13",
      firstNoticeOn: "2026-10-30",
      inDeliveryPeriod: true,
    });
    expect(cbotSoyFrontContract("2026-11-16").contract).toBe("ZSF27");
  });

  it("moves a last trading day on a weekend to the Friday before", () => {
    // 2026-03-14 is a Saturday.
    expect(cbotSoyFrontContract("2026-03-13").lastTradeOn).toBe("2026-03-13");
    expect(cbotSoyFrontContract("2026-03-16").contract).toBe("ZSK26");
  });

  it("marks the delivery period from first notice day, never before", () => {
    // First notice for January 2027 is Thursday 2026-12-31.
    expect(cbotSoyFrontContract("2026-12-30").inDeliveryPeriod).toBe(false);
    expect(cbotSoyFrontContract("2026-12-31")).toMatchObject({
      contract: "ZSF27",
      inDeliveryPeriod: true,
    });
    // August 2026's first notice falls back from Friday 2026-07-31.
    expect(cbotSoyFrontContract("2026-07-30")).toMatchObject({
      contract: "ZSQ26",
      inDeliveryPeriod: false,
    });
  });

  it("crosses the year with November's expiry", () => {
    expect(cbotSoyFrontContract("2026-12-01")).toMatchObject({
      contract: "ZSF27",
      contractMonth: "2027-01",
    });
  });

  it("rejects a date that is not a calendar date", () => {
    expect(() => cbotSoyFrontContract("2026-02-30")).toThrow();
  });
});
