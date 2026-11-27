import { describe, expect, it } from "vitest";

import {
  REAL_ESTATE_PORTALS,
  listingCaptureSchema,
} from "../../../src/modules/real-estate/domain/listing-capture";

import {
  PORTAL_ADAPTERS,
  adapterFor,
  matchesPattern,
  portalHostPermissions,
} from "./registry";
import { PORTAL_MATCHES } from "./portal-matches";

const IDENTITY_FIELDS = new Set([
  "source",
  "pageKind",
  "parseBasis",
  "capturedAt",
]);

describe("portals/registry", () => {
  it("cada adapter declara todos los campos del contrato", () => {
    const required = Object.keys(listingCaptureSchema.shape).filter(
      (field) => !IDENTITY_FIELDS.has(field),
    );
    for (const adapter of PORTAL_ADAPTERS) {
      expect(Object.keys(adapter.fields).sort(), adapter.sourceId).toEqual(
        [...required].sort(),
      );
      for (const [field, source] of Object.entries(adapter.fields)) {
        const text = "path" in source ? source.path : source.note;
        expect(text.trim(), `${adapter.sourceId}.${field}`).not.toBe("");
      }
    }
  });

  it("ningún selector obligatorio está vacío", () => {
    for (const adapter of PORTAL_ADAPTERS) {
      expect(adapter.embeddedStateSelectors.length).toBeGreaterThan(0);
      expect(adapter.challengeSelectors.length).toBeGreaterThan(0);
      for (const selector of [
        ...adapter.embeddedStateSelectors,
        ...adapter.challengeSelectors,
      ]) {
        expect(selector.trim()).not.toBe("");
      }
    }
  });

  it("cada adapter es un portal declarado, una sola vez, en su propio host", () => {
    const ids = PORTAL_ADAPTERS.map((adapter) => adapter.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const adapter of PORTAL_ADAPTERS) {
      const portal = REAL_ESTATE_PORTALS.find(
        (candidate) => candidate.sourceId === adapter.sourceId,
      );
      expect(portal, adapter.sourceId).toBeDefined();
      for (const pattern of adapter.matches) {
        const host = /^https:\/\/([a-z0-9.-]+)\//u.exec(pattern)?.[1];
        expect(host, pattern).toBeDefined();
        expect(
          host === portal!.hostSuffix ||
            host!.endsWith(`.${portal!.hostSuffix}`),
          pattern,
        ).toBe(true);
      }
    }
  });

  it("dos adapters nunca comparten un host", () => {
    const hostsByAdapter = PORTAL_ADAPTERS.map(
      (adapter) =>
        new Set(
          adapter.matches.map(
            (pattern) => /^https:\/\/([a-z0-9.-]+)\//u.exec(pattern)?.[1],
          ),
        ),
    );
    for (let a = 0; a < hostsByAdapter.length; a += 1) {
      for (let b = a + 1; b < hostsByAdapter.length; b += 1) {
        const shared = [...hostsByAdapter[a]].filter((host) =>
          hostsByAdapter[b].has(host),
        );
        expect(shared).toEqual([]);
      }
    }
  });

  it("resuelve una URL a su adapter y nada más", () => {
    expect(
      adapterFor("https://www.remax.com.ar/listings/buy?page=1")?.sourceId,
    ).toBe("remax-ar");
    expect(adapterFor("https://www.remax.com.ar/")).toBeNull();
    expect(adapterFor("http://www.remax.com.ar/listings/buy")).toBeNull();
    expect(adapterFor("https://evil.example/listings/buy")).toBeNull();
    expect(adapterFor("no es una url")).toBeNull();
    expect(
      matchesPattern(
        "https://www.remax.com.ar/listings/*",
        new URL("https://remax.com.ar/listings/x"),
      ),
    ).toBe(false);
  });

  it("cada adapter declara exactamente los patrones de su portal", () => {
    for (const adapter of PORTAL_ADAPTERS) {
      expect(adapter.matches).toEqual(
        PORTAL_MATCHES[adapter.sourceId as keyof typeof PORTAL_MATCHES],
      );
    }
    expect(Object.keys(PORTAL_MATCHES).sort()).toEqual(
      PORTAL_ADAPTERS.map((adapter) => adapter.sourceId).sort(),
    );
  });

  it("deriva los permisos de host de los patrones", () => {
    expect(portalHostPermissions()).toEqual(["https://www.remax.com.ar/*"]);
  });
});
