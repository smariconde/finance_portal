import { z } from "zod";

/**
 * La infraestructura de términos (`glossary-1.0.0`), compartida por las lecciones
 * de `F11-10` y el glosario de valuación de `EDU-01` (ADR 0076, sección 10).
 *
 * Una entrada es copia de interfaz versionada: el término estándar en inglés
 * primero —como se lo busca y se lo enseña—, la aclaración en castellano, una
 * definición de una o dos oraciones, la fórmula cuando la hay, por qué importa
 * en una línea y al menos una fuente citada. Las entradas son texto plano: se
 * renderizan escapadas, nunca como HTML ni markdown.
 *
 * Un glosario se valida entero al definirse: una clave repetida, una fuente que
 * no existe o un texto con marcado lo rompen en el test, no en la página.
 */
export const GLOSSARY_VERSION = "glossary-1.0.0";

const keySchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);

const plainText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim() === value, "untrimmed")
    .refine((value) => !/[<>\u0000-\u001f‪-‮⁦-⁩]/u.test(value), "markup");

export const glossarySourceSchema = z
  .object({
    key: keySchema,
    /** Autor, año, título y editorial o revista, como se cita. */
    citation: plainText(240),
  })
  .strict();

export const glossaryEntrySchema = z
  .object({
    key: keySchema,
    /** El término en inglés, como aparece en la plataforma o en el libro. */
    term: plainText(48),
    /** La aclaración en castellano, en minúscula para leerse como subtítulo. */
    es: plainText(64),
    definition: plainText(240),
    formula: plainText(160).nullable(),
    why: plainText(160),
    sources: z.array(keySchema).min(1).max(4),
  })
  .strict();

export type GlossarySource = z.infer<typeof glossarySourceSchema>;
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>;

export type Glossary = {
  readonly version: string;
  readonly entries: ReadonlyMap<string, GlossaryEntry>;
  readonly sources: ReadonlyMap<string, GlossarySource>;
};

export function defineGlossary(
  version: string,
  sources: readonly GlossarySource[],
  entries: readonly GlossaryEntry[],
): Glossary {
  const sourceMap = new Map<string, GlossarySource>();
  for (const source of sources) {
    const parsed = glossarySourceSchema.parse(source);
    if (sourceMap.has(parsed.key)) {
      throw new Error(`Glossary source repeated: ${parsed.key}`);
    }
    sourceMap.set(parsed.key, parsed);
  }
  const entryMap = new Map<string, GlossaryEntry>();
  for (const entry of entries) {
    const parsed = glossaryEntrySchema.parse(entry);
    if (entryMap.has(parsed.key)) {
      throw new Error(`Glossary entry repeated: ${parsed.key}`);
    }
    for (const source of parsed.sources) {
      if (!sourceMap.has(source)) {
        throw new Error(`Glossary entry ${parsed.key} cites ${source}`);
      }
    }
    entryMap.set(parsed.key, parsed);
  }
  return Object.freeze({ version, entries: entryMap, sources: sourceMap });
}

/** La entrada de una clave que el código ya declaró: falta, es un error de copia. */
export function glossaryEntryOf(
  glossary: Glossary,
  key: string,
): GlossaryEntry {
  const entry = glossary.entries.get(key);
  if (entry === undefined) {
    throw new Error(`Glossary ${glossary.version} has no ${key}`);
  }
  return entry;
}

/** Las citas de una entrada, en el orden en que las declara. */
export function citationsOf(
  glossary: Glossary,
  entry: GlossaryEntry,
): readonly GlossarySource[] {
  return entry.sources.map((key) => glossary.sources.get(key)!);
}
