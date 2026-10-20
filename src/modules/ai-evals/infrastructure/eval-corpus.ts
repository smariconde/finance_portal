import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

/**
 * Corpus congelado de los evals de la capa IA (`F5-07`,
 * [ADR 0035](../../../../docs/architecture/adr/0035-ai-layer-evals.md),
 * decisión 2).
 *
 * Es un corpus de la [ADR 0023](../../../../docs/architecture/adr/0023-frozen-sec-extracts-rights.md)
 * y cumple sus cuatro propiedades a la vez: los 10-K son **elegidos** —declarados
 * por `accession` en `declared-eval-cases.ts`—, **reducidos** a las secciones que
 * leen las tareas por los mismos lectores y con sus mismos techos, llevan
 * **manifiesto** con hash del documento y de cada extracto, y vienen de
 * `sec-edgar`, cuyos derechos son `allowed`.
 *
 * Fuente: U.S. Securities and Exchange Commission, EDGAR. Contenido público
 * copiado con cita, sin el sello ni los logos de la SEC y sin afiliación alguna.
 *
 * Las claves de país y región son nombres de lugares, identificadores del
 * proyecto: ninguna cifra de Damodaran entra acá.
 *
 * El corpus **no vuelve a la red**: actualizarlo es correr
 * `pnpm ai:eval-capture --apply` y revisar el diff.
 */
export const AI_EVAL_CORPUS_VERSION = "ai-eval-corpus-1.1.0";

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), "corpus");

export const AI_EVAL_CORPUS_MANIFEST_PATH = join(CORPUS_DIR, "manifest.json");

export const EVAL_EXTRACT_SECTIONS = [
  "item_1_business",
  "segment_note",
  "geographic_revenue",
  "equity_compensation",
] as const;

export type EvalExtractSection = (typeof EVAL_EXTRACT_SECTIONS)[number];

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const keySchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const evalCorpusExtractSchema = z.object({
  section: z.enum(EVAL_EXTRACT_SECTIONS),
  /** Ruta relativa al directorio del corpus. */
  path: z.string().min(1),
  readerVersion: z.string().min(1).max(64),
  bytes: z.number().int().positive(),
  sha256: sha256Schema,
  truncated: z.boolean(),
});

export type EvalCorpusExtract = z.infer<typeof evalCorpusExtractSchema>;

export const evalCorpusDocumentSchema = z.object({
  cik: z.string().regex(/^[0-9]{10}$/u),
  accessionNumber: z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
  sourceUrl: z.url(),
  /** Instante en que la SEC sirvió el documento, informado por el egress. */
  fetchedAt: z.iso.datetime(),
  /** El documento entero no se conserva: se deja dicho cuánto pesaba y su hash. */
  rawBytes: z.number().int().positive(),
  rawSha256: sha256Schema,
  extracts: z.array(evalCorpusExtractSchema).min(1),
});

export type EvalCorpusDocument = z.infer<typeof evalCorpusDocumentSchema>;

/** Reduced companyconcept corroboration; only rows of the declared filing/end. */
export const evalEmployeeXbrlSchema = z
  .object({
    cik: z.string().regex(/^[0-9]{10}$/u),
    accessionNumber: z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
    fiscalYearEnd: z.iso.date(),
    field: z.enum(["optionsOutstanding", "weightedStrike"]),
    sourceUrl: z.url(),
    fetchedAt: z.iso.datetime(),
    status: z.union([z.literal(200), z.literal(404)]),
    rawBytes: z.number().int().nonnegative(),
    rawSha256: sha256Schema,
    parserVersion: z.string().min(1),
    values: z.array(z.string().regex(/^-?[0-9]+(?:\.[0-9]+)?$/u)),
  })
  .superRefine((row, ctx) => {
    if (row.status === 404 && row.values.length > 0)
      ctx.addIssue({
        code: "custom",
        path: ["values"],
        message: "A missing concept carries no values.",
      });
  });

export const evalCorpusManifestSchema = z.object({
  corpusVersion: z.literal(AI_EVAL_CORPUS_VERSION),
  sourceId: z.literal("sec-edgar"),
  attribution: z.string().min(1),
  exposureKeys: z.object({
    /** Release de Damodaran de la que se leyeron los nombres, sin sus valores. */
    countryReleaseId: z.uuid(),
    regionReleaseId: z.uuid(),
    publishedLabel: z.string().min(1).max(64),
    countries: z.array(keySchema).min(1),
    regions: z.array(keySchema).min(1),
  }),
  documents: z.array(evalCorpusDocumentSchema),
  employeeEquityXbrl: z.array(evalEmployeeXbrlSchema).default([]),
});

export type EvalCorpusManifest = z.infer<typeof evalCorpusManifestSchema>;

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function loadEvalCorpusManifest(): EvalCorpusManifest {
  return evalCorpusManifestSchema.parse(
    JSON.parse(readFileSync(AI_EVAL_CORPUS_MANIFEST_PATH, "utf8")),
  );
}

export function evalCorpusPath(extract: EvalCorpusExtract): string {
  return join(CORPUS_DIR, extract.path);
}

export function evalCorpusDirectory(): string {
  return CORPUS_DIR;
}

/** El texto de cada extracto congelado, por CIK y sección. */
export type EvalCorpusTexts = ReadonlyMap<
  string,
  Partial<Record<EvalExtractSection, string>>
>;

export function readEvalCorpusTexts(
  manifest: EvalCorpusManifest,
): EvalCorpusTexts {
  return new Map(
    manifest.documents.map((document) => [
      document.cik,
      Object.fromEntries(
        document.extracts.map((extract) => [
          extract.section,
          readFileSync(evalCorpusPath(extract), "utf8"),
        ]),
      ),
    ]),
  );
}
