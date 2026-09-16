/**
 * Eventos de listing sintéticos con la forma del cable de la SEC.
 *
 * Ningún emisor, CIK de emisor, accession, fecha ni nombre proviene de una
 * descarga: el repositorio es público. Los únicos valores reales son los CIK de
 * EDGAR de Nasdaq y NYSE, porque la regla los usa para ubicar al mercado que
 * presentó. Lo que sí copia de los casos medidos el 2026-09-15 es la **forma**:
 *
 * - **traspaso** (Kraft Heinz): 8-K 3.01 antes de constituir el universo, después
 *   `8-A12B` y `25` del emisor con segundos de diferencia y el `CERT` del mercado
 *   nuevo a la mañana siguiente;
 * - **delisting** (AvalonBay): `25-NSE` del mercado a la mañana y el 8-K con 2.01,
 *   3.01 y 5.01 a la tarde;
 * - **renombre** (Franklin Templeton): `formerNames` con un borde anterior a la
 *   constitución, así que la versión registrada nació con el nombre vencido;
 * - **cambio de ticker** (BNY): nada fechado en el índice;
 * - **dos clases en el mismo mercado** (Alphabet): la evidencia no dice cuál.
 */
import {
  identityGraphSchema,
  type IdentityGraph,
} from "@/modules/identity/domain/identity-graph";
import type { CompanyTickerAssignment } from "@/modules/universe/domain/universe-source-records";

import type {
  SecFormerName,
  SecListingFiling,
  SecListingIndex,
} from "../domain/parse-sec-listing-index";

export const FIXTURE_LISTINGS_CONSTITUTED_AT = "2025-09-05T01:00:00.000Z";
export const FIXTURE_LISTINGS_FETCHED_AT = "2025-09-20T18:00:00.000Z";

export const NASDAQ_FILER_CIK = "0001354457";
export const NYSE_FILER_CIK = "0000876661";

type FixtureFiler = {
  readonly key: string;
  readonly cik: string;
  readonly name: string;
  readonly listings: readonly {
    readonly mic: string;
    readonly symbol: string;
  }[];
};

export const FIXTURE_LISTING_FILERS = {
  transfer: {
    key: "81",
    cik: "0000000081",
    name: "TRASPASO SINTETICO CORP",
    listings: [{ mic: "XNAS", symbol: "TRSP" }],
  },
  delisting: {
    key: "82",
    cik: "0000000082",
    name: "SALIDA SINTETICA INC",
    listings: [{ mic: "XNYS", symbol: "SALE" }],
  },
  rename: {
    key: "83",
    cik: "0000000083",
    name: "NOMBRE VIEJO SINTETICO INC",
    listings: [{ mic: "XNYS", symbol: "NMBR" }],
  },
  twoClasses: {
    key: "84",
    cik: "0000000084",
    name: "DOS CLASES SINTETICAS INC",
    listings: [
      { mic: "XNAS", symbol: "DOSA" },
      { mic: "XNAS", symbol: "DOSB" },
    ],
  },
  symbolChange: {
    key: "85",
    cik: "0000000085",
    name: "TICKER SINTETICO CO",
    listings: [{ mic: "XNYS", symbol: "OLDT" }],
  },
} as const satisfies Record<string, FixtureFiler>;

export const FIXTURE_RENAMED_TO = "NOMBRE NUEVO SINTETICO INC";

/** UUID determinista: prefijo de nivel, filer e índice en el último grupo. */
function id(prefix: string, key: string, index = 0): string {
  return `00000000-0000-4000-8000-${prefix}${key}${String(index).padStart(4, "0")}0000`;
}

export function fixtureIds(filer: FixtureFiler, index = 0) {
  return {
    legalEntityId: id("0e", filer.key),
    securityId: id("5e", filer.key),
    listingId: id("1a", filer.key, index),
    listingSymbolId: id("5a", filer.key, index),
    identifierAssignmentId: id("c1", filer.key),
  };
}

const HASH = "a".repeat(64);

function opening(recordedAt = FIXTURE_LISTINGS_CONSTITUTED_AT) {
  return {
    validFrom: FIXTURE_LISTINGS_CONSTITUTED_AT,
    validTo: null,
    availableAt: FIXTURE_LISTINGS_CONSTITUTED_AT,
    supersededAt: null,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: "fixture-pin",
    contentHash: HASH,
    recordedAt,
  };
}

/** Grafo abierto con los cinco filers, como lo deja una constitución. */
export function buildFixtureListingGraph(): IdentityGraph {
  const filers = Object.values(FIXTURE_LISTING_FILERS) as FixtureFiler[];

  return identityGraphSchema.parse({
    legalEntities: filers.map((filer) => ({
      ...opening(),
      legalEntityId: fixtureIds(filer).legalEntityId,
      legalName: filer.name,
      entityType: "other",
      jurisdiction: null,
      status: "active",
    })),
    securities: filers.map((filer) => ({
      ...opening(),
      securityId: fixtureIds(filer).securityId,
      issuerLegalEntityId: fixtureIds(filer).legalEntityId,
      securityType: "common_equity",
      shareClass: null,
      economicCurrency: "USD",
      status: "active",
    })),
    listings: filers.flatMap((filer) =>
      filer.listings.map((listing, index) => ({
        ...opening(),
        listingId: fixtureIds(filer, index).listingId,
        securityId: fixtureIds(filer).securityId,
        mic: listing.mic,
        quoteCurrency: "USD",
        country: "US",
        status: "active",
        primaryListing: true,
      })),
    ),
    listingSymbols: filers.flatMap((filer) =>
      filer.listings.map((listing, index) => ({
        ...opening(),
        listingSymbolId: fixtureIds(filer, index).listingSymbolId,
        listingId: fixtureIds(filer, index).listingId,
        symbol: listing.symbol,
        symbolType: "ticker",
      })),
    ),
    depositaryPrograms: [],
    depositaryRatios: [],
    identifierAssignments: filers.map((filer) => ({
      ...opening(),
      sourceId: "sec-edgar",
      identifierAssignmentId: fixtureIds(filer).identifierAssignmentId,
      subjectType: "legal_entity",
      subjectId: fixtureIds(filer).legalEntityId,
      identifierType: "cik",
      identifierValue: filer.cik,
      normalizedValue: filer.cik,
      scope: "sec:filer",
      issuingAuthority: "U.S. Securities and Exchange Commission",
      confidence: "authoritative",
    })),
  });
}

/** Tabla de tickers «de hoy»: lo que cambió y lo que la tabla todavía no muestra. */
export const FIXTURE_LISTING_ASSIGNMENTS: readonly CompanyTickerAssignment[] =
  Object.freeze([
    // Ya en NYSE, mismo ticker.
    {
      cik: "81",
      name: "TRASPASO SINTETICO CORP",
      ticker: "TRSP",
      exchange: "NYSE",
    },
    // La tabla todavía la muestra: no publica cuándo saca un ticker.
    {
      cik: "82",
      name: "SALIDA SINTETICA INC",
      ticker: "SALE",
      exchange: "NYSE",
    },
    { cik: "83", name: FIXTURE_RENAMED_TO, ticker: "NMBR", exchange: "NYSE" },
    {
      cik: "84",
      name: "DOS CLASES SINTETICAS INC",
      ticker: "DOSA",
      exchange: "Nasdaq",
    },
    {
      cik: "84",
      name: "DOS CLASES SINTETICAS INC",
      ticker: "DOSB",
      exchange: "Nasdaq",
    },
    {
      cik: "85",
      name: "TICKER SINTETICO CO",
      ticker: "NEWT",
      exchange: "NYSE",
    },
  ]);

export const FIXTURE_LISTING_ACCESSIONS = {
  transferNotice: "0000000081-25-000057",
  transferRegistration: "0000000081-25-000061",
  transferWithdrawal: "0000000081-25-000062",
  transferCertification: "0000876661-25-000730",
  debtRegistration: "0000000081-25-000070",
  debtCertification: "0001354457-25-000507",
  delistingStrike: "0000876661-25-000689",
  delistingNotice: "0000000900-25-097833",
  unrelatedStrike: "0000876661-25-000390",
} as const;

export const FIXTURE_TRANSFER_EFFECTIVE_AT = "2025-09-09T12:44:23.000Z";
export const FIXTURE_DELISTING_EFFECTIVE_AT = "2025-09-17T20:01:44.000Z";
export const FIXTURE_RENAME_BORDER = "2025-08-14T04:00:00.000Z";

function filing(
  accessionNumber: string,
  form: string,
  acceptedAt: string,
  items: readonly string[] | null = [],
  reportDate: string | null = null,
): SecListingFiling {
  return {
    accessionNumber,
    form,
    filingDate: acceptedAt.slice(0, 10),
    reportDate,
    acceptedAt,
    items,
    submitterCik: accessionNumber.slice(0, 10),
  };
}

const PERIODIC = (cik: string) =>
  filing(`${cik}-25-000010`, "10-K", "2025-02-20T21:05:00.000Z");

export function fixtureListingIndex(
  filer: keyof typeof FIXTURE_LISTING_FILERS,
  overrides: {
    readonly filings?: readonly SecListingFiling[];
    readonly formerNames?: readonly SecFormerName[];
    readonly entityName?: string | null;
  } = {},
): SecListingIndex {
  const { cik, name } = FIXTURE_LISTING_FILERS[filer];
  const a = FIXTURE_LISTING_ACCESSIONS;
  const defaults: Record<
    keyof typeof FIXTURE_LISTING_FILERS,
    { filings: SecListingFiling[]; formerNames: SecFormerName[]; name: string }
  > = {
    transfer: {
      name,
      formerNames: [],
      filings: [
        PERIODIC(cik),
        filing(a.transferNotice, "8-K", "2025-08-26T12:03:49.000Z", [
          "3.01",
          "7.01",
          "9.01",
        ]),
        filing(a.transferRegistration, "8-A12B", "2025-09-08T20:03:41.000Z"),
        filing(a.transferWithdrawal, "25", "2025-09-08T20:04:14.000Z"),
        filing(a.transferCertification, "CERT", FIXTURE_TRANSFER_EFFECTIVE_AT),
      ],
    },
    delisting: {
      name,
      formerNames: [],
      filings: [
        PERIODIC(cik),
        filing(a.delistingStrike, "25-NSE", "2025-09-17T14:53:32.000Z"),
        filing(a.delistingNotice, "8-K", FIXTURE_DELISTING_EFFECTIVE_AT, [
          "2.01",
          "3.01",
          "5.01",
          "9.01",
        ]),
      ],
    },
    rename: {
      name: FIXTURE_RENAMED_TO,
      formerNames: [
        {
          name,
          from: "1994-11-10T05:00:00.000Z",
          to: FIXTURE_RENAME_BORDER,
        },
      ],
      filings: [PERIODIC(cik)],
    },
    twoClasses: { name, formerNames: [], filings: [PERIODIC(cik)] },
    symbolChange: { name, formerNames: [], filings: [PERIODIC(cik)] },
  };
  const base = defaults[filer];
  const filings = overrides.filings ?? base.filings;
  const accepted = filings
    .map((entry) => entry.acceptedAt)
    .filter((value): value is string => value !== null)
    .sort();

  return {
    cik,
    entityName:
      overrides.entityName === undefined ? base.name : overrides.entityName,
    formerNames: overrides.formerNames ?? base.formerNames,
    filings,
    coverage: { oldestAcceptedAt: accepted[0] ?? null, hasHistoryFiles: false },
    rejectedFilings: 0,
    rejectedFormerNames: 0,
  };
}

export { filing as fixtureListingFiling };

/** Payload con la forma de `submissions`, para probar parser y adaptador. */
export function fixtureSubmissionsPayload(index: SecListingIndex): unknown {
  return {
    cik: index.cik,
    name: index.entityName,
    formerNames: index.formerNames.map((entry) => ({
      name: entry.name,
      from: entry.from,
      to: entry.to,
    })),
    filings: {
      recent: {
        accessionNumber: index.filings.map((entry) => entry.accessionNumber),
        filingDate: index.filings.map((entry) => entry.filingDate),
        reportDate: index.filings.map((entry) => entry.reportDate ?? ""),
        acceptanceDateTime: index.filings.map((entry) => entry.acceptedAt),
        form: index.filings.map((entry) => entry.form),
        items: index.filings.map((entry) => (entry.items ?? []).join(",")),
      },
      files: [],
    },
  };
}
