import { z } from "zod";

import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import { TemporalContractError } from "@/modules/temporal/domain/temporal-error";
import {
  isEffectiveAt,
  isKnownAt,
  selectEffectiveVersion,
  type TemporalVersion,
} from "@/modules/temporal/domain/temporal-version";

import {
  normalizeIdentifierValue,
  normalizeSymbol,
  type DepositaryRatio,
  type IdentifierAssignment,
  type IdentityGraph,
  type Listing,
} from "./identity-graph";

/** Versión de la regla: toda resolución queda explicada por una regla citable. */
export const IDENTITY_RESOLUTION_RULE_VERSION = "identity-resolution-1.0.0";

/** Una asignación `candidate` nunca participa de un join financiero. */
const JOINABLE_CONFIDENCES: ReadonlySet<IdentifierAssignment["confidence"]> =
  new Set(["authoritative", "confirmed"]);

export const identityLookupSchema = z
  .object({
    identifierType: z.string().trim().min(2).max(64).optional(),
    identifierValue: z.string().trim().min(1).max(128).optional(),
    /** Acota el identificador al esquema que lo emitió. */
    scope: z.string().trim().min(1).max(256).optional(),
    symbol: z.string().trim().min(1).max(32).optional(),
    mic: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{4}$/u)
      .optional(),
  })
  .superRefine((lookup, context) => {
    const hasIdentifier =
      lookup.identifierType !== undefined &&
      lookup.identifierValue !== undefined;

    if (!hasIdentifier && lookup.symbol === undefined) {
      context.addIssue({
        code: "custom",
        path: ["symbol"],
        message: "A lookup needs either a symbol or an identifier pair.",
      });
    }

    if (
      (lookup.identifierType === undefined) !==
      (lookup.identifierValue === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["identifierValue"],
        message: "identifierType and identifierValue must travel together.",
      });
    }
  });

export type IdentityLookup = z.infer<typeof identityLookupSchema>;

export type IdentityResolution = {
  status: "resolved" | "ambiguous" | "not_found" | "conflict";
  legalEntityId: string | null;
  securityId: string | null;
  listingId: string | null;
  depositaryProgramId: string | null;
  /** Todos los candidatos considerados, también cuando hay una decisión. */
  candidateIds: readonly string[];
  matchedAssignmentIds: readonly string[];
  resolutionRuleVersion: string;
  decidedBy: "rule" | "owner" | null;
  rationale: string;
};

function unresolved(
  status: Exclude<IdentityResolution["status"], "resolved">,
  rationale: string,
  candidateIds: readonly string[] = [],
  matchedAssignmentIds: readonly string[] = [],
): IdentityResolution {
  return {
    status,
    legalEntityId: null,
    securityId: null,
    listingId: null,
    depositaryProgramId: null,
    candidateIds,
    matchedAssignmentIds,
    resolutionRuleVersion: IDENTITY_RESOLUTION_RULE_VERSION,
    decidedBy: null,
    rationale,
  };
}

function currentVersions<TVersion extends TemporalVersion>(
  versions: readonly TVersion[],
  query: PointInTimeQuery,
): TVersion[] {
  return versions.filter(
    (version) =>
      isEffectiveAt(version, query.effectiveAt) && isKnownAt(version, query),
  );
}

type ResolvedChain = {
  legalEntityId: string | null;
  securityId: string | null;
  listingId: string | null;
};

/**
 * Resolución determinista de identidad
 * (`docs/data/identity-model.md`, "Proceso determinista").
 *
 * No adivina: un símbolo sin MIC que alcanza dos listings devuelve
 * `ambiguous_identity` con sus candidatos, y dos sujetos incompatibles para el
 * mismo identificador autoritativo devuelven `conflict` en vez de elegir uno.
 */
export function resolveIdentity(
  graph: IdentityGraph,
  lookup: IdentityLookup,
  query: PointInTimeQuery,
): IdentityResolution {
  const parsedLookup = identityLookupSchema.parse(lookup);

  const listings = currentVersions(graph.listings, query);
  const listingById = new Map(
    listings.map((listing) => [listing.listingId, listing]),
  );
  const securities = currentVersions(graph.securities, query);
  const securityById = new Map(
    securities.map((security) => [security.securityId, security]),
  );
  const legalEntities = currentVersions(graph.legalEntities, query);
  const legalEntityById = new Map(
    legalEntities.map((entity) => [entity.legalEntityId, entity]),
  );

  const expandFromListing = (listing: Listing): ResolvedChain => {
    const security = securityById.get(listing.securityId) ?? null;
    const legalEntity =
      security === null
        ? null
        : (legalEntityById.get(security.issuerLegalEntityId) ?? null);

    return {
      listingId: listing.listingId,
      securityId: security?.securityId ?? null,
      legalEntityId: legalEntity?.legalEntityId ?? null,
    };
  };

  let symbolChain: ResolvedChain | null = null;
  const candidateIds: string[] = [];

  if (parsedLookup.symbol !== undefined) {
    const normalized = normalizeSymbol(parsedLookup.symbol);
    const matchedListings = currentVersions(graph.listingSymbols, query)
      .filter((assignment) => normalizeSymbol(assignment.symbol) === normalized)
      .map((assignment) => listingById.get(assignment.listingId))
      .filter((listing): listing is Listing => listing !== undefined)
      .filter(
        (listing) =>
          parsedLookup.mic === undefined || listing.mic === parsedLookup.mic,
      );

    const distinctListings = [
      ...new Map(
        matchedListings.map((listing) => [listing.listingId, listing]),
      ).values(),
    ];

    candidateIds.push(...distinctListings.map((listing) => listing.listingId));

    if (distinctListings.length === 0) {
      return unresolved(
        "not_found",
        "No listing carries that symbol at the requested cutoff.",
      );
    }

    if (distinctListings.length > 1) {
      // Un ticker sin MIC es una búsqueda, no una identidad.
      return unresolved(
        "ambiguous",
        "The symbol resolves to more than one listing; a MIC is required.",
        candidateIds,
      );
    }

    symbolChain = expandFromListing(distinctListings[0]!);
  }

  let identifierChain: ResolvedChain | null = null;
  const matchedAssignmentIds: string[] = [];

  if (parsedLookup.identifierType !== undefined) {
    const normalized = normalizeIdentifierValue(
      parsedLookup.identifierType,
      parsedLookup.identifierValue!,
    );
    const matchedAssignments = currentVersions(
      graph.identifierAssignments,
      query,
    ).filter(
      (assignment) =>
        assignment.identifierType === parsedLookup.identifierType &&
        assignment.normalizedValue === normalized &&
        (parsedLookup.scope === undefined ||
          assignment.scope === parsedLookup.scope) &&
        JOINABLE_CONFIDENCES.has(assignment.confidence),
    );

    matchedAssignmentIds.push(
      ...matchedAssignments.map(
        (assignment) => assignment.identifierAssignmentId,
      ),
    );

    const distinctSubjects = [
      ...new Map(
        matchedAssignments.map((assignment) => [
          `${assignment.subjectType}:${assignment.subjectId}`,
          assignment,
        ]),
      ).values(),
    ];

    if (distinctSubjects.length === 0) {
      return unresolved(
        "not_found",
        "No authoritative assignment carries that identifier at the cutoff.",
        candidateIds,
      );
    }

    if (distinctSubjects.length > 1) {
      // Un identificador autoritativo asignado a sujetos incompatibles es un
      // conflicto para revisión manual, no un empate a resolver por promedio.
      return unresolved(
        "conflict",
        "The identifier is assigned to incompatible subjects at the cutoff.",
        distinctSubjects.map((assignment) => assignment.subjectId),
        matchedAssignmentIds,
      );
    }

    const subject = distinctSubjects[0]!;

    if (subject.subjectType === "listing") {
      const listing = listingById.get(subject.subjectId);
      identifierChain =
        listing === undefined
          ? { listingId: null, securityId: null, legalEntityId: null }
          : expandFromListing(listing);
    } else if (subject.subjectType === "security") {
      const security = securityById.get(subject.subjectId) ?? null;
      identifierChain = {
        listingId: null,
        securityId: security?.securityId ?? null,
        legalEntityId: security
          ? (legalEntityById.get(security.issuerLegalEntityId)?.legalEntityId ??
            null)
          : null,
      };
    } else {
      identifierChain = {
        listingId: null,
        securityId: null,
        legalEntityId:
          legalEntityById.get(subject.subjectId)?.legalEntityId ?? null,
      };
    }
  }

  if (
    symbolChain !== null &&
    identifierChain !== null &&
    identifierChain.securityId !== null &&
    symbolChain.securityId !== identifierChain.securityId
  ) {
    // Ticker/MIC y el identificador confirmado no pueden apuntar a securities
    // distintas: el caso va a revisión manual.
    return unresolved(
      "conflict",
      "Symbol and identifier resolve to different securities.",
      [
        ...new Set([
          ...candidateIds,
          symbolChain.securityId ?? "",
          identifierChain.securityId,
        ]),
      ].filter((id) => id !== ""),
      matchedAssignmentIds,
    );
  }

  const chain = symbolChain ?? identifierChain!;

  if (chain.legalEntityId === null && chain.securityId === null) {
    return unresolved(
      "not_found",
      "The subject exists but no identity level is effective at the cutoff.",
      candidateIds,
      matchedAssignmentIds,
    );
  }

  const depositaryProgram =
    chain.securityId === null
      ? null
      : (currentVersions(graph.depositaryPrograms, query).find(
          (program) => program.depositarySecurityId === chain.securityId,
        ) ?? null);

  return {
    status: "resolved",
    legalEntityId: chain.legalEntityId,
    securityId: chain.securityId,
    listingId: chain.listingId,
    depositaryProgramId: depositaryProgram?.depositaryProgramId ?? null,
    candidateIds,
    matchedAssignmentIds,
    resolutionRuleVersion: IDENTITY_RESOLUTION_RULE_VERSION,
    decidedBy: "rule",
    rationale:
      parsedLookup.symbol === undefined
        ? "Resolved from an authoritative identifier assignment effective at the cutoff."
        : "Resolved from the symbol effective at the cutoff for the requested venue.",
  };
}

/**
 * Ratio depositario vigente. Un cambio anunciado antes de su fecha efectiva no
 * altera el ratio anterior: `available_at` explica desde cuándo se sabe y
 * `valid_from` desde cuándo aplica.
 */
export function resolveDepositaryRatio(
  graph: IdentityGraph,
  depositaryProgramId: string,
  query: PointInTimeQuery,
): DepositaryRatio | null {
  return selectEffectiveVersion(
    graph.depositaryRatios.filter(
      (ratio) => ratio.depositaryProgramId === depositaryProgramId,
    ),
    query,
    depositaryProgramId,
  );
}

/** Ayuda de lectura: nunca colapsa la security depositaria con su subyacente. */
export function requireResolvedSubject(
  resolution: IdentityResolution,
  subjectType: "legal_entity" | "security" | "listing",
): string {
  const subjectId =
    subjectType === "legal_entity"
      ? resolution.legalEntityId
      : subjectType === "security"
        ? resolution.securityId
        : resolution.listingId;

  if (resolution.status !== "resolved" || subjectId === null) {
    throw new TemporalContractError(
      "ambiguous_identity",
      `Identity did not resolve to a ${subjectType} at the requested cutoff.`,
      resolution.candidateIds,
    );
  }

  return subjectId;
}
