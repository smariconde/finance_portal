import "server-only";

import { and, desc, eq, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  assertStoredEmployeeEquity,
  type EmployeeEquityRepository,
  type StoredEmployeeEquity,
} from "@/modules/valuation/application/employee-equity-repository";
import {
  employeeEquityEvidenceRecordSchema,
  employeeEquityProposalSchema,
} from "@/modules/valuation/domain/employee-equity";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type ProposalRow = typeof schema.employeeEquityProposals.$inferSelect;

/** Repositorio personal de transcripciones de opciones y unidades (`F4-05`). */
export function createPostgresEmployeeEquityRepository(
  database: Database,
): EmployeeEquityRepository {
  async function hydrate(row: ProposalRow): Promise<StoredEmployeeEquity> {
    const [evidence] = await database
      .select()
      .from(schema.employeeEquityEvidence)
      .where(eq(schema.employeeEquityEvidence.proposalId, row.proposalId));

    if (evidence === undefined) {
      throw new Error(`proposal ${row.proposalId} has no recorded evidence`);
    }

    return {
      proposal: employeeEquityProposalSchema.parse({
        ...row,
        proposedAt: row.proposedAt.toISOString(),
        recordedAt: row.recordedAt.toISOString(),
      }),
      evidence: employeeEquityEvidenceRecordSchema.parse({
        sourceId: evidence.sourceId,
        documentUrl: evidence.documentUrl,
        accessionNumber: evidence.accessionNumber,
        documentAcceptedAt: evidence.documentAcceptedAt.toISOString(),
        sha256: evidence.sha256,
        byteLength: evidence.byteLength,
        truncated: evidence.truncated,
        excerpt: evidence.excerpt,
      }),
    };
  }

  return {
    storage: "personal-postgres",
    async record(stored) {
      const proposal = employeeEquityProposalSchema.parse(stored.proposal);
      const evidence = employeeEquityEvidenceRecordSchema.parse(
        stored.evidence,
      );

      assertStoredEmployeeEquity({ proposal, evidence });

      await database.transaction(async (tx) => {
        await tx.insert(schema.employeeEquityProposals).values({
          ...proposal,
          transcription: proposal.transcription,
          proposedAt: new Date(proposal.proposedAt),
          recordedAt: new Date(proposal.recordedAt),
        });
        await tx.insert(schema.employeeEquityEvidence).values({
          ...evidence,
          proposalId: proposal.proposalId,
          documentAcceptedAt: new Date(evidence.documentAcceptedAt),
        });
      });
    },
    async latestForSubject(legalEntityId) {
      const [row] = await database
        .select()
        .from(schema.employeeEquityProposals)
        .where(eq(schema.employeeEquityProposals.legalEntityId, legalEntityId))
        .orderBy(desc(schema.employeeEquityProposals.proposedAt))
        .limit(1);

      return row === undefined ? null : hydrate(row);
    },
    async acceptedAsKnown(legalEntityId, knownAt) {
      const [row] = await database
        .select()
        .from(schema.employeeEquityProposals)
        .where(
          and(
            eq(schema.employeeEquityProposals.legalEntityId, legalEntityId),
            eq(schema.employeeEquityProposals.outcome, "accepted"),
            lte(schema.employeeEquityProposals.proposedAt, new Date(knownAt)),
          ),
        )
        .orderBy(desc(schema.employeeEquityProposals.proposedAt))
        .limit(1);

      return row === undefined ? null : hydrate(row);
    },
  };
}
