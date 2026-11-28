import { z } from "zod";

import type { ZoningQuery } from "./zoning-resolution";

/**
 * La consulta de zonificación que el owner hizo al municipio por una parcela
 * (`zoning-query-1.0.0`, decisión del owner del 2026-11-28): se carga con
 * `pnpm inmuebles:zoning-query --file …` desde un archivo que vive fuera del
 * repositorio. Es la única lectura `official_query`. Una consulta nueva de la
 * misma parcela reemplaza a la anterior, que queda guardada.
 */
export const ZONING_QUERY_VERSION = "zoning-query-1.0.0";

const decimal = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u, "canonical_decimal");

export const zoningQueryFileSchema = z.strictObject({
  /** Nomenclatura provincial de 16 dígitos, como la publica IDECOR. */
  nomenclature: z.string().regex(/^\d{16}$/u, "nomenclature_16_digits"),
  pattern: z.string().trim().min(1).max(80),
  ordinance: z.string().trim().min(1).max(200),
  /** FOS como fracción (0,7), no como porcentaje. */
  fos: decimal
    .refine((value) => Number(value) > 0 && Number(value) <= 1, "fos_fraction")
    .nullable(),
  fot: decimal.refine((value) => Number(value) > 0, "fot_positive").nullable(),
  heightMaxM: decimal
    .refine((value) => Number(value) > 0, "height_positive")
    .nullable(),
  floorsMax: z.number().int().min(1).max(80).nullable(),
  consultedOn: z.iso.date(),
  reference: z.string().trim().min(1).max(300),
});

export type ZoningQueryFile = z.infer<typeof zoningQueryFileSchema>;

export function zoningQueryOf(
  file: ZoningQueryFile,
  declaredAt: string,
): ZoningQuery {
  return { ...file, declaredAt };
}
