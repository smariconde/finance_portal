import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { SEC_CORPUS_REDUCER_VERSION } from "../domain/reduce-sec-corpus";

/**
 * Corpus congelado de extractos reales de la SEC.
 *
 * Es el otro oráculo de regresión, al lado del filer sintético: aquél prueba que
 * el parser hace lo que creemos, éste prueba que el cable es como creemos. Los
 * derechos que lo permiten están revisados en la
 * [ADR 0023](../../../../docs/architecture/adr/0023-frozen-sec-extracts-rights.md);
 * la forma —extracto elegido, reducido, con manifiesto— es lo que lo distingue de
 * un recording, y las tres propiedades tienen que valer a la vez.
 *
 * Fuente: U.S. Securities and Exchange Commission, EDGAR. Contenido público
 * copiado con cita, sin el sello ni los logos de la SEC y sin afiliación alguna.
 *
 * El corpus **no vuelve a la red**: nada acá dentro descarga, y actualizarlo es
 * volver a correr `pnpm fixtures:capture --apply` y revisar el diff.
 */
const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), "golden");

export const GOLDEN_CORPUS_MANIFEST_PATH = join(CORPUS_DIR, "manifest.json");

export const GOLDEN_CORPUS_DATASETS = [
  "sec.submissions",
  "sec.companyfacts",
] as const;

export type GoldenCorpusDataset = (typeof GOLDEN_CORPUS_DATASETS)[number];

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

export const goldenCorpusEntrySchema = z.object({
  /** Ruta relativa al directorio del corpus. */
  path: z.string().min(1),
  dataset: z.enum(GOLDEN_CORPUS_DATASETS),
  cik: z.string().regex(/^[0-9]{10}$/u),
  entityName: z.string().min(1),
  sourceUrl: z.url(),
  /** Instante en que la SEC sirvió el documento, informado por el egress. */
  fetchedAt: z.iso.datetime(),
  /** Lo que la SEC sirvió, antes de reducir: no se conserva, se deja dicho. */
  rawBytes: z.number().int().positive(),
  rawSha256: sha256Schema,
  /** Lo que quedó commiteado. */
  bytes: z.number().int().positive(),
  sha256: sha256Schema,
  anchorOn: z.iso.date(),
  floorOn: z.iso.date(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
});

export type GoldenCorpusEntry = z.infer<typeof goldenCorpusEntrySchema>;

export const goldenCorpusManifestSchema = z.object({
  reducerVersion: z.literal(SEC_CORPUS_REDUCER_VERSION),
  sourceId: z.literal("sec-edgar"),
  attribution: z.string().min(1),
  entries: z.array(goldenCorpusEntrySchema),
});

export type GoldenCorpusManifest = z.infer<typeof goldenCorpusManifestSchema>;

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function loadGoldenCorpusManifest(): GoldenCorpusManifest {
  return goldenCorpusManifestSchema.parse(
    JSON.parse(readFileSync(GOLDEN_CORPUS_MANIFEST_PATH, "utf8")),
  );
}

export function goldenCorpusPath(entry: GoldenCorpusEntry): string {
  return join(CORPUS_DIR, entry.path);
}

/** El texto tal como quedó congelado. Sin parsear: el parser es lo que se prueba. */
export function readGoldenCorpusText(entry: GoldenCorpusEntry): string {
  return readFileSync(goldenCorpusPath(entry), "utf8");
}

export function findGoldenCorpusEntry(
  manifest: GoldenCorpusManifest,
  cik: string,
  dataset: GoldenCorpusDataset,
): GoldenCorpusEntry {
  const entry = manifest.entries.find(
    (candidate) => candidate.cik === cik && candidate.dataset === dataset,
  );

  if (entry === undefined) {
    throw new Error(`El corpus no tiene ${dataset} de ${cik}.`);
  }

  return entry;
}
