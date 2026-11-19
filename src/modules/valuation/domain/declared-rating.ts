import { z } from "zod";

import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import { utcTimestampSchema } from "@/modules/temporal/domain/temporal-version";

import { coverageFloorSchema, type CoverageFloor } from "./zero-debt-evidence";

/**
 * Rating declarado por el owner (`F6-42`, decisión delegada por el owner el
 * 2026-11-19 con F medido).
 *
 * El rating sintético sale de la cobertura `EBIT / intereses` del último
 * ejercicio. Para Ford eso es −7,3: un ejercicio con más de 15 B de cargos por
 * vehículos eléctricos. La normalización no los revierte —Ford tiene cargos
 * todos los años— y el promedio de 2020–2025 también da CCC (1,05). El rating
 * D resultante pone un costo de deuda del 23 % y un 50 % de fracaso a diez
 * años, mientras las tres calificadoras publican BBB-, BBB- y Ba1.
 *
 * Damodaran usa el rating real cuando existe y el sintético cuando no. La
 * declaración nombra el rating de la tabla de la corrida, la **más baja** de las
 * calificaciones publicadas y sus fuentes. La cobertura pasa a ser el piso de esa
 * banda, así que el costo de deuda y la probabilidad de fracaso salen de la
 * misma fila, como con la deuda cero (ADR 0054). Una declaración es por CIK, se
 * fecha cuando se decide y un corte anterior no la ve.
 */
export const DECLARED_RATING_VERSION = "declared-rating-1.0.0";

export const ratingDeclarationSchema = z.object({
  cik: z.string().regex(/^[0-9]{10}$/u),
  ticker: z.string().trim().min(1).max(12),
  /** La etiqueta exacta de la fila de la tabla de Damodaran («Ba1/BB+»). */
  rating: z.string().min(1).max(32),
  decidedBy: z.literal("owner"),
  declaredAt: utcTimestampSchema,
  rationale: z.string().trim().min(20).max(600),
  /** Las calificaciones publicadas que la sostienen; la declarada es la menor. */
  publishedRatings: z
    .array(
      z.object({
        agency: z.enum(["S&P", "Moody's", "Fitch"]),
        rating: z.string().min(1).max(8),
        source: z.url().max(512),
      }),
    )
    .min(1)
    .max(3),
});

export type RatingDeclaration = z.infer<typeof ratingDeclarationSchema>;

export const declaredRatingSchema = z.object({
  version: z.literal(DECLARED_RATING_VERSION),
  legalEntityId: z.uuid(),
  declaration: ratingDeclarationSchema,
  /** El piso de la banda declarada, con la release y la fila. */
  coverageFloor: coverageFloorSchema,
});

export type DeclaredRating = z.infer<typeof declaredRatingSchema>;

function visible(instant: string, query: PointInTimeQuery): boolean {
  return (
    (query.knownAt === null ||
      Date.parse(instant) <= Date.parse(query.knownAt)) &&
    Date.parse(instant) <= Date.parse(query.effectiveAt)
  );
}

/** La declaración vigente para el CIK al corte, o `null`. */
export function declaredRatingAt(
  declarations: readonly RatingDeclaration[],
  cik: string | null,
  query: PointInTimeQuery,
): RatingDeclaration | null {
  if (cik === null) return null;
  return (
    declarations
      .filter((item) => item.cik === cik && visible(item.declaredAt, query))
      .sort((a, b) => Date.parse(b.declaredAt) - Date.parse(a.declaredAt))[0] ??
    null
  );
}

export type DeclaredRatingAssessment =
  | { readonly status: "declared"; readonly declared: DeclaredRating }
  | {
      readonly status: "unavailable";
      readonly reason: "rating_not_in_table";
    };

export function assessDeclaredRating(
  declaration: RatingDeclaration,
  legalEntityId: string,
  floor: CoverageFloor | null,
): DeclaredRatingAssessment {
  if (floor === null)
    return { status: "unavailable", reason: "rating_not_in_table" };
  return {
    status: "declared",
    declared: declaredRatingSchema.parse({
      version: DECLARED_RATING_VERSION,
      legalEntityId,
      declaration,
      coverageFloor: floor,
    }),
  };
}

/** Lo que no cierra de una declaración congelada, como rutas. */
export function declaredRatingMismatches(
  declared: DeclaredRating,
  context: {
    readonly legalEntityId: string;
    readonly knowledge: PointInTimeQuery;
    readonly syntheticRating: string;
  },
  prefix: string,
): string[] {
  const mismatches: string[] = [];
  if (declared.legalEntityId !== context.legalEntityId)
    mismatches.push(`${prefix}.legalEntityId`);
  if (!visible(declared.declaration.declaredAt, context.knowledge))
    mismatches.push(`${prefix}.declaration.declaredAt`);
  if (declared.declaration.rating !== context.syntheticRating)
    mismatches.push(`${prefix}.declaration.rating`);
  return mismatches;
}
