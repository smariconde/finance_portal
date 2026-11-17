import {
  argentinaIndicatorSchema,
  type ArgentinaIndicator,
} from "./argentina-indicator";

/**
 * Argentina's country risk (ADR 0080): J.P. Morgan's sovereign spread read
 * from Ámbito's history of closes. Declared apart from the `F9-04` set, like
 * the ITCRM, because it is a long daily series the page reads as a chart.
 */
export const DECLARED_COUNTRY_RISK: ArgentinaIndicator =
  argentinaIndicatorSchema.parse({
    id: "ar_country_risk_embi",
    externalId: "riesgopais",
    block: "external",
    frequency: "daily",
    unit: "Puntos básicos",
    scale: "unit",
    currency: "percent",
    seasonalAdjustment: "original",
    priceBasis: "not_applicable",
    indexBase: null,
    reportingScope: "Argentina · spread soberano de J.P. Morgan, cierre diario",
    sourceId: "ambito-riesgo-pais",
    filters: {},
    sourceUrl: "https://www.ambito.com/contenidos/riesgo-pais.html",
    segment: "embi-ar",
    methodology:
      "Spread de los bonos soberanos de la Argentina en dólares sobre los del Tesoro de los Estados Unidos, en puntos básicos, según el índice EMBI de J.P. Morgan publicado por Ámbito. Hasta el 2025-09-29 es el del EMBI+; desde el 2025-09-30, el del EMBI Global Diversified (country-risk-index-1.0.0). Sólo se guardan los cierres del histórico; el valor del día cambia durante la rueda y no se lee.",
  });

export function declaredCountryRisk(id: string): ArgentinaIndicator | null {
  return id === DECLARED_COUNTRY_RISK.id ? DECLARED_COUNTRY_RISK : null;
}

/**
 * The index behind the figure, dated (`country-risk-index-1.0.0`). J.P.
 * Morgan took Argentina out of the EMBI+ on 2025-09-30; the series goes on
 * as the EMBI Global Diversified spread. The data shows no clean level jump,
 * so the change is declared, never detected.
 */
export const COUNTRY_RISK_INDEX_VERSION = "country-risk-index-1.0.0";

export type CountryRiskIndexSegment = {
  readonly id: "embi_plus" | "embi_global_diversified";
  readonly label: string;
  readonly from: string;
  /** Exclusive; `null` while it lasts. */
  readonly to: string | null;
  readonly description: string;
  readonly source: string;
};

export const COUNTRY_RISK_INDEX_SEGMENTS: readonly CountryRiskIndexSegment[] = [
  {
    id: "embi_plus",
    label: "EMBI+",
    from: "1998-12-11",
    to: "2025-09-30",
    description:
      "Spread de la Argentina en el EMBI+ de J.P. Morgan: sólo bonos en dólares bajo ley extranjera, con montos mínimos en circulación.",
    source: "J.P. Morgan, vía Ámbito",
  },
  {
    id: "embi_global_diversified",
    label: "EMBI Global Diversified",
    from: "2025-09-30",
    to: null,
    description:
      "Desde que J.P. Morgan sacó a la Argentina del EMBI+, el spread de su EMBI Global Diversified, publicado una vez por día con el cierre anterior.",
    source: "J.P. Morgan, vía Ámbito",
  },
];

/** The index of a close's day. */
export function countryRiskIndexOn(on: string): CountryRiskIndexSegment | null {
  return (
    COUNTRY_RISK_INDEX_SEGMENTS.find(
      (segment) =>
        on >= segment.from && (segment.to === null || on < segment.to),
    ) ?? null
  );
}
