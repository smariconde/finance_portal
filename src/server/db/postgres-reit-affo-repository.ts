import "server-only";

import { and, desc, eq, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  parseStoredReitAffo,
  type ReitAffoRepository,
  type StoredReitAffo,
} from "@/modules/valuation/application/reit-affo-repository";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type ProposalRow = typeof schema.reitAffoProposals.$inferSelect;

export function createPostgresReitAffoRepository(
  database: Database,
): ReitAffoRepository {
  async function hydrate(row: ProposalRow): Promise<StoredReitAffo> {
    const [evidence] = await database
      .select()
      .from(schema.reitAffoEvidence)
      .where(eq(schema.reitAffoEvidence.proposalId, row.proposalId));
    if (evidence === undefined)
      throw new Error(`REIT AFFO proposal ${row.proposalId} has no evidence`);
    return parseStoredReitAffo({
      proposal: {
        ...row,
        outcome: row.outcome as StoredReitAffo["proposal"]["outcome"],
        transcription:
          row.transcription as StoredReitAffo["proposal"]["transcription"],
        proposedAt: row.proposedAt.toISOString(),
        recordedAt: row.recordedAt.toISOString(),
      },
      evidence: {
        sourceId: evidence.sourceId as "sec-edgar",
        documentUrl: evidence.documentUrl,
        accessionNumber: evidence.accessionNumber,
        documentAcceptedAt: evidence.documentAcceptedAt.toISOString(),
        sha256: evidence.sha256,
        byteLength: evidence.byteLength,
        truncated: evidence.truncated,
        excerpt: evidence.excerpt,
      },
    });
  }

  return {
    storage: "personal-postgres",
    async record(stored) {
      const { proposal, evidence } = parseStoredReitAffo(stored);
      await database.transaction(async (tx) => {
        await tx.insert(schema.reitAffoProposals).values({
          ...proposal,
          transcription: proposal.transcription,
          proposedAt: new Date(proposal.proposedAt),
          recordedAt: new Date(proposal.recordedAt),
        });
        await tx.insert(schema.reitAffoEvidence).values({
          ...evidence,
          proposalId: proposal.proposalId,
          documentAcceptedAt: new Date(evidence.documentAcceptedAt),
        });
      });
    },
    async latestForSubject(legalEntityId) {
      const [row] = await database
        .select()
        .from(schema.reitAffoProposals)
        .where(eq(schema.reitAffoProposals.legalEntityId, legalEntityId))
        .orderBy(desc(schema.reitAffoProposals.recordedAt))
        .limit(1);
      return row === undefined ? null : hydrate(row);
    },
    async latestAsKnown(legalEntityId, knownAt) {
      const [row] = await database
        .select()
        .from(schema.reitAffoProposals)
        .where(
          and(
            eq(schema.reitAffoProposals.legalEntityId, legalEntityId),
            lte(schema.reitAffoProposals.recordedAt, new Date(knownAt)),
          ),
        )
        .orderBy(desc(schema.reitAffoProposals.recordedAt))
        .limit(1);
      if (row === undefined) return null;
      const stored = await hydrate(row);
      return stored.evidence.documentAcceptedAt <= knownAt ? stored : null;
    },
    async acceptedAsKnown(legalEntityId, knownAt) {
      const [row] = await database
        .select()
        .from(schema.reitAffoProposals)
        .where(
          and(
            eq(schema.reitAffoProposals.legalEntityId, legalEntityId),
            eq(schema.reitAffoProposals.outcome, "accepted"),
            lte(schema.reitAffoProposals.recordedAt, new Date(knownAt)),
            lte(schema.reitAffoProposals.proposedAt, new Date(knownAt)),
          ),
        )
        .orderBy(desc(schema.reitAffoProposals.recordedAt))
        .limit(1);
      if (row === undefined) return null;
      const stored = await hydrate(row);
      return stored.evidence.documentAcceptedAt <= knownAt ? stored : null;
    },
  };
}
