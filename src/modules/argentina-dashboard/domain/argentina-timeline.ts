/**
 * The dated context the Argentina charts draw behind a series (`F9-13`):
 * presidencies since 1983 and the exchange and statistical regimes. Each one
 * is a declared fact with its date and source; the charts only place it on
 * the axis. Nothing here says a government or a regime caused a movement
 * (owner decision of 2026-11-03: governments since 1983 plus regimes).
 *
 * A span runs from `from` (inclusive) to `to` (exclusive): the day a
 * president takes office closes the predecessor's term.
 */
export const ARGENTINA_TIMELINE_VERSION = "argentina-timeline-1.0.0";

export type PresidentialTerm = {
  readonly id: string;
  /** Short label for the axis: «Macri», «CFK II». */
  readonly label: string;
  readonly president: string;
  readonly from: string;
  /** `null` while the term is running. */
  readonly to: string | null;
  /**
   * `interim` groups the three presidencies of eleven days after De la Rúa's
   * resignation: they stay on the axis and out of the comparison.
   */
  readonly kind: "elected" | "legislative_assembly" | "interim";
};

export type RegimeSpan = {
  readonly id: string;
  readonly label: string;
  readonly from: string;
  readonly to: string | null;
  /** What the regime was, in one sentence and without causes. */
  readonly description: string;
  readonly source: string;
};

export const PRESIDENTIAL_TERMS_SOURCE =
  "Casa Rosada, listado de presidentes de la Nación; fechas de asunción ante la Asamblea Legislativa";

export const PRESIDENTIAL_TERMS: readonly PresidentialTerm[] = [
  {
    id: "alfonsin",
    label: "Alfonsín",
    president: "Raúl Alfonsín",
    from: "1983-12-10",
    to: "1989-07-08",
    kind: "elected",
  },
  {
    id: "menem-1",
    label: "Menem I",
    president: "Carlos Menem (primer mandato)",
    from: "1989-07-08",
    to: "1995-07-08",
    kind: "elected",
  },
  {
    id: "menem-2",
    label: "Menem II",
    president: "Carlos Menem (segundo mandato)",
    from: "1995-07-08",
    to: "1999-12-10",
    kind: "elected",
  },
  {
    id: "de-la-rua",
    label: "De la Rúa",
    president: "Fernando de la Rúa",
    from: "1999-12-10",
    to: "2001-12-21",
    kind: "elected",
  },
  {
    id: "interim-2001",
    label: "Interinos",
    president: "Ramón Puerta, Adolfo Rodríguez Saá y Eduardo Camaño",
    from: "2001-12-21",
    to: "2002-01-02",
    kind: "interim",
  },
  {
    id: "duhalde",
    label: "Duhalde",
    president: "Eduardo Duhalde",
    from: "2002-01-02",
    to: "2003-05-25",
    kind: "legislative_assembly",
  },
  {
    id: "kirchner",
    label: "N. Kirchner",
    president: "Néstor Kirchner",
    from: "2003-05-25",
    to: "2007-12-10",
    kind: "elected",
  },
  {
    id: "cfk-1",
    label: "CFK I",
    president: "Cristina Fernández de Kirchner (primer mandato)",
    from: "2007-12-10",
    to: "2011-12-10",
    kind: "elected",
  },
  {
    id: "cfk-2",
    label: "CFK II",
    president: "Cristina Fernández de Kirchner (segundo mandato)",
    from: "2011-12-10",
    to: "2015-12-10",
    kind: "elected",
  },
  {
    id: "macri",
    label: "Macri",
    president: "Mauricio Macri",
    from: "2015-12-10",
    to: "2019-12-10",
    kind: "elected",
  },
  {
    id: "alberto-fernandez",
    label: "A. Fernández",
    president: "Alberto Fernández",
    from: "2019-12-10",
    to: "2023-12-10",
    kind: "elected",
  },
  {
    id: "milei",
    label: "Milei",
    president: "Javier Milei",
    from: "2023-12-10",
    to: null,
    kind: "elected",
  },
];

/**
 * Regimes may overlap a presidency and each other (the INDEC intervention
 * and the first exchange control). The two controls end the day before the
 * norm that lifted them, as `declared-transformation-caveats-1.0.0` dates
 * them, so `to` here is the norm's own day.
 */
export const REGIME_SPANS: readonly RegimeSpan[] = [
  {
    id: "convertibility",
    label: "Convertibilidad",
    from: "1991-04-01",
    to: "2002-01-06",
    description:
      "Un peso convertible por un dólar, por ley, hasta la Ley de Emergencia Pública.",
    source: "Ley 23.928 y Ley 25.561",
  },
  {
    id: "indec-intervention",
    label: "INDEC intervenido",
    from: "2007-01-01",
    to: "2016-01-01",
    description:
      "Las cifras oficiales de precios de esos años no son comparables; la emergencia estadística de 2016 lo declaró.",
    source: "INDEC, emergencia estadística (Decreto 55/2016)",
  },
  {
    id: "fx-controls-2011",
    label: "Cepo 2011–2015",
    from: "2011-10-31",
    to: "2015-12-17",
    description:
      "Restricciones a la compra de moneda extranjera, hasta la unificación cambiaria.",
    source: "AFIP RG 3210/2011; BCRA Com. A 5850",
  },
  {
    id: "fx-controls-2019",
    label: "Cepo 2019–2025",
    from: "2019-09-01",
    to: "2025-04-14",
    description:
      "Restricciones a la compra de moneda extranjera, hasta el régimen de bandas.",
    source: "DNU 609/2019; BCRA Com. A 6770 y Com. A 8226",
  },
  {
    id: "fx-bands-2025",
    label: "Bandas cambiarias",
    from: "2025-04-14",
    to: null,
    description:
      "El tipo de cambio flota entre una banda inferior y una superior que el BCRA publica día por día.",
    source: "BCRA Com. A 8226",
  },
];

function overlaps(
  span: { readonly from: string; readonly to: string | null },
  fromOn: string,
  toOn: string,
): boolean {
  return span.from <= toOn && (span.to === null || span.to > fromOn);
}

/** The terms that touch `[fromOn, toOn]`, in order. */
export function termsOverlapping(
  fromOn: string,
  toOn: string,
): readonly PresidentialTerm[] {
  return PRESIDENTIAL_TERMS.filter((term) => overlaps(term, fromOn, toOn));
}

export function regimesOverlapping(
  fromOn: string,
  toOn: string,
): readonly RegimeSpan[] {
  return REGIME_SPANS.filter((regime) => overlaps(regime, fromOn, toOn));
}

/** The term in office on `on`, or `null` before 1983-12-10. */
export function termOn(on: string): PresidentialTerm | null {
  return (
    PRESIDENTIAL_TERMS.find(
      (term) => term.from <= on && (term.to === null || on < term.to),
    ) ?? null
  );
}
