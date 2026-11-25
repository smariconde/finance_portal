import { z } from "zod";

import type {
  XbrlContext,
  XbrlShareFact,
  XbrlShareFacts,
} from "@/modules/fundamentals/domain/sec-xbrl-instance";

import {
  type Dec,
  engineDecimalSchema,
  formatDecimal,
  parseDecimal,
  ZERO,
} from "./decimal-policy";

/**
 * Acciones diluidas cuando companyfacts no trae un conteo sin dimensiones
 * (`diluted-shares-reconciled-1.0.0`, `F6-49`).
 *
 * Visa publica acciones diluidas y EPS sólo por clase desde 2009, Hershey y
 * Constellation también, y ExxonMobil dejó de etiquetar las diluidas en 2013
 * porque son iguales a las básicas. Sin el conteo, la evaluación no empieza.
 *
 * El conteo es el que el propio filing usa para su EPS diluido: el instance del
 * 10-K del ejercicio, leído por `sec-xbrl-share-facts-1.0.0`. Candidatos:
 *
 * - `class_diluted`: las diluidas de una clase de `StatementClassOfStockAxis`
 *   con su EPS diluido. La clase que cotiza «as-converted» divide toda la
 *   utilidad (Visa: clase A, 23.504 / 1.907 = 12,32).
 * - `undimensioned_diluted`: las diluidas sin dimensiones con el EPS diluido
 *   sin dimensiones.
 * - `basic_reconciles_diluted_eps`: sin diluidas, las básicas sin dimensiones
 *   con el EPS diluido sin dimensiones (ExxonMobil).
 *
 * Un candidato concilia si `|utilidad − EPS × acciones|` no supera el redondeo
 * impreso de los tres números (`decimals`): medio dígito del EPS por las
 * acciones, medio dígito de las acciones por el EPS y medio dígito de la
 * utilidad. La utilidad es la disponible a comunes diluida si se publica, si no
 * `NetIncomeLoss`, ambas sin dimensiones y del ejercicio completo. Tiene que
 * conciliar exactamente uno: ninguno o dos se nombran, nunca se elige ni se
 * suman clases.
 */
export const DILUTED_SHARES_RECONCILED_VERSION =
  "diluted-shares-reconciled-1.0.0";

export const DILUTED_SHARES_US_GAAP_CONCEPTS = [
  "WeightedAverageNumberOfDilutedSharesOutstanding",
  "WeightedAverageNumberOfSharesOutstandingBasic",
  "EarningsPerShareDiluted",
  "NetIncomeLossAvailableToCommonStockholdersDiluted",
  "NetIncomeLoss",
] as const;

const CLASS_AXIS = "StatementClassOfStockAxis";
const NET_INCOME_CONCEPTS = [
  "us-gaap:NetIncomeLossAvailableToCommonStockholdersDiluted",
  "us-gaap:NetIncomeLoss",
] as const;
const MIN_DAYS = 350;
const MAX_DAYS = 380;
const DAY_MS = 86_400_000;

export const dilutedSharesBasisSchema = z.enum([
  "class_diluted",
  "undimensioned_diluted",
  "basic_reconciles_diluted_eps",
]);

export type DilutedSharesBasis = z.infer<typeof dilutedSharesBasisSchema>;

const decimalText = z.string().regex(/^-?[0-9]{1,24}(?:\.[0-9]{1,12})?$/u);

/** Lo que queda congelado en el perfil de completitud cuando se usa. */
export const dilutedSharesReconciledSchema = z.object({
  version: z.literal(DILUTED_SHARES_RECONCILED_VERSION),
  basis: dilutedSharesBasisSchema,
  /** Miembro de la clase, sin prefijo; `null` sin dimensiones. */
  member: z.string().min(1).max(128).nullable(),
  fiscalYearEnd: z.iso.date(),
  shares: decimalText,
  dilutedEps: decimalText,
  netIncome: decimalText,
  netIncomeConcept: z.enum(NET_INCOME_CONCEPTS),
  /** `|utilidad − EPS × acciones|` y el redondeo que la admite. */
  residual: decimalText,
  tolerance: decimalText,
  accessionNumber: z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
  availableAt: z.iso.datetime({ offset: true }),
});

export type DilutedSharesReconciled = z.infer<
  typeof dilutedSharesReconciledSchema
>;

export type DilutedSharesUnavailableReason =
  | "net_income_missing"
  | "net_income_ambiguous"
  | "no_candidates"
  | "none_reconciles"
  | "several_reconcile";

export type DilutedSharesReading =
  | {
      readonly status: "reconciled";
      readonly reconciled: DilutedSharesReconciled;
    }
  | {
      readonly status: "unavailable";
      readonly reason: DilutedSharesUnavailableReason;
    };

export type DilutedSharesFiling = {
  readonly accessionNumber: string;
  readonly acceptedAt: string;
  readonly fiscalYearEnd: string;
  readonly read: XbrlShareFacts;
};

function fullYearEndingOn(context: XbrlContext, endDate: string): boolean {
  if (context.startDate === null || context.endDate !== endDate) return false;
  const days =
    (Date.parse(`${context.endDate}T00:00:00Z`) -
      Date.parse(`${context.startDate}T00:00:00Z`)) /
      DAY_MS +
    1;
  return days >= MIN_DAYS && days <= MAX_DAYS;
}

/** `null` sin dimensiones, el miembro de la clase, o `undefined` si es otro cruce. */
function classOf(context: XbrlContext): string | null | undefined {
  if (context.typed) return undefined;
  if (context.members.length === 0) return null;
  const [only, ...rest] = context.members;
  return rest.length === 0 && only!.axis === CLASS_AXIS
    ? only!.member
    : undefined;
}

function halfUnit(decimals: number | null): Dec {
  return decimals === null
    ? ZERO
    : parseDecimal("0.5", "halfUnit").times(
        parseDecimal("10", "base").pow(-decimals),
      );
}

type Valued = { readonly value: Dec; readonly fact: XbrlShareFact };

export function reconcileDilutedShares(
  filing: DilutedSharesFiling,
  cik: string,
): DilutedSharesReading {
  const { read, fiscalYearEnd } = filing;
  // Por concepto y por clase (`null` = sin dimensiones), los valores distintos.
  const byClass = new Map<string, Map<string | null, Valued[]>>();

  for (const fact of read.facts) {
    const context = read.contexts.get(fact.contextId);
    if (
      context === undefined ||
      context.cik !== cik ||
      !fullYearEndingOn(context, fiscalYearEnd)
    ) {
      continue;
    }
    const member = classOf(context);
    // Un texto que no es un decimal canónico (ceros a la izquierda) no se lee.
    if (
      member === undefined ||
      !engineDecimalSchema.safeParse(fact.value).success
    ) {
      continue;
    }
    const perClass = byClass.get(fact.concept) ?? new Map();
    const list: Valued[] = perClass.get(member) ?? [];
    if (!list.some((entry) => entry.fact.value === fact.value)) {
      list.push({ value: parseDecimal(fact.value, fact.concept), fact });
    }
    perClass.set(member, list);
    byClass.set(fact.concept, perClass);
  }

  const single = (concept: string, member: string | null, unit: string) => {
    const list = (byClass.get(concept)?.get(member) ?? []).filter(
      (entry) => entry.fact.unit === unit,
    );
    return list.length === 1
      ? list[0]!
      : list.length === 0
        ? null
        : "ambiguous";
  };

  let netIncome: Valued | null = null;
  let netIncomeConcept: (typeof NET_INCOME_CONCEPTS)[number] | null = null;
  for (const concept of NET_INCOME_CONCEPTS) {
    const found = single(concept, null, "usd");
    if (found === "ambiguous") {
      return { status: "unavailable", reason: "net_income_ambiguous" };
    }
    if (found !== null) {
      netIncome = found;
      netIncomeConcept = concept;
      break;
    }
  }
  if (netIncome === null || netIncomeConcept === null) {
    return { status: "unavailable", reason: "net_income_missing" };
  }

  type Candidate = {
    readonly basis: DilutedSharesBasis;
    readonly member: string | null;
    readonly shares: Valued;
    readonly eps: Valued;
  };
  const candidates: Candidate[] = [];
  const diluted = "us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding";
  const eps = "us-gaap:EarningsPerShareDiluted";

  for (const member of byClass.get(diluted)?.keys() ?? []) {
    const shares = single(diluted, member, "shares");
    const perShare = single(eps, member, "usd_per_share");
    if (
      shares === null ||
      shares === "ambiguous" ||
      perShare === null ||
      perShare === "ambiguous"
    ) {
      continue;
    }
    candidates.push({
      basis: member === null ? "undimensioned_diluted" : "class_diluted",
      member,
      shares,
      eps: perShare,
    });
  }

  if (!candidates.some((candidate) => candidate.member === null)) {
    const basic = single(
      "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
      null,
      "shares",
    );
    const perShare = single(eps, null, "usd_per_share");
    if (
      basic !== null &&
      basic !== "ambiguous" &&
      perShare !== null &&
      perShare !== "ambiguous"
    ) {
      candidates.push({
        basis: "basic_reconciles_diluted_eps",
        member: null,
        shares: basic,
        eps: perShare,
      });
    }
  }

  const positive = candidates.filter((candidate) =>
    candidate.shares.value.greaterThan(ZERO),
  );
  if (positive.length === 0) {
    return { status: "unavailable", reason: "no_candidates" };
  }

  const measured = positive.map((candidate) => {
    const residual = netIncome!.value
      .minus(candidate.eps.value.times(candidate.shares.value))
      .abs();
    const tolerance = halfUnit(candidate.eps.fact.decimals)
      .times(candidate.shares.value)
      .plus(
        halfUnit(candidate.shares.fact.decimals).times(
          candidate.eps.value.abs(),
        ),
      )
      .plus(halfUnit(netIncome!.fact.decimals));
    return { candidate, residual, tolerance };
  });
  const reconciling = measured.filter((entry) =>
    entry.residual.lessThanOrEqualTo(entry.tolerance),
  );

  if (reconciling.length === 0) {
    return { status: "unavailable", reason: "none_reconciles" };
  }
  if (reconciling.length > 1) {
    return { status: "unavailable", reason: "several_reconcile" };
  }

  const { candidate, residual, tolerance } = reconciling[0]!;
  return {
    status: "reconciled",
    reconciled: dilutedSharesReconciledSchema.parse({
      version: DILUTED_SHARES_RECONCILED_VERSION,
      basis: candidate.basis,
      member: candidate.member,
      fiscalYearEnd,
      shares: candidate.shares.fact.value,
      dilutedEps: candidate.eps.fact.value,
      netIncome: netIncome.fact.value,
      netIncomeConcept,
      residual: formatDecimal(residual, "residual"),
      tolerance: formatDecimal(tolerance, "tolerance"),
      accessionNumber: filing.accessionNumber,
      availableAt: filing.acceptedAt,
    }),
  };
}
