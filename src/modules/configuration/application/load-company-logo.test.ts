import { describe, expect, it, vi } from "vitest";

import type { CompanyLogoStore } from "./company-logo-store";
import { createCompanyLogoLoader } from "./load-company-logo";

const now = "2026-11-16T12:00:00.000Z";
const logo = {
  bytes: new Uint8Array([1, 2]),
  contentHash: "a".repeat(64),
  fetchedAt: now,
};
function setup() {
  const store = {
    read: vi.fn<CompanyLogoStore["read"]>().mockResolvedValue(null),
    claim: vi.fn<CompanyLogoStore["claim"]>().mockResolvedValue(true),
    save: vi.fn<CompanyLogoStore["save"]>().mockResolvedValue(),
    defer: vi.fn<CompanyLogoStore["defer"]>().mockResolvedValue(),
  };
  const download = vi.fn().mockResolvedValue(logo);
  const canDownload = vi.fn().mockReturnValue(true);
  return {
    store,
    download,
    canDownload,
    load: createCompanyLogoLoader({
      store,
      download,
      canDownload,
      now: () => now,
      newToken: () => "token",
    }),
  };
}
describe("durable company logo", () => {
  it("serves the stored bytes without a provider key or call", async () => {
    const harness = setup();
    harness.canDownload.mockReturnValue(false);
    harness.store.read.mockResolvedValue(logo);
    expect(await harness.load("ko")).toEqual({ state: "stored", logo });
    expect(harness.store.read).toHaveBeenCalledWith("KO");
    expect(harness.download).not.toHaveBeenCalled();
    expect(harness.store.claim).not.toHaveBeenCalled();
  });
  it("downloads and publishes only after acquiring the shared reservation", async () => {
    const { store, load } = setup();
    expect(await load("KO")).toEqual({ state: "stored", logo });
    expect(store.claim).toHaveBeenCalledWith("KO", "token", now);
    expect(store.save).toHaveBeenCalledWith("KO", "token", logo);
  });
  it("does not spend twice when another process holds the reservation or a 404 cooldown", async () => {
    const { store, download, load } = setup();
    store.claim.mockResolvedValue(false);
    expect(await load("KO")).toEqual({ state: "missing" });
    expect(download).not.toHaveBeenCalled();
  });
  it("rereads a logo completed by another process", async () => {
    const { store, download, load } = setup();
    store.claim.mockResolvedValue(false);
    store.read.mockResolvedValueOnce(null).mockResolvedValueOnce(logo);
    expect(await load("KO")).toEqual({ state: "stored", logo });
    expect(download).not.toHaveBeenCalled();
  });
  it("keeps a provider 404 negative for one day without storing an image", async () => {
    const { store, download, load } = setup();
    download.mockResolvedValue(null);
    expect(await load("KO")).toEqual({ state: "missing" });
    expect(store.defer).toHaveBeenCalledWith(
      "KO",
      "token",
      "2026-11-17T12:00:00.000Z",
    );
    expect(store.save).not.toHaveBeenCalled();
  });
  it("defers budget, network and validation failures for five minutes", async () => {
    const { store, download, load } = setup();
    download.mockRejectedValue(
      new Error("upstream credential must not escape"),
    );
    expect(await load("KO")).toEqual({ state: "unavailable" });
    expect(store.defer).toHaveBeenCalledWith(
      "KO",
      "token",
      "2026-11-16T12:05:00.000Z",
    );
    expect(store.save).not.toHaveBeenCalled();
  });
  it("never calls for invalid input or a missing provider key", async () => {
    const { store, load, canDownload, download } = setup();
    expect(await load("../KO")).toEqual({ state: "missing" });
    expect(store.read).not.toHaveBeenCalled();
    canDownload.mockReturnValue(false);
    expect(await load("KO")).toEqual({ state: "missing" });
    expect(download).not.toHaveBeenCalled();
    expect(store.claim).not.toHaveBeenCalled();
  });
});
