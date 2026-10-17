import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { subjectClassificationSchema } from "@/modules/classification/domain/subject-classification";
import type {
  IndustryResolutionRepository,
  StoredIndustryResolution,
} from "@/modules/valuation/application/industry-resolution-repository";
import {
  DAMODARAN_INDUSTRY_ASSERTION_TAXONOMY,
  industryEvidenceRecordSchema,
  industryResolutionDocumentId,
  industryResolutionRecordSchema,
  type IndustryEvidenceRecord,
  type IndustryResolutionRecord,
} from "@/modules/valuation/domain/industry-resolution";

import { applyClassificationPlanInTransaction } from "./postgres-classification-repository";
import * as schema from "./schema";
import { toTemporalFields } from "./temporal-row";

type Database = PostgresJsDatabase<typeof schema>;

function toResolution(
  row: typeof schema.industryResolutions.$inferSelect,
): IndustryResolutionRecord {
  return industryResolutionRecordSchema.parse({
    resolutionId: row.resolutionId,
    legalEntityId: row.legalEntityId,
    cik: row.cik,
    sic: row.sic,
    candidates: row.candidates,
    taskVersion: row.taskVersion,
    promptVersion: row.promptVersion,
    ladderVersion: row.ladderVersion,
    sectionsVersion: row.sectionsVersion,
    outcome: row.outcome,
    industryKey: row.industryKey,
    confidence: row.confidence,
    rationale: row.rationale,
    reason: row.reason,
    acceptedRung: row.acceptedRung,
    respondedModel: row.respondedModel,
    citedEvidenceIds: row.citedEvidenceIds,
    resolvedAt: row.resolvedAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
  });
}

function toEvidence(
  row: typeof schema.industryResolutionEvidence.$inferSelect,
): IndustryEvidenceRecord {
  return industryEvidenceRecordSchema.parse({
    evidenceId: row.evidenceId,
    sourceId: row.sourceId,
    section: row.section,
    documentUrl: row.documentUrl,
    accessionNumber: row.accessionNumber,
    documentAcceptedAt: row.documentAcceptedAt.toISOString(),
    sha256: row.sha256,
    byteLength: row.byteLength,
    truncated: row.truncated,
    excerpt: row.excerpt,
  });
}

/** Repositorio personal de resoluciones de industria (`F5-03`, ADR 0033). */
export function createPostgresIndustryResolutionRepository(
  database: Database,
): IndustryResolutionRepository {
  async function withEvidence(
    row: typeof schema.industryResolutions.$inferSelect,
  ): Promise<StoredIndustryResolution> {
    const evidence = await database
      .select()
      .from(schema.industryResolutionEvidence)
      .where(
        eq(schema.industryResolutionEvidence.resolutionId, row.resolutionId),
      )
      .orderBy(asc(schema.industryResolutionEvidence.evidenceId));

    return {
      resolution: toResolution(row),
      evidence: evidence.map(toEvidence),
    };
  }

  return {
    storage: "personal-postgres",
    async record({ resolution, evidence, plan }) {
      const parsed = industryResolutionRecordSchema.parse(resolution);
      const parsedEvidence = evidence.map((item) =>
        industryEvidenceRecordSchema.parse(item),
      );

      if (plan !== null && parsed.outcome !== "resolved") {
        throw new Error("Only a resolved industry is asserted.");
      }

      await database.transaction(async (tx) => {
        await tx.insert(schema.industryResolutions).values({
          resolutionId: parsed.resolutionId,
          legalEntityId: parsed.legalEntityId,
          cik: parsed.cik,
          sic: parsed.sic,
          candidates: [...parsed.candidates],
          taskVersion: parsed.taskVersion,
          promptVersion: parsed.promptVersion,
          ladderVersion: parsed.ladderVersion,
          sectionsVersion: parsed.sectionsVersion,
          outcome: parsed.outcome,
          industryKey: parsed.industryKey,
          confidence: parsed.confidence,
          rationale: parsed.rationale,
          reason: parsed.reason,
          acceptedRung: parsed.acceptedRung,
          respondedModel: parsed.respondedModel,
          citedEvidenceIds: [...parsed.citedEvidenceIds],
          resolvedAt: new Date(parsed.resolvedAt),
          recordedAt: new Date(parsed.recordedAt),
        });

        if (parsedEvidence.length > 0) {
          await tx.insert(schema.industryResolutionEvidence).values(
            parsedEvidence.map((item) => ({
              resolutionId: parsed.resolutionId,
              evidenceId: item.evidenceId,
              sourceId: item.sourceId,
              section: item.section,
              documentUrl: item.documentUrl,
              accessionNumber: item.accessionNumber,
              documentAcceptedAt: new Date(item.documentAcceptedAt),
              sha256: item.sha256,
              byteLength: item.byteLength,
              truncated: item.truncated,
              excerpt: item.excerpt,
            })),
          );
        }

        if (plan !== null) {
          await applyClassificationPlanInTransaction(tx, plan);
        }
      });
    },
    async latestForSubject(legalEntityId) {
      const [row] = await database
        .select()
        .from(schema.industryResolutions)
        .where(eq(schema.industryResolutions.legalEntityId, legalEntityId))
        .orderBy(desc(schema.industryResolutions.resolvedAt))
        .limit(1);

      return row === undefined ? null : withEvidence(row);
    },
    async findResolution(resolutionId) {
      const [row] = await database
        .select()
        .from(schema.industryResolutions)
        .where(eq(schema.industryResolutions.resolutionId, resolutionId))
        .limit(1);

      return row === undefined ? null : withEvidence(row);
    },
    async assertionsForSubject(legalEntityId) {
      const rows = await database
        .select()
        .from(schema.classificationAssignments)
        .where(
          and(
            eq(schema.classificationAssignments.subjectId, legalEntityId),
            eq(
              schema.classificationAssignments.taxonomyId,
              DAMODARAN_INDUSTRY_ASSERTION_TAXONOMY,
            ),
          ),
        )
        .limit(200);

      const documentIds = rows
        .map((row) => row.sourceDocumentId)
        .filter((id): id is string => id !== null);
      const resolutionIds = documentIds.map((id) =>
        id.replace(/^industry-resolution\//u, ""),
      );
      const resolutions =
        resolutionIds.length === 0
          ? []
          : await database
              .select()
              .from(schema.industryResolutions)
              .where(
                inArray(schema.industryResolutions.resolutionId, resolutionIds),
              );

      return rows.flatMap((row) => {
        const resolution = resolutions.find(
          (candidate) =>
            industryResolutionDocumentId(candidate.resolutionId) ===
            row.sourceDocumentId,
        );

        if (resolution === undefined) {
          return [];
        }

        const classification = subjectClassificationSchema.parse({
          classificationAssignmentId: row.classificationAssignmentId,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          taxonomyId: row.taxonomyId,
          taxonomyVersion: row.taxonomyVersion,
          code: row.code,
          label: row.label,
          ...toTemporalFields(row),
        });

        return [
          {
            classification,
            reading: {
              resolutionId: resolution.resolutionId,
              industryKey: classification.code,
              availableAt: classification.availableAt,
              respondedModel: resolution.respondedModel,
              evidenceIds: resolution.citedEvidenceIds,
            },
          },
        ];
      });
    },
  };
}
