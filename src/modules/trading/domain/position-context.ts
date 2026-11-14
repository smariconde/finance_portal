import {
  resolveCedearAccess,
  type CedearAccess,
} from "@/modules/cedears/domain/resolve-cedear-access";
import type { StoredCedearRegistry } from "@/modules/cedears/domain/plan-cedear-registry";
import {
  listSectors,
  SP500_SECTOR_TAXONOMY_ID,
} from "@/modules/classification/domain/sector-taxonomy";
import {
  resolveClassificationAt,
  type SubjectClassification,
} from "@/modules/classification/domain/subject-classification";
import {
  normalizeSymbol,
  type IdentityGraph,
} from "@/modules/identity/domain/identity-graph";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
} from "@/modules/temporal/domain/temporal-version";
import type { StoredValuationRun } from "@/modules/valuation/domain/stored-valuation-run";

/**
 * El cruce de una posición con lo que el portal sabe de ella
 * (`position-context-1.0.0`, ADR 0076, sección 3; `F11-04`): su última
 * valuación registrada, su sector y su acceso por CEDEAR, al corte de la lectura.
 *
 * Es opcional por construcción: vive en la base de análisis, que puede no
 * responder, y la cuenta se muestra igual. Cada parte que falta dice por qué;
 * ninguna se rellena.
 *
 * La identidad sigue `schwab-position-identity-1.0.0`: el símbolo de Schwab se
 * busca entre los tickers vigentes de listings activos en dólares —Schwab opera
 * en EE.UU.—, y sólo una security candidata resuelve. Un CEDEAR en BYMA puede
 * tener el mismo ticker que su subyacente, y por eso el filtro de moneda.
 */
export const POSITION_CONTEXT_VERSION = "position-context-1.0.0";
export const POSITION_IDENTITY_VERSION = "schwab-position-identity-1.0.0";

export type PositionIdentity =
  | {
      readonly status: "resolved";
      readonly securityId: string;
      readonly legalEntityId: string;
    }
  | {
      readonly status: "unresolved";
      readonly reason: "not_in_universe" | "ambiguous_symbol";
    };

export function resolvePositionIdentity(
  graph: IdentityGraph,
  symbol: string,
  query: PointInTimeQuery,
): PositionIdentity {
  const current = <T extends Parameters<typeof isEffectiveAt>[0]>(
    rows: readonly T[],
  ) =>
    rows.filter(
      (row) => isEffectiveAt(row, query.effectiveAt) && isKnownAt(row, query),
    );

  const normalized = normalizeSymbol(symbol);
  const listings = new Map(
    current(graph.listings)
      .filter(
        (listing) =>
          listing.status === "active" && listing.quoteCurrency === "USD",
      )
      .map((listing) => [listing.listingId, listing]),
  );
  const securityIds = new Set(
    current(graph.listingSymbols)
      .filter((row) => normalizeSymbol(row.symbol) === normalized)
      .map((row) => listings.get(row.listingId)?.securityId)
      .filter((id): id is string => id !== undefined),
  );

  if (securityIds.size === 0) {
    return { status: "unresolved", reason: "not_in_universe" };
  }
  if (securityIds.size > 1) {
    return { status: "unresolved", reason: "ambiguous_symbol" };
  }

  const securityId = [...securityIds][0]!;
  const security = current(graph.securities).find(
    (row) => row.securityId === securityId,
  );
  if (security === undefined) {
    return { status: "unresolved", reason: "not_in_universe" };
  }

  return {
    status: "resolved",
    securityId,
    legalEntityId: security.issuerLegalEntityId,
  };
}

export type PositionValuation =
  | {
      readonly status: "valued";
      readonly valuePerShare: string;
      readonly currency: string;
      readonly asOf: string;
      readonly runStatus: "computed" | "requires_review";
    }
  | {
      readonly status: "absent";
      readonly reason:
        "not_requested" | "no_run" | "run_rejected" | "run_without_value";
    };

/** El valor por acción de una corrida, en el lugar de cada método. */
export function valuationOf(
  run: StoredValuationRun | null,
  requested: boolean,
): PositionValuation {
  if (!requested) return { status: "absent", reason: "not_requested" };
  if (run === null) return { status: "absent", reason: "no_run" };
  if (run.status === "rejected" || run.result === null) {
    return { status: "absent", reason: "run_rejected" };
  }

  const value =
    "base" in run.result
      ? run.result.base.valuePerShare
      : run.result.valuePerShare;

  if (value === null) return { status: "absent", reason: "run_without_value" };

  return {
    status: "valued",
    valuePerShare: value,
    currency: run.currency,
    asOf: run.asOf,
    runStatus: run.status,
  };
}

export type PositionSector =
  | {
      readonly status: "classified";
      readonly code: string;
      readonly label: string;
    }
  | {
      readonly status: "absent";
      readonly reason: "never_classified" | "not_effective_at_cutoff";
    };

const SECTOR_LABEL: ReadonlyMap<string, string> = new Map(
  listSectors().map(({ code, label }) => [code, label]),
);

export function sectorOf(
  classifications: readonly SubjectClassification[],
  legalEntityId: string,
  query: PointInTimeQuery,
): PositionSector {
  const resolution = resolveClassificationAt(
    classifications,
    SP500_SECTOR_TAXONOMY_ID,
    query,
    legalEntityId,
  );
  if (!resolution.classified) {
    return { status: "absent", reason: resolution.absence };
  }
  const code = resolution.classification.code;
  return { status: "classified", code, label: SECTOR_LABEL.get(code) ?? code };
}

export type PositionCedear =
  | {
      readonly status: "program";
      /** Ratio de cada programa: `depositario:subyacente`, o `null` sin ratio al corte. */
      readonly ratios: readonly (string | null)[];
    }
  | {
      readonly status: "absent";
      readonly reason: Extract<
        CedearAccess,
        { status: "none_known" }
      >["reason"];
    };

export function cedearOf(
  registry: StoredCedearRegistry,
  securityId: string,
  query: PointInTimeQuery,
): PositionCedear {
  const access = resolveCedearAccess(registry, securityId, query);
  if (access.status !== "program") {
    return { status: "absent", reason: access.reason };
  }
  return {
    status: "program",
    ratios: access.programs.map(({ ratio }) =>
      ratio === null
        ? null
        : `${ratio.depositaryUnits}:${ratio.underlyingUnits}`,
    ),
  };
}

export type PositionContext =
  | {
      readonly symbol: string;
      readonly status: "resolved";
      readonly valuation: PositionValuation;
      readonly sector: PositionSector;
      readonly cedear: PositionCedear;
    }
  | {
      readonly symbol: string;
      readonly status: "unresolved";
      readonly reason: "not_in_universe" | "ambiguous_symbol";
    };
