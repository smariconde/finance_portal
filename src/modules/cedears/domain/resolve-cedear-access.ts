import type {
  DepositaryProgram,
  DepositaryRatio,
} from "@/modules/identity/domain/identity-graph";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import { selectEffectiveVersion } from "@/modules/temporal/domain/temporal-version";

import type { StoredCedearRegistry } from "./plan-cedear-registry";

/**
 * Acceso por CEDEAR a una security subyacente, al corte pedido
 * ([ADR 0027](../../../../docs/architecture/adr/0027-cedear-registry-sources.md)).
 *
 * Es lo que la matriz de riesgo va a preguntar por cada punto (`F7-05`) y la
 * valuación por su ticker (`F6-04`). La respuesta es por **security**, no por
 * emisor: si una empresa tiene dos clases, sólo la que es subyacente de un
 * programa lo tiene —GOOGL sí, GOOG no—.
 *
 * Nunca dice «sin CEDEAR» cuando lo que sabe es menos que eso. Un programa que
 * no es efectivo al corte —porque se lo vio por primera vez después, o porque se
 * retiró— se nombra con su motivo, y quien lee decide qué dibujar.
 */
export const CEDEAR_ACCESS_RULE_VERSION = "cedear-access-1.0.0";

export type CedearAccessProgram = {
  readonly program: DepositaryProgram;
  /** `null` si el programa no tiene ratio efectivo y conocido al corte. */
  readonly ratio: DepositaryRatio | null;
};

export type CedearAccess =
  | {
      readonly status: "program";
      readonly programs: readonly CedearAccessProgram[];
    }
  | {
      readonly status: "none_known";
      readonly reason:
        /** Ningún programa del registro tuvo nunca este subyacente. */
        | "no_program_recorded"
        /**
         * Hay programas registrados, pero ninguno efectivo y conocido al corte:
         * el corte es anterior a la primera observación, o el programa se retiró.
         */
        | "not_effective_at_cutoff";
    };

export function resolveCedearAccess(
  registry: StoredCedearRegistry,
  underlyingSecurityId: string,
  query: PointInTimeQuery,
): CedearAccess {
  const versions = registry.programs.filter(
    (program) => program.underlyingSecurityId === underlyingSecurityId,
  );

  if (versions.length === 0) {
    return { status: "none_known", reason: "no_program_recorded" };
  }

  const programIds = [
    ...new Set(versions.map((program) => program.depositaryProgramId)),
  ].sort();
  const programs: CedearAccessProgram[] = [];

  for (const programId of programIds) {
    const program = selectEffectiveVersion(
      versions.filter((version) => version.depositaryProgramId === programId),
      query,
      programId,
    );

    if (program === null) {
      continue;
    }

    programs.push({
      program,
      ratio: selectEffectiveVersion(
        registry.ratios.filter(
          (ratio) => ratio.depositaryProgramId === programId,
        ),
        query,
        programId,
      ),
    });
  }

  return programs.length === 0
    ? { status: "none_known", reason: "not_effective_at_cutoff" }
    : { status: "program", programs };
}
