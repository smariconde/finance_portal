import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

/**
 * The dollar a soy exporter actually settled at (`F9-15`). Between 2022 and
 * 2025 the board's pesos were not collected at the BNA buyer rate: three
 * «dólar soja» programs fixed a rate per dollar, the Programa de Incremento
 * Exportador let a share be settled through securities at the CCL, and the
 * «dólar blend» kept 20 % at the CCL until 2025-04-14. Each span is a declared
 * fact with its decree; a day outside every span is settled at the official
 * rate. Spans run from `from` (inclusive) to `to` (exclusive), like the
 * timeline's.
 */
export const SOY_EXPORT_FX_REGIMES_VERSION = "soy-export-fx-regimes-1.0.0";
export const SOY_EFFECTIVE_BASIS_VERSION = "soy-effective-basis-1.0.0";

export type SoyExportFxRegime = {
  readonly id: string;
  /** Short label for the chart: «Dólar soja II», «Blend 80/20». */
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly rule:
    | { readonly kind: "fixed"; readonly pesosPerDollar: string }
    /** `officialShare` through the exchange market, the rest at the CCL. */
    | { readonly kind: "blend"; readonly officialShare: string };
  readonly norm: string;
  readonly description: string;
};

export const DECLARED_SOY_EXPORT_FX_REGIMES: readonly SoyExportFxRegime[] = [
  {
    id: "dolar-soja-1",
    label: "Dólar soja I",
    from: "2022-09-05",
    to: "2022-10-01",
    rule: { kind: "fixed", pesosPerDollar: "200" },
    norm: "Decreto 576/2022 (B.O. 5/9/2022), hasta el 30/9/2022",
    description:
      "Programa de Incremento Exportador: la soja y sus derivados se liquidaron a $ 200 por dólar.",
  },
  {
    id: "dolar-soja-2",
    label: "Dólar soja II",
    from: "2022-11-28",
    to: "2022-12-31",
    rule: { kind: "fixed", pesosPerDollar: "230" },
    norm: "Decreto 787/2022 (B.O. 28/11/2022), hasta el 30/12/2022",
    description:
      "El programa se restableció con la soja liquidada a $ 230 por dólar.",
  },
  {
    id: "dolar-soja-3",
    label: "Dólar soja III",
    from: "2023-04-10",
    to: "2023-06-01",
    rule: { kind: "fixed", pesosPerDollar: "300" },
    norm: "Decreto 194/2023 (B.O. 10/4/2023), capítulo de la soja hasta el 31/5/2023",
    description:
      "Tercera edición, con la soja liquidada a $ 300 por dólar; el dólar de $ 340 de julio (Decreto 378/2023) fue para economías regionales, no para la soja.",
  },
  {
    id: "pie-75-25",
    label: "75/25 CCL",
    from: "2023-09-05",
    to: "2023-10-23",
    rule: { kind: "blend", officialShare: "0.75" },
    norm: "Decreto 443/2023 (B.O. 5/9/2023) y Decreto 492/2023 (B.O. 2/10/2023), reemplazados el 23/10/2023 por el Decreto 549/2023",
    description:
      "El 75 % por el mercado de cambios y el 25 % de libre disponibilidad, liquidado por contado con liquidación desde el Decreto 492/2023.",
  },
  {
    id: "pie-70-30",
    label: "70/30 CCL",
    from: "2023-10-23",
    to: "2023-11-18",
    rule: { kind: "blend", officialShare: "0.7" },
    norm: "Decreto 549/2023 (B.O. 23/10/2023), hasta el 17/11/2023",
    description:
      "El 70 % por el mercado de cambios y el 30 % con valores negociables, es decir, al contado con liquidación.",
  },
  {
    id: "pie-50-50",
    label: "50/50 CCL",
    from: "2023-11-21",
    to: "2023-12-11",
    rule: { kind: "blend", officialShare: "0.5" },
    norm: "Decreto 597/2023 (B.O. 21/11/2023), hasta el 10/12/2023",
    description:
      "La mitad por el mercado de cambios y la mitad al contado con liquidación.",
  },
  {
    id: "blend-80-20",
    label: "Blend 80/20",
    from: "2023-12-13",
    to: "2025-04-14",
    rule: { kind: "blend", officialShare: "0.8" },
    norm: "DNU 28/2023 (B.O. 13/12/2023), derogado por el DNU 269/2025 (B.O. 14/4/2025)",
    description:
      "El 80 % de toda exportación por el mercado de cambios y el 20 % al contado con liquidación.",
  },
];

export function soyExportFxRegimeOn(on: string): SoyExportFxRegime | null {
  return (
    DECLARED_SOY_EXPORT_FX_REGIMES.find(
      (regime) => on >= regime.from && on < regime.to,
    ) ?? null
  );
}

export type SoyEffectiveBasis =
  | {
      readonly status: "unavailable";
      readonly reason: "missing_leg" | "missing_ccl" | "non_positive_input";
    }
  | {
      readonly status: "computed";
      readonly version: typeof SOY_EFFECTIVE_BASIS_VERSION;
      /** `official` outside every declared span. */
      readonly regimeId: string;
      readonly pesosPerDollar: string;
      readonly rosarioUsdPerTon: string;
      readonly basisPct: string;
    };

const decimal = createDecimalOperations((code) => new Error(code));

/**
 * The board's gap against Chicago at the dollar the exporter settled at, on
 * the same day as every leg: a fixed program rate, or the declared share of
 * the BNA buyer rate —the one the board converts with— plus the rest at that
 * day's implied CCL. A blended day without a CCL has no reading; it never
 * borrows another day's.
 */
export function calculateSoyEffectiveBasis(input: {
  readonly on: string;
  readonly rosarioArs: string | null;
  readonly bnaBuyer: string | null;
  readonly ccl: string | null;
  readonly chicagoUsdPerTon: string | null;
}): SoyEffectiveBasis {
  const { rosarioArs, bnaBuyer, chicagoUsdPerTon } = input;
  if (rosarioArs === null || chicagoUsdPerTon === null) {
    return { status: "unavailable", reason: "missing_leg" };
  }
  const regime = soyExportFxRegimeOn(input.on);
  const pesos = decimal.parseDecimal(rosarioArs, "rosarioArs");
  const chicago = decimal.parseDecimal(chicagoUsdPerTon, "chicagoUsdPerTon");

  let rate;
  if (regime?.rule.kind === "fixed") {
    rate = decimal.parseDecimal(regime.rule.pesosPerDollar, "pesosPerDollar");
  } else {
    if (bnaBuyer === null)
      return { status: "unavailable", reason: "missing_leg" };
    const official = decimal.parseDecimal(bnaBuyer, "bnaBuyer");
    if (regime === null) {
      rate = official;
    } else {
      if (input.ccl === null) {
        return { status: "unavailable", reason: "missing_ccl" };
      }
      const ccl = decimal.parseDecimal(input.ccl, "ccl");
      if (!ccl.gt(0)) {
        return { status: "unavailable", reason: "non_positive_input" };
      }
      const share = decimal.parseDecimal(
        regime.rule.officialShare,
        "officialShare",
      );
      rate = decimal.assertFinite(
        official
          .mul(share)
          .plus(ccl.mul(decimal.parseDecimal("1", "one").minus(share))),
        "pesosPerDollar",
      );
    }
  }
  if (!pesos.gt(0) || !rate.gt(0) || !chicago.gt(0)) {
    return { status: "unavailable", reason: "non_positive_input" };
  }

  const rosarioUsd = decimal.divide(pesos, rate, "rosarioUsdPerTon");
  const basis = decimal.assertFinite(
    decimal.divide(rosarioUsd, chicago, "basisPct").minus(1).mul(100),
    "basisPct",
  );
  return {
    status: "computed",
    version: SOY_EFFECTIVE_BASIS_VERSION,
    regimeId: regime?.id ?? "official",
    pesosPerDollar: decimal.formatDecimal(rate, "pesosPerDollar"),
    rosarioUsdPerTon: decimal.formatDecimal(rosarioUsd, "rosarioUsdPerTon"),
    basisPct: decimal.formatDecimal(basis, "basisPct"),
  };
}
