import {
  declaredSuccessionSchema,
  type DeclaredSuccession,
} from "../domain/reporting-succession";

/**
 * Sucesiones de emisor declaradas por el owner.
 *
 * Es configuración revisada, igual que el registro de fuentes y el pin de la
 * lista de constituyentes: agregar una es un diff que se lee. La declaración no
 * prueba nada por sí sola; `pnpm corporate-actions:record` la contrasta con los
 * índices de la SEC y rechaza con nombre lo que no cierra.
 *
 * Todo lo citado es público: CIK y accession de EDGAR.
 */
export const DECLARED_SUCCESSIONS: readonly DeclaredSuccession[] =
  Object.freeze([
    declaredSuccessionSchema.parse({
      predecessorCik: "0000034088",
      successorCik: "0002115436",
      successionAccession: "0001193125-26-291990",
      decidedBy: "owner",
      decidedOn: "2026-09-14",
      rationale:
        "Reorganización en holding: ExxonMobil Holdings Corp asume el registro de Exxon Mobil Corporation por 8-K12B y presenta los estados del mismo grupo consolidado; el 10-Q del segundo trimestre de 2026 es conjunto y sus comparativos repiten los valores del antecesor.",
    }),
  ]);
