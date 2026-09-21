import { z } from "zod";

/**
 * Muestra de reconciliación del gate de la Fase 2 (`F2-07`).
 *
 * El gate pide 30 empresas de arquetipos distintos reconciliadas contra su
 * filing. Nada en la base puede decir hoy de qué arquetipo es una empresa: no
 * hay columna de sector, industria ni SIC, y la clasificación versionada es
 * `F7-02`, que el roadmap ejecuta después de esta fase.
 *
 * Así que el arquetipo se **declara**, igual que las sucesiones y los eventos
 * corporativos: es configuración revisada, un diff que se lee, con el motivo de
 * cada elección escrito al lado. No es el selector de `F3-01` —ese va a derivar
 * el arquetipo de reglas sobre los datos— y este vocabulario no lo condiciona:
 * acá sólo se declara a qué se parece cada empresa para que la muestra cubra
 * métodos de valuación distintos y no treinta veces el mismo.
 *
 * El ticker es cómo el owner nombra una empresa; el CIK lo resuelve el grafo de
 * identidad en el momento de usarla, como hace `pnpm fundamentals:ingest`.
 */
export const GATE_SAMPLE_VERSION = "phase-2-gate-sample-1.0.0";

/**
 * Arquetipos de [`04_VALUATION_SYSTEM.md`](../../../../docs/finance-portal-masterplan/04_VALUATION_SYSTEM.md).
 * Cada uno exige un método distinto, y es esa diferencia la que la muestra tiene
 * que cubrir: un banco reconciliado con conceptos industriales no prueba nada.
 */
export const gateArchetypeSchema = z.enum([
  "mature_non_financial",
  "high_growth",
  "loss_making_early_stage",
  "bank",
  "insurer",
  "reit",
  "cyclical",
  "commodity",
  "holding",
  "distress",
]);

export type GateArchetype = z.infer<typeof gateArchetypeSchema>;

export const GATE_ARCHETYPES: readonly GateArchetype[] =
  gateArchetypeSchema.options;

export const gateSampleEntrySchema = z.object({
  /** Símbolo vigente por el que el owner nombra la empresa. */
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .regex(/^[A-Z][A-Z0-9.-]*$/u),
  archetype: gateArchetypeSchema,
  /** Tanda de ingesta: la muestra se baja por partes y se mide entre una y otra. */
  batch: z.number().int().min(1).max(9),
  decidedBy: z.literal("owner"),
  decidedOn: z.iso.date(),
  /** Por qué esta empresa y no otra del mismo arquetipo. */
  rationale: z.string().trim().min(20).max(400),
});

export type GateSampleEntry = z.infer<typeof gateSampleEntrySchema>;

export class GateSampleError extends Error {
  constructor(
    readonly reason:
      | "duplicate_ticker"
      | "archetype_not_covered"
      | "batch_leaves_archetype_uncovered",
    message: string,
    readonly subjects: readonly string[] = [],
  ) {
    super(message);
    this.name = "GateSampleError";
  }
}

/**
 * Invariantes de la muestra. Se evalúan sobre la declaración, no sobre la base:
 * una muestra que repite un ticker o que deja un arquetipo sin representante no
 * prueba lo que el gate dice que prueba, y conviene que eso falle al leer el
 * archivo y no después de gastar los requests.
 */
export function assertGateSample(
  entries: readonly GateSampleEntry[],
): readonly GateSampleEntry[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.ticker)) {
      duplicates.add(entry.ticker);
    }
    seen.add(entry.ticker);
  }

  if (duplicates.size > 0) {
    throw new GateSampleError(
      "duplicate_ticker",
      "A company appears more than once in the gate sample.",
      [...duplicates].sort(),
    );
  }

  const covered = new Set(entries.map((entry) => entry.archetype));
  const missing = GATE_ARCHETYPES.filter(
    (archetype) => !covered.has(archetype),
  );

  if (missing.length > 0) {
    throw new GateSampleError(
      "archetype_not_covered",
      "The gate sample leaves an archetype without a company.",
      missing,
    );
  }

  // La primera tanda existe para cubrir los diez arquetipos con lo mínimo que
  // se puede bajar. Si no los cubre, medir sobre ella no dice nada del resto.
  const firstBatch = new Set(
    entries
      .filter((entry) => entry.batch === 1)
      .map((entry) => entry.archetype),
  );
  const uncovered = GATE_ARCHETYPES.filter(
    (archetype) => !firstBatch.has(archetype),
  );

  if (uncovered.length > 0) {
    throw new GateSampleError(
      "batch_leaves_archetype_uncovered",
      "The first batch does not reach every archetype.",
      uncovered,
    );
  }

  return entries;
}

/** Empresas de una tanda, en el orden en que se declararon. */
export function selectBatch(
  entries: readonly GateSampleEntry[],
  batch: number,
): readonly GateSampleEntry[] {
  return entries.filter((entry) => entry.batch === batch);
}

/** Cuántas empresas declara cada arquetipo. Es lo que el informe del gate muestra. */
export function countByArchetype(
  entries: readonly GateSampleEntry[],
): Readonly<Record<GateArchetype, number>> {
  const counts = Object.fromEntries(
    GATE_ARCHETYPES.map((archetype) => [archetype, 0]),
  ) as Record<GateArchetype, number>;

  for (const entry of entries) {
    counts[entry.archetype] += 1;
  }

  return counts;
}
