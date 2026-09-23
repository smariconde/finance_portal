import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  identifierAssignmentSchema,
  identityGraphSchema,
  legalEntitySchema,
  listingSchema,
  listingSymbolSchema,
  normalizeSymbol,
  securitySchema,
} from "@/modules/identity/domain/identity-graph";
import {
  summarizePlan,
  universeStateQuerySchema,
  type UniverseRepository,
} from "@/modules/universe/application/universe-repository";
import { indexMembershipSchema } from "@/modules/universe/domain/index-membership";
import type { UniverseConstitutionPlan } from "@/modules/universe/domain/plan-universe-constitution";

import * as schema from "./schema";
import { toTemporalFields, toTemporalRow } from "./temporal-row";

type Database = PostgresJsDatabase<typeof schema>;

/**
 * Repositorio personal del grafo de identidad y del universo.
 *
 * Escribe el plan completo en una sola transacción: cerrar una versión y abrir
 * la que la reemplaza es una operación, no dos. Si se partiera, el índice único
 * parcial de versión abierta rechazaría la segunda mitad y dejaría al sujeto sin
 * versión vigente o con dos.
 *
 * Las tablas de registro se insertan con `onConflictDoNothing`: un renombre
 * reusa el ID de la entidad, así que su fila de registro ya existe y volver a
 * declararla no es un error, es la afirmación de que la identidad no cambió.
 */
export function createPostgresUniverseRepository(
  database: Database,
): UniverseRepository {
  return {
    storage: "personal-postgres",
    async loadState(query) {
      const parsed = universeStateQuerySchema.parse(query);

      const [
        entityRows,
        securityRows,
        listingRows,
        symbolRows,
        assignmentRows,
        membershipRows,
        programRows,
        ratioRows,
      ] = await Promise.all([
        database
          .select()
          .from(schema.legalEntityVersions)
          .where(
            and(
              isNull(schema.legalEntityVersions.validTo),
              isNull(schema.legalEntityVersions.supersededAt),
            ),
          )
          .limit(parsed.limit),
        database
          .select()
          .from(schema.securityVersions)
          .where(
            and(
              isNull(schema.securityVersions.validTo),
              isNull(schema.securityVersions.supersededAt),
            ),
          )
          .limit(parsed.limit),
        database
          .select()
          .from(schema.listingVersions)
          .where(
            and(
              isNull(schema.listingVersions.validTo),
              isNull(schema.listingVersions.supersededAt),
            ),
          )
          .limit(parsed.limit),
        database
          .select()
          .from(schema.listingSymbols)
          .where(
            and(
              isNull(schema.listingSymbols.validTo),
              isNull(schema.listingSymbols.supersededAt),
            ),
          )
          .limit(parsed.limit),
        database
          .select()
          .from(schema.identifierAssignments)
          .where(
            and(
              isNull(schema.identifierAssignments.validTo),
              isNull(schema.identifierAssignments.supersededAt),
            ),
          )
          .limit(parsed.limit),
        database
          .select()
          .from(schema.indexMemberships)
          .where(eq(schema.indexMemberships.indexId, parsed.indexId))
          .limit(parsed.limit),
        database
          .select()
          .from(schema.depositaryProgramVersions)
          .where(
            and(
              isNull(schema.depositaryProgramVersions.validTo),
              isNull(schema.depositaryProgramVersions.supersededAt),
            ),
          )
          .limit(parsed.limit),
        database
          .select()
          .from(schema.depositaryRatios)
          .where(
            and(
              isNull(schema.depositaryRatios.validTo),
              isNull(schema.depositaryRatios.supersededAt),
            ),
          )
          .limit(parsed.limit),
      ]);

      const graph = identityGraphSchema.parse({
        legalEntities: entityRows.map((row) => ({
          ...toTemporalFields(row),
          legalEntityId: row.legalEntityId,
          legalName: row.legalName,
          entityType: row.entityType,
          jurisdiction: row.jurisdiction,
          status: row.status,
        })),
        securities: securityRows.map((row) => ({
          ...toTemporalFields(row),
          securityId: row.securityId,
          issuerLegalEntityId: row.issuerLegalEntityId,
          securityType: row.securityType,
          shareClass: row.shareClass,
          economicCurrency: row.economicCurrency,
          status: row.status,
        })),
        listings: listingRows.map((row) => ({
          ...toTemporalFields(row),
          listingId: row.listingId,
          securityId: row.securityId,
          mic: row.mic,
          quoteCurrency: row.quoteCurrency,
          country: row.country,
          status: row.status,
          primaryListing: row.primaryListing,
        })),
        listingSymbols: symbolRows.map((row) => ({
          ...toTemporalFields(row),
          listingSymbolId: row.listingSymbolId,
          listingId: row.listingId,
          symbol: row.symbol,
          symbolType: row.symbolType,
        })),
        // Los programas vigentes del registro CEDEAR (`F7-03`, ADR 0027). La
        // historia —ratios superseded, programas retirados— no es estado del
        // grafo: se lee con el repositorio del registro al corte pedido.
        depositaryPrograms: programRows.map((row) => ({
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
        })),
        depositaryRatios: ratioRows.map((row) => ({
          ...toTemporalFields(row),
          depositaryRatioId: row.depositaryRatioId,
          depositaryProgramId: row.depositaryProgramId,
          depositaryUnits: row.depositaryUnits,
          underlyingUnits: row.underlyingUnits,
          announcedAt: row.announcedAt?.toISOString() ?? null,
        })),
        identifierAssignments: assignmentRows.map((row) => ({
          ...toTemporalFields(row),
          identifierAssignmentId: row.identifierAssignmentId,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          identifierType: row.identifierType,
          identifierValue: row.identifierValue,
          normalizedValue: row.normalizedValue,
          scope: row.scope,
          issuingAuthority: row.issuingAuthority,
          confidence: row.confidence,
        })),
      });

      return {
        graph,
        memberships: membershipRows.map((row) =>
          indexMembershipSchema.parse({
            ...toTemporalFields(row),
            indexMembershipId: row.indexMembershipId,
            indexId: row.indexId,
            securityId: row.securityId,
          }),
        ),
      };
    },
    async applyConstitution(plan: UniverseConstitutionPlan) {
      // El plan se vuelve a validar antes de escribir: el repositorio no confía
      // en que quien lo construyó lo haya parseado (`TM-05`).
      const legalEntities = plan.legalEntities.map((version) =>
        legalEntitySchema.parse(version),
      );
      const securities = plan.securities.map((version) =>
        securitySchema.parse(version),
      );
      const listings = plan.listings.map((version) =>
        listingSchema.parse(version),
      );
      const listingSymbols = plan.listingSymbols.map((version) =>
        listingSymbolSchema.parse(version),
      );
      const assignments = plan.identifierAssignments.map((version) =>
        identifierAssignmentSchema.parse(version),
      );
      const memberships = plan.memberships.map((version) =>
        indexMembershipSchema.parse(version),
      );

      await database.transaction(async (transaction) => {
        // Las clausuras van primero: el índice único de versión abierta nunca
        // debe ver dos filas vigentes para el mismo sujeto.
        for (const closure of plan.closures) {
          if (closure.level === "legal_entity") {
            await transaction
              .update(schema.legalEntityVersions)
              .set({ validTo: new Date(closure.validTo) })
              .where(
                and(
                  eq(
                    schema.legalEntityVersions.legalEntityId,
                    closure.subjectId,
                  ),
                  eq(
                    schema.legalEntityVersions.validFrom,
                    new Date(closure.validFrom),
                  ),
                  // Sólo cierra un intervalo abierto: nunca reescribe una
                  // decisión ya tomada.
                  isNull(schema.legalEntityVersions.validTo),
                ),
              );
            continue;
          }

          await transaction
            .update(schema.indexMemberships)
            .set({ validTo: new Date(closure.validTo) })
            .where(
              and(
                eq(
                  schema.indexMemberships.indexMembershipId,
                  closure.subjectId,
                ),
                eq(
                  schema.indexMemberships.validFrom,
                  new Date(closure.validFrom),
                ),
                isNull(schema.indexMemberships.validTo),
              ),
            );
        }

        if (legalEntities.length > 0) {
          await transaction
            .insert(schema.legalEntities)
            .values(
              [
                ...new Set(
                  legalEntities.map((version) => version.legalEntityId),
                ),
              ].map((legalEntityId) => ({ legalEntityId })),
            )
            .onConflictDoNothing();
          await transaction.insert(schema.legalEntityVersions).values(
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
          await transaction
            .insert(schema.securities)
            .values(
              [...new Set(securities.map((version) => version.securityId))].map(
                (securityId) => ({ securityId }),
              ),
            )
            .onConflictDoNothing();
          await transaction.insert(schema.securityVersions).values(
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

        if (listings.length > 0) {
          await transaction
            .insert(schema.listings)
            .values(
              [...new Set(listings.map((version) => version.listingId))].map(
                (listingId) => ({ listingId }),
              ),
            )
            .onConflictDoNothing();
          await transaction.insert(schema.listingVersions).values(
            listings.map((version) => ({
              ...toTemporalRow(version),
              listingId: version.listingId,
              securityId: version.securityId,
              mic: version.mic,
              quoteCurrency: version.quoteCurrency,
              country: version.country,
              status: version.status,
              primaryListing: version.primaryListing,
            })),
          );
        }

        if (listingSymbols.length > 0) {
          await transaction.insert(schema.listingSymbols).values(
            listingSymbols.map((version) => ({
              ...toTemporalRow(version),
              listingSymbolId: version.listingSymbolId,
              listingId: version.listingId,
              symbol: version.symbol,
              // Clave de búsqueda derivada: el valor original queda intacto.
              normalizedSymbol: normalizeSymbol(version.symbol),
              symbolType: version.symbolType,
            })),
          );
        }

        if (assignments.length > 0) {
          await transaction.insert(schema.identifierAssignments).values(
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

        if (memberships.length > 0) {
          await transaction.insert(schema.indexMemberships).values(
            memberships.map((version) => ({
              ...toTemporalRow(version),
              indexMembershipId: version.indexMembershipId,
              indexId: version.indexId,
              securityId: version.securityId,
            })),
          );
        }
      });

      return summarizePlan(plan);
    },
  };
}
