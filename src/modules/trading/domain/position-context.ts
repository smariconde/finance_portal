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
 * (`position-context-2.0.0`, ADR 0076, sección 3; `F11-04`): su última
 * valuación registrada, buscada por el ticker. `1.0.0` también daba sector y
 * acceso por CEDEAR, y para eso leía el grafo de identidad, la clasificación y
 * el registro de CEDEARs en cada apertura de la cuenta.
 *
 * Es opcional por construcción: vive en la base de análisis, que puede no
 * responder, y la cuenta se muestra igual. Lo que falta dice por qué; nada se
 * rellena.
 *
 * `resolvePositionIdentity` sigue para los earnings de la cuenta. La identidad sigue `schwab-position-identity-1.0.0`: el símbolo de Schwab se
 * busca entre los tickers vigentes de listings activos en dólares —Schwab opera
 * en EE.UU.—, y sólo una security candidata resuelve. Un CEDEAR en BYMA puede
 * tener el mismo ticker que su subyacente, y por eso el filtro de moneda.
 */
export const POSITION_CONTEXT_VERSION = "position-context-2.0.0";
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

/** Desde `position-context-2.0.0`, sólo la valuación: el owner sacó sector y
 * CEDEAR de la cuenta (2026-11-27) por no usarlos al operar. */
export type PositionContext = {
  readonly symbol: string;
  readonly valuation: PositionValuation;
};
