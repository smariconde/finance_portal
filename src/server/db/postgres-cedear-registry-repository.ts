import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  cedearRegistryQuerySchema,
  summarizeCedearPlan,
  type CedearRegistryRepository,
} from "@/modules/cedears/application/cedear-registry-repository";
import type {
  CedearRegistryPlan,
  CedearSupersession,
} from "@/modules/cedears/domain/plan-cedear-registry";
import {
  depositaryProgramSchema,
  depositaryRatioSchema,
  identifierAssignmentSchema,
  legalEntitySchema,
  securitySchema,
} from "@/modules/identity/domain/identity-graph";

import * as schema from "./schema";
import { toTemporalFields, toTemporalRow } from "./temporal-row";

type Database = PostgresJsDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Repositorio personal del registro CEDEAR (ADR 0027).
 *
 * Escribe el plan en **una** transacción que toca dos familias de tablas: la
 * identidad —el depositario, la security del CEDEAR y sus identificadores— y el
 * registro —programa y ratio—. Partida, un programa podría quedar apuntando a
 * una security que no existe, o un ratio nuevo convivir con el que reemplaza.
 * Las supersesiones van primero: los índices únicos parciales nunca deben ver
 * dos versiones vigentes.
 */
export function createPostgresCedearRegistryRepository(
  database: Database,
): CedearRegistryRepository {
  async function supersede(
    tx: Transaction,
    supersession: CedearSupersession,
    kind: "program" | "ratio",
  ): Promise<void> {
    const updated =
      kind === "program"
        ? await tx
            .update(schema.depositaryProgramVersions)
            .set({ supersededAt: new Date(supersession.supersededAt) })
            .where(
              and(
                eq(
                  schema.depositaryProgramVersions.depositaryProgramId,
                  supersession.id,
                ),
                eq(
                  schema.depositaryProgramVersions.validFrom,
                  new Date(supersession.validFrom),
                ),
                isNull(schema.depositaryProgramVersions.validTo),
                isNull(schema.depositaryProgramVersions.supersededAt),
              ),
            )
            .returning({
              id: schema.depositaryProgramVersions.depositaryProgramId,
            })
        : await tx
            .update(schema.depositaryRatios)
            .set({ supersededAt: new Date(supersession.supersededAt) })
            .where(
              and(
                eq(schema.depositaryRatios.depositaryRatioId, supersession.id),
                eq(
                  schema.depositaryRatios.validFrom,
                  new Date(supersession.validFrom),
                ),
                isNull(schema.depositaryRatios.validTo),
                isNull(schema.depositaryRatios.supersededAt),
              ),
            )
            .returning({ id: schema.depositaryRatios.depositaryRatioId });

    // Cero filas es que la versión que el plan vio ya no está abierta: otra
    // corrida la movió entre el plan y la escritura. Se aborta todo.
    if (updated.length !== 1) {
      throw new Error(
        `expected exactly one open ${kind} ${supersession.id} to supersede, updated ${updated.length}`,
      );
    }
  }

  return {
    storage: "personal-postgres",
    async loadRegistry(query) {
      const parsed = cedearRegistryQuerySchema.parse(query);
      const scope =
        parsed.depositaryLegalEntityId === null
          ? undefined
          : eq(
              schema.depositaryProgramVersions.depositaryLegalEntityId,
              parsed.depositaryLegalEntityId,
            );

      const programRows = await database
        .select()
        .from(schema.depositaryProgramVersions)
        .where(scope)
        // Una fila más que el techo distingue "entró justo" de "se pasó".
        .limit(parsed.limit + 1);

      const programIds = [
        ...new Set(programRows.map((row) => row.depositaryProgramId)),
      ];
      const ratioRows =
        programIds.length === 0
          ? []
          : await database
              .select()
              .from(schema.depositaryRatios)
              .where(
                inArray(
                  schema.depositaryRatios.depositaryProgramId,
                  programIds,
                ),
              )
              .limit(parsed.limit + 1);

      if (
        programRows.length > parsed.limit ||
        ratioRows.length > parsed.limit
      ) {
        throw new Error(
          `cedear registry read exceeded its limit of ${parsed.limit} rows`,
        );
      }

      return {
        programs: programRows.map((row) =>
          depositaryProgramSchema.parse({
            ...toTemporalFields(row),
            depositaryProgramId: row.depositaryProgramId,
            programType: row.programType,
            depositarySecurityId: row.depositarySecurityId,
            underlyingSecurityId: row.underlyingSecurityId,
            depositaryLegalEntityId: row.depositaryLegalEntityId,
            sponsorLegalEntityId: row.sponsorLegalEntityId,
            investorScope: row.investorScope,
            status: row.status,
            reportedUnderlyingSymbol: row.reportedUnderlyingSymbol,
            reportedUnderlyingIsin: row.reportedUnderlyingIsin,
          }),
        ),
        ratios: ratioRows.map((row) =>
          depositaryRatioSchema.parse({
            ...toTemporalFields(row),
            depositaryRatioId: row.depositaryRatioId,
            depositaryProgramId: row.depositaryProgramId,
            depositaryUnits: row.depositaryUnits,
            underlyingUnits: row.underlyingUnits,
            announcedAt: row.announcedAt?.toISOString() ?? null,
          }),
        ),
      };
    },
    async applyRegistryPlan(plan: CedearRegistryPlan) {
      // El plan se vuelve a validar antes de escribir: el repositorio no confía
      // en que quien lo construyó lo haya parseado (`TM-05`).
      const legalEntities = plan.legalEntities.map((version) =>
        legalEntitySchema.parse(version),
      );
      const securities = plan.securities.map((version) =>
        securitySchema.parse(version),
      );
      const assignments = plan.identifierAssignments.map((version) =>
        identifierAssignmentSchema.parse(version),
      );
      const programs = plan.programs.map((version) =>
        depositaryProgramSchema.parse(version),
      );
      const ratios = plan.ratios.map((version) =>
        depositaryRatioSchema.parse(version),
      );

      await database.transaction(async (tx) => {
        for (const supersession of plan.programSupersessions) {
          await supersede(tx, supersession, "program");
        }

        for (const supersession of plan.ratioSupersessions) {
          await supersede(tx, supersession, "ratio");
        }

        if (legalEntities.length > 0) {
          await tx
            .insert(schema.legalEntities)
            .values(
              legalEntities.map((version) => ({
                legalEntityId: version.legalEntityId,
              })),
            )
            .onConflictDoNothing();
          await tx.insert(schema.legalEntityVersions).values(
            legalEntities.map((version) => ({
              ...toTemporalRow(version),
              legalEntityId: version.legalEntityId,
              legalName: version.legalName,
              entityType: version.entityType,
              jurisdiction: version.jurisdiction,
              status: version.status,
            })),
          );
        }

        if (securities.length > 0) {
          await tx
            .insert(schema.securities)
            .values(
              securities.map((version) => ({ securityId: version.securityId })),
            );
          await tx.insert(schema.securityVersions).values(
            securities.map((version) => ({
              ...toTemporalRow(version),
              securityId: version.securityId,
              issuerLegalEntityId: version.issuerLegalEntityId,
              securityType: version.securityType,
              shareClass: version.shareClass,
              economicCurrency: version.economicCurrency,
              status: version.status,
            })),
          );
        }

        if (assignments.length > 0) {
          await tx.insert(schema.identifierAssignments).values(
            assignments.map((version) => ({
              ...toTemporalRow(version),
              identifierAssignmentId: version.identifierAssignmentId,
              subjectType: version.subjectType,
              subjectId: version.subjectId,
              identifierType: version.identifierType,
              identifierValue: version.identifierValue,
              normalizedValue: version.normalizedValue,
              scope: version.scope,
              issuingAuthority: version.issuingAuthority,
              confidence: version.confidence,
            })),
          );
        }

        if (programs.length > 0) {
          // Un programa que reaparece reusa su ID: su fila de registro ya existe
          // y volver a declararla es afirmar que es el mismo programa.
          await tx
            .insert(schema.depositaryPrograms)
            .values(
              [
                ...new Set(
                  programs.map((version) => version.depositaryProgramId),
                ),
              ].map((depositaryProgramId) => ({ depositaryProgramId })),
            )
            .onConflictDoNothing();
          await tx.insert(schema.depositaryProgramVersions).values(
            programs.map((version) => ({
              ...toTemporalRow(version),
              depositaryProgramId: version.depositaryProgramId,
              programType: version.programType,
              depositarySecurityId: version.depositarySecurityId,
              underlyingSecurityId: version.underlyingSecurityId,
              depositaryLegalEntityId: version.depositaryLegalEntityId,
              sponsorLegalEntityId: version.sponsorLegalEntityId,
              investorScope: version.investorScope,
              status: version.status,
              reportedUnderlyingSymbol: version.reportedUnderlyingSymbol,
              reportedUnderlyingIsin: version.reportedUnderlyingIsin,
            })),
          );
        }

        if (ratios.length > 0) {
          await tx.insert(schema.depositaryRatios).values(
            ratios.map((version) => ({
              ...toTemporalRow(version),
              depositaryRatioId: version.depositaryRatioId,
              depositaryProgramId: version.depositaryProgramId,
              depositaryUnits: version.depositaryUnits,
              underlyingUnits: version.underlyingUnits,
              announcedAt:
                version.announcedAt === null
                  ? null
                  : new Date(version.announcedAt),
            })),
          );
        }
      });

      return summarizeCedearPlan(plan);
    },
  };
}
