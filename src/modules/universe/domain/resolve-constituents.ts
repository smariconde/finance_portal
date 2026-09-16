import {
  normalizeIdentifierValue,
  normalizeSymbol,
} from "@/modules/identity/domain/identity-graph";

import type {
  CompanyTickerAssignment,
  IndexConstituentClaim,
} from "./universe-source-records";
import { resolveVenue, type Venue } from "./venue-map";

/**
 * Join determinista entre la lista de constituyentes y las asignaciones
 * autoritativas ticker→CIK.
 *
 * El join sólo puede hacerse por símbolo, que es justamente el valor que el
 * modelo de identidad trata como inestable. La regla asume esa limitación en vez
 * de taparla: cada caso que el símbolo no alcanza a decidir sale como rechazo
 * nombrado y ninguno se resuelve por parecido de nombre ni por descarte.
 */
export const CONSTITUENT_MATCH_RULE_VERSION = "constituent-match-1.0.0";

/**
 * Los separadores de clase divergen entre fuentes: la lista escribe `BRK.B` y la
 * SEC escribe `BRK-B`. Es una diferencia de convención tipográfica sobre el mismo
 * ticker, no dos símbolos distintos, así que la regla admite el match relajado
 * **y lo declara**. Se aplica sólo como segundo intento y sólo si es unívoco: si
 * la forma relajada alcanza a más de un ticker, el caso es ambiguo y no se
 * resuelve. Ninguna de las dos formas originales se pierde.
 */
function relaxSeparators(symbol: string): string {
  return normalizeSymbol(symbol).replace(/[.\-/]/gu, "");
}

export type ConstituentMatchKind = "exact" | "separator_relaxed";

export type ResolvedConstituent = {
  /** Símbolo tal como lo escribe la lista de constituyentes. */
  readonly claimSymbol: string;
  /** Símbolo tal como lo asigna la fuente autoritativa: el que se persiste. */
  readonly assignedSymbol: string;
  readonly normalizedSymbol: string;
  readonly normalizedCik: string;
  readonly legalName: string;
  readonly venue: Venue;
  readonly matchKind: ConstituentMatchKind;
};

export type ConstituentRejectionCode =
  /** El mismo símbolo aparece dos veces en la lista de entrada. */
  | "duplicate_claim_symbol"
  /** Ninguna asignación autoritativa cubre ese símbolo en el corte. */
  | "issuer_not_assigned"
  /** El símbolo alcanza a más de un CIK: dos emisores, no un empate. */
  | "ambiguous_issuer"
  /** Un solo emisor pero más de un venue: no se elige un primario por descarte. */
  | "ambiguous_venue"
  /** La asignación no declara mercado. */
  | "missing_exchange"
  /** El mercado declarado no está en el mapa de venues versionado. */
  | "unmapped_venue";

export type ConstituentRejection = {
  readonly claimSymbol: string;
  readonly code: ConstituentRejectionCode;
  /** Candidatos considerados; nunca uno elegido en silencio. */
  readonly candidates: readonly string[];
};

export type ConstituentResolution = {
  readonly matchRuleVersion: string;
  readonly resolved: readonly ResolvedConstituent[];
  readonly rejections: readonly ConstituentRejection[];
};

type AssignmentGroup = {
  readonly assignments: readonly CompanyTickerAssignment[];
};

function indexAssignments(assignments: readonly CompanyTickerAssignment[]): {
  exact: Map<string, AssignmentGroup>;
  relaxed: Map<string, Set<string>>;
} {
  const exact = new Map<string, CompanyTickerAssignment[]>();
  const relaxed = new Map<string, Set<string>>();

  for (const assignment of assignments) {
    const normalized = normalizeSymbol(assignment.ticker);
    const group = exact.get(normalized);

    if (group) {
      group.push(assignment);
    } else {
      exact.set(normalized, [assignment]);
    }

    const relaxedKey = relaxSeparators(assignment.ticker);
    const targets = relaxed.get(relaxedKey);

    if (targets) {
      targets.add(normalized);
    } else {
      relaxed.set(relaxedKey, new Set([normalized]));
    }
  }

  return {
    exact: new Map(
      [...exact].map(([key, group]) => [key, { assignments: group }]),
    ),
    relaxed,
  };
}

export function resolveConstituents(
  claims: readonly IndexConstituentClaim[],
  assignments: readonly CompanyTickerAssignment[],
): ConstituentResolution {
  const index = indexAssignments(assignments);
  const resolved: ResolvedConstituent[] = [];
  const rejections: ConstituentRejection[] = [];
  const seenClaims = new Set<string>();

  for (const claim of claims) {
    const normalizedClaim = normalizeSymbol(claim.symbol);

    if (seenClaims.has(normalizedClaim)) {
      rejections.push({
        claimSymbol: claim.symbol,
        code: "duplicate_claim_symbol",
        candidates: [normalizedClaim],
      });
      continue;
    }

    seenClaims.add(normalizedClaim);

    let matchKind: ConstituentMatchKind = "exact";
    let group = index.exact.get(normalizedClaim);

    if (!group) {
      const relaxedTargets = [
        ...(index.relaxed.get(relaxSeparators(claim.symbol)) ?? []),
      ];

      if (relaxedTargets.length === 1) {
        matchKind = "separator_relaxed";
        group = index.exact.get(relaxedTargets[0]!);
      } else if (relaxedTargets.length > 1) {
        rejections.push({
          claimSymbol: claim.symbol,
          code: "ambiguous_issuer",
          candidates: relaxedTargets.sort(),
        });
        continue;
      }
    }

    if (!group) {
      rejections.push({
        claimSymbol: claim.symbol,
        code: "issuer_not_assigned",
        candidates: [],
      });
      continue;
    }

    const ciks = [
      ...new Set(
        group.assignments.map((assignment) =>
          normalizeIdentifierValue("cik", assignment.cik),
        ),
      ),
    ].sort();

    if (ciks.length > 1) {
      // El mismo ticker asignado a dos emisores es un conflicto para revisión
      // manual, no un empate que se resuelva eligiendo el primero.
      rejections.push({
        claimSymbol: claim.symbol,
        code: "ambiguous_issuer",
        candidates: ciks,
      });
      continue;
    }

    if (group.assignments.length > 1) {
      rejections.push({
        claimSymbol: claim.symbol,
        code: "ambiguous_venue",
        candidates: [
          ...new Set(
            group.assignments.map((assignment) => assignment.exchange ?? ""),
          ),
        ]
          .filter((label) => label !== "")
          .sort(),
      });
      continue;
    }

    const assignment = group.assignments[0]!;

    if (assignment.exchange === null) {
      rejections.push({
        claimSymbol: claim.symbol,
        code: "missing_exchange",
        candidates: ciks,
      });
      continue;
    }

    const venue = resolveVenue(assignment.exchange);

    if (venue === null) {
      rejections.push({
        claimSymbol: claim.symbol,
        code: "unmapped_venue",
        candidates: [assignment.exchange],
      });
      continue;
    }

    resolved.push({
      claimSymbol: claim.symbol,
      assignedSymbol: assignment.ticker,
      normalizedSymbol: normalizeSymbol(assignment.ticker),
      normalizedCik: ciks[0]!,
      legalName: assignment.name,
      venue,
      matchKind,
    });
  }

  return {
    matchRuleVersion: CONSTITUENT_MATCH_RULE_VERSION,
    resolved,
    rejections,
  };
}
