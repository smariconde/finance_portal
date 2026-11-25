import type { XbrlShareFacts } from "@/modules/fundamentals/domain/sec-xbrl-instance";

import { engineDecimalSchema, parseDecimal, ZERO } from "./decimal-policy";

/**
 * Participaciones no controlantes en cero sólo con evidencia
 * (`noncontrolling-interest-evidence-1.0.0`, `F6-49`).
 *
 * Un filer que sólo publica el patrimonio **incluyendo** a los no controlantes
 * y ningún `MinorityInterest` deja el reclamo en `missing`: la ausencia de un
 * hecho no prueba que sea cero (ADR 0038). Visa es el caso medido: desde 2011
 * sólo etiqueta `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest`.
 *
 * La evidencia es el estado de patrimonio del mismo filing cuyo cierre es el
 * del balance de la corrida: el total sin dimensiones y sus componentes en
 * `StatementEquityComponentsAxis`, a esa fecha.
 *
 * - Hacen falta dos componentes o más, y que sumen exactamente el total
 *   (dentro del redondeo impreso de cada número): un estado incompleto no
 *   prueba nada.
 * - Un componente de no controlantes en cero también es evidencia; uno con
 *   monto no lo es (`noncontrolling_reported`): eso es un reclamo, no un cero.
 * - Un `MinorityInterest` sin dimensiones a esa fecha también lo nombra.
 *
 * Medido en Visa: 10-K al 2026-09-30, cinco componentes suman 36.111 M; 10-Q al
 * 2026-06-30, cinco suman 35.178 M. Ninguno es de no controlantes.
 */
export const NONCONTROLLING_INTEREST_EVIDENCE_VERSION =
  "noncontrolling-interest-evidence-1.0.0";

export const NONCONTROLLING_INTEREST_US_GAAP_CONCEPTS = [
  "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  "MinorityInterest",
] as const;

const TOTAL =
  "us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest";
const MINORITY = "us-gaap:MinorityInterest";
const COMPONENTS_AXIS = "StatementEquityComponentsAxis";
const NONCONTROLLING_MEMBER = /Noncontrolling|MinorityInterest/u;

export type NoncontrollingInterestEvidence =
  | {
      readonly status: "zero";
      readonly version: typeof NONCONTROLLING_INTEREST_EVIDENCE_VERSION;
      readonly accessionNumber: string;
      readonly asOf: string;
      readonly total: string;
      readonly components: number;
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "total_missing"
        | "components_missing"
        | "components_do_not_add_up"
        | "noncontrolling_reported";
    };

export function noncontrollingInterestEvidence(input: {
  readonly cik: string;
  readonly asOf: string;
  readonly accessionNumber: string;
  readonly read: XbrlShareFacts;
}): NoncontrollingInterestEvidence {
  const totals = new Set<string>();
  const components = new Map<string, Set<string>>();
  const decimals: (number | null)[] = [];
  let minority: string | null = null;

  for (const fact of input.read.facts) {
    if (fact.unit !== "usd") continue;
    const context = input.read.contexts.get(fact.contextId);
    if (
      context === undefined ||
      context.cik !== input.cik ||
      context.typed ||
      context.instant !== input.asOf ||
      !engineDecimalSchema.safeParse(fact.value).success
    ) {
      continue;
    }

    if (fact.concept === MINORITY && context.members.length === 0) {
      minority = fact.value;
      continue;
    }
    if (fact.concept !== TOTAL) continue;

    if (context.members.length === 0) {
      totals.add(fact.value);
      decimals.push(fact.decimals);
      continue;
    }

    const [only, ...rest] = context.members;
    if (rest.length > 0 || only!.axis !== COMPONENTS_AXIS) continue;
    const values = components.get(only!.member) ?? new Set<string>();
    values.add(fact.value);
    components.set(only!.member, values);
    decimals.push(fact.decimals);
  }

  if (totals.size !== 1) {
    return { status: "unavailable", reason: "total_missing" };
  }
  if (minority !== null && !parseDecimal(minority, "minority").isZero()) {
    return { status: "unavailable", reason: "noncontrolling_reported" };
  }

  const single = [...components].filter(([, values]) => values.size === 1);
  if (single.length < 2 || single.length !== components.size) {
    return { status: "unavailable", reason: "components_missing" };
  }

  for (const [member, values] of single) {
    if (
      NONCONTROLLING_MEMBER.test(member) &&
      !parseDecimal([...values][0]!, "noncontrolling").isZero()
    ) {
      return { status: "unavailable", reason: "noncontrolling_reported" };
    }
  }

  const total = [...totals][0]!;
  const sum = single.reduce(
    (acc, [, values]) => acc.plus(parseDecimal([...values][0]!, "component")),
    ZERO,
  );
  const tolerance = decimals.reduce(
    (acc, power) =>
      power === null
        ? acc
        : acc.plus(
            parseDecimal("0.5", "halfUnit").times(
              parseDecimal("10", "base").pow(-power),
            ),
          ),
    ZERO,
  );

  if (sum.minus(parseDecimal(total, "total")).abs().greaterThan(tolerance)) {
    return { status: "unavailable", reason: "components_do_not_add_up" };
  }

  return {
    status: "zero",
    version: NONCONTROLLING_INTEREST_EVIDENCE_VERSION,
    accessionNumber: input.accessionNumber,
    asOf: input.asOf,
    total,
    components: single.length,
  };
}

/** El texto del reclamo declarado ausente, con la regla y el filing. */
export function noncontrollingInterestRationale(
  evidence: Extract<NoncontrollingInterestEvidence, { status: "zero" }>,
): string {
  return `${evidence.version}: the equity statement of filing ${evidence.accessionNumber} at ${evidence.asOf} adds ${evidence.components} components to the total with no noncontrolling interest; valued at zero and named.`;
}
