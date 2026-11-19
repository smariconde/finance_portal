import type { CoverShareFact } from "@/modules/fundamentals/domain/sec-xbrl-instance";

import { formatDecimal, parseDecimal, ZERO } from "./decimal-policy";
import { SHARES_OUTSTANDING_CONCEPT } from "./employee-equity-claim";

/**
 * Acciones en circulación de un filer con varias clases
 * (`shares-outstanding-classes-1.0.0`, `F6-32`, decisión del owner: «que se
 * pueda valuar todo lo posible»).
 *
 * `shares-outstanding-cover-1.0.0` lee la carátula sin dimensiones, y un filer
 * con varias clases sólo la publica por clase. Medido el 2026-11-18 en la
 * carátula del último 10-Q de PLTR (A, B y F), DDOG (A y B), RDDT (A, B y C en
 * cero), GOOGL (A, B y C), META (A y B), F (común y B) y BRK (A y B): todas
 * en `StatementClassOfStockAxis`, misma fecha, unidad en acciones.
 *
 * - Se suman todas las clases de una misma fecha, cada una con un único
 *   miembro explícito en ese eje y sin miembros tipados: una clase con otro
 *   eje o sin miembro no se adivina.
 * - Cada clase pesa uno, salvo un peso declarado por CIK en acciones de la
 *   clase que cotiza la security valuada: BRK suma A × 1.500 + B, porque una A
 *   se convierte en 1.500 B y la security del universo es BRK.B. Sumar A y B
 *   sin el peso inventaría 1.400 millones de acciones de más.
 * - Hace falta más de una clase: con una sola, el conteo sin dimensiones es el
 *   de la regla anterior.
 * - El hecho no tiene observación propia: cita la presentación y nombra la
 *   regla en sus marcas de calidad.
 */
export const SHARES_OUTSTANDING_CLASSES_VERSION =
  "shares-outstanding-classes-1.0.0";

const CLASS_AXIS = "StatementClassOfStockAxis";

/**
 * Pesos declarados por CIK y miembro, en unidades de la clase valuada. Un
 * miembro que no figura pesa uno.
 */
export const DECLARED_SHARE_CLASS_WEIGHTS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  // Berkshire Hathaway: cada acción A se convierte en 1.500 B (10-K, Item 5).
  "0001067983": { CommonClassAMember: "1500" },
};

export type CoverShareClassesInput = {
  readonly cik: string;
  readonly facts: readonly CoverShareFact[];
  readonly accessionNumber: string;
  readonly acceptedAt: string;
};

export type CoverShareClassesReading =
  | {
      readonly status: "summed";
      readonly observation: {
        readonly concept: typeof SHARES_OUTSTANDING_CONCEPT;
        readonly asOf: string;
        readonly availableAt: string;
        readonly value: string;
        readonly observationId: null;
        readonly sourceDocumentId: string;
        readonly qualityFlags: readonly string[];
      };
      readonly classes: readonly {
        readonly member: string;
        readonly shares: string;
        readonly weight: string;
      }[];
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "no_class_facts"
        | "single_class"
        | "class_member_ambiguous"
        | "class_dates_differ";
    };

export function sumCoverShareClasses(
  input: CoverShareClassesInput,
): CoverShareClassesReading {
  const facts = input.facts.filter((fact) => fact.cik === input.cik);

  if (facts.length === 0) {
    return { status: "unavailable", reason: "no_class_facts" };
  }

  if (
    facts.some(
      (fact) =>
        fact.typed ||
        fact.members.length !== 1 ||
        fact.members[0]!.axis !== CLASS_AXIS ||
        fact.instant === null,
    )
  ) {
    return { status: "unavailable", reason: "class_member_ambiguous" };
  }

  const members = facts.map((fact) => fact.members[0]!.member);
  if (new Set(members).size !== members.length) {
    return { status: "unavailable", reason: "class_member_ambiguous" };
  }

  if (members.length < 2) {
    return { status: "unavailable", reason: "single_class" };
  }

  const dates = new Set(facts.map((fact) => fact.instant!));
  if (dates.size !== 1) {
    return { status: "unavailable", reason: "class_dates_differ" };
  }

  const weights = DECLARED_SHARE_CLASS_WEIGHTS[input.cik] ?? {};
  const classes = facts.map((fact) => {
    const member = fact.members[0]!.member;
    return {
      member,
      shares: fact.value,
      weight: weights[member] ?? "1",
    };
  });
  const total = classes.reduce(
    (sum, entry) =>
      sum.plus(
        parseDecimal(entry.shares, "coverShares").times(
          parseDecimal(entry.weight, "coverShareWeight"),
        ),
      ),
    ZERO,
  );

  if (!total.greaterThan(ZERO)) {
    return { status: "unavailable", reason: "no_class_facts" };
  }

  return {
    status: "summed",
    observation: {
      concept: SHARES_OUTSTANDING_CONCEPT,
      asOf: [...dates][0]!,
      availableAt: input.acceptedAt,
      value: formatDecimal(total, "sharesOutstanding"),
      observationId: null,
      sourceDocumentId: input.accessionNumber,
      qualityFlags: [
        SHARES_OUTSTANDING_CLASSES_VERSION,
        ...(Object.keys(weights).length > 0
          ? ["share_class_weights_declared"]
          : []),
      ],
    },
    classes,
  };
}
