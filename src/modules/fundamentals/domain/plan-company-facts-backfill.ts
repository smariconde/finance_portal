import { resolveReportingLineage } from "@/modules/corporate-actions/domain/reporting-lineage";
import type { LegalEntityRelationship } from "@/modules/corporate-actions/domain/reporting-succession";
import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import {
  isOpenMembership,
  type IndexMembership,
} from "@/modules/universe/domain/index-membership";

/**
 * Qué filers recorre un backfill de companyfacts (ADR 0015).
 *
 * Los miembros vigentes del índice, por el CIK de su emisor, más los antecesores
 * de reporte de cada uno: la historia de un sucesor vive en el CIK anterior y el
 * linaje la une al leer (ADR 0011), así que un backfill que no la baje deja al
 * sucesor sin historia. Es la misma regla que `fundamentals:ingest --ticker`,
 * aplicada al universo entero.
 *
 * Un emisor con dos clases (Alphabet, Fox, News Corp) entra una sola vez: el CIK
 * es de la entidad legal. El orden es el del CIK, estable entre corridas, y
 * forma parte del plan.
 *
 * Lo que no tiene CIK no se adivina: queda rechazado con nombre.
 */
export const COMPANY_FACTS_BACKFILL_PLAN_VERSION =
  "companyfacts-backfill-plan-1.0.0";

const CIK_SCOPE = "sec:filer";

export type CompanyFactsBackfillSubject = {
  readonly cik: string;
  readonly legalEntityId: string;
  readonly role: "index_member" | "reporting_predecessor";
  /** Tickers vigentes de sus securities en el índice, sólo para mostrar. */
  readonly symbols: readonly string[];
  /** Para un antecesor, el sucesor que lo trajo. */
  readonly successorLegalEntityId: string | null;
};

export type CompanyFactsBackfillRejectionCode =
  | "security_not_in_graph"
  | "issuer_without_cik"
  | "issuer_with_several_ciks"
  | "predecessor_without_cik";

export type CompanyFactsBackfillRejection = {
  readonly code: CompanyFactsBackfillRejectionCode;
  readonly subjectId: string;
};

export type CompanyFactsBackfillPlan = {
  readonly planVersion: string;
  readonly subjects: readonly CompanyFactsBackfillSubject[];
  readonly rejections: readonly CompanyFactsBackfillRejection[];
  readonly members: number;
};

const isOpen = (version: {
  readonly validTo: string | null;
  readonly supersededAt: string | null;
}) => version.validTo === null && version.supersededAt === null;

export function planCompanyFactsBackfill(input: {
  readonly graph: IdentityGraph;
  readonly memberships: readonly IndexMembership[];
  readonly relationships: readonly LegalEntityRelationship[];
  readonly indexId: string;
  readonly cutoff: PointInTimeQuery;
}): CompanyFactsBackfillPlan {
  const { graph, relationships, cutoff } = input;
  const members = input.memberships.filter(
    (membership) =>
      membership.indexId === input.indexId && isOpenMembership(membership),
  );
  const securities = new Map(
    graph.securities
      .filter(isOpen)
      .map((security) => [security.securityId, security]),
  );
  const ciksByEntity = new Map<string, string[]>();

  for (const assignment of graph.identifierAssignments) {
    if (
      isOpen(assignment) &&
      assignment.identifierType === "cik" &&
      assignment.scope === CIK_SCOPE &&
      assignment.subjectType === "legal_entity"
    ) {
      const ciks = ciksByEntity.get(assignment.subjectId) ?? [];
      ciks.push(assignment.normalizedValue);
      ciksByEntity.set(assignment.subjectId, ciks);
    }
  }

  const symbolsBySecurity = new Map<string, string[]>();
  const listingsById = new Map(
    graph.listings
      .filter(isOpen)
      .map((listing) => [listing.listingId, listing]),
  );

  for (const symbol of graph.listingSymbols) {
    const listing = listingsById.get(symbol.listingId);

    if (isOpen(symbol) && symbol.symbolType === "ticker" && listing) {
      const symbols = symbolsBySecurity.get(listing.securityId) ?? [];
      symbols.push(symbol.symbol);
      symbolsBySecurity.set(listing.securityId, symbols);
    }
  }

  const subjects = new Map<string, CompanyFactsBackfillSubject>();
  const rejections: CompanyFactsBackfillRejection[] = [];
  const rejected = new Set<string>();
  const reject = (
    code: CompanyFactsBackfillRejectionCode,
    subjectId: string,
  ) => {
    const key = `${code}:${subjectId}`;

    if (!rejected.has(key)) {
      rejected.add(key);
      rejections.push({ code, subjectId });
    }
  };

  const issuers = new Map<string, string[]>();

  for (const membership of members) {
    const security = securities.get(membership.securityId);

    if (!security) {
      reject("security_not_in_graph", membership.securityId);
      continue;
    }

    const symbols = issuers.get(security.issuerLegalEntityId) ?? [];
    symbols.push(...(symbolsBySecurity.get(security.securityId) ?? []));
    issuers.set(security.issuerLegalEntityId, symbols);
  }

  for (const [legalEntityId, symbols] of issuers) {
    const ciks = ciksByEntity.get(legalEntityId) ?? [];

    if (ciks.length === 0) {
      reject("issuer_without_cik", legalEntityId);
      continue;
    }

    if (new Set(ciks).size > 1) {
      reject("issuer_with_several_ciks", legalEntityId);
      continue;
    }

    subjects.set(ciks[0]!, {
      cik: ciks[0]!,
      legalEntityId,
      role: "index_member",
      symbols: [...new Set(symbols)].sort(),
      successorLegalEntityId: null,
    });

    const lineage = resolveReportingLineage(
      relationships,
      legalEntityId,
      cutoff,
    );

    for (const segment of lineage.segments.slice(1)) {
      const predecessorCiks = ciksByEntity.get(segment.legalEntityId) ?? [];

      if (new Set(predecessorCiks).size !== 1) {
        reject("predecessor_without_cik", segment.legalEntityId);
        continue;
      }

      const cik = predecessorCiks[0]!;

      if (!subjects.has(cik)) {
        subjects.set(cik, {
          cik,
          legalEntityId: segment.legalEntityId,
          role: "reporting_predecessor",
          symbols: [],
          successorLegalEntityId: legalEntityId,
        });
      }
    }
  }

  return {
    planVersion: COMPANY_FACTS_BACKFILL_PLAN_VERSION,
    subjects: [...subjects.values()].sort((left, right) =>
      left.cik.localeCompare(right.cik),
    ),
    rejections,
    members: members.length,
  };
}
