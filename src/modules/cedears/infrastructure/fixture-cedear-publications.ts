import {
  identityGraphSchema,
  type IdentityGraph,
} from "@/modules/identity/domain/identity-graph";

/**
 * Publicaciones **sintéticas** de los dos emisores
 * ([ADR 0027](../../../../docs/architecture/adr/0027-cedear-registry-sources.md)).
 *
 * Ningún payload capturado entra al repositorio: Comafi prohíbe almacenar su
 * contenido y Caja de Valores no publica términos. Lo que se reproduce es la
 * **forma** del cable medido el 2026-09-23 —y sus defectos, que son lo que el
 * parser tiene que resistir—, con emisores, tickers e ISIN inventados. Los ISIN
 * tienen dígito verificador válido, porque el parser lo comprueba.
 */
export const FIXTURE_OBSERVED_AT = "2026-09-23T03:00:00.000Z";
const GRAPH_SINCE = "2026-09-05T00:00:00.000Z";

export const FIXTURE_CEDEAR_ISINS = Object.freeze({
  alpha: "ARFXCD000010",
  beta: "ARFXCD000028",
  gammaA: "ARFXCD000036",
  conflict: "ARFXCD000044",
  etf: "ARFXCD000051",
  corporate: "ARFXCD000069",
  malformedRatio: "ARFXCD000077",
  foreign: "ARFXCD000085",
  delta: "ARFXCV000018",
  cajaEtf: "ARFXCV000026",
  cajaForeign: "ARFXCV000034",
});

export const FIXTURE_UNDERLYING_ISINS = Object.freeze({
  alpha: "USFXA0000014",
  beta: "USFXB0000012",
  gammaA: "USFXCA000018",
  delta: "USFXD0000018",
});

const id = (suffix: string) =>
  `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

export const FIXTURE_UNDERLYING_IDS = Object.freeze({
  alphaEntity: id("a1"),
  alphaSecurity: id("a2"),
  alphaListing: id("a3"),
  betaEntity: id("b1"),
  betaSecurity: id("b2"),
  betaListing: id("b3"),
  gammaEntity: id("c1"),
  gammaClassA: id("c2"),
  gammaClassAListing: id("c3"),
  gammaClassB: id("c4"),
  gammaClassBListing: id("c5"),
  deltaEntity: id("d1"),
  deltaSecurity: id("d2"),
  deltaListing: id("d3"),
});

const HASH = "0".repeat(64);
const envelope = {
  validFrom: GRAPH_SINCE,
  validTo: null,
  availableAt: GRAPH_SINCE,
  supersededAt: null,
  sourceId: "datahub-sp500-pddl",
  sourceDocumentId: null,
  contentHash: HASH,
  recordedAt: GRAPH_SINCE,
} as const;

function underlying(
  entityId: string,
  name: string,
  listings: readonly {
    securityId: string;
    listingId: string;
    mic: string;
    symbol: string;
    shareClass: string | null;
  }[],
) {
  return {
    entity: {
      ...envelope,
      legalEntityId: entityId,
      legalName: name,
      entityType: "operating_company",
      jurisdiction: "US",
      status: "active",
    },
    securities: listings.map((listing) => ({
      ...envelope,
      securityId: listing.securityId,
      issuerLegalEntityId: entityId,
      securityType: "common_equity",
      shareClass: listing.shareClass,
      economicCurrency: "USD",
      status: "active",
    })),
    listings: listings.map((listing) => ({
      ...envelope,
      listingId: listing.listingId,
      securityId: listing.securityId,
      mic: listing.mic,
      quoteCurrency: "USD",
      country: "US",
      status: "active",
      primaryListing: true,
    })),
    symbols: listings.map((listing, index) => ({
      ...envelope,
      listingSymbolId: id(`${listing.listingId.slice(-2)}${index}f`),
      listingId: listing.listingId,
      symbol: listing.symbol,
      symbolType: "ticker",
    })),
  };
}

/**
 * Un grafo chico con los casos que el registro tiene que distinguir: una clase
 * de un emisor con dos clases (sólo la subyacente lleva programa), un listing
 * que cambió de venue y un emisor que sólo emite Caja de Valores.
 */
export function fixtureCedearGraph(): IdentityGraph {
  const U = FIXTURE_UNDERLYING_IDS;
  const parts = [
    underlying(U.alphaEntity, "Fixture Alpha Corp", [
      {
        securityId: U.alphaSecurity,
        listingId: U.alphaListing,
        mic: "XNYS",
        symbol: "FXA",
        shareClass: null,
      },
    ]),
    // Cotiza en Nasdaq; Comafi la declara en NYSE, como pasó con KMB.
    underlying(U.betaEntity, "Fixture Beta Inc", [
      {
        securityId: U.betaSecurity,
        listingId: U.betaListing,
        mic: "XNAS",
        symbol: "FXB",
        shareClass: null,
      },
    ]),
    underlying(U.gammaEntity, "Fixture Gamma Holdings", [
      {
        securityId: U.gammaClassA,
        listingId: U.gammaClassAListing,
        mic: "XNYS",
        symbol: "FXC-A",
        shareClass: "A",
      },
      {
        securityId: U.gammaClassB,
        listingId: U.gammaClassBListing,
        mic: "XNYS",
        symbol: "FXC-B",
        shareClass: "B",
      },
    ]),
    underlying(U.deltaEntity, "Fixture Delta Co", [
      {
        securityId: U.deltaSecurity,
        listingId: U.deltaListing,
        mic: "XNAS",
        symbol: "FXD",
        shareClass: null,
      },
    ]),
  ];

  return identityGraphSchema.parse({
    legalEntities: parts.map((part) => part.entity),
    securities: parts.flatMap((part) => part.securities),
    listings: parts.flatMap((part) => part.listings),
    listingSymbols: parts.flatMap((part) => part.symbols),
    depositaryPrograms: [],
    depositaryRatios: [],
    identifierAssignments: [],
  });
}

type ComafiRowInput = {
  readonly name: string;
  readonly isin: string;
  readonly underlyingIsin?: string;
  readonly ratio: string;
  readonly code?: string;
  readonly section?: string;
  readonly description: string;
};

function comafiRow(row: ComafiRowInput) {
  return {
    id: 1,
    link: "https://example.invalid/",
    name: row.name,
    description: row.description,
    summary: `${row.name} FIXTURE\n`,
    section: row.section ?? "Cedear Shares",
    tip: row.isin,
    keys: "Acción ordinaria, ",
    // El cable trae saltos de línea al final de varios campos.
    character: `${row.ratio}\n`,
    tech: `${row.underlyingIsin ?? ""}\n`,
    legal: "",
    price: "",
    code: row.code ?? "8001",
    categories: [{ category: "Estados Unidos", flag: "united-states.svg" }],
  };
}

/** Descripción en `<li>`, con los dos puntos a veces dentro del `<strong>`. */
function listDescription(fields: {
  readonly name: string;
  readonly market: string;
  readonly ticker: string;
  readonly observation: string;
}): string {
  return (
    "<ul>\n" +
    ` <li><strong>NOMBRE:</strong> ${fields.name}</li>\n` +
    " <li><strong>Industria o Sector</strong>: Technology</li>\n" +
    ` <li><strong>Mercado de valor subyacente</strong>: ${fields.market}</li>\n` +
    " <li><strong>Alcance P&uacute;blico Inversor:&nbsp;</strong>Calificado y no Calificado</li>\n" +
    // Una etiqueta partida en medio de la palabra, como la escribe el emisor.
    ` <li><strong>T</strong>i<strong>cker en mercado de origen:</strong> ${fields.ticker}</li>\n` +
    ` <li><strong>Observaciones Programa:</strong> ${fields.observation}</li>\n` +
    "</ul>\n"
  );
}

export function fixtureComafiProducts(
  overrides: {
    readonly alphaRatio?: string;
    readonly alphaObservation?: string;
    readonly omit?: readonly string[];
  } = {},
): unknown {
  const I = FIXTURE_CEDEAR_ISINS;
  const rows = [
    comafiRow({
      name: "FXA",
      isin: I.alpha,
      underlyingIsin: FIXTURE_UNDERLYING_ISINS.alpha,
      ratio: overrides.alphaRatio ?? "10:1",
      code: "8001",
      description: listDescription({
        name: "FIXTURE ALPHA CORP",
        market: "NYSE",
        ticker: "FXA",
        observation:
          overrides.alphaObservation ?? "Habilitado para emitir y cancelar",
      }),
    }),
    comafiRow({
      name: "FXB",
      isin: I.beta,
      underlyingIsin: FIXTURE_UNDERLYING_ISINS.beta,
      ratio: "144 : 1",
      code: "8002",
      // Descripción separada por `<br />`, no por `<li>`, y un mercado viejo.
      description:
        "NOMBRE: FIXTURE BETA INC&nbsp;<br />\nIndustria o Sector: Energy<br />\n" +
        "Mercado de valor subyacente: NYSE<br />\n" +
        "Alcance P&uacute;blico Inversor: Calificado y no Calificado<br />\n" +
        "Ticker en mercado de origen: FXB<br />\n" +
        "Observaciones Programa: Inhablitado para emitir",
    }),
    comafiRow({
      // Separador de clase de la fuente: `/`, no el `-` del grafo.
      name: "FXC/A",
      isin: I.gammaA,
      underlyingIsin: FIXTURE_UNDERLYING_ISINS.gammaA,
      ratio: "1 :4",
      code: "8003",
      description: listDescription({
        name: "FIXTURE GAMMA CL A",
        // La industria cargada en el campo de mercado.
        market: "Idustrial Gases",
        ticker: "FXC/A",
        observation: "Habilitado para emitir y cancelar",
      }),
    }),
    comafiRow({
      // El ticker principal no está en el grafo y la descripción declara otro
      // que sí: la fila se contradice.
      name: "FXZ",
      isin: I.conflict,
      ratio: "2:1",
      code: "8004",
      description: listDescription({
        name: "FIXTURE ZETA",
        market: "NYSE",
        ticker: "FXA",
        observation: "Habilitado para emitir y cancelar",
      }),
    }),
    comafiRow({
      name: "FXETF",
      isin: I.etf,
      ratio: "20:1",
      code: "8005",
      section: "Cedear ETF",
      description: listDescription({
        name: "FIXTURE ETF",
        market: "NYSE Arca",
        ticker: "FXETF",
        observation: "Habilitado para emitir y cancelar",
      }),
    }),
    comafiRow({
      name: "DFX3-XD001",
      isin: I.corporate,
      ratio: "1:1",
      code: "8006",
      section: "Cedear Corporate",
      description: "",
    }),
    comafiRow({
      name: "FXM",
      isin: I.malformedRatio,
      ratio: "3.1",
      code: "8007",
      description: listDescription({
        name: "FIXTURE MALFORMED",
        market: "NYSE",
        ticker: "FXM",
        observation: "Habilitado para emitir y cancelar",
      }),
    }),
    comafiRow({
      // Un ticker de B3 que coincide con uno del grafo: colisión, no identidad.
      name: "FXD",
      isin: I.foreign,
      ratio: "1:1",
      code: "8008",
      description: listDescription({
        name: "FIXTURE BRASIL SA",
        market: "B3",
        ticker: "FXD",
        observation: "Habilitado para emitir y cancelar",
      }),
    }),
    comafiRow({
      name: "FXW",
      isin: "",
      ratio: "",
      code: "",
      description: listDescription({
        name: "FIXTURE SIN ISIN",
        market: "NYSE",
        ticker: "MS",
        observation: "Habilitado para emitir y cancelar",
      }),
    }),
  ];
  const omit = new Set(overrides.omit ?? []);

  return {
    products: rows.filter((row) => !omit.has(row.tip)),
    t: 1,
  };
}

function cajaRow(cells: readonly string[]): string {
  const [name, ...rest] = cells;

  return (
    "\n\t\t\t\t<tr>\n" +
    `\t\t\t\t\t<th class="text-left"><a href="https://example.invalid/" target="_blank">${name}</a></th>\n` +
    rest
      .map((cell) => `\t\t\t\t\t<td class="text-center">${cell}</td>\n`)
      .join("") +
    "\t\t\t\t</tr>\n"
  );
}

function cajaTable(kind: "ETF" | "Acciones", rows: readonly string[]): string {
  const underlying = kind === "ETF" ? "ETF" : "Acción";

  return (
    '<table class="table  table-sm aranceles-table tabla-cedears">\n<thead>\n<tr class="color2">\n' +
    `<th scope="col" class="text-left">CEDEAR de ${kind}</th>\n` +
    '<th scope="col" class="text-center">Símbolo BYMA</th>\n' +
    '<th scope="col" class="text-center">Ticker en Mercado<br>de Origen</th>\n' +
    '<th scope="col" class="text-center">Código Caja de<br>Valores Cedear</th>\n' +
    '<th scope="col" class="text-center">ISIN Cedear</th>\n' +
    `<th scope="col" class="text-center">Código Caja de<br>Valores ${underlying}</th>\n` +
    `<th scope="col" class="text-center">ISIN ${underlying}</th>\n` +
    '<th scope="col" class="text-center">Mercado de<br>Origen</th>\n' +
    '<th scope="col" class="text-center">Ratio CEDEARs /<br>valor subyacente</th>\n' +
    '<th scope="col" class="text-center">Monto máximo</th>\n' +
    '<th scope="col" class="text-center">Alcance Público<br>Inversor</th>\n' +
    "</tr>\n</thead>\n<tbody>\n" +
    rows.join("") +
    "</tbody>\n</table>\n"
  );
}

export function fixtureCajaValoresHtml(
  options: { readonly shiftColumns?: boolean } = {},
): string {
  const I = FIXTURE_CEDEAR_ISINS;
  const etf = cajaTable("ETF", [
    cajaRow([
      "FIXTURE S&amp;P ETF",
      "FXSPY",
      "FXSPY",
      "8601",
      I.cajaEtf,
      "9001",
      "USFXSPY00004",
      "NYSE ARCA",
      "60:1",
      "600.000.000",
      "Calificado y<br>No Calificado",
    ]),
  ]);
  const shares = cajaTable("Acciones", [
    cajaRow([
      "FIXTURE DELTA CO",
      "FXD",
      "FXD",
      "8602",
      I.delta,
      "9002",
      FIXTURE_UNDERLYING_ISINS.delta,
      "NASDAQ GS",
      "5:1",
      "10.000.000",
      "Calificado y<br>No Calificado",
    ]),
    cajaRow([
      "FIXTURE BRASIL ON",
      "FXB3",
      "FXB3",
      "8603",
      I.cajaForeign,
      "9003",
      "BRFXB3ACNOR0",
      "B3",
      "1:1",
      "10.000.000",
      "Calificado y<br>No Calificado",
    ]),
  ]);
  const page = `<html><body><section>${etf}${shares}</section></body></html>`;

  // Una columna agregada antes del ratio: el parser tiene que negarse entero.
  return options.shiftColumns
    ? page.replace(
        '<th scope="col" class="text-center">Mercado de<br>Origen</th>',
        '<th scope="col" class="text-center">Moneda</th>\n<th scope="col" class="text-center">Mercado de<br>Origen</th>',
      )
    : page;
}
