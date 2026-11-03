import type { TransformationKind } from "./series-transformation";

/**
 * Advertencias declaradas sobre las referencias de una transformación
 * (`declared-transformation-caveats-1.0.0`, ADR 0066). No corrigen nada: dicen
 * qué tramo de la referencia no mide lo que su nombre promete, para que una
 * comparación entre épocas lo lea en vez de descubrirlo.
 *
 * Cada una cita su fuente. Una advertencia sin rango (`from` y `to` nulos)
 * describe la referencia entera.
 */
export type TransformationCaveat = {
  readonly code: string;
  readonly kinds: readonly TransformationKind[];
  /** Primer día afectado; `null` desde el inicio. */
  readonly from: string | null;
  /** Último día afectado; `null` hasta hoy. */
  readonly to: string | null;
  readonly note: string;
  readonly source: string;
};

export const DECLARED_TRANSFORMATION_CAVEATS_VERSION =
  "declared-transformation-caveats-1.0.0";

export const DECLARED_TRANSFORMATION_CAVEATS: readonly TransformationCaveat[] =
  Object.freeze([
    {
      code: "cpi_published_one_decimal",
      kinds: ["real_cpi"],
      from: null,
      to: null,
      note: "La inflación mensual se publica con un decimal; el índice encadenado acumula ese redondeo.",
      source: "BCRA, variable 27",
    },
    {
      code: "cer_lags_cpi",
      kinds: ["real_cer"],
      from: null,
      to: null,
      note: "El CER de un día refleja el IPC de unos 45 días antes; con inflación alta, deflactar por el CER del mismo día subestima o sobreestima el nivel real.",
      source: "Medido contra el IPC encadenado (ADR 0066)",
    },
    {
      code: "indec_cpi_under_intervention",
      kinds: ["real_cpi", "real_cer"],
      from: "2007-01-01",
      to: "2015-12-31",
      note: "IPC del INDEC intervenido: subestimó la inflación, así que los valores reales de ese tramo quedan sobreestimados.",
      source: "INDEC, emergencia estadística (Decreto 55/2016)",
    },
    {
      code: "cpi_provincial_substitute",
      kinds: ["real_cpi", "real_cer"],
      from: "2015-11-01",
      to: "2016-04-30",
      note: "Sin IPC nacional: noviembre 2015 a enero 2016 usa el IPC de la Ciudad de Buenos Aires y febrero a abril 2016 el de San Luis.",
      source: "BCRA, metodología de la variable 27",
    },
    {
      code: "ccl_implied_market_rate",
      kinds: ["usd_ccl"],
      from: null,
      to: null,
      note: "CCL implícito: mediana de precio local × ratio / ADR entre pares declarados; es un tipo de cambio de mercado, no una cotización publicada, y en el cepo de 2019–2025 lo encarecieron también las restricciones a operar.",
      source: "Yahoo Finance, ADR 0068",
    },
    {
      code: "official_fx_under_controls",
      kinds: ["usd_wholesale", "usd_spliced"],
      from: "2011-10-31",
      to: "2015-12-16",
      note: "Cepo cambiario: el mayorista oficial quedó por debajo de los tipos de cambio que pagaba el mercado.",
      source: "AFIP RG 3210 (2011) a Comunicación A 5850 (2015)",
    },
    {
      code: "official_fx_under_controls",
      kinds: ["usd_wholesale", "usd_spliced"],
      from: "2019-09-01",
      to: "2025-04-13",
      note: "Cepo cambiario: el mayorista oficial quedó por debajo de los tipos de cambio que pagaba el mercado.",
      source: "Comunicación A 6770 (2019) a Comunicación A 8226 (2025)",
    },
  ]);

/** Las advertencias de `kind` cuyo tramo toca `[firstOn, lastOn]`. */
export function caveatsFor(
  kind: TransformationKind,
  firstOn: string,
  lastOn: string,
): readonly TransformationCaveat[] {
  return DECLARED_TRANSFORMATION_CAVEATS.filter(
    (caveat) =>
      caveat.kinds.includes(kind) &&
      (caveat.from === null || caveat.from <= lastOn) &&
      (caveat.to === null || caveat.to >= firstOn),
  );
}
