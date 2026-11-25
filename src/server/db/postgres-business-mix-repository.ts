import "server-only";

import { and, asc, desc, eq, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  assertStoredBusinessMix,
  type BusinessMixRepository,
  type StoredBusinessMix,
} from "@/modules/valuation/application/business-mix-repository";
import {
  businessMixEvidenceRecordSchema,
  businessMixLineRecordSchema,
  businessMixProposalSchema,
} from "@/modules/valuation/domain/business-mix";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type ProposalRow = typeof schema.businessMixProposals.$inferSelect;

/** Repositorio personal de mezclas de negocios (`F6-48`, ADR 0086). */
export function createPostgresBusinessMixRepository(
  database: Database,
): BusinessMixRepository {
  async function hydrate(row: ProposalRow): Promise<StoredBusinessMix> {
    const [lines, evidence] = await Promise.all([
      database
        .select()
        .from(schema.businessMixLines)
        .where(eq(schema.businessMixLines.proposalId, row.proposalId))
        .orderBy(asc(schema.businessMixLines.ordinal)),
      database
        .select()
        .from(schema.businessMixEvidence)
        .where(eq(schema.businessMixEvidence.proposalId, row.proposalId))
        .orderBy(asc(schema.businessMixEvidence.evidenceId)),
    ]);

    return {
      proposal: businessMixProposalSchema.parse({
        ...row,
        proposedAt: row.proposedAt.toISOString(),
        recordedAt: row.recordedAt.toISOString(),
      }),
      lines: lines.map((line) =>
        businessMixLineRecordSchema.parse({
          ordinal: line.ordinal,
          lineId: line.lineId,
          axis: line.axis,
          member: line.member,
          concept: line.concept,
          amount: line.amount,
          industryKey: line.industryKey,
          quote: line.quote,
          evidenceId: line.evidenceId,
        }),
      ),
      evidence: evidence.map((item) =>
        businessMixEvidenceRecordSchema.parse({
          evidenceId: item.evidenceId,
          sourceId: item.sourceId,
          section: item.section,
          documentUrl: item.documentUrl,
          accessionNumber: item.accessionNumber,
          documentAcceptedAt: item.documentAcceptedAt.toISOString(),
          sha256: item.sha256,
          byteLength: item.byteLength,
          truncated: item.truncated,
          excerpt: item.excerpt,
        }),
      ),
    };
  }

  return {
    storage: "personal-postgres",
    async record(stored) {
      const proposal = businessMixProposalSchema.parse(stored.proposal);
      const lines = stored.lines.map((line) =>
        businessMixLineRecordSchema.parse(line),
      );
      const evidence = stored.evidence.map((item) =>
        businessMixEvidenceRecordSchema.parse(item),
      );

      assertStoredBusinessMix({ proposal, lines, evidence });

      await database.transaction(async (tx) => {
        await tx.insert(schema.businessMixProposals).values({
          ...proposal,
          proposedAt: new Date(proposal.proposedAt),
          recordedAt: new Date(proposal.recordedAt),
        });

        if (evidence.length > 0) {
          await tx.insert(schema.businessMixEvidence).values(
            evidence.map((item) => ({
              ...item,
              proposalId: proposal.proposalId,
              documentAcceptedAt: new Date(item.documentAcceptedAt),
            })),
          );
        }

        if (lines.length > 0) {
          await tx.insert(schema.businessMixLines).values(
            lines.map((line) => ({
              ...line,
              proposalId: proposal.proposalId,
            })),
          );
        }
      });
    },
    async latestForSubject(legalEntityId) {
      const [row] = await database
        .select()
        .from(schema.businessMixProposals)
        .where(eq(schema.businessMixProposals.legalEntityId, legalEntityId))
        .orderBy(desc(schema.businessMixProposals.proposedAt))
        .limit(1);

      return row === undefined ? null : hydrate(row);
    },
    async acceptedAsKnown(legalEntityId, knownAt) {
      const [row] = await database
        .select()
        .from(schema.businessMixProposals)
        .where(
          and(
            eq(schema.businessMixProposals.legalEntityId, legalEntityId),
            eq(schema.businessMixProposals.outcome, "accepted"),
            lte(schema.businessMixProposals.proposedAt, new Date(knownAt)),
          ),
        )
        .orderBy(desc(schema.businessMixProposals.proposedAt))
        .limit(1);

      return row === undefined ? null : hydrate(row);
    },
  };
}
