import type {
  DepositaryProgram,
  DepositaryRatio,
  IdentityGraph,
} from "@/modules/identity/domain/identity-graph";

import {
  cedearRegistryQuerySchema,
  summarizeCedearPlan,
  type CedearRegistryQuery,
  type CedearRegistryRepository,
  type CedearRegistrySummary,
} from "../application/cedear-registry-repository";
import type {
  CedearRegistryPlan,
  CedearSupersession,
  StoredCedearRegistry,
} from "../domain/plan-cedear-registry";

const isOpen = (version: {
  readonly validTo: string | null;
  readonly supersededAt: string | null;
}) => version.validTo === null && version.supersededAt === null;

/**
 * Doble de test, no un modo de runtime. Ningún composition root lo construye.
 *
 * Guarda también el grafo, porque el plan escribe en él —el depositario, la
 * security del CEDEAR y sus identificadores— y una segunda corrida tiene que
 * encontrarlos por ISIN. Corre las mismas invariantes que los índices únicos de
 * PostgreSQL: un solo programa abierto por CEDEAR, un solo ratio abierto por
 * programa y un ISIN autoritativo abierto para una sola security.
 */
export class InMemoryCedearRegistryRepository implements CedearRegistryRepository {
  readonly storage = "in-memory-fixture" as const;

  private programs: DepositaryProgram[] = [];
  private ratios: DepositaryRatio[] = [];
  private currentGraph: IdentityGraph;

  constructor(graph: IdentityGraph) {
    this.currentGraph = graph;
  }

  graph(): IdentityGraph {
    return this.currentGraph;
  }

  async loadRegistry(
    query: CedearRegistryQuery,
  ): Promise<StoredCedearRegistry> {
    const { depositaryLegalEntityId, limit } =
      cedearRegistryQuerySchema.parse(query);
    const programs = this.programs.filter(
      (program) =>
        depositaryLegalEntityId === null ||
        program.depositaryLegalEntityId === depositaryLegalEntityId,
    );
    const programIds = new Set(
      programs.map((program) => program.depositaryProgramId),
    );
    const ratios = this.ratios.filter((ratio) =>
      programIds.has(ratio.depositaryProgramId),
    );

    if (programs.length > limit || ratios.length > limit) {
      throw new Error(
        `cedear registry read exceeded its limit of ${limit} rows`,
      );
    }

    return {
      programs: programs.map((program) => ({ ...program })),
      ratios: ratios.map((ratio) => ({ ...ratio })),
    };
  }

  private static supersede<
    T extends {
      validFrom: string;
      validTo: string | null;
      supersededAt: string | null;
    },
  >(
    rows: T[],
    supersession: CedearSupersession,
    idOf: (row: T) => string,
    label: string,
  ): T[] {
    const index = rows.findIndex(
      (row) =>
        idOf(row) === supersession.id &&
        row.validFrom === supersession.validFrom &&
        isOpen(row),
    );

    if (index === -1) {
      throw new Error(`no open ${label} ${supersession.id} to supersede`);
    }

    const next = [...rows];
    next[index] = { ...rows[index]!, supersededAt: supersession.supersededAt };

    return next;
  }

  async applyRegistryPlan(
    plan: CedearRegistryPlan,
  ): Promise<CedearRegistrySummary> {
    // Todo o nada, como la transacción de PostgreSQL: se trabaja sobre copias y
    // se publican al final.
    let programs = [...this.programs];
    let ratios = [...this.ratios];

    for (const supersession of plan.programSupersessions) {
      programs = InMemoryCedearRegistryRepository.supersede(
        programs,
        supersession,
        (row) => row.depositaryProgramId,
        "program",
      );
    }

    for (const supersession of plan.ratioSupersessions) {
      ratios = InMemoryCedearRegistryRepository.supersede(
        ratios,
        supersession,
        (row) => row.depositaryRatioId,
        "ratio",
      );
    }

    for (const program of plan.programs) {
      if (
        programs.some(
          (row) =>
            isOpen(row) &&
            (row.depositarySecurityId === program.depositarySecurityId ||
              row.depositaryProgramId === program.depositaryProgramId),
        )
      ) {
        throw new Error(
          `depositary_program_versions_open_uidx: ${program.depositaryProgramId}`,
        );
      }

      programs.push(program);
    }

    for (const ratio of plan.ratios) {
      if (
        ratios.some(
          (row) =>
            isOpen(row) &&
            row.depositaryProgramId === ratio.depositaryProgramId,
        )
      ) {
        throw new Error(
          `depositary_ratios_open_uidx: ${ratio.depositaryProgramId}`,
        );
      }

      ratios.push(ratio);
    }

    const graph = this.currentGraph;

    for (const assignment of plan.identifierAssignments) {
      if (
        graph.identifierAssignments.some(
          (row) =>
            isOpen(row) &&
            row.confidence === "authoritative" &&
            row.identifierType === assignment.identifierType &&
            row.scope === assignment.scope &&
            row.normalizedValue === assignment.normalizedValue,
        )
      ) {
        throw new Error(
          `identifier_assignments_authoritative_uidx: ${assignment.normalizedValue}`,
        );
      }
    }

    this.programs = programs;
    this.ratios = ratios;
    this.currentGraph = {
      ...graph,
      legalEntities: [...graph.legalEntities, ...plan.legalEntities],
      securities: [...graph.securities, ...plan.securities],
      identifierAssignments: [
        ...graph.identifierAssignments,
        ...plan.identifierAssignments,
      ],
    };

    return summarizeCedearPlan(plan);
  }
}
