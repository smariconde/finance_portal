import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PORTAL_ADAPTERS } from "../portals/registry";
import {
  LISTING_CORPUS_REDUCER_VERSION,
  sha256Hex,
  type CorpusManifest,
  type ReducedPage,
} from "./reducer";

const DIRECTORY = resolve(__dirname, "files");
const manifest = JSON.parse(
  readFileSync(resolve(DIRECTORY, "manifest.json"), "utf8"),
) as CorpusManifest;

/**
 * El oráculo real de los adapters (ADR 0089, Decisión 10): cada página
 * reducida está fijada por su hash y el adapter tiene que leer de ella
 * exactamente lo que se revisó al congelarla.
 */
describe("listing-capture-corpus", () => {
  it("cada archivo coincide con su hash y su reductor", () => {
    for (const entry of manifest.entries) {
      const text = readFileSync(resolve(DIRECTORY, entry.file), "utf8");
      expect(sha256Hex(text), entry.file).toBe(entry.sha256);
      expect(entry.reducer).toBe(LISTING_CORPUS_REDUCER_VERSION);
    }
  });

  it("cada página se lee como se revisó al congelarla", () => {
    for (const entry of manifest.entries) {
      const page = JSON.parse(
        readFileSync(resolve(DIRECTORY, entry.file), "utf8"),
      ) as ReducedPage;
      const expected = JSON.parse(
        readFileSync(
          resolve(DIRECTORY, entry.file.replace(/\.json$/u, ".expected.json")),
          "utf8",
        ),
      ) as unknown;
      const adapter = PORTAL_ADAPTERS.find(
        (candidate) => candidate.sourceId === page.source,
      );
      expect(adapter, entry.file).toBeDefined();
      expect(adapter!.read(page.document), entry.file).toEqual(expected);
    }
  });

  it("todo portal con adapter tiene al menos una ficha y un listado congelados", () => {
    for (const adapter of PORTAL_ADAPTERS) {
      const files = manifest.entries.filter(
        (entry) => entry.source === adapter.sourceId,
      );
      expect(
        files.some((entry) => entry.file.includes("-detail-")),
        adapter.sourceId,
      ).toBe(true);
      expect(
        files.some((entry) => entry.file.includes("-search-")),
        adapter.sourceId,
      ).toBe(true);
    }
  });
});
