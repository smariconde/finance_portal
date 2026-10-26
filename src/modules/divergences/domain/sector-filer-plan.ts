import type { SectorMember } from "@/modules/classification/domain/resolve-sector-population";
import type { CompanyFactsBackfillSubject } from "@/modules/fundamentals/domain/plan-company-facts-backfill";

/**
 * Reuse the SEC backfill job on just one sector's filers. A predecessor belongs
 * when its successor is in the sector; share classes collapse to one CIK.
 */
export function sectorFilers(
  members: readonly SectorMember[],
  subjects: readonly CompanyFactsBackfillSubject[],
): readonly CompanyFactsBackfillSubject[] {
  const issuers = new Set(members.map((member) => member.issuerLegalEntityId));
  return subjects.filter(
    (subject) =>
      issuers.has(subject.legalEntityId) ||
      (subject.successorLegalEntityId !== null &&
        issuers.has(subject.successorLegalEntityId)),
  );
}
