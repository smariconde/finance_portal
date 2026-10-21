import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
} from "@/modules/temporal/domain/temporal-version";

const JOINABLE = new Set(["authoritative", "confirmed"]);

/**
 * CIK y país del listing al corte de la corrida. Una asignación que todavía no
 * se podía conocer no cuenta, y una cerrada tampoco.
 */
export function issuerFactsAt(
  graph: IdentityGraph,
  legalEntityId: string,
  listingId: string | null,
  query: PointInTimeQuery,
): { readonly cik: string | null; readonly listingCountry: string | null } {
  const cik =
    graph.identifierAssignments.find(
      (assignment) =>
        assignment.identifierType === "cik" &&
        assignment.subjectType === "legal_entity" &&
        assignment.subjectId === legalEntityId &&
        JOINABLE.has(assignment.confidence) &&
        isEffectiveAt(assignment, query.effectiveAt) &&
        isKnownAt(assignment, query),
    )?.normalizedValue ?? null;
  const listingCountry =
    listingId === null
      ? null
      : (graph.listings.find(
          (listing) =>
            listing.listingId === listingId &&
            isEffectiveAt(listing, query.effectiveAt) &&
            isKnownAt(listing, query),
        )?.country ?? null);

  return { cik, listingCountry };
}
