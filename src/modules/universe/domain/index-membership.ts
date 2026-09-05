import { z } from "zod";

import {
  refineTemporalVersion,
  temporalVersionShape,
} from "@/modules/temporal/domain/temporal-version";

/**
 * Pertenencia a un índice como dimensión versionada.
 *
 * El sujeto es la **security**, no la entidad legal ni el listing: el S&P 500
 * admite dos clases de acciones del mismo emisor —cada una es un instrumento
 * distinto— y no admite dos veces el mismo instrumento por cotizar en más de un
 * venue. Colgar la membresía de la entidad legal fusionaría las clases; colgarla
 * del listing multiplicaría la empresa por mercado.
 *
 * Una salida del índice cierra el intervalo (`validTo`); nunca borra la fila.
 * Preguntar "quién estaba en el índice el 2024-01-01, según lo que se sabía
 * entonces" tiene que seguir siendo respondible después de cada rebalanceo
 * (`TM-06`).
 */
export const indexIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

/** Universo inicial declarado por la ADR 0007. */
export const SP500_INDEX_ID = "sp-500";

export const indexMembershipSchema = z
  .object({
    ...temporalVersionShape,
    indexMembershipId: z.uuid(),
    indexId: indexIdSchema,
    securityId: z.uuid(),
  })
  .superRefine(refineTemporalVersion);

export type IndexMembership = z.infer<typeof indexMembershipSchema>;

/** Miembros vigentes y conocidos en el corte, sin desempatar solapamientos. */
export function isOpenMembership(membership: IndexMembership): boolean {
  return membership.validTo === null && membership.supersededAt === null;
}
