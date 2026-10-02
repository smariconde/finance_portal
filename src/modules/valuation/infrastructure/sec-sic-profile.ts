import { z } from "zod";

import { parseSecSubmissions } from "@/modules/fundamentals/domain/parse-sec-submissions";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { utcTimestampSchema } from "@/modules/temporal/domain/temporal-version";

import {
  profileEvidenceSchema,
  type ProfileEvidence,
} from "../domain/method-selection";

/**
 * Mapeo conservador de subtipos explícitos de la lista SIC de la SEC.
 * https://www.sec.gov/search-filings/standard-industrial-classification-sic-code-list
 *
 * El número de SIC es una categoría publicada, no un umbral financiero.
 * Un código ausente de estas listas no afirma que el perfil sea falso.
 */
export const SEC_SIC_PROFILE_RULE_VERSION = "sec-sic-profile-1.0.0";

const BANK_SIC = new Set(["6021", "6022", "6029", "6035", "6036"]);
const INSURER_SIC = new Set(["6311", "6321", "6331", "6351", "6361", "6399"]);
const REIT_SIC = "6798";

const requestSchema = z.object({
  legalEntityId: z.uuid(),
  expectedCik: z.string().regex(/^[0-9]{10}$/u),
  fetchedAt: utcTimestampSchema,
  recordedAt: utcTimestampSchema,
});

const sicEnvelopeSchema = z.object({
  sic: z.string().regex(/^[0-9]{4}$/u),
});

export type SecSicProfileResult =
  | {
      status: "mapped";
      ruleVersion: typeof SEC_SIC_PROFILE_RULE_VERSION;
      sic: string;
      evidence: ProfileEvidence;
    }
  | {
      status: "unmapped";
      ruleVersion: typeof SEC_SIC_PROFILE_RULE_VERSION;
      sic: string;
      evidence: null;
    }
  | {
      status: "rejected";
      ruleVersion: typeof SEC_SIC_PROFILE_RULE_VERSION;
      reason:
        | "submissions_invalid"
        | "cik_mismatch"
        | "sic_invalid"
        | "recorded_before_fetch";
      evidence: null;
    };

export function constituteSecSicProfile(
  rawPayload: unknown,
  request: z.input<typeof requestSchema>,
): SecSicProfileResult {
  const input = requestSchema.parse(request);

  if (input.recordedAt < input.fetchedAt) {
    return {
      status: "rejected",
      ruleVersion: SEC_SIC_PROFILE_RULE_VERSION,
      reason: "recorded_before_fetch",
      evidence: null,
    };
  }

  const submissions = parseSecSubmissions(rawPayload);
  if (!submissions.ok) {
    return {
      status: "rejected",
      ruleVersion: SEC_SIC_PROFILE_RULE_VERSION,
      reason: "submissions_invalid",
      evidence: null,
    };
  }

  if (submissions.cik !== input.expectedCik) {
    return {
      status: "rejected",
      ruleVersion: SEC_SIC_PROFILE_RULE_VERSION,
      reason: "cik_mismatch",
      evidence: null,
    };
  }

  const envelope = sicEnvelopeSchema.safeParse(rawPayload);
  if (!envelope.success) {
    return {
      status: "rejected",
      ruleVersion: SEC_SIC_PROFILE_RULE_VERSION,
      reason: "sic_invalid",
      evidence: null,
    };
  }

  const { sic } = envelope.data;
  const profile = BANK_SIC.has(sic)
    ? "bank"
    : INSURER_SIC.has(sic)
      ? "insurer"
      : sic === REIT_SIC
        ? "reit"
        : null;

  if (profile === null) {
    return {
      status: "unmapped",
      ruleVersion: SEC_SIC_PROFILE_RULE_VERSION,
      sic,
      evidence: null,
    };
  }

  return {
    status: "mapped",
    ruleVersion: SEC_SIC_PROFILE_RULE_VERSION,
    sic,
    evidence: profileEvidenceSchema.parse({
      legalEntityId: input.legalEntityId,
      profile,
      present: true,
      // SEC publica el SIC vigente, sin inicio histórico en este JSON. Usar
      // fetchedAt evita atribuir el subtipo a un corte anterior no probado.
      validFrom: input.fetchedAt,
      validTo: null,
      availableAt: input.fetchedAt,
      supersededAt: null,
      recordedAt: input.recordedAt,
      sourceId: "sec-edgar",
      sourceDocumentId: "submissions/CIK" + submissions.cik + ".json",
      contentHash: computeContentHash({
        cik: submissions.cik,
        sic,
        ruleVersion: SEC_SIC_PROFILE_RULE_VERSION,
      }),
    }),
  };
}
