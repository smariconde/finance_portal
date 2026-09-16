import {
  listingSymbolSchema,
  normalizeSymbol,
  type IdentityGraph,
} from "@/modules/identity/domain/identity-graph";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { normalizeCik } from "@/modules/fundamentals/domain/parse-sec-submissions";
import type { CompanyTickerAssignment } from "@/modules/universe/domain/universe-source-records";
import { resolveVenue } from "@/modules/universe/domain/venue-map";
import type { SecListingIndex } from "./parse-sec-listing-index";
import {
  DECLARED_EVENT_RULE_VERSION,
  declaredEventSchema,
  type DeclaredEvent,
  type DeclaredEventPlan,
  type DeclaredEventRejection,
} from "./declared-event";
import {
  computeCorporateActionContentHash,
  corporateActionSchema,
  legalEntityRelationshipSchema,
  startOfNewYorkDay,
  type CorporateAction,
  type LegalEntityRelationship,
} from "./reporting-succession";

export type DeclaredEventEvidence =
  | {
      readonly kind: "acquisition";
      readonly acquired: SecListingIndex;
      readonly acquirer: SecListingIndex;
      readonly fetchedAt: string;
    }
  | {
      readonly kind: "symbol_change";
      readonly assignments: readonly CompanyTickerAssignment[];
      readonly fetchedAt: string;
    };

const open = (v: { validTo: string | null; supersededAt: string | null }) =>
  v.validTo === null && v.supersededAt === null;

/** Current identity is resolved at ingestion, never at a historical filing date. */
export function declaredEntityIds(graph: IdentityGraph, cik: string): string[] {
  return [
    ...new Set(
      graph.identifierAssignments
        .filter(
          (a) =>
            open(a) &&
            a.subjectType === "legal_entity" &&
            a.identifierType === "cik" &&
            a.confidence === "authoritative" &&
            a.normalizedValue === cik,
        )
        .map((a) => a.subjectId),
    ),
  ];
}

export function planDeclaredEvent(input: {
  readonly declaration: DeclaredEvent;
  readonly evidence: DeclaredEventEvidence;
  readonly graph: IdentityGraph;
  readonly corporateActions: readonly CorporateAction[];
  readonly relationships: readonly LegalEntityRelationship[];
  readonly recordedAt: string;
  /** Previous successful verification, only for recovery of the same evidence. */
  readonly firstVerifiedAt?: string;
  readonly newId: () => string;
}): DeclaredEventPlan {
  const declaration = declaredEventSchema.parse(input.declaration);
  const { evidence, graph, recordedAt, newId } = input;
  const empty: DeclaredEventPlan = {
    ruleVersion: DECLARED_EVENT_RULE_VERSION,
    status: "rejected",
    rejection: null,
    subjectId: null,
    corporateActions: [],
    relationships: [],
    supersessions: [],
    listingSymbols: [],
    filings: [],
  };
  const reject = (rejection: DeclaredEventRejection): DeclaredEventPlan => ({
    ...empty,
    rejection,
  });
  if (Date.parse(declaration.decidedAt) > Date.parse(recordedAt))
    return reject("future_declaration");
  const effectiveAt = startOfNewYorkDay(declaration.effectiveOn);
  if (Date.parse(effectiveAt) > Date.parse(recordedAt))
    return reject("future_effective_date");
  if (declaration.kind !== evidence.kind) return reject("subject_mismatch");
  if (Date.parse(evidence.fetchedAt) > Date.parse(recordedAt))
    return reject("future_evidence");

  const ciks =
    declaration.kind === "acquisition"
      ? [declaration.acquiredCik, declaration.acquirerCik]
      : [declaration.cik];
  const entities = ciks.map((cik) => declaredEntityIds(graph, cik));
  if (entities.some((ids) => ids.length === 0))
    return reject("entity_not_in_graph");
  if (entities.some((ids) => ids.length !== 1))
    return reject("ambiguous_entity");
  const subjectId = entities[0]![0]!;
  const declarationHash = computeContentHash(declaration);
  // Identity of a declaration is stable across downloads; its first knowledge
  // timestamp survives replay, even when today's table has moved on again.
  const previous = input.corporateActions.find(
    (a) =>
      a.actionType === declaration.kind &&
      a.terms.declarationHash === declarationHash,
  );
  if (previous)
    return { ...empty, status: "unchanged", subjectId: previous.subjectId };
  const decision = {
    declarationHash,
    decidedBy: declaration.decidedBy,
    decidedAt: declaration.decidedAt,
    rationale: declaration.rationale,
    ruleVersion: DECLARED_EVENT_RULE_VERSION,
  };
  const action = (
    base: Omit<
      CorporateAction,
      "corporateActionId" | "contentHash" | "recordedAt"
    >,
  ) =>
    corporateActionSchema.parse({
      ...base,
      corporateActionId: newId(),
      contentHash: computeCorporateActionContentHash(base),
      recordedAt,
    });

  if (declaration.kind === "acquisition" && evidence.kind === "acquisition") {
    const acquirerId = entities[1]![0]!;
    if (subjectId === acquirerId) return reject("same_entity");
    if (
      evidence.acquired.cik !== declaration.acquiredCik ||
      evidence.acquirer.cik !== declaration.acquirerCik
    )
      return reject("subject_mismatch");
    const targets = evidence.acquired.filings.filter(
      (f) => f.accessionNumber === declaration.acquiredClosingAccession,
    );
    const buyers = evidence.acquirer.filings.filter(
      (f) => f.accessionNumber === declaration.acquirerClosingAccession,
    );
    if (targets.length !== 1 || buyers.length !== 1)
      return reject("closing_filing_missing");
    const target = targets[0]!;
    const buyer = buyers[0]!;
    if (
      [target, buyer].some(
        (f) =>
          f.form !== "8-K" ||
          !f.items?.includes("2.01") ||
          f.reportDate !== declaration.effectiveOn ||
          f.acceptedAt === null ||
          Date.parse(f.acceptedAt) < Date.parse(effectiveAt),
      ) ||
      !target.items?.includes("5.01") ||
      target.accessionNumber === buyer.accessionNumber
    )
      return reject("closing_filing_invalid");
    const sharedA = evidence.acquired.filings.filter(
      (f) => f.accessionNumber === declaration.sharedCommunicationAccession,
    );
    const sharedB = evidence.acquirer.filings.filter(
      (f) => f.accessionNumber === declaration.sharedCommunicationAccession,
    );
    if (sharedA.length !== 1 || sharedB.length !== 1)
      return reject("shared_communication_missing");
    const shared = sharedA[0]!;
    if (
      shared.form !== "425" ||
      shared.acceptedAt === null ||
      computeContentHash(shared) !== computeContentHash(sharedB[0]) ||
      Date.parse(shared.acceptedAt) >
        Math.min(Date.parse(target.acceptedAt!), Date.parse(buyer.acceptedAt!))
    )
      return reject("shared_communication_invalid");
    const availableAt = new Date(
      Math.max(
        ...[target, buyer, shared].map((f) => Date.parse(f.acceptedAt!)),
      ),
    ).toISOString();
    if (Date.parse(availableAt) > Date.parse(evidence.fetchedAt))
      return reject("future_evidence");
    if (
      input.corporateActions.some(
        (a) =>
          a.actionType === "acquisition" &&
          a.sourceDocumentId === target.accessionNumber,
      )
    )
      return reject("conflicting_event");
    const relationships = input.relationships.filter(
      (r) => r.relationshipType === "acquired_by" && open(r),
    );
    if (relationships.some((r) => r.predecessorLegalEntityId === subjectId))
      return reject("acquired_has_other_acquirer");
    const visited = new Set<string>([subjectId]);
    let next: string | undefined = acquirerId;
    while (next !== undefined) {
      if (visited.has(next)) return reject("acquisition_cycle");
      visited.add(next);
      next = relationships.find(
        (r) => r.predecessorLegalEntityId === next,
      )?.successorLegalEntityId;
    }
    const event = action({
      actionType: "acquisition",
      subjectType: "legal_entity",
      subjectId,
      announcedAt: shared.acceptedAt,
      effectiveOn: declaration.effectiveOn,
      availableAt,
      sourceId: "sec-edgar",
      sourceDocumentId: target.accessionNumber,
      terms: {
        ...decision,
        acquiredCik: declaration.acquiredCik,
        acquirerCik: declaration.acquirerCik,
        acquirerLegalEntityId: acquirerId,
        acquirerClosingAccession: buyer.accessionNumber,
        sharedCommunicationAccession: shared.accessionNumber,
      },
    });
    const relationship = {
      relationshipType: "acquired_by",
      predecessorLegalEntityId: subjectId,
      successorLegalEntityId: acquirerId,
      effectiveOn: declaration.effectiveOn,
      validFrom: effectiveAt,
      validTo: null,
      availableAt,
      supersededAt: null,
      sourceId: "sec-edgar",
      sourceDocumentId: target.accessionNumber,
      decidedBy: declaration.decidedBy,
      decisionRuleVersion: DECLARED_EVENT_RULE_VERSION,
    };
    return {
      ...empty,
      status: "planned",
      subjectId,
      corporateActions: [event],
      relationships: [
        legalEntityRelationshipSchema.parse({
          ...relationship,
          relationshipId: newId(),
          corporateActionId: event.corporateActionId,
          contentHash: computeContentHash(relationship),
          recordedAt,
        }),
      ],
      filings: [
        { subjectId, filing: target },
        { subjectId: acquirerId, filing: buyer },
        { subjectId, filing: shared },
      ],
    };
  }

  if (declaration.kind !== "symbol_change" || evidence.kind !== "symbol_change")
    return reject("subject_mismatch");
  const securities = new Set(
    graph.securities
      .filter(
        (s) =>
          open(s) &&
          s.issuerLegalEntityId === subjectId &&
          s.status === "active",
      )
      .map((s) => s.securityId),
  );
  const listings = graph.listings.filter(
    (l) =>
      open(l) &&
      l.status === "active" &&
      l.mic === declaration.mic &&
      securities.has(l.securityId),
  );
  if (listings.length === 0) return reject("listing_not_in_graph");
  if (listings.length !== 1) return reject("ambiguous_listing");
  const listing = listings[0]!;
  const symbols = graph.listingSymbols.filter(
    (s) =>
      open(s) && s.listingId === listing.listingId && s.symbolType === "ticker",
  );
  if (
    symbols.length !== 1 ||
    normalizeSymbol(symbols[0]!.symbol) !== declaration.fromSymbol
  )
    return reject("old_symbol_mismatch");
  const old = symbols[0]!;
  if (
    Date.parse(effectiveAt) <= Date.parse(old.validFrom) ||
    Date.parse(effectiveAt) < Date.parse(listing.validFrom)
  )
    return reject("stale_effective_date");
  const assignments = evidence.assignments.filter(
    (a) =>
      resolveVenue(a.exchange)?.mic === declaration.mic ||
      (resolveVenue(a.exchange) === null &&
        [declaration.fromSymbol, declaration.toSymbol].includes(
          normalizeSymbol(a.ticker),
        )),
  );
  const assigned = assignments.filter(
    (a) => normalizeSymbol(a.ticker) === declaration.toSymbol,
  );
  if (
    assigned.length !== 1 ||
    normalizeCik(assigned[0]!.cik) !== declaration.cik ||
    resolveVenue(assigned[0]!.exchange)?.mic !== declaration.mic
  )
    return reject("new_symbol_not_assigned");
  if (
    assignments.some(
      (a) => normalizeSymbol(a.ticker) === declaration.fromSymbol,
    )
  )
    return reject("old_symbol_still_assigned");
  if (
    assignments.filter((a) => normalizeCik(a.cik) === declaration.cik).length >
    1
  )
    return reject("ambiguous_listing");
  const venues = new Set(
    graph.listings
      .filter((l) => open(l) && l.mic === declaration.mic)
      .map((l) => l.listingId),
  );
  if (
    graph.listingSymbols.some(
      (s) =>
        open(s) &&
        s.symbolType === "ticker" &&
        venues.has(s.listingId) &&
        normalizeSymbol(s.symbol) === declaration.toSymbol,
    )
  )
    return reject("symbol_collision");
  const availableAt = input.firstVerifiedAt ?? recordedAt;
  if (Date.parse(availableAt) <= Date.parse(old.availableAt))
    return reject("stale_effective_date");
  const document = `owner-declaration:${declarationHash}`;
  const event = action({
    actionType: "symbol_change",
    subjectType: "listing",
    subjectId: listing.listingId,
    announcedAt: null,
    effectiveOn: declaration.effectiveOn,
    availableAt,
    sourceId: "sec-edgar",
    sourceDocumentId: document,
    terms: {
      ...decision,
      cik: declaration.cik,
      mic: declaration.mic,
      fromSymbol: declaration.fromSymbol,
      toSymbol: declaration.toSymbol,
      corroboratingDocument: "company_tickers_exchange.json",
    },
  });
  const version = (
    symbol: string,
    validFrom: string,
    validTo: string | null,
  ) => {
    const content = {
      listingId: listing.listingId,
      symbol,
      symbolType: "ticker",
      validFrom,
      validTo,
      availableAt,
      supersededAt: null,
      sourceId: "sec-edgar",
      sourceDocumentId: document,
    };
    return listingSymbolSchema.parse({
      ...content,
      listingSymbolId: newId(),
      contentHash: computeContentHash(content),
      recordedAt,
    });
  };
  return {
    ...empty,
    status: "planned",
    subjectId: listing.listingId,
    corporateActions: [event],
    supersessions: [
      {
        listingSymbolId: old.listingSymbolId,
        validFrom: old.validFrom,
        supersededAt: availableAt,
      },
    ],
    listingSymbols: [
      version(old.symbol, old.validFrom, effectiveAt),
      version(declaration.toSymbol, effectiveAt, null),
    ],
  };
}
