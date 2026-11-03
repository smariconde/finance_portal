import "server-only";

import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  MAX_DEFINITIONS_PER_SOURCE,
  MAX_OBSERVATIONS_PER_SERIES,
  type MacroSeriesRepository,
  type ObservationWrite,
} from "@/modules/macro-series/application/macro-series-repository";
import {
  sameBasis,
  seriesBasisSchema,
  seriesDefinitionSchema,
  type CatalogPlan,
  type SeriesDefinition,
} from "@/modules/macro-series/domain/series-definition";
import {
  macroSeriesSchema,
  seriesObservationSchema,
  type SeriesObservation,
} from "@/modules/macro-series/domain/series-observation";

import * as schema from "./schema";
import { toTemporalFields, toTemporalRow } from "./temporal-row";

type Database = PostgresJsDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Espacio propio de locks consultivos: no se cruza con los de jobs ni IA. */
const MACRO_SERIES_LOCK_NAMESPACE = 20_565;
/** Filas por `insert`: ocho columnas por fila quedan lejos del techo de parámetros. */
const INSERT_CHUNK = 1000;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }

  return result;
}

const definitionColumns = {
  definition: schema.macroSeriesDefinitions,
  seriesKey: schema.macroSeries.seriesKey,
  externalId: schema.macroSeries.externalId,
};

function toDefinition(row: {
  definition: typeof schema.macroSeriesDefinitions.$inferSelect;
  seriesKey: string;
  externalId: string;
}): SeriesDefinition {
  const { definition } = row;

  return seriesDefinitionSchema.parse({
    definitionId: definition.definitionId,
    seriesKey: row.seriesKey,
    externalId: row.externalId,
    description: definition.description,
    category: definition.category,
    seriesType: definition.seriesType,
    frequency: definition.frequency,
    unit: definition.unit,
    currencyCode: definition.currencyCode,
    firstReportedOn: definition.firstReportedOn,
    methodology: definition.methodology,
    parserVersion: definition.parserVersion,
    ingestionRunId: definition.ingestionRunId,
    ...toTemporalFields(definition),
  });
}

const observationColumns = {
  observation: schema.macroSeriesObservations,
  recordedAt: schema.ingestionRuns.recordedAt,
};

function toObservation(
  seriesKey: string,
  row: {
    observation: typeof schema.macroSeriesObservations.$inferSelect;
    recordedAt: Date;
  },
): SeriesObservation {
  const { observation } = row;

  return seriesObservationSchema.parse({
    seriesKey,
    periodOn: observation.periodOn,
    revision: observation.revision,
    value: observation.value,
    withdrawn: observation.withdrawn,
    availableAt: observation.availableAt.toISOString(),
    supersededAt: observation.supersededAt?.toISOString() ?? null,
    recordedAt: row.recordedAt.toISOString(),
    ingestionRunId: observation.ingestionRunId,
  });
}

async function lockSource(tx: Transaction, sourceId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${MACRO_SERIES_LOCK_NAMESPACE}::int4, hashtext(${sourceId}::text))`,
  );
}

/**
 * Repositorio personal de series macro (`F9-01`, ADR 0065).
 *
 * Cada escritura es una transacción que toma el lock de la fuente y verifica
 * lo que el plan vio: una supersesión que no encuentra la vigente esperada
 * aborta entera, y el índice único de la revisión vigente impide que dos
 * procesos a la vez dupliquen un punto.
 */
export function createPostgresMacroSeriesRepository(
  database: Database,
): MacroSeriesRepository {
  async function seriesIdOf(seriesKey: string): Promise<number | null> {
    const rows = await database
      .select({ seriesId: schema.macroSeries.seriesId })
      .from(schema.macroSeries)
      .where(eq(schema.macroSeries.seriesKey, seriesKey));

    return rows[0]?.seriesId ?? null;
  }

  return {
    storage: "personal-postgres",

    async listOpenDefinitions(sourceId) {
      const rows = await database
        .select(definitionColumns)
        .from(schema.macroSeriesDefinitions)
        .innerJoin(
          schema.macroSeries,
          eq(
            schema.macroSeries.seriesId,
            schema.macroSeriesDefinitions.seriesId,
          ),
        )
        .where(
          and(
            eq(schema.macroSeries.sourceId, sourceId),
            isNull(schema.macroSeriesDefinitions.validTo),
            isNull(schema.macroSeriesDefinitions.supersededAt),
          ),
        )
        .orderBy(asc(schema.macroSeries.seriesId))
        .limit(MAX_DEFINITIONS_PER_SOURCE + 1);

      if (rows.length > MAX_DEFINITIONS_PER_SOURCE) {
        throw new Error(
          `${sourceId} exceeded ${MAX_DEFINITIONS_PER_SOURCE} open definitions`,
        );
      }

      return rows.map(toDefinition);
    },

    async listSeriesDefinitions(seriesKey) {
      const rows = await database
        .select(definitionColumns)
        .from(schema.macroSeriesDefinitions)
        .innerJoin(
          schema.macroSeries,
          eq(
            schema.macroSeries.seriesId,
            schema.macroSeriesDefinitions.seriesId,
          ),
        )
        .where(eq(schema.macroSeries.seriesKey, seriesKey))
        .orderBy(asc(schema.macroSeriesDefinitions.validFrom));

      return rows.map(toDefinition);
    },

    async applyCatalogPlan(plan: CatalogPlan) {
      const inserted = [
        ...plan.opened,
        ...plan.superseded.map((pair) => pair.next),
      ];
      const sourceIds = new Set(
        [...inserted, ...plan.withdrawn].map(
          (definition) => definition.sourceId,
        ),
      );

      if (sourceIds.size === 0) {
        return;
      }

      if (sourceIds.size > 1) {
        throw new Error("a catalog plan belongs to one source");
      }

      const [sourceId] = sourceIds;

      await database.transaction(async (tx) => {
        await lockSource(tx, sourceId!);

        for (const batch of chunks(plan.opened, INSERT_CHUNK)) {
          await tx
            .insert(schema.macroSeries)
            .values(
              batch.map((definition) => ({
                seriesKey: definition.seriesKey,
                sourceId: definition.sourceId,
                externalId: definition.externalId,
              })),
            )
            .onConflictDoNothing({ target: schema.macroSeries.seriesKey });
        }

        const keys = [
          ...new Set(inserted.map((definition) => definition.seriesKey)),
        ];
        const ids = new Map<string, number>();

        for (const batch of chunks(keys, INSERT_CHUNK)) {
          const rows = await tx
            .select({
              seriesId: schema.macroSeries.seriesId,
              seriesKey: schema.macroSeries.seriesKey,
            })
            .from(schema.macroSeries)
            .where(inArray(schema.macroSeries.seriesKey, batch));

          for (const row of rows) {
            ids.set(row.seriesKey, row.seriesId);
          }
        }

        const closeOpen = async (
          definition: SeriesDefinition,
          change: { supersededAt: Date } | { validTo: Date },
        ) => {
          const updated = await tx
            .update(schema.macroSeriesDefinitions)
            .set(change)
            .where(
              and(
                eq(
                  schema.macroSeriesDefinitions.definitionId,
                  definition.definitionId,
                ),
                isNull(schema.macroSeriesDefinitions.validTo),
                isNull(schema.macroSeriesDefinitions.supersededAt),
              ),
            )
            .returning({
              definitionId: schema.macroSeriesDefinitions.definitionId,
            });

          if (updated.length !== 1) {
            throw new Error(
              `the open definition of ${definition.seriesKey} is not the one the plan saw`,
            );
          }
        };

        for (const { previous, next } of plan.superseded) {
          await closeOpen(previous, {
            supersededAt: new Date(next.availableAt),
          });
        }

        for (const withdrawn of plan.withdrawn) {
          await closeOpen(withdrawn, { validTo: new Date(withdrawn.validTo!) });
        }

        for (const batch of chunks(inserted, INSERT_CHUNK)) {
          await tx.insert(schema.macroSeriesDefinitions).values(
            batch.map((definition) => {
              const seriesId = ids.get(definition.seriesKey);

              if (seriesId === undefined) {
                throw new Error(`${definition.seriesKey} has no series row`);
              }

              return {
                definitionId: definition.definitionId,
                seriesId,
                description: definition.description,
                category: definition.category,
                seriesType: definition.seriesType,
                frequency: definition.frequency,
                unit: definition.unit,
                currencyCode: definition.currencyCode,
                firstReportedOn: definition.firstReportedOn,
                methodology: definition.methodology,
                parserVersion: definition.parserVersion,
                ingestionRunId: definition.ingestionRunId,
                ...toTemporalRow(definition),
              };
            }),
          );
        }
      });
    },

    async findSeries(seriesKey) {
      const rows = await database
        .select()
        .from(schema.macroSeries)
        .where(eq(schema.macroSeries.seriesKey, seriesKey));
      const row = rows[0];

      if (row === undefined) {
        return null;
      }

      return macroSeriesSchema.parse({
        seriesKey: row.seriesKey,
        sourceId: row.sourceId,
        externalId: row.externalId,
        basis:
          row.basisFrequency === null
            ? null
            : {
                frequency: row.basisFrequency,
                unit: row.basisUnit,
                currencyCode: row.basisCurrency,
              },
      });
    },

    async listOpenObservations(seriesKey, fromPeriodOn) {
      const seriesId = await seriesIdOf(seriesKey);

      if (seriesId === null) {
        return [];
      }

      const rows = await database
        .select(observationColumns)
        .from(schema.macroSeriesObservations)
        .innerJoin(
          schema.ingestionRuns,
          eq(
            schema.ingestionRuns.runId,
            schema.macroSeriesObservations.ingestionRunId,
          ),
        )
        .where(
          and(
            eq(schema.macroSeriesObservations.seriesId, seriesId),
            isNull(schema.macroSeriesObservations.supersededAt),
            fromPeriodOn === null
              ? undefined
              : gte(schema.macroSeriesObservations.periodOn, fromPeriodOn),
          ),
        )
        .orderBy(asc(schema.macroSeriesObservations.periodOn))
        .limit(MAX_OBSERVATIONS_PER_SERIES + 1);

      if (rows.length > MAX_OBSERVATIONS_PER_SERIES) {
        throw new Error(
          `${seriesKey} exceeded ${MAX_OBSERVATIONS_PER_SERIES} points`,
        );
      }

      return rows.map((row) => toObservation(seriesKey, row));
    },

    async listObservations(seriesKey) {
      const seriesId = await seriesIdOf(seriesKey);

      if (seriesId === null) {
        return [];
      }

      const rows = await database
        .select(observationColumns)
        .from(schema.macroSeriesObservations)
        .innerJoin(
          schema.ingestionRuns,
          eq(
            schema.ingestionRuns.runId,
            schema.macroSeriesObservations.ingestionRunId,
          ),
        )
        .where(eq(schema.macroSeriesObservations.seriesId, seriesId))
        .orderBy(
          asc(schema.macroSeriesObservations.periodOn),
          asc(schema.macroSeriesObservations.revision),
        )
        .limit(MAX_OBSERVATIONS_PER_SERIES + 1);

      if (rows.length > MAX_OBSERVATIONS_PER_SERIES) {
        throw new Error(
          `${seriesKey} exceeded ${MAX_OBSERVATIONS_PER_SERIES} revisions`,
        );
      }

      return rows.map((row) => toObservation(seriesKey, row));
    },

    async applyObservations(write: ObservationWrite) {
      const basis = seriesBasisSchema.parse(write.basis);

      await database.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(schema.macroSeries)
          .where(eq(schema.macroSeries.seriesKey, write.seriesKey))
          .for("update");
        const series = rows[0];

        if (series === undefined) {
          throw new Error(`${write.seriesKey} is not a recorded series`);
        }

        await lockSource(tx, series.sourceId);

        if (series.basisFrequency === null) {
          await tx
            .update(schema.macroSeries)
            .set({
              basisFrequency: basis.frequency,
              basisUnit: basis.unit,
              basisCurrency: basis.currencyCode,
            })
            .where(eq(schema.macroSeries.seriesId, series.seriesId));
        } else if (
          !sameBasis(
            seriesBasisSchema.parse({
              frequency: series.basisFrequency,
              unit: series.basisUnit,
              currencyCode: series.basisCurrency,
            }),
            basis,
          )
        ) {
          throw new Error(`${write.seriesKey} was pinned to another basis`);
        }

        const superseding = write.revisions.filter(
          (revision) => revision.revision > 0,
        );

        for (const batch of chunks(superseding, INSERT_CHUNK)) {
          // Texto con cast: un `Date` dentro de `sql` crudo no se serializa.
          const at = new Date(batch[0]!.availableAt).toISOString();
          const pairs = sql.join(
            batch.map(
              (revision) =>
                sql`(${revision.periodOn}::date, ${revision.revision - 1}::smallint)`,
            ),
            sql`, `,
          );
          const updated = await tx.execute(sql`
            update macro_series_observations as o
            set superseded_at = ${at}::timestamptz
            from (values ${pairs}) as v(period_on, revision)
            where o.series_id = ${series.seriesId}
              and o.period_on = v.period_on
              and o.revision = v.revision
              and o.superseded_at is null
            returning o.period_on
          `);

          if (updated.length !== batch.length) {
            throw new Error(
              `the open revisions of ${write.seriesKey} are not the ones the plan saw`,
            );
          }
        }

        for (const batch of chunks(write.revisions, INSERT_CHUNK)) {
          await tx.insert(schema.macroSeriesObservations).values(
            batch.map((revision) => ({
              seriesId: series.seriesId,
              periodOn: revision.periodOn,
              revision: revision.revision,
              value: revision.value,
              withdrawn: revision.withdrawn,
              availableAt: new Date(revision.availableAt),
              supersededAt: null,
              ingestionRunId: revision.ingestionRunId,
            })),
          );
        }
      });
    },
  };
}
