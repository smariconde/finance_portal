import { z } from "zod";

import {
  calendarDateSchema,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";
import type { ListingSymbol } from "@/modules/identity/domain/identity-graph";
import type {
  CorporateAction,
  LegalEntityRelationship,
} from "./reporting-succession";
import type { SecListingFiling } from "./parse-sec-listing-index";

export const DECLARED_EVENT_RULE_VERSION = "declared-event-1.0.0";
const cik = z
  .string()
  .regex(/^[0-9]{1,10}$/u)
  .refine((value) => Number(value) > 0)
  .transform((value) => value.padStart(10, "0"));
const accession = z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u);
const symbol = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Z0-9][A-Z0-9.-]*$/u);
const decision = {
  effectiveOn: calendarDateSchema,
  decidedAt: utcTimestampSchema,
  decidedBy: z.literal("owner"),
  rationale: z.string().trim().min(1).max(256),
};

export const declaredEventSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("acquisition"),
        acquiredCik: cik,
        acquirerCik: cik,
        acquiredClosingAccession: accession,
        acquirerClosingAccession: accession,
        sharedCommunicationAccession: accession,
        ...decision,
      })
      .strict(),
    z
      .object({
        kind: z.literal("symbol_change"),
        cik,
        mic: z.string().regex(/^[A-Z0-9]{4}$/u),
        fromSymbol: symbol,
        toSymbol: symbol,
        ...decision,
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (
      value.kind === "acquisition"
        ? value.acquiredCik === value.acquirerCik
        : value.fromSymbol === value.toSymbol
    ) {
      context.addIssue({
        code: "custom",
        message: "A change requires distinct parties or symbols.",
      });
    }
  });
export type DeclaredEvent = z.infer<typeof declaredEventSchema>;
export type DeclaredEventInput = z.input<typeof declaredEventSchema>;
export type DeclaredAcquisition = Extract<
  DeclaredEvent,
  { kind: "acquisition" }
>;
export type DeclaredSymbolChange = Extract<
  DeclaredEvent,
  { kind: "symbol_change" }
>;

export type DeclaredEventRejection =
  | "entity_not_in_graph"
  | "ambiguous_entity"
  | "same_entity"
  | "future_declaration"
  | "future_effective_date"
  | "subject_mismatch"
  | "closing_filing_missing"
  | "closing_filing_invalid"
  | "shared_communication_missing"
  | "shared_communication_invalid"
  | "future_evidence"
  | "conflicting_event"
  | "acquired_has_other_acquirer"
  | "acquisition_cycle"
  | "listing_not_in_graph"
  | "ambiguous_listing"
  | "old_symbol_mismatch"
  | "new_symbol_not_assigned"
  | "old_symbol_still_assigned"
  | "symbol_collision"
  | "stale_effective_date";

export type DeclaredEventPlan = {
  readonly ruleVersion: string;
  readonly status: "planned" | "unchanged" | "rejected";
  readonly rejection: DeclaredEventRejection | null;
  readonly subjectId: string | null;
  readonly corporateActions: readonly CorporateAction[];
  readonly relationships: readonly LegalEntityRelationship[];
  readonly supersessions: readonly {
    readonly listingSymbolId: string;
    readonly validFrom: string;
    readonly supersededAt: string;
  }[];
  readonly listingSymbols: readonly ListingSymbol[];
  readonly filings: readonly {
    readonly subjectId: string;
    readonly filing: SecListingFiling;
  }[];
};
