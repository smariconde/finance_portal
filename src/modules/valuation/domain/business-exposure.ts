import { z } from "zod";

import type { ReferenceRow } from "@/modules/reference-data/domain/reference-release";

import type { ReferenceReading } from "./cost-of-capital";
import {
  divide,
  engineDecimalSchema,
  formatDecimal,
  ONE,
  parseDecimal,
  ZERO,
  type Dec,
} from "./decimal-policy";

/**
 * La beta por mezcla de negocios (`F6-48`,
 * [ADR 0086](../../../../docs/architecture/adr/0086-business-mix-beta.md),
 * decisión 5, `business-mix-weights-1.0.0`, la versión que nombra
 * `BUSINESS_MIX_WEIGHTS_VERSION`).
 *
 * Como Damodaran con una empresa de varios negocios: el valor de cada uno se
 * estima con las ventas de su industria por el EV/Sales de esa industria, y la
 * beta desapalancada —corregida por caja— y la D/E objetivo son las de cada
 * industria ponderadas por ese valor. Hamada reapalanca después, como con una
 * sola industria. Con una declaración del owner, los pesos son los declarados.
 *
 * Una industria sin beta, sin D/E o sin EV/Sales positivo se nombra en
 * `missing`: nunca se completa con la de la empresa.
 */
/** La mezcla que entra al costo de capital: industrias con ventas o pesos. */
export type BusinessMixReading = {
  readonly source: "owner_declaration" | "ai_proposal";
  readonly proposalId: string | null;
  readonly weightsVersion: string;
  readonly businesses: readonly {
    readonly industryKey: string;
    /** Ventas del ejercicio en USD; `null` con una declaración. */
    readonly revenue: string | null;
    /** El peso declarado; `null` con una propuesta. */
    readonly declaredWeight: string | null;
  }[];
};

const keySchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const businessExposureSchema = z
  .object({
    source: z.enum(["owner_declaration", "ai_proposal"]),
    /** La propuesta aceptada; `null` para una declaración del owner. */
    proposalId: z.uuid().nullable(),
    weightsVersion: z.string().min(1).max(64),
    betasReleaseId: z.uuid(),
    /** La release de EV/Sales; `null` con pesos declarados. */
    evToSalesReleaseId: z.uuid().nullable(),
    businesses: z
      .array(
        z.object({
          industryKey: keySchema,
          revenue: engineDecimalSchema.nullable(),
          evToSales: engineDecimalSchema.nullable(),
          /** `revenue × evToSales`; `null` con pesos declarados. */
          estimatedValue: engineDecimalSchema.nullable(),
          unleveredBeta: engineDecimalSchema,
          debtToEquity: engineDecimalSchema,
          weight: engineDecimalSchema,
        }),
      )
      .min(2)
      .max(20),
    unleveredBeta: engineDecimalSchema,
    debtToEquity: engineDecimalSchema,
  })
  .superRefine((exposure, context) => {
    const declared = exposure.source === "owner_declaration";
    const total = exposure.businesses.reduce(
      (sum: Dec, item) => sum.plus(parseDecimal(item.weight, "weight")),
      ZERO,
    );

    // Pesos calculados por división a precisión del motor: suman 1 salvo el
    // último dígito.
    if (total.minus(ONE).abs().greaterThan("1e-24")) {
      context.addIssue({
        code: "custom",
        path: ["businesses"],
        message: "Business weights add up to one.",
      });
    }

    if (
      declared !== (exposure.evToSalesReleaseId === null) ||
      exposure.businesses.some(
        (item) =>
          declared !==
          (item.revenue === null &&
            item.evToSales === null &&
            item.estimatedValue === null),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["businesses"],
        message:
          "A proposal carries revenue, EV/Sales and value; a declaration carries only weights.",
      });
    }

    if (
      new Set(exposure.businesses.map((item) => item.industryKey)).size !==
      exposure.businesses.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["businesses"],
        message: "Each industry appears once.",
      });
    }
  });

export type BusinessExposure = z.infer<typeof businessExposureSchema>;

function decimalField(row: ReferenceRow | null, field: string): string | null {
  const value = row?.values[field];
  return typeof value === "string" &&
    engineDecimalSchema.safeParse(value).success
    ? value
    : null;
}

type BusinessRow = {
  readonly industryKey: string;
  readonly revenue: string | null;
  readonly evToSales: string | null;
  readonly estimatedValue: string | null;
  readonly unleveredBeta: string;
  readonly debtToEquity: string;
};

/** Los pesos de la regla: el valor estimado de cada industria sobre el total. */
function weightsOf(
  rows: readonly BusinessRow[],
  declared: readonly (string | null)[],
): string[] {
  if (declared.every((weight) => weight !== null)) {
    return declared as string[];
  }

  const values = rows.map((row) =>
    parseDecimal(row.estimatedValue!, "estimated_value"),
  );
  const total = values.reduce((sum: Dec, value) => sum.plus(value), ZERO);

  return values.map((value) =>
    formatDecimal(divide(value, total, "business_weight"), "business_weight"),
  );
}

/** La beta y la D/E combinadas: Σ peso × la de cada industria. */
export function businessAggregates(
  businesses: readonly Pick<
    BusinessRow & { weight: string },
    "unleveredBeta" | "debtToEquity" | "weight"
  >[],
): { readonly unleveredBeta: string; readonly debtToEquity: string } {
  const weighted = (field: "unleveredBeta" | "debtToEquity") =>
    formatDecimal(
      businesses.reduce(
        (sum: Dec, item) =>
          sum.plus(
            parseDecimal(item.weight, "weight").times(
              parseDecimal(item[field], field),
            ),
          ),
        ZERO,
      ),
      field,
    );

  return {
    unleveredBeta: weighted("unleveredBeta"),
    debtToEquity: weighted("debtToEquity"),
  };
}

/**
 * Las filas de cada industria en las releases al corte. Una mezcla de una sola
 * industria no llega acá: la lectura ya la descartó.
 */
export function resolveBusinessExposure(
  mix: BusinessMixReading,
  betas: ReferenceReading | null,
  evToSales: ReferenceReading | null,
): { exposure: BusinessExposure | null; missing: string[] } {
  const declared = mix.source === "owner_declaration";

  if (betas === null) {
    return { exposure: null, missing: ["business_mix_betas"] };
  }
  if (!declared && evToSales === null) {
    return { exposure: null, missing: ["business_mix_ev_to_sales"] };
  }

  const missing: string[] = [];
  const rows: BusinessRow[] = mix.businesses.flatMap(
    (business): BusinessRow[] => {
      const key = business.industryKey;
      const betaRow = betas.rows.find((row) => row.key === key) ?? null;
      const unleveredBeta = decimalField(
        betaRow,
        "unlevered_beta_cash_corrected",
      );
      const debtToEquity = decimalField(betaRow, "debt_to_equity");

      if (unleveredBeta === null || debtToEquity === null) {
        missing.push(`business_mix_beta.${key}`);
        return [];
      }

      if (declared) {
        return [
          {
            industryKey: key,
            revenue: null,
            evToSales: null,
            estimatedValue: null,
            unleveredBeta,
            debtToEquity,
          },
        ];
      }

      const multiple = decimalField(
        evToSales!.rows.find((row) => row.key === key) ?? null,
        "ev_sales",
      );
      const revenue = business.revenue;

      if (
        multiple === null ||
        !parseDecimal(multiple, "ev_sales").greaterThan(ZERO)
      ) {
        missing.push(`business_mix_ev_to_sales.${key}`);
        return [];
      }
      if (
        revenue === null ||
        !parseDecimal(revenue, "revenue").greaterThan(ZERO)
      ) {
        missing.push(`business_mix_revenue.${key}`);
        return [];
      }

      return [
        {
          industryKey: key,
          revenue,
          evToSales: multiple,
          estimatedValue: formatDecimal(
            parseDecimal(revenue, "revenue").times(
              parseDecimal(multiple, "ev_sales"),
            ),
            "estimated_value",
          ),
          unleveredBeta,
          debtToEquity,
        },
      ];
    },
  );

  if (missing.length > 0) {
    return { exposure: null, missing };
  }

  const weights = weightsOf(
    rows,
    mix.businesses.map((business) => business.declaredWeight),
  );
  const businesses = rows.map((row, index) => ({
    ...row,
    weight: weights[index]!,
  }));

  return {
    exposure: businessExposureSchema.parse({
      source: mix.source,
      proposalId: mix.proposalId,
      weightsVersion: mix.weightsVersion,
      betasReleaseId: betas.release.releaseId,
      evToSalesReleaseId: declared ? null : evToSales!.release.releaseId,
      businesses,
      ...businessAggregates(businesses),
    }),
    missing,
  };
}

/**
 * Las rutas donde la exposición no se explica sola: un valor que no es ventas
 * por EV/Sales, un peso que no es su parte del valor, o una beta o D/E
 * combinada que no es la suma ponderada. Vacío cuando todo coincide.
 */
export function businessExposureMismatches(
  exposure: BusinessExposure,
): string[] {
  const mismatches: string[] = [];
  const declared = exposure.source === "owner_declaration";

  exposure.businesses.forEach((item, index) => {
    if (
      !declared &&
      !parseDecimal(item.revenue!, "revenue")
        .times(parseDecimal(item.evToSales!, "ev_sales"))
        .eq(parseDecimal(item.estimatedValue!, "estimated_value"))
    ) {
      mismatches.push(`costOfCapital.businessExposure.businesses.${index}`);
    }
  });

  if (!declared && mismatches.length === 0) {
    const expected = weightsOf(
      exposure.businesses,
      exposure.businesses.map(() => null),
    );

    exposure.businesses.forEach((item, index) => {
      if (item.weight !== expected[index]) {
        mismatches.push(
          `costOfCapital.businessExposure.businesses.${index}.weight`,
        );
      }
    });
  }

  const aggregates = businessAggregates(exposure.businesses);

  if (aggregates.unleveredBeta !== exposure.unleveredBeta) {
    mismatches.push("costOfCapital.businessExposure.unleveredBeta");
  }
  if (aggregates.debtToEquity !== exposure.debtToEquity) {
    mismatches.push("costOfCapital.businessExposure.debtToEquity");
  }

  return mismatches;
}
