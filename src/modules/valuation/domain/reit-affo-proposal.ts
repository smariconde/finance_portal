import { z } from "zod";
import { createHash } from "node:crypto";

import { engineDecimalSchema } from "./decimal-policy";
import { reitAffoOutputSchema } from "./reit-affo-task";

export const reitAffoProposalSchema = z
  .strictObject({
    proposalId: z.uuid(),
    legalEntityId: z.uuid(),
    cik: z.string().regex(/^[0-9]{10}$/u),
    accessionNumber: z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
    fiscalYearEnd: z.iso.date(),
    taskVersion: z.string().min(1).max(64),
    promptVersion: z.string().min(1).max(64),
    policyVersion: z.string().min(1).max(64),
    extractVersion: z.string().min(1).max(64),
    /** Same-filing GAAP anchor used by the policy, frozen for replay. */
    expectedCommonIncome: engineDecimalSchema,
    commonIncomeObservationId: z.uuid(),
    commonIncomeSourceDocumentId: z
      .string()
      .regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
    outcome: z.enum(["accepted", "abstained", "stopped"]),
    transcription: reitAffoOutputSchema.nullable(),
    reason: z.string().min(1).max(96).nullable(),
    acceptedRung: z.number().int().min(1).max(16).nullable(),
    respondedModel: z.string().min(1).max(128).nullable(),
    proposedAt: z.iso.datetime({ offset: true }),
    recordedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((proposal, context) => {
    const accepted = proposal.outcome === "accepted";
    if (
      accepted !==
      (proposal.transcription?.decision === "proposed" &&
        proposal.reason === null &&
        proposal.acceptedRung !== null &&
        proposal.respondedModel !== null)
    )
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "An accepted proposal has a verified transcription and model.",
      });
    if (
      !accepted &&
      (proposal.transcription !== null ||
        proposal.reason === null ||
        proposal.acceptedRung !== null ||
        proposal.respondedModel !== null)
    )
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A refusal keeps its reason and no transcription.",
      });
    if (Date.parse(proposal.recordedAt) < Date.parse(proposal.proposedAt))
      context.addIssue({
        code: "custom",
        path: ["recordedAt"],
        message: "Recording cannot precede proposal.",
      });
  });

export type ReitAffoProposal = z.infer<typeof reitAffoProposalSchema>;

export const reitAffoEvidenceRecordSchema = z.strictObject({
  sourceId: z.literal("sec-edgar"),
  documentUrl: z.url(),
  accessionNumber: z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
  documentAcceptedAt: z.iso.datetime({ offset: true }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  byteLength: z.number().int().positive().max(14_000),
  truncated: z.boolean(),
  excerpt: z.string().min(1),
});

export type ReitAffoEvidenceRecord = z.infer<
  typeof reitAffoEvidenceRecordSchema
>;

export function assertReitAffoEvidence(
  proposal: ReitAffoProposal,
  evidence: ReitAffoEvidenceRecord,
): void {
  if (proposal.accessionNumber !== evidence.accessionNumber)
    throw new Error("REIT AFFO proposal and extract must name the same 10-K.");
  if (proposal.commonIncomeSourceDocumentId !== proposal.accessionNumber)
    throw new Error(
      "The common-income XBRL anchor must come from the same 10-K.",
    );
  if (Date.parse(evidence.documentAcceptedAt) > Date.parse(proposal.proposedAt))
    throw new Error("The 10-K must be available before the model proposal.");
  if (
    new TextEncoder().encode(evidence.excerpt).byteLength !==
    evidence.byteLength
  )
    throw new Error("REIT AFFO extract byte length differs from its evidence.");
  if (
    createHash("sha256").update(evidence.excerpt).digest("hex") !==
    evidence.sha256
  )
    throw new Error("REIT AFFO extract hash differs from its evidence.");
}
