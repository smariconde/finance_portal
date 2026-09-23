import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
} from "@/modules/temporal/domain/temporal-version";

import type { CedearClaim } from "./cedear-claim";

/**
 * Resolución del subyacente de un programa contra el grafo
 * ([ADR 0027](../../../../docs/architecture/adr/0027-cedear-registry-sources.md),
 * decisión 3).
 *
 * El registro **no constituye identidad**: sólo apunta a securities que el grafo
 * ya tiene. Un programa cuyo subyacente no está en el grafo queda afuera con su
 * motivo, y nunca se crea un emisor desde el listado de un depositario.
 *
 * El ticker identifica y el mercado corrobora. Es la regla que resultó de medir
 * los datos: el mercado que el emisor declara está viejo o mal cargado bastante
 * más seguido que el ticker —KMB figura en NYSE y ya cotiza en Nasdaq; LIN, PLD y
 * SHW traen la industria en el campo de mercado—, así que un mercado que no
 * coincide se marca y no decide.
 */
export const CEDEAR_UNDERLYING_RESOLUTION_VERSION =
  "cedear-underlying-resolution-1.0.0";

export type UnderlyingCandidate = {
  readonly securityId: string;
  readonly listingId: string;
  readonly mic: string;
};

/** Símbolo normalizado → listings vigentes que lo tienen en el instante. */
export type UnderlyingSymbolIndex = ReadonlyMap<
  string,
  readonly UnderlyingCandidate[]
>;

/**
 * Traducción declarada del ticker de la fuente a la convención del grafo.
 *
 * El grafo guarda los símbolos como los publica la SEC, con guion para la clase
 * (`BRK-B`), y los emisores de CEDEAR escriben `BRK/B`. Es la única traducción:
 * la normalización del modelo de identidad no toca puntos ni guiones a
 * propósito, y esta regla vale sólo para leer esta fuente contra ese grafo.
 */
export function normalizeOriginSymbol(raw: string): string {
  return raw.replace(/\s+/gu, "").toUpperCase().replace(/[/.]/gu, "-");
}

/**
 * Índice de símbolos del grafo **en el instante de la observación**: un ticker
 * es un valor de búsqueda acotado en el tiempo, y el que vale es el que regía
 * cuando se leyó la publicación.
 */
export function buildUnderlyingSymbolIndex(
  graph: IdentityGraph,
  observedAt: string,
): UnderlyingSymbolIndex {
  const query = pointInTimeQuerySchema.parse({
    effectiveAt: observedAt,
    revisionPolicy: "as_known",
    knownAt: observedAt,
    sourcePolicyVersion: CEDEAR_UNDERLYING_RESOLUTION_VERSION,
  });
  const current = <T extends Parameters<typeof isKnownAt>[0]>(version: T) =>
    isEffectiveAt(version, observedAt) && isKnownAt(version, query);

  const listingById = new Map(
    graph.listings
      .filter(current)
      .map((listing) => [listing.listingId, listing]),
  );
  const index = new Map<string, UnderlyingCandidate[]>();

  for (const symbol of graph.listingSymbols) {
    const listing = listingById.get(symbol.listingId);

    if (
      listing === undefined ||
      symbol.symbolType !== "ticker" ||
      !current(symbol)
    ) {
      continue;
    }

    const key = normalizeOriginSymbol(symbol.symbol);
    index.set(key, [
      ...(index.get(key) ?? []),
      {
        securityId: listing.securityId,
        listingId: listing.listingId,
        mic: listing.mic,
      },
    ]);
  }

  return index;
}

export type OriginMarket =
  | { readonly kind: "us"; readonly mic: string }
  | { readonly kind: "foreign" }
  | { readonly kind: "unrecognized" };

/** Mercados de Estados Unidos tal como los escriben los dos emisores. */
const US_MARKETS: Readonly<Record<string, string>> = Object.freeze({
  NYSE: "XNYS",
  "NEW YORK": "XNYS",
  NASDAQ: "XNAS",
  "NASDAQ GS": "XNAS",
  "NASDAQ GM": "XNAS",
  "NASDAQ CM": "XNAS",
  "NYSE ARCA": "ARCX",
  NYSEARCA: "ARCX",
  "NYSE AMERICAN": "XASE",
  NYSEAMERICAN: "XASE",
  "CBOE BZX": "BATS",
  OTC: "OTCM",
  "OTC US": "OTCM",
});

/**
 * Mercados fuera de Estados Unidos. El universo sólo tiene venues de Estados
 * Unidos, así que un ticker de B3 o de Londres que coincidiera con uno local
 * sería una colisión y no una identidad: se deja afuera sin buscarlo.
 */
const FOREIGN_MARKETS: ReadonlySet<string> = new Set([
  "B3",
  "BOVESPA",
  "XETRA",
  "LONDON STOCK EXCHANGE",
  "LSE",
  "EURONEXT",
  "TSX",
  "BME",
]);

export function classifyOriginMarket(raw: string | null): OriginMarket {
  const label = (raw ?? "").replace(/\s+/gu, " ").trim().toUpperCase();
  const mic = US_MARKETS[label];

  if (mic !== undefined) {
    return { kind: "us", mic };
  }

  return FOREIGN_MARKETS.has(label)
    ? { kind: "foreign" }
    : { kind: "unrecognized" };
}

export type CedearQualityFlag =
  /** El mercado declarado es de Estados Unidos pero no el del listing. */
  | "origin_market_stale"
  /** El campo de mercado no dice un mercado reconocible. */
  | "origin_market_unrecognized"
  /** Un segundo ticker de la fila no está en el grafo: es un dato viejo. */
  | "origin_ticker_stale";

export type UnderlyingResolution =
  | {
      readonly status: "resolved";
      readonly securityId: string;
      readonly listingId: string;
      /** El ticker declarado que resolvió, tal como vino. */
      readonly reportedSymbol: string;
      readonly flags: readonly CedearQualityFlag[];
    }
  | {
      readonly status: "outside_universe";
      readonly reason: "symbol_not_in_universe" | "foreign_market";
    }
  | {
      readonly status: "rejected";
      readonly code:
        /** Dos tickers de la misma fila apuntan a securities distintas. */
        | "underlying_ticker_conflict"
        /** Un ticker alcanza a dos securities en el instante. */
        | "underlying_ambiguous";
    };

function distinctSecurities(
  candidates: readonly UnderlyingCandidate[],
): readonly string[] {
  return [...new Set(candidates.map((candidate) => candidate.securityId))];
}

export function resolveCedearUnderlying(
  claim: CedearClaim,
  index: UnderlyingSymbolIndex,
): UnderlyingResolution {
  const market = classifyOriginMarket(claim.originMarket);

  if (market.kind === "foreign") {
    return { status: "outside_universe", reason: "foreign_market" };
  }

  const [primary, ...secondaries] = claim.originSymbols;

  if (primary === undefined) {
    return { status: "outside_universe", reason: "symbol_not_in_universe" };
  }

  const primaryCandidates = index.get(normalizeOriginSymbol(primary)) ?? [];

  if (distinctSecurities(primaryCandidates).length > 1) {
    return { status: "rejected", code: "underlying_ambiguous" };
  }

  const hit = primaryCandidates[0] ?? null;
  const flags: CedearQualityFlag[] = [];

  for (const secondary of secondaries) {
    const candidates = index.get(normalizeOriginSymbol(secondary)) ?? [];

    // Un segundo ticker que resuelve a otra security —o que resuelve cuando el
    // principal no— es una fila que se contradice: TLN declara GEV en la
    // descripción. Elegir uno de los dos sería inventar el desempate.
    if (
      candidates.some((candidate) => candidate.securityId !== hit?.securityId)
    ) {
      return { status: "rejected", code: "underlying_ticker_conflict" };
    }

    if (candidates.length === 0 && hit !== null) {
      flags.push("origin_ticker_stale");
    }
  }

  if (hit === null) {
    return { status: "outside_universe", reason: "symbol_not_in_universe" };
  }

  if (market.kind === "unrecognized") {
    flags.push("origin_market_unrecognized");
  } else if (market.mic !== hit.mic) {
    flags.push("origin_market_stale");
  }

  return {
    status: "resolved",
    securityId: hit.securityId,
    listingId: hit.listingId,
    reportedSymbol: primary,
    flags,
  };
}
