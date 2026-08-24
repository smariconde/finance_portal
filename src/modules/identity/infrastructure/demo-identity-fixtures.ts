import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { DEMO_SOURCE_ID } from "@/modules/ingestion/infrastructure/demo-ingestion-fixtures";

import {
  identityGraphSchema,
  normalizeIdentifierValue,
  type IdentityGraph,
} from "../domain/identity-graph";

/**
 * Grafo de identidad sintético del modo demo.
 *
 * Describe a `FixtureCo`, una empresa inexistente, con los cuatro niveles del
 * modelo separados y un programa depositario que nunca colapsa el CEDEAR con su
 * subyacente. Cubre los casos golden que exige `F1-04`:
 *
 * - ticker ambiguo: `FIXA` sin MIC alcanza el listing de XNAS y el de XBUE;
 * - ticker reutilizado: XNAS reasigna `FIXA` a otro emisor en 2025;
 * - cambio de vigencia: `FIXA` pasa a `FXCO` anunciado el 2024-05-10 y efectivo
 *   el 2024-06-01;
 * - ratio depositario anunciado el 2024-07-15 y efectivo el 2024-09-01.
 *
 * No deriva de ningún payload live. Cambiar un registro obliga a subir
 * `DEMO_IDENTITY_FIXTURE_VERSION`.
 */
export const DEMO_IDENTITY_FIXTURE_VERSION = "2026-08-23.1";

const ID_PREFIX = "0a1b7c40-3f21-4d8e-9a01-";

function internalId(suffix: string): string {
  return `${ID_PREFIX}${suffix.padStart(12, "0")}`;
}

export const DEMO_IDENTITY_IDS = Object.freeze({
  fixtureCoEntity: internalId("1"),
  depositaryEntity: internalId("2"),
  andesEntity: internalId("3"),
  fixtureCoClassA: internalId("11"),
  fixtureCoCedear: internalId("12"),
  andesCommon: internalId("13"),
  fixtureCoXnasListing: internalId("21"),
  fixtureCoXbueListing: internalId("22"),
  andesXnasListing: internalId("23"),
  cedearProgram: internalId("41"),
});

/** Clave con la que la fuente sintética nombra al sujeto de sus observaciones. */
export const DEMO_SUBJECT_KEY = "fixtureco";
export const DEMO_IDENTIFIER_SCOPE = `source:${DEMO_SOURCE_ID}`;

const IDENTITY_DOCUMENT = "fixtureco-identity-register";
const RECORDED_AT = "2026-08-23T00:00:00.000Z";

type VersionFields = Record<string, unknown>;

/**
 * El hash se calcula sobre el contenido declarado, no se inventa: una fixture
 * con hash inventado no probaría la idempotencia que el contrato exige.
 */
function withHash<TFields extends VersionFields>(
  fields: TFields,
): TFields & { contentHash: string } {
  return { ...fields, contentHash: computeContentHash(fields) };
}

const provenance = {
  sourceId: DEMO_SOURCE_ID,
  sourceDocumentId: IDENTITY_DOCUMENT,
  recordedAt: RECORDED_AT,
} as const;

const open = {
  validTo: null,
  supersededAt: null,
} as const;

export const DEMO_IDENTITY_GRAPH: IdentityGraph = identityGraphSchema.parse({
  legalEntities: [
    withHash({
      ...provenance,
      ...open,
      legalEntityId: DEMO_IDENTITY_IDS.fixtureCoEntity,
      legalName: "FixtureCo Global Inc.",
      entityType: "operating_company",
      jurisdiction: "US",
      status: "active",
      validFrom: "2010-01-01T00:00:00.000Z",
      availableAt: "2010-01-01T00:00:00.000Z",
    }),
    withHash({
      ...provenance,
      ...open,
      legalEntityId: DEMO_IDENTITY_IDS.depositaryEntity,
      legalName: "Depositario Local S.A.",
      entityType: "depositary",
      jurisdiction: "AR",
      status: "active",
      validFrom: "2015-01-01T00:00:00.000Z",
      availableAt: "2015-01-01T00:00:00.000Z",
    }),
    withHash({
      ...provenance,
      ...open,
      legalEntityId: DEMO_IDENTITY_IDS.andesEntity,
      legalName: "Fixture Andes Corp.",
      entityType: "operating_company",
      jurisdiction: "US",
      status: "active",
      validFrom: "2024-01-01T00:00:00.000Z",
      availableAt: "2024-01-01T00:00:00.000Z",
    }),
  ],
  securities: [
    withHash({
      ...provenance,
      ...open,
      securityId: DEMO_IDENTITY_IDS.fixtureCoClassA,
      issuerLegalEntityId: DEMO_IDENTITY_IDS.fixtureCoEntity,
      securityType: "common_equity",
      shareClass: "A",
      economicCurrency: "USD",
      status: "active",
      validFrom: "2010-01-01T00:00:00.000Z",
      availableAt: "2010-01-01T00:00:00.000Z",
    }),
    withHash({
      ...provenance,
      ...open,
      // El CEDEAR es otro instrumento, con su propio emisor y moneda.
      securityId: DEMO_IDENTITY_IDS.fixtureCoCedear,
      issuerLegalEntityId: DEMO_IDENTITY_IDS.depositaryEntity,
      securityType: "depositary_receipt",
      shareClass: null,
      economicCurrency: "ARS",
      status: "active",
      validFrom: "2021-03-01T00:00:00.000Z",
      availableAt: "2021-03-01T00:00:00.000Z",
    }),
    withHash({
      ...provenance,
      ...open,
      securityId: DEMO_IDENTITY_IDS.andesCommon,
      issuerLegalEntityId: DEMO_IDENTITY_IDS.andesEntity,
      securityType: "common_equity",
      shareClass: null,
      economicCurrency: "USD",
      status: "active",
      validFrom: "2024-01-01T00:00:00.000Z",
      availableAt: "2024-01-01T00:00:00.000Z",
    }),
  ],
  listings: [
    withHash({
      ...provenance,
      ...open,
      listingId: DEMO_IDENTITY_IDS.fixtureCoXnasListing,
      securityId: DEMO_IDENTITY_IDS.fixtureCoClassA,
      mic: "XNAS",
      quoteCurrency: "USD",
      country: "US",
      status: "active",
      primaryListing: true,
      validFrom: "2020-01-01T00:00:00.000Z",
      availableAt: "2020-01-01T00:00:00.000Z",
    }),
    withHash({
      ...provenance,
      ...open,
      listingId: DEMO_IDENTITY_IDS.fixtureCoXbueListing,
      securityId: DEMO_IDENTITY_IDS.fixtureCoCedear,
      mic: "XBUE",
      quoteCurrency: "ARS",
      country: "AR",
      status: "active",
      primaryListing: true,
      validFrom: "2021-03-01T00:00:00.000Z",
      availableAt: "2021-03-01T00:00:00.000Z",
    }),
    withHash({
      ...provenance,
      ...open,
      listingId: DEMO_IDENTITY_IDS.andesXnasListing,
      securityId: DEMO_IDENTITY_IDS.andesCommon,
      mic: "XNAS",
      quoteCurrency: "USD",
      country: "US",
      status: "active",
      primaryListing: true,
      validFrom: "2025-01-01T00:00:00.000Z",
      availableAt: "2025-01-01T00:00:00.000Z",
    }),
  ],
  listingSymbols: [
    withHash({
      ...provenance,
      supersededAt: null,
      listingSymbolId: internalId("31"),
      listingId: DEMO_IDENTITY_IDS.fixtureCoXnasListing,
      symbol: "FIXA",
      symbolType: "ticker",
      validFrom: "2020-01-01T00:00:00.000Z",
      // El símbolo anterior deja de ser válido exactamente cuando empieza el
      // nuevo: intervalos que se tocan, no se solapan.
      validTo: "2024-06-01T00:00:00.000Z",
      availableAt: "2020-01-01T00:00:00.000Z",
    }),
    withHash({
      ...provenance,
      ...open,
      listingSymbolId: internalId("32"),
      listingId: DEMO_IDENTITY_IDS.fixtureCoXnasListing,
      symbol: "FXCO",
      symbolType: "ticker",
      validFrom: "2024-06-01T00:00:00.000Z",
      // Anunciado tres semanas antes de ser efectivo.
      availableAt: "2024-05-10T13:00:00.000Z",
    }),
    withHash({
      ...provenance,
      ...open,
      listingSymbolId: internalId("33"),
      listingId: DEMO_IDENTITY_IDS.fixtureCoXbueListing,
      symbol: "FIXA",
      symbolType: "ticker",
      validFrom: "2021-03-01T00:00:00.000Z",
      availableAt: "2021-03-01T00:00:00.000Z",
    }),
    withHash({
      ...provenance,
      ...open,
      // Otro emisor recibe el ticker liberado: el símbolo no es una identidad.
      listingSymbolId: internalId("34"),
      listingId: DEMO_IDENTITY_IDS.andesXnasListing,
      symbol: "FIXA",
      symbolType: "ticker",
      validFrom: "2025-03-01T00:00:00.000Z",
      availableAt: "2025-02-01T13:00:00.000Z",
    }),
  ],
  depositaryPrograms: [
    withHash({
      ...provenance,
      ...open,
      depositaryProgramId: DEMO_IDENTITY_IDS.cedearProgram,
      programType: "cedear",
      depositarySecurityId: DEMO_IDENTITY_IDS.fixtureCoCedear,
      underlyingSecurityId: DEMO_IDENTITY_IDS.fixtureCoClassA,
      depositaryLegalEntityId: DEMO_IDENTITY_IDS.depositaryEntity,
      sponsorLegalEntityId: null,
      investorScope: "Inversores locales del mercado sintético",
      status: "active",
      validFrom: "2021-03-01T00:00:00.000Z",
      availableAt: "2021-03-01T00:00:00.000Z",
    }),
  ],
  depositaryRatios: [
    withHash({
      ...provenance,
      // Versión conocida hasta el anuncio: 10:1 sin fin declarado.
      depositaryRatioId: internalId("51"),
      depositaryProgramId: DEMO_IDENTITY_IDS.cedearProgram,
      depositaryUnits: "10",
      underlyingUnits: "1",
      announcedAt: null,
      validFrom: "2021-03-01T00:00:00.000Z",
      validTo: null,
      availableAt: "2021-03-01T00:00:00.000Z",
      supersededAt: "2024-07-15T13:00:00.000Z",
    }),
    withHash({
      ...provenance,
      // El anuncio cierra el intervalo anterior sin reescribir su valor.
      depositaryRatioId: internalId("52"),
      depositaryProgramId: DEMO_IDENTITY_IDS.cedearProgram,
      depositaryUnits: "10",
      underlyingUnits: "1",
      announcedAt: "2024-07-15T13:00:00.000Z",
      validFrom: "2021-03-01T00:00:00.000Z",
      validTo: "2024-09-01T00:00:00.000Z",
      availableAt: "2024-07-15T13:00:00.000Z",
      supersededAt: null,
    }),
    withHash({
      ...provenance,
      ...open,
      depositaryRatioId: internalId("53"),
      depositaryProgramId: DEMO_IDENTITY_IDS.cedearProgram,
      depositaryUnits: "20",
      underlyingUnits: "1",
      announcedAt: "2024-07-15T13:00:00.000Z",
      validFrom: "2024-09-01T00:00:00.000Z",
      availableAt: "2024-07-15T13:00:00.000Z",
    }),
  ],
  identifierAssignments: [
    withHash({
      ...provenance,
      ...open,
      identifierAssignmentId: internalId("61"),
      subjectType: "legal_entity",
      subjectId: DEMO_IDENTITY_IDS.fixtureCoEntity,
      identifierType: "cik",
      identifierValue: "999901",
      normalizedValue: normalizeIdentifierValue("cik", "999901"),
      scope: "sec:filer",
      issuingAuthority: "Fixture registrar",
      confidence: "authoritative",
      validFrom: "2010-01-01T00:00:00.000Z",
      availableAt: "2010-01-01T00:00:00.000Z",
    }),
    withHash({
      ...provenance,
      ...open,
      // El ISIN identifica al instrumento, nunca al emisor ni al venue.
      identifierAssignmentId: internalId("62"),
      subjectType: "security",
      subjectId: DEMO_IDENTITY_IDS.fixtureCoClassA,
      identifierType: "isin",
      identifierValue: "US0FIXTURE01",
      normalizedValue: normalizeIdentifierValue("isin", "US0FIXTURE01"),
      scope: "iso6166",
      issuingAuthority: "Fixture NNA",
      confidence: "authoritative",
      validFrom: "2010-01-01T00:00:00.000Z",
      availableAt: "2010-01-01T00:00:00.000Z",
    }),
    withHash({
      ...provenance,
      ...open,
      identifierAssignmentId: internalId("63"),
      subjectType: "security",
      subjectId: DEMO_IDENTITY_IDS.fixtureCoCedear,
      identifierType: "isin",
      identifierValue: "ARFIXTURE001",
      normalizedValue: normalizeIdentifierValue("isin", "ARFIXTURE001"),
      scope: "iso6166",
      issuingAuthority: "Fixture NNA",
      confidence: "authoritative",
      validFrom: "2021-03-01T00:00:00.000Z",
      availableAt: "2021-03-01T00:00:00.000Z",
    }),
    withHash({
      ...provenance,
      ...open,
      // Clave con la que la fuente sintética nombra al sujeto de sus datos.
      identifierAssignmentId: internalId("64"),
      subjectType: "legal_entity",
      subjectId: DEMO_IDENTITY_IDS.fixtureCoEntity,
      identifierType: "vendor_subject_key",
      identifierValue: DEMO_SUBJECT_KEY,
      normalizedValue: normalizeIdentifierValue(
        "vendor_subject_key",
        DEMO_SUBJECT_KEY,
      ),
      scope: DEMO_IDENTIFIER_SCOPE,
      issuingAuthority: null,
      confidence: "authoritative",
      validFrom: "2010-01-01T00:00:00.000Z",
      availableAt: "2010-01-01T00:00:00.000Z",
    }),
    withHash({
      ...provenance,
      ...open,
      // Coincidencia por nombre sin evidencia adicional: queda `candidate` y
      // por lo tanto nunca participa de un join financiero automático.
      identifierAssignmentId: internalId("65"),
      subjectType: "security",
      subjectId: DEMO_IDENTITY_IDS.andesCommon,
      identifierType: "isin",
      identifierValue: "US0FIXTURE01",
      normalizedValue: normalizeIdentifierValue("isin", "US0FIXTURE01"),
      scope: "iso6166",
      issuingAuthority: "Fixture vendor",
      confidence: "candidate",
      validFrom: "2024-01-01T00:00:00.000Z",
      availableAt: "2024-01-01T00:00:00.000Z",
    }),
  ],
});

/** Lookup del sujeto que publica el dataset sintético de fundamentales. */
export const DEMO_SUBJECT_LOOKUP = Object.freeze({
  identifierType: "vendor_subject_key",
  identifierValue: DEMO_SUBJECT_KEY,
  scope: DEMO_IDENTIFIER_SCOPE,
});

/** Símbolo vigente en el venue primario tras el cambio de ticker de 2024. */
export const DEMO_CURRENT_SYMBOL = Object.freeze({
  symbol: "FXCO",
  mic: "XNAS",
});

/** Símbolo anterior: sólo resuelve a FixtureCo antes del 2024-06-01. */
export const DEMO_PREVIOUS_SYMBOL = Object.freeze({
  symbol: "FIXA",
  mic: "XNAS",
});
