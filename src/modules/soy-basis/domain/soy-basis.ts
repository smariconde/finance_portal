import { z } from "zod";

import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

/** F9-05: a comparison is valid only for the same market day and known vintages. */
export const SOY_BASIS_VERSION = "soy-basis-1.0.0";
export const BUSHELS_PER_METRIC_TON = "36.7437";

const datedPriceSchema = z.strictObject({
  marketOn: z.iso.date(),
  availableAt: z.iso.datetime({ offset: true }),
  sourceId: z.string().min(1),
  value: z.string().min(1),
});

const rosarioSchema = datedPriceSchema.extend({
  unit: z.literal("ARS/t"),
  delivery: z.literal("spot_rosario"),
});

const fxSchema = datedPriceSchema.extend({
  unit: z.literal("ARS/USD"),
  side: z.literal("buyer"),
  market: z.literal("BNA_divisas"),
});

const chicagoSchema = datedPriceSchema
  .extend({
    unit: z.enum(["USD/bushel", "US_cents/bushel", "USD/t"]),
    contract: z.string().min(1),
    seriesKind: z.enum(["single_contract", "continuous"]),
    /** The contract is supplied per point; a continuous series also names its roll. */
    rollPolicy: z.string().min(1).nullable(),
  })
  .refine(
    (point) => point.seriesKind !== "continuous" || point.rollPolicy !== null,
    {
      message: "continuous series requires a roll policy",
      path: ["rollPolicy"],
    },
  );

export const soyBasisInputSchema = z.strictObject({
  marketOn: z.iso.date(),
  knownAt: z.iso.datetime({ offset: true }),
  rosario: rosarioSchema.nullable(),
  fx: fxSchema.nullable(),
  chicago: chicagoSchema.nullable(),
});

export type SoyBasisInput = z.infer<typeof soyBasisInputSchema>;

export type SoyBasisResult =
  | {
      readonly status: "unavailable";
      readonly reason:
        | "missing_rosario"
        | "missing_fx"
        | "missing_chicago"
        | "date_mismatch"
        | "not_yet_known"
        | "non_positive_input";
    }
  | {
      readonly status: "computed";
      readonly version: typeof SOY_BASIS_VERSION;
      readonly marketOn: string;
      readonly knownAt: string;
      readonly rosarioUsdPerTon: string;
      readonly chicagoUsdPerTon: string;
      readonly basisPct: string;
      readonly chicagoContract: string;
      readonly chicagoSeriesKind: "single_contract" | "continuous";
      readonly chicagoRollPolicy: string | null;
      readonly sources: {
        readonly rosario: string;
        readonly fx: string;
        readonly chicago: string;
      };
      readonly availableAt: {
        readonly rosario: string;
        readonly fx: string;
        readonly chicago: string;
      };
    };

const decimal = createDecimalOperations((code) => new Error(code));

/** Inputs are already vintage-selected by the caller; this gate prevents a later
 * quote from slipping into an earlier comparison. No interpolation or prior-day FX. */
export function calculateSoyBasis(raw: SoyBasisInput): SoyBasisResult {
  const input = soyBasisInputSchema.parse(raw);
  const { rosario, fx, chicago } = input;
  if (rosario === null)
    return { status: "unavailable", reason: "missing_rosario" };
  if (fx === null) return { status: "unavailable", reason: "missing_fx" };
  if (chicago === null)
    return { status: "unavailable", reason: "missing_chicago" };
  if (
    [rosario, fx, chicago].some((point) => point.marketOn !== input.marketOn)
  ) {
    return { status: "unavailable", reason: "date_mismatch" };
  }
  if (
    [rosario, fx, chicago].some(
      (point) => Date.parse(point.availableAt) > Date.parse(input.knownAt),
    )
  ) {
    return { status: "unavailable", reason: "not_yet_known" };
  }

  const pesoPrice = decimal.parseDecimal(rosario.value, "rosario.value");
  const buyerFx = decimal.parseDecimal(fx.value, "fx.value");
  const chicagoPrice = decimal.parseDecimal(chicago.value, "chicago.value");
  if (!pesoPrice.gt(0) || !buyerFx.gt(0) || !chicagoPrice.gt(0)) {
    return { status: "unavailable", reason: "non_positive_input" };
  }

  const rosarioUsd = decimal.divide(pesoPrice, buyerFx, "rosarioUsdPerTon");
  const dollarsPerBushel =
    chicago.unit === "US_cents/bushel"
      ? decimal.divide(
          chicagoPrice,
          decimal.parseDecimal("100", "centsPerDollar"),
          "dollarsPerBushel",
        )
      : chicagoPrice;
  const chicagoUsd =
    chicago.unit === "USD/t"
      ? chicagoPrice
      : decimal.assertFinite(
          dollarsPerBushel.mul(
            decimal.parseDecimal(BUSHELS_PER_METRIC_TON, "bushelsPerMetricTon"),
          ),
          "chicagoUsdPerTon",
        );
  const basis = decimal.assertFinite(
    decimal.divide(rosarioUsd, chicagoUsd, "basisPct").minus(1).mul(100),
    "basisPct",
  );
  return {
    status: "computed",
    version: SOY_BASIS_VERSION,
    marketOn: input.marketOn,
    knownAt: input.knownAt,
    rosarioUsdPerTon: decimal.formatDecimal(rosarioUsd, "rosarioUsdPerTon"),
    chicagoUsdPerTon: decimal.formatDecimal(chicagoUsd, "chicagoUsdPerTon"),
    basisPct: decimal.formatDecimal(basis, "basisPct"),
    chicagoContract: chicago.contract,
    chicagoSeriesKind: chicago.seriesKind,
    chicagoRollPolicy: chicago.rollPolicy,
    sources: {
      rosario: rosario.sourceId,
      fx: fx.sourceId,
      chicago: chicago.sourceId,
    },
    availableAt: {
      rosario: rosario.availableAt,
      fx: fx.availableAt,
      chicago: chicago.availableAt,
    },
  };
}
