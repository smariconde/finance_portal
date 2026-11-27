import type {
  ListingCapture,
  PageKind,
  ParseBasis,
  RealEstatePortal,
} from "../../../src/modules/real-estate/domain/listing-capture";
import type { ListingFacts } from "../../../src/modules/real-estate/domain/listing-revisions";

/**
 * Lo que el content script le entrega a un adapter: el documento que el owner
 * ya abrió, reducido a texto. Nada de red: un adapter es una función pura y se
 * prueba con fixtures en Node (ADR 0089, Decisión 2).
 */
export type PortalDocument = {
  /** `location.href` al terminar de cargar. */
  readonly url: string;
  readonly capturedAt: string;
  /** `textContent` de cada selector de `embeddedStateSelectors`, o `null`. */
  readonly embeddedStates: Readonly<Record<string, string | null>>;
  /** `textContent` de cada `<script type="application/ld+json">`. */
  readonly jsonLd: readonly string[];
};

/** Por qué un aviso de la página no viajó; un código cerrado, nunca el valor. */
export type SkipReason = string;

export type PortalReading =
  | {
      readonly kind: "captures";
      readonly pageKind: PageKind;
      readonly parseBasis: ParseBasis;
      readonly captures: readonly ListingCapture[];
      /** Cuántos avisos de la página se dejaron afuera, por motivo. */
      readonly skipped: Readonly<Record<SkipReason, number>>;
    }
  /** La URL no es una ficha ni un listado del portal. */
  | { readonly kind: "not_a_listing_page" }
  /** Ninguna base cerró el contrato: se rechaza por nombre (Decisión 2). */
  | { readonly kind: "rejected"; readonly reason: string };

/** De dónde sale un campo del contrato en este portal, o por qué no sale. */
export type FieldSource =
  | { readonly basis: ParseBasis; readonly path: string }
  | {
      readonly absent: "not_published" | "ambiguous" | "computed_later";
      readonly note: string;
    };

/** Los campos que el adapter tiene que declarar: todos los hechos del aviso. */
export type DeclaredField = keyof ListingFacts | "externalId" | "canonicalUrl";

export type PortalAdapter = {
  readonly sourceId: RealEstatePortal;
  /** La versión del parser: cambia cuando cambia lo que lee. */
  readonly version: string;
  /** Patrones de `matches` del content script; de acá salen los permisos. */
  readonly matches: readonly string[];
  /** La CDN de fotos, para los dHash de `F13-05`. */
  readonly photoHosts: readonly string[];
  /** `<script>` cuyo texto es el estado embebido de la aplicación. */
  readonly embeddedStateSelectors: readonly string[];
  /** Si alguno está en el documento, es un desafío: el portal se detiene. */
  readonly challengeSelectors: readonly string[];
  /** Cada campo del contrato, con su base y su ruta o el motivo de ausencia. */
  readonly fields: Readonly<Record<DeclaredField, FieldSource>>;
  readonly pageKindOf: (url: URL) => PageKind | null;
  readonly read: (document: PortalDocument) => PortalReading;
};
