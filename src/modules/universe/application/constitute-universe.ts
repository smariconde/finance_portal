import { z } from "zod";

import { sourceIdSchema } from "@/modules/ingestion/domain/source-registry-entry";

import { indexIdSchema } from "../domain/index-membership";
import {
  planUniverseConstitution,
  type UniverseConstitutionPlan,
} from "../domain/plan-universe-constitution";
import { resolveConstituents } from "../domain/resolve-constituents";
import {
  companyTickerAssignmentSchema,
  indexConstituentClaimSchema,
} from "../domain/universe-source-records";

import {
  summarizePlan,
  type UniverseConstitutionSummary,
  type UniverseRepository,
} from "./universe-repository";

/**
 * Techo del lote. El S&P 500 tiene ~503 instrumentos y la tabla ticker→CIK de la
 * SEC unas decenas de miles: un lote más grande que esto no es un universo más
 * grande, es otra cosa que se coló por el mismo camino.
 */
const MAX_CLAIMS = 5_000;
const MAX_ASSIGNMENTS = 100_000;

export const constituteUniverseCommandSchema = z.object({
  indexId: indexIdSchema,
  /** Vigencia del snapshot del índice. */
  effectiveAt: z.iso.datetime({ offset: true }),
  /** Primer instante en que ese snapshot pudo conocerse. */
  availableAt: z.iso.datetime({ offset: true }),
  sourceId: sourceIdSchema,
  sourceDocumentId: z.string().trim().min(1).max(256).nullable().default(null),
  claims: z.array(indexConstituentClaimSchema).max(MAX_CLAIMS),
  assignments: z.array(companyTickerAssignmentSchema).max(MAX_ASSIGNMENTS),
});

export type ConstituteUniverseCommand = z.input<
  typeof constituteUniverseCommandSchema
>;

export type ConstituteUniverseDependencies = {
  readonly repository: UniverseRepository;
  /** Reloj inyectado: `recorded_at` es auditoría, no un `Date.now()` disperso. */
  readonly now: () => string;
  readonly newId: () => string;
};

export type ConstituteUniverseOutcome = {
  readonly plan: UniverseConstitutionPlan;
  readonly summary: UniverseConstitutionSummary;
};

/**
 * Constituye el universo de un índice: resuelve identidad, planifica versiones y
 * aplica el plan completo. La decisión vive en el dominio; acá sólo se ordena el
 * paso por el repositorio, de modo que probar la regla no exija una base.
 *
 * Una constitución sin miembros resueltos **no** se aplica. Un lote vacío o
 * íntegramente irresuelto no puede vaciar el universo por omisión: cerraría cada
 * membresía vigente como si el índice se hubiera disuelto (`TM-05`).
 */
export async function constituteUniverse(
  command: ConstituteUniverseCommand,
  dependencies: ConstituteUniverseDependencies,
): Promise<ConstituteUniverseOutcome> {
  const parsed = constituteUniverseCommandSchema.parse(command);
  const { repository, now, newId } = dependencies;

  const state = await repository.loadState({ indexId: parsed.indexId });
  const resolution = resolveConstituents(parsed.claims, parsed.assignments);

  const plan = planUniverseConstitution({
    indexId: parsed.indexId,
    effectiveAt: parsed.effectiveAt,
    availableAt: parsed.availableAt,
    recordedAt: now(),
    sourceId: parsed.sourceId,
    sourceDocumentId: parsed.sourceDocumentId,
    resolution,
    state,
    newId,
  });

  if (plan.counts.members === 0) {
    return {
      plan,
      summary: {
        ...summarizePlan(plan),
        applied: {
          legalEntities: 0,
          securities: 0,
          listings: 0,
          listingSymbols: 0,
          identifierAssignments: 0,
          memberships: 0,
          closures: 0,
        },
        members: 0,
      },
    };
  }

  return { plan, summary: await repository.applyConstitution(plan) };
}
