import type { ParcelVersion } from "../domain/parcel";

/**
 * Avisos y parcelas **sintéticos** de Córdoba Capital (ADR 0089, §14 del
 * modelo): ninguna dirección, agencia, foto ni nomenclatura es real. Cubren
 * los bordes que los slices siguientes necesitan probar sin red:
 *
 * - la misma casa publicada por tres agencias en tres portales;
 * - una republicación: el aviso se da de baja y vuelve con otro ID;
 * - una parcela que se subdivide;
 * - un pin compartido por avisos de casas distintas (el centro del barrio);
 * - un departamento que baja de precio dos veces y se vuelve a ver igual;
 * - «consultar precio», un precio en ARS y un aviso sin superficie.
 *
 * Las capturas son entradas crudas (`unknown` para el contrato): un test las
 * pasa por `listing-capture-1.0.0` como pasaría una captura real.
 */
type RawCapture = Record<string, unknown>;

function capture(overrides: RawCapture): RawCapture {
  return {
    source: "remax-ar",
    externalId: "SYN-0000",
    canonicalUrl: "https://www.remax.com.ar/listings/sintetica-0000",
    pageKind: "listing_detail",
    parseBasis: "json_ld",
    operation: "sale",
    propertyType: "house",
    priceAmount: "100000",
    priceStatus: "published",
    priceCurrency: "USD",
    expensesAmount: null,
    expensesCurrency: null,
    coveredAreaM2: null,
    totalAreaM2: null,
    landAreaM2: null,
    rooms: null,
    bedrooms: null,
    bathrooms: null,
    parkingSpaces: null,
    ageYears: null,
    floor: null,
    amenities: [],
    condition: "unknown",
    legalFlags: [],
    addressDeclared: null,
    neighborhood: null,
    latitude: null,
    longitude: null,
    agency: null,
    publishedAt: null,
    descriptionSimhash: null,
    photoDhashes: [],
    photoCount: 0,
    capturedAt: "2026-11-01T15:00:00.000Z",
    ...overrides,
  };
}

/**
 * La misma casa de Barrio Sintético Norte, tres agencias y tres portales. Las
 * fotos son las mismas con un bit de diferencia en algún dHash (cada portal
 * recomprime), la descripción la reescribió cada agencia y la dirección está
 * escrita de tres maneras.
 */
export const SAME_HOUSE_THREE_AGENCIES = {
  /** La clave que la deduplicación de `F13-05` tendría que reunir. */
  expectedPropertyKey: "syn-house-norte-1234",
  captures: [
    capture({
      source: "remax-ar",
      externalId: "SYN-RMX-1001",
      canonicalUrl:
        "https://www.remax.com.ar/listings/casa-sintetica-norte-1234",
      priceAmount: "185000",
      coveredAreaM2: "180",
      totalAreaM2: "210",
      landAreaM2: "300",
      rooms: 5,
      bedrooms: 3,
      bathrooms: 2,
      parkingSpaces: 1,
      ageYears: 35,
      amenities: ["grill", "garden"],
      condition: "to_renovate",
      legalFlags: ["deed"],
      addressDeclared: "Av. Sintética 1234",
      neighborhood: "Barrio Sintético Norte",
      latitude: "-31.3801234",
      longitude: "-64.2101234",
      agency: "Inmobiliaria Sintética Uno",
      descriptionSimhash: "9f3a5c7e1b2d4f60",
      photoDhashes: [
        "f0e1d2c3b4a59687",
        "0123456789abcdef",
        "fedcba9876543210",
        "a5a5a5a5a5a5a5a5",
        "3c3c3c3c3c3c3c3c",
      ],
      photoCount: 18,
      capturedAt: "2026-11-01T15:00:00.000Z",
    }),
    capture({
      source: "zonaprop",
      externalId: "SYN-ZP-55001",
      canonicalUrl:
        "https://www.zonaprop.com.ar/propiedades/casa-sintetica-norte-55001.html",
      parseBasis: "embedded_state",
      priceAmount: "189000",
      coveredAreaM2: "182",
      totalAreaM2: "212",
      landAreaM2: "300",
      rooms: 5,
      bedrooms: 3,
      bathrooms: 2,
      parkingSpaces: 1,
      amenities: ["garden", "grill"],
      condition: "to_renovate",
      legalFlags: ["deed"],
      addressDeclared: "Avenida Sintetica 1234",
      neighborhood: "B° Sintético Norte",
      agency: "Sintética Dos Propiedades",
      descriptionSimhash: "9f3a5c7e1b2d4f62",
      photoDhashes: [
        "f0e1d2c3b4a59686",
        "0123456789abcdef",
        "fedcba9876543211",
      ],
      photoCount: 12,
      capturedAt: "2026-11-02T16:30:00.000Z",
    }),
    capture({
      source: "argenprop",
      externalId: "SYN-AP-777001",
      canonicalUrl: "https://www.argenprop.com/casa-en-venta-sintetica-777001",
      parseBasis: "dom",
      priceAmount: "179000",
      coveredAreaM2: "180",
      totalAreaM2: "210",
      rooms: 5,
      bedrooms: 3,
      bathrooms: 2,
      condition: "unknown",
      addressDeclared: "Sintética 1234",
      neighborhood: "Sintético Norte",
      agency: "Grupo Sintético Tres",
      descriptionSimhash: "9f3a5c7e1b2d4e60",
      photoDhashes: ["f0e1d2c3b4a59687", "0123456789abcdee"],
      photoCount: 9,
      capturedAt: "2026-11-03T12:10:00.000Z",
    }),
  ],
} as const;

/**
 * Una republicación: el aviso se da de baja («finalizado» en la ficha) y la
 * misma casa vuelve once días después con otro ID y el precio más bajo.
 */
export const REPUBLICATION = {
  expectedPropertyKey: "syn-house-sur-880",
  original: capture({
    source: "remax-ar",
    externalId: "SYN-RMX-2001",
    canonicalUrl: "https://www.remax.com.ar/listings/casa-sintetica-sur-880",
    priceAmount: "120000",
    coveredAreaM2: "140",
    totalAreaM2: "250",
    landAreaM2: "250",
    rooms: 4,
    bedrooms: 2,
    bathrooms: 1,
    condition: "good",
    addressDeclared: "Calle Sintética Sur 880",
    neighborhood: "Barrio Sintético Sur",
    agency: "Inmobiliaria Sintética Uno",
    descriptionSimhash: "1111222233334444",
    photoDhashes: ["aaaabbbbccccdddd", "1234123412341234"],
    photoCount: 10,
    capturedAt: "2026-10-01T14:00:00.000Z",
  }),
  removedAt: "2026-10-20T14:00:00.000Z",
  relisted: capture({
    source: "remax-ar",
    externalId: "SYN-RMX-2077",
    canonicalUrl:
      "https://www.remax.com.ar/listings/casa-sintetica-sur-880-oportunidad",
    priceAmount: "112000",
    coveredAreaM2: "140",
    totalAreaM2: "250",
    landAreaM2: "250",
    rooms: 4,
    bedrooms: 2,
    bathrooms: 1,
    condition: "good",
    addressDeclared: "Calle Sintética Sur 880",
    neighborhood: "Barrio Sintético Sur",
    agency: "Inmobiliaria Sintética Uno",
    descriptionSimhash: "1111222233334445",
    photoDhashes: ["aaaabbbbccccdddd", "1234123412341234"],
    photoCount: 10,
    capturedAt: "2026-10-31T14:00:00.000Z",
  }),
} as const;

/**
 * Un departamento que baja de precio dos veces —una de ellas vista en la
 * tarjeta de búsqueda— y después se vuelve a ver igual: tres revisiones y un
 * `lastSeenAt` que avanza solo.
 */
export const PRICE_CUTS_TWICE = {
  captures: [
    capture({
      source: "zonaprop",
      externalId: "SYN-ZP-90210",
      canonicalUrl:
        "https://www.zonaprop.com.ar/propiedades/depto-sintetico-centro-90210.html",
      parseBasis: "embedded_state",
      propertyType: "apartment",
      priceAmount: "120000",
      expensesAmount: "85000",
      expensesCurrency: "ARS",
      coveredAreaM2: "72.5",
      totalAreaM2: "78",
      rooms: 3,
      bedrooms: 2,
      bathrooms: 1,
      ageYears: 12,
      floor: 6,
      amenities: ["elevator", "balcony", "sum"],
      condition: "good",
      legalFlags: ["credit_eligible", "deed"],
      addressDeclared: "Bv. Sintético 455",
      neighborhood: "Centro Sintético",
      agency: "Sintética Dos Propiedades",
      publishedAt: "2026-09-15",
      descriptionSimhash: "abcdefabcdef0123",
      photoDhashes: ["0f0f0f0f0f0f0f0f", "f0f0f0f0f0f0f0f0"],
      photoCount: 14,
      capturedAt: "2026-09-20T13:00:00.000Z",
    }),
    capture({
      source: "zonaprop",
      externalId: "SYN-ZP-90210",
      canonicalUrl:
        "https://www.zonaprop.com.ar/propiedades/depto-sintetico-centro-90210.html",
      pageKind: "search_result",
      parseBasis: "embedded_state",
      propertyType: "apartment",
      priceAmount: "115000",
      // La tarjeta redondea la superficie y no lista amenities: no reescribe la ficha.
      coveredAreaM2: "72",
      rooms: 3,
      addressDeclared: "Bv. Sintético 455",
      neighborhood: "Centro Sintético",
      photoDhashes: ["0f0f0f0f0f0f0f0f"],
      photoCount: 14,
      capturedAt: "2026-10-12T13:00:00.000Z",
    }),
    capture({
      source: "zonaprop",
      externalId: "SYN-ZP-90210",
      canonicalUrl:
        "https://www.zonaprop.com.ar/propiedades/depto-sintetico-centro-90210.html",
      parseBasis: "embedded_state",
      propertyType: "apartment",
      priceAmount: "109000",
      expensesAmount: "85000",
      expensesCurrency: "ARS",
      coveredAreaM2: "72.5",
      totalAreaM2: "78",
      rooms: 3,
      bedrooms: 2,
      bathrooms: 1,
      ageYears: 12,
      floor: 6,
      amenities: ["sum", "balcony", "elevator"],
      condition: "good",
      legalFlags: ["deed", "credit_eligible"],
      addressDeclared: "Bv. Sintético 455",
      neighborhood: "Centro Sintético",
      agency: "Sintética Dos Propiedades",
      publishedAt: "2026-09-15",
      descriptionSimhash: "abcdefabcdef0123",
      photoDhashes: ["0f0f0f0f0f0f0f0f", "f0f0f0f0f0f0f0f0"],
      photoCount: 14,
      capturedAt: "2026-11-05T13:00:00.000Z",
    }),
  ],
  /** Igual a la tercera, con los conjuntos en otro orden: no es una revisión. */
  seenAgain: capture({
    source: "zonaprop",
    externalId: "SYN-ZP-90210",
    canonicalUrl:
      "https://www.zonaprop.com.ar/propiedades/depto-sintetico-centro-90210.html",
    parseBasis: "embedded_state",
    propertyType: "apartment",
    priceAmount: "109000",
    expensesAmount: "85000",
    expensesCurrency: "ARS",
    coveredAreaM2: "72.5",
    totalAreaM2: "78",
    rooms: 3,
    bedrooms: 2,
    bathrooms: 1,
    ageYears: 12,
    floor: 6,
    amenities: ["balcony", "elevator", "sum"],
    condition: "good",
    legalFlags: ["credit_eligible", "deed"],
    addressDeclared: "Bv. Sintético 455",
    neighborhood: "Centro Sintético",
    agency: "Sintética Dos Propiedades",
    publishedAt: "2026-09-15",
    descriptionSimhash: "abcdefabcdef0123",
    photoDhashes: ["0f0f0f0f0f0f0f0f", "f0f0f0f0f0f0f0f0"],
    photoCount: 14,
    capturedAt: "2026-11-20T13:00:00.000Z",
  }),
} as const;

/** El centro de Barrio Sintético Oeste: tres casas distintas con el mismo pin. */
export const SHARED_PIN = {
  latitude: "-31.4200001",
  longitude: "-64.2300001",
  captures: [
    capture({
      source: "argenprop",
      externalId: "SYN-AP-300001",
      canonicalUrl: "https://www.argenprop.com/casa-sintetica-oeste-300001",
      parseBasis: "dom",
      priceAmount: "95000",
      totalAreaM2: "200",
      addressDeclared: "Calle Oeste Sintética 10",
      neighborhood: "Barrio Sintético Oeste",
      latitude: "-31.4200001",
      longitude: "-64.2300001",
      capturedAt: "2026-11-04T10:00:00.000Z",
    }),
    capture({
      source: "argenprop",
      externalId: "SYN-AP-300002",
      canonicalUrl: "https://www.argenprop.com/casa-sintetica-oeste-300002",
      parseBasis: "dom",
      priceAmount: "130000",
      totalAreaM2: "320",
      addressDeclared: "Pasaje Sintético 2200",
      neighborhood: "Barrio Sintético Oeste",
      latitude: "-31.4200001",
      longitude: "-64.2300001",
      capturedAt: "2026-11-04T10:05:00.000Z",
    }),
    capture({
      source: "mercadolibre-inmuebles",
      externalId: "MLA-SYN-4000001",
      canonicalUrl:
        "https://casa.mercadolibre.com.ar/MLA-SYN-4000001-casa-sintetica-oeste",
      parseBasis: "json_ld",
      // «Consultar precio»: un estado, no un cero.
      priceAmount: null,
      priceStatus: "on_request",
      priceCurrency: null,
      addressDeclared: "Barrio Sintético Oeste",
      neighborhood: "Barrio Sintético Oeste",
      latitude: "-31.4200001",
      longitude: "-64.2300001",
      capturedAt: "2026-11-04T10:12:00.000Z",
    }),
  ],
} as const;

/** Un terreno en pesos que no publica superficie. */
export const LAND_IN_PESOS_WITHOUT_AREA = capture({
  source: "mercadolibre-inmuebles",
  externalId: "MLA-SYN-5000001",
  canonicalUrl:
    "https://terreno.mercadolibre.com.ar/MLA-SYN-5000001-lote-sintetico",
  propertyType: "land",
  priceAmount: "48000000",
  priceCurrency: "ARS",
  addressDeclared: "Lote sobre Calle Sintética 3100",
  neighborhood: "Barrio Sintético Este",
  capturedAt: "2026-11-06T18:00:00.000Z",
});

/**
 * Una parcela sintética de 600 m² que se subdivide el 2026-03-01 en dos lotes
 * que ceden diez metros a la vereda. La subdivisión se lee el 2026-04-10.
 */
export const SUBDIVIDED_PARCEL = {
  parcel: {
    parcelId: "00000000-0000-4000-8000-0000000000a1",
    version: 1,
    nomenclature: {
      provincial: "11-01-01-99-99-001-001",
      municipal: "99-99-001-001",
    },
    landAreaM2: "600",
    validFrom: "2001-01-01",
    validTo: null,
    endedBy: null,
    closedObservedAt: null,
    sourceId: "synthetic-cadastre",
    observedAt: "2026-01-15T12:00:00.000Z",
  } satisfies ParcelVersion,
  successors: [
    {
      parcelId: "00000000-0000-4000-8000-0000000000a2",
      nomenclature: {
        provincial: "11-01-01-99-99-001-002",
        municipal: "99-99-001-002",
      },
      landAreaM2: "300",
    },
    {
      parcelId: "00000000-0000-4000-8000-0000000000a3",
      nomenclature: {
        provincial: "11-01-01-99-99-001-003",
        municipal: "99-99-001-003",
      },
      landAreaM2: "290",
    },
  ],
  effectiveOn: "2026-03-01",
  observedAt: "2026-04-10T12:00:00.000Z",
} as const;
