import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseJsonPreservingNumbers } from "../domain/exact-json";

import {
  goldenCorpusPath,
  loadGoldenCorpusManifest,
  readGoldenCorpusText,
  sha256Hex,
} from "./golden-sec-corpus";

const manifest = loadGoldenCorpusManifest();

describe("golden SEC corpus", () => {
  it("is not empty: a corpus nobody captured is not an oracle", () => {
    expect(manifest.entries.length).toBeGreaterThan(0);
  });

  it.each(manifest.entries.map((entry) => [entry.path, entry] as const))(
    "%s matches the bytes and the hash the manifest pinned",
    (_path, entry) => {
      expect(existsSync(goldenCorpusPath(entry))).toBe(true);

      const text = readGoldenCorpusText(entry);

      // El hash es lo que hace que «congelado» signifique algo: un archivo
      // editado a mano, reformateado o bajado de nuevo falla acá y no más tarde
      // como una diferencia inexplicable del parser.
      expect(Buffer.byteLength(text, "utf8")).toBe(entry.bytes);
      expect(sha256Hex(text)).toBe(entry.sha256);
    },
  );

  it.each(manifest.entries.map((entry) => [entry.path, entry] as const))(
    "%s is still JSON, and its numbers are still text",
    (_path, entry) => {
      const document = parseJsonPreservingNumbers(readGoldenCorpusText(entry));

      expect(document).toBeTypeOf("object");
    },
  );

  it("covers both datasets of every filer it holds", () => {
    const byCik = new Map<string, Set<string>>();

    for (const entry of manifest.entries) {
      byCik.set(
        entry.cik,
        (byCik.get(entry.cik) ?? new Set()).add(entry.dataset),
      );
    }

    for (const [cik, datasets] of byCik) {
      expect([cik, [...datasets].sort()]).toStrictEqual([
        cik,
        ["sec.companyfacts", "sec.submissions"],
      ]);
    }
  });

  it("says where every file came from and what the whole document weighed", () => {
    for (const entry of manifest.entries) {
      expect(entry.sourceUrl).toMatch(/^https:\/\/data\.sec\.gov\//u);
      // La provenance de lo que no se conserva: el corpus no guarda el payload
      // entero, pero deja dicho su tamaño y su hash (`TM-16`).
      expect(entry.rawBytes).toBeGreaterThan(0);
      expect(entry.rawSha256).not.toBe(entry.sha256);
    }
  });

  it("weighs a fraction of what was downloaded", () => {
    // Por archivo no siempre: la SEC sirve JSON minificado y el corpus va
    // formateado para que su diff se pueda leer, así que un submissions al que
    // le sobraban pocas presentaciones termina más grande que el original. La
    // afirmación que importa es la del total.
    const raw = manifest.entries.reduce(
      (total, entry) => total + entry.rawBytes,
      0,
    );
    const frozen = manifest.entries.reduce(
      (total, entry) => total + entry.bytes,
      0,
    );

    expect(frozen).toBeLessThan(raw / 4);
    // Presupuesto declarado del corpus: crecerlo es una decisión, no un descuido.
    expect(frozen).toBeLessThan(4 * 1024 * 1024);
  });
});
