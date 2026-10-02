import { z } from "zod";

import { completenessProfileSchema } from "./completeness-profile";
import { methodSelectionSchema } from "./method-selection";
import { rigorAssessmentSchema } from "./rigor-level";

/**
 * Lo que la Fase 3 decide antes de valuar, y que la corrida lleva consigo:
 * método, completitud y nivel de rigor (`F3-01` a `F3-03`).
 *
 * Viaja dentro del snapshot, así que entra en el `input_hash`: la misma empresa
 * evaluada con otra versión del selector o con un dato más es otra corrida.
 */
export const valuationAssessmentSchema = z.object({
  selection: methodSelectionSchema,
  completeness: completenessProfileSchema,
  rigor: rigorAssessmentSchema,
});

export type ValuationAssessment = z.infer<typeof valuationAssessmentSchema>;
