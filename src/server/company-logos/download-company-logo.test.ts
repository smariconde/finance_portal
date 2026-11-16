import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import type { EgressFetchResponse } from "@/modules/ingestion/application/egress-fetch";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";

import { createCompanyLogoDownload } from "./download-company-logo";

const PNG = new Uint8Array(
  readFileSync(new URL("./fixtures/company-logo.png", import.meta.url)),
);
const entry = DEMO_SOURCE_REGISTRY.find((row) => row.sourceId === "logo-dev")!;
const fetchedAt = "2026-11-16T12:00:00.000Z";
function setup(response: Partial<EgressFetchResponse> = {}, source = entry) {
  const fetch = vi.fn(async () => ({
    status: 200,
    body: PNG,
    byteLength: PNG.byteLength,
    fetchedAt,
    ...response,
  }));
  return {
    fetch,
    download: createCompanyLogoDownload({
      fetch,
      entry: source,
      key: () => "pk_testCompanyLogo123",
    }),
  };
}

describe("logo.dev persisted PNG contract", () => {
  it("rejects an image outside the declared 128 px square", async () => {
    const body = new Uint8Array(
      await sharp(PNG).resize(64, 64).png().toBuffer(),
    );
    await expect(setup({ body }).download("KO")).rejects.toThrow(
      "image rejected",
    );
  });
  it("decodes the synthetic recorded fixture, keeps provenance and requests the canonical locator", async () => {
    const { fetch, download } = setup();
    const logo = await download("KO");
    expect(logo).toMatchObject({
      fetchedAt,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(logo!.bytes.slice(0, 8)).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toEqual([
      {
        sourceId: "logo-dev",
        accept: "image/png",
        url: "https://img.logo.dev/ticker/KO?token=pk_testCompanyLogo123&size=64&format=png&retina=true&fallback=404",
      },
    ]);
  });
  it("treats only a provider 404 as an absent logo", async () => {
    await expect(setup({ status: 404 }).download("KO")).resolves.toBeNull();
    for (const status of [202, 301, 401, 403, 429, 500]) {
      await expect(setup({ status }).download("KO")).rejects.toThrow();
    }
  });
  it.each([
    new TextEncoder().encode("<html>error</html>"),
    new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"/>',
    ),
    PNG.slice(0, 45),
    new Uint8Array(262145),
  ])("rejects non-PNG, truncated or oversized payloads", async (body) => {
    await expect(setup({ body }).download("KO")).rejects.toThrow();
  });
  it("refuses unapproved storage before any outgoing call", async () => {
    const { fetch, download } = setup(
      {},
      { ...entry, rights: { ...entry.rights, rawStorage: "restricted" } },
    );
    await expect(download("KO")).rejects.toThrow("rights refused");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not expose or call with a secret key or malformed ticker", async () => {
    const fetch = vi.fn();
    const download = createCompanyLogoDownload({
      fetch,
      entry,
      key: () => "sk_neverUseThis",
    });
    expect(await download("KO")).toBeNull();
    expect(await setup().download("../KO")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
