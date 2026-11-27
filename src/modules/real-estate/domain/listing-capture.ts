import { z } from "zod";

/**
 * Lo que la extensión manda por cada aviso que vio (ADR 0089, Decisión 2;
 * `docs/real-estate/market-model.md` §3). Es un contrato **cerrado**: un campo
 * de más, un precio en cero o un enum fuera del conjunto rechazan la captura
 * entera, porque un parser que empieza a mandar otra cosa es un parser roto y
 * tiene que fallar por nombre, no publicar a medias (`TM-05`).
 *
 * Los nombres van en camelCase como el resto del código; cada uno es el campo
 * del mismo nombre en snake_case del modelo.
 *
 * Lo que **no** viaja: el texto de la descripción, las URLs de las fotos, el
 * teléfono, el correo, cookies ni encabezados. De la descripción viaja su
 * SimHash; de las fotos, sus dHash; de los rasgos que se leen en el texto
 * («a reciclar», «apto crédito»), el enum que extrae `listing-features-1.0.0`
 * en el navegador.
 */
export const LISTING_CAPTURE_VERSION = "listing-capture-1.0.0";

/**
 * Los portales declarados. El ID es el de la fila del registro de fuentes que
 * cada slice agrega al medir el portal (`F13-02`, `F13-04`); el sufijo de host
 * es lo único que una `canonicalUrl` de ese portal puede nombrar.
 */
export const REAL_ESTATE_PORTALS = [
  { sourceId: "remax-ar", hostSuffix: "remax.com.ar" },
  { sourceId: "zonaprop", hostSuffix: "zonaprop.com.ar" },
  { sourceId: "argenprop", hostSuffix: "argenprop.com" },
  { sourceId: "mercadolibre-inmuebles", hostSuffix: "mercadolibre.com.ar" },
] as const;

export type RealEstatePortal = (typeof REAL_ESTATE_PORTALS)[number]["sourceId"];

const PORTAL_IDS = REAL_ESTATE_PORTALS.map((portal) => portal.sourceId) as [
  RealEstatePortal,
  ...RealEstatePortal[],
];

export const PAGE_KINDS = ["listing_detail", "search_result"] as const;
export const PARSE_BASES = ["json_ld", "embedded_state", "dom"] as const;
export const OPERATIONS = ["sale", "rent"] as const;
export const PROPERTY_TYPES = [
  "house",
  "apartment",
  "ph",
  "land",
  "parking",
  "office",
  "retail",
] as const;
export const PRICE_STATUSES = ["published", "on_request"] as const;
export const LISTING_CURRENCIES = ["USD", "ARS"] as const;
export const AMENITIES = [
  "pool",
  "gym",
  "sum",
  "security",
  "grill",
  "elevator",
  "balcony",
  "garden",
] as const;
export const CONDITIONS = ["new", "good", "to_renovate", "unknown"] as const;
export const LEGAL_FLAGS = [
  "credit_eligible",
  "deed",
  "boleto_only",
  "succession",
  "possession",
] as const;

export type PageKind = (typeof PAGE_KINDS)[number];
export type ParseBasis = (typeof PARSE_BASES)[number];
export type Operation = (typeof OPERATIONS)[number];
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export type PriceStatus = (typeof PRICE_STATUSES)[number];
export type ListingCurrency = (typeof LISTING_CURRENCIES)[number];
export type Amenity = (typeof AMENITIES)[number];
export type Condition = (typeof CONDITIONS)[number];
export type LegalFlag = (typeof LEGAL_FLAGS)[number];

/**
 * Un decimal positivo en su forma canónica: sin signo, sin ceros a la
 * izquierda ni a la derecha, con punto. «85,50» no entra: la extensión
 * normaliza y el hash del contenido nunca depende de cómo se escribió el
 * número. Un cero o un negativo no son un precio ni una superficie: el portal
 * que no la publica manda `null`.
 */
function positiveDecimal(maxIntegerDigits: number, maxFractionDigits: number) {
  const pattern = new RegExp(
    `^(?:0|[1-9][0-9]{0,${maxIntegerDigits - 1}})(?:\\.[0-9]{0,${maxFractionDigits - 1}}[1-9])?$`,
    "u",
  );
  return z
    .string()
    .regex(pattern, "not_a_canonical_positive_decimal")
    .refine((value) => /[1-9]/u.test(value), "not_positive");
}

/** Una coordenada en grados decimales, canónica como los montos. */
function coordinate(limit: number) {
  return z
    .string()
    .regex(
      /^-?(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{0,6}[1-9])?$/u,
      "not_a_canonical_coordinate",
    )
    .refine((value) => value !== "-0", "negative_zero")
    .refine((value) => Math.abs(Number(value)) <= limit, "out_of_range");
}

/** Texto tal como lo publica el portal: sin controles ni espacios en los bordes. */
function publishedText(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .regex(/^[^\p{Cc}]+$/u, "control_character")
    .refine((value) => value.trim() === value, "untrimmed");
}

function count(min: number, max: number) {
  return z.number().int().min(min).max(max);
}

/** Un conjunto cerrado viaja como lista sin repetidos; el orden no importa. */
function closedSet<const T extends readonly [string, ...string[]]>(
  values: T,
  max: number,
) {
  return z
    .array(z.enum(values))
    .max(max)
    .refine((items) => new Set(items).size === items.length, "repeated_value");
}

/** 64 bits en hex minúscula: un SimHash o un dHash. */
const hash64Schema = z.string().regex(/^[0-9a-f]{16}$/u, "not_a_64_bit_hash");

const externalIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u, "not_an_external_id");

export const listingCaptureSchema = z
  .strictObject({
    source: z.enum(PORTAL_IDS),
    externalId: externalIdSchema,
    canonicalUrl: z.url({ protocol: /^https$/u }).max(512),
    pageKind: z.enum(PAGE_KINDS),
    parseBasis: z.enum(PARSE_BASES),
    operation: z.enum(OPERATIONS),
    propertyType: z.enum(PROPERTY_TYPES),
    priceAmount: positiveDecimal(12, 2).nullable(),
    priceStatus: z.enum(PRICE_STATUSES),
    priceCurrency: z.enum(LISTING_CURRENCIES).nullable(),
    expensesAmount: positiveDecimal(12, 2).nullable(),
    expensesCurrency: z.enum(LISTING_CURRENCIES).nullable(),
    coveredAreaM2: positiveDecimal(7, 2).nullable(),
    totalAreaM2: positiveDecimal(7, 2).nullable(),
    landAreaM2: positiveDecimal(7, 2).nullable(),
    rooms: count(1, 99).nullable(),
    bedrooms: count(0, 99).nullable(),
    bathrooms: count(0, 99).nullable(),
    parkingSpaces: count(0, 999).nullable(),
    ageYears: count(0, 300).nullable(),
    floor: count(-5, 200).nullable(),
    amenities: closedSet(AMENITIES, AMENITIES.length),
    condition: z.enum(CONDITIONS),
    legalFlags: closedSet(LEGAL_FLAGS, LEGAL_FLAGS.length),
    addressDeclared: publishedText(300).nullable(),
    neighborhood: publishedText(120).nullable(),
    latitude: coordinate(90).nullable(),
    longitude: coordinate(180).nullable(),
    agency: publishedText(200).nullable(),
    publishedAt: z.iso.date().nullable(),
    descriptionSimhash: hash64Schema.nullable(),
    photoDhashes: z.array(hash64Schema).max(5),
    photoCount: count(0, 999),
    capturedAt: z.iso.datetime(),
  })
  .superRefine((capture, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });

    // «Consultar precio» es un estado, no un precio en cero.
    if (capture.priceStatus === "published") {
      if (capture.priceAmount === null) issue("priceAmount", "price_missing");
      if (capture.priceCurrency === null)
        issue("priceCurrency", "currency_missing");
    } else {
      if (capture.priceAmount !== null)
        issue("priceAmount", "price_with_on_request");
      if (capture.priceCurrency !== null)
        issue("priceCurrency", "currency_with_on_request");
    }
    if (
      (capture.expensesAmount === null) !==
      (capture.expensesCurrency === null)
    )
      issue("expensesCurrency", "expenses_amount_and_currency_together");
    if ((capture.latitude === null) !== (capture.longitude === null))
      issue("longitude", "coordinates_together");
    if (capture.photoCount < capture.photoDhashes.length)
      issue("photoCount", "fewer_photos_than_hashes");

    const portal = REAL_ESTATE_PORTALS.find(
      (candidate) => candidate.sourceId === capture.source,
    );
    const url = URL.canParse(capture.canonicalUrl)
      ? new URL(capture.canonicalUrl)
      : null;
    if (url !== null && portal !== undefined) {
      const host = url.hostname;
      if (host !== portal.hostSuffix && !host.endsWith(`.${portal.hostSuffix}`))
        issue("canonicalUrl", "host_outside_portal");
      // Canónica: sin parámetros de seguimiento, fragmento ni credenciales.
      if (url.search !== "" || capture.canonicalUrl.includes("?"))
        issue("canonicalUrl", "query_in_canonical_url");
      if (url.hash !== "" || capture.canonicalUrl.includes("#"))
        issue("canonicalUrl", "fragment_in_canonical_url");
      if (url.username !== "" || url.password !== "")
        issue("canonicalUrl", "credentials_in_url");
    }

    // Un portal no fecha en el futuro lo que ya vimos publicado.
    if (
      capture.publishedAt !== null &&
      capture.publishedAt > capture.capturedAt.slice(0, 10)
    )
      issue("publishedAt", "published_after_capture");
  });

export type ListingCapture = z.infer<typeof listingCaptureSchema>;

export type ListingCaptureRejection = {
  readonly code: "listing_capture_invalid";
  /** Ruta y motivo de cada problema; nunca el valor recibido. */
  readonly issues: readonly string[];
};

/**
 * Valida una captura sin lanzar: lo que vuelve rechazado nombra el campo y el
 * motivo, nunca el valor, porque el valor puede ser justo lo que no debía
 * viajar (un teléfono en la dirección, por ejemplo).
 */
export function parseListingCapture(
  input: unknown,
):
  | { readonly ok: true; readonly capture: ListingCapture }
  | { readonly ok: false; readonly rejection: ListingCaptureRejection } {
  const result = listingCaptureSchema.safeParse(input);
  if (result.success) return { ok: true, capture: result.data };
  return {
    ok: false,
    rejection: {
      code: "listing_capture_invalid",
      issues: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "$"}:${issue.message}`,
      ),
    },
  };
}
