import "server-only";

import { and, asc, desc, eq, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  assertStoredOperationsMix,
  type OperationsMixRepository,
  type StoredOperationsMix,
} from "@/modules/valuation/application/operations-mix-repository";
import {
  operationsMixEvidenceRecordSchema,
  operationsMixLineRecordSchema,
  operationsMixProposalSchema,
} from "@/modules/valuation/domain/operations-mix";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type ProposalRow = typeof schema.operationsMixProposals.$inferSelect;

/** Repositorio personal de mixes de operaciones (`F5-05`, ADR 0034). */
export function createPostgresOperationsMixRepository(
  database: Database,
): OperationsMixRepository {
  async function hydrate(row: ProposalRow): Promise<StoredOperationsMix> {
    const [lines, evidence] = await Promise.all([
      database
        .select()
        .from(schema.operationsMixLines)
        .where(eq(schema.operationsMixLines.proposalId, row.proposalId))
        .orderBy(asc(schema.operationsMixLines.ordinal)),
      database
        .select()
        .from(schema.operationsMixEvidence)
        .where(eq(schema.operationsMixEvidence.proposalId, row.proposalId))
        .orderBy(asc(schema.operationsMixEvidence.evidenceId)),
    ]);

    return {
      proposal: operationsMixProposalSchema.parse({
        ...row,
        proposedAt: row.proposedAt.toISOString(),
        recordedAt: row.recordedAt.toISOString(),
      }),
      lines: lines.map((line) =>
        operationsMixLineRecordSchema.parse({
          ordinal: line.ordinal,
          label: line.label,
          printedAmount: line.printedAmount,
          amount: line.amount,
          basis: line.basis,
          exposureKeys: line.exposureKeys,
          quote: line.quote,
          evidenceId: line.evidenceId,
          definitionQuote: line.definitionQuote,
        }),
      ),
      evidence: evidence.map((item) =>
        operationsMixEvidenceRecordSchema.parse({
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
      const proposal = operationsMixProposalSchema.parse(stored.proposal);
      const lines = stored.lines.map((line) =>
        operationsMixLineRecordSchema.parse(line),
      );
      const evidence = stored.evidence.map((item) =>
        operationsMixEvidenceRecordSchema.parse(item),
      );

      assertStoredOperationsMix({ proposal, lines, evidence });

      await database.transaction(async (tx) => {
        await tx.insert(schema.operationsMixProposals).values({
          ...proposal,
          proposedAt: new Date(proposal.proposedAt),
          recordedAt: new Date(proposal.recordedAt),
        });

        if (evidence.length > 0) {
          await tx.insert(schema.operationsMixEvidence).values(
            evidence.map((item) => ({
              ...item,
              proposalId: proposal.proposalId,
              documentAcceptedAt: new Date(item.documentAcceptedAt),
            })),
          );
        }

        if (lines.length > 0) {
          await tx.insert(schema.operationsMixLines).values(
            lines.map((line) => ({
              ...line,
              proposalId: proposal.proposalId,
              exposureKeys: [...line.exposureKeys],
            })),
          );
        }
      });
    },
    async latestForSubject(legalEntityId) {
      const [row] = await database
        .select()
        .from(schema.operationsMixProposals)
        .where(eq(schema.operationsMixProposals.legalEntityId, legalEntityId))
        .orderBy(desc(schema.operationsMixProposals.proposedAt))
        .limit(1);

      return row === undefined ? null : hydrate(row);
    },
    async acceptedAsKnown(legalEntityId, knownAt) {
      const [row] = await database
        .select()
        .from(schema.operationsMixProposals)
        .where(
          and(
            eq(schema.operationsMixProposals.legalEntityId, legalEntityId),
            eq(schema.operationsMixProposals.outcome, "accepted"),
            lte(schema.operationsMixProposals.proposedAt, new Date(knownAt)),
          ),
        )
        .orderBy(desc(schema.operationsMixProposals.proposedAt))
        .limit(1);

      return row === undefined ? null : hydrate(row);
    },
  };
}
