import {
  profileDeclarationSchema,
  type ProfileDeclaration,
} from "../domain/declared-profile";

/**
 * Perfiles de ciclo declarados por el owner, por CIK (`F6-43`). Sólo cuando el
 * SIC junta negocios que no comparten la economía; agregar uno es un diff
 * revisable y la selección nombra la regla declarada.
 */
export const DECLARED_PROFILES: readonly ProfileDeclaration[] = Object.freeze(
  (
    [
      {
        cik: "0000723125",
        ticker: "MU",
        profile: "cyclical",
        decidedBy: "owner",
        declaredAt: "2026-11-19T14:00:00.000Z",
        rationale:
          "Decisión delegada por el owner el 2026-11-19. Micron fabrica memorias DRAM y NAND, un commodity manufacturado cuyo resultado sigue al precio del ciclo: margen operativo −20 % en 2023 y 76 % ajustado en el ejercicio base. El SIC 3674 no lo separa de quien diseña chips.",
      },
    ] as const satisfies readonly unknown[]
  ).map((entry) => profileDeclarationSchema.parse(entry)),
);
