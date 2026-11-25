import type {
  CoverShareFact,
  XbrlShareFacts,
} from "@/modules/fundamentals/domain/sec-xbrl-instance";

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

/**
 * Clases que no valen lo mismo y cuya conversión cambia (`F6-49`): Visa
 * convierte cada B-1, B-2 y B-3 en A a una tasa que baja con cada depósito del
 * litigio, y sus preferentes de la serie A, B y C también convierten. Un peso
 * declarado quedaría viejo; el filing publica la tasa de cada clase y lo que
 * suma «as-converted», en conceptos de su propia extensión, en cada 10-Q y 10-K.
 *
 * - La clase que cotiza la security valuada pesa uno (Visa etiqueta su tasa
 *   como cero: no se convierte en sí misma).
 * - Cada otra clase de la carátula pesa su tasa del mismo filing, a la última
 *   fecha que no pase la de la carátula; sin tasa positiva no hay conteo.
 * - Lo que convierte y no está en la carátula —las preferentes— entra con las
 *   acciones «as-converted» que el filing publica por miembro a esa fecha.
 * - Control: el total tiene que quedar a no más del 1 % del total
 *   «as-converted» sin dimensiones del filing. Medido en Visa, la diferencia es
 *   la recompra entre el cierre y la carátula: −0,16 % (10-Q de junio 2026) y
 *   −0,19 % (10-K de septiembre).
 */
export const SHARES_OUTSTANDING_CLASSES_CONVERTED_VERSION =
  "shares-outstanding-classes-1.1.0";

export type DeclaredShareClassConversion = {
  /** Miembro de la clase que cotiza la security valuada. */
  readonly baseMember: string;
  /** Nombre local, en la extensión del filer, de la tasa por clase (`pure`). */
  readonly conversionRate: string;
  /** Nombre local, en la extensión, de las acciones «as-converted» (`shares`). */
  readonly asConvertedShares: string;
};

export const DECLARED_SHARE_CLASS_CONVERSIONS: Readonly<
  Record<string, DeclaredShareClassConversion>
> = {
  // Visa: clase A; B-1, B-2, B-3 y C y las preferentes A, B y C convierten
  // (10-K FY2026, nota de patrimonio, «as-converted class A common stock»).
  "0001403161": {
    baseMember: "CommonClassAMember",
    conversionRate: "CommonStockConversionRate",
    asConvertedShares: "SharesOutstandingAsConvertedBasis",
  },
};

/** Diferencia máxima contra el total «as-converted» del filing. */
export const AS_CONVERTED_TOLERANCE = "0.01";

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
  /** Hechos de extensión del mismo instance, cuando el CIK declara conversión. */
  readonly conversionFacts?: XbrlShareFacts | null;
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
      /** Sólo con conversión declarada: el total del filing y su fecha. */
      readonly control?: {
        readonly asOf: string;
        readonly filerTotal: string;
        readonly difference: string;
      };
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "no_class_facts"
        | "single_class"
        | "class_member_ambiguous"
        | "class_dates_differ"
        | "conversion_facts_missing"
        | "conversion_rate_missing"
        | "as_converted_total_missing"
        | "as_converted_total_mismatch";
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

  const coverDate = [...dates][0]!;
  const conversion = DECLARED_SHARE_CLASS_CONVERSIONS[input.cik];

  if (conversion !== undefined) {
    return convertedClasses(input, facts, coverDate, conversion);
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
      asOf: coverDate,
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

/** Hechos de un concepto de extensión con un único miembro de clase, por fecha. */
function extensionByMember(
  read: XbrlShareFacts,
  cik: string,
  local: string,
  unit: "pure" | "shares",
): Map<string, Map<string | null, string>> {
  const byDate = new Map<string, Map<string | null, string>>();
  const ambiguous = new Set<string>();
  for (const fact of read.facts) {
    if (fact.concept !== `extension:${local}` || fact.unit !== unit) continue;
    const context = read.contexts.get(fact.contextId);
    if (
      context === undefined ||
      context.cik !== cik ||
      context.typed ||
      context.instant === null ||
      context.members.length > 1 ||
      (context.members.length === 1 && context.members[0]!.axis !== CLASS_AXIS)
    ) {
      continue;
    }
    const member = context.members[0]?.member ?? null;
    const members = byDate.get(context.instant) ?? new Map();
    const previous = members.get(member);
    if (previous !== undefined && previous !== fact.value) {
      ambiguous.add(`${context.instant}\u0000${member ?? ""}`);
    }
    members.set(member, fact.value);
    byDate.set(context.instant, members);
  }
  for (const key of ambiguous) {
    const [date, member] = key.split("\u0000");
    byDate.get(date!)?.delete(member === "" ? null : member!);
  }
  return byDate;
}

function convertedClasses(
  input: CoverShareClassesInput,
  facts: readonly CoverShareFact[],
  coverDate: string,
  conversion: DeclaredShareClassConversion,
): CoverShareClassesReading {
  const read = input.conversionFacts;
  if (read === undefined || read === null) {
    return { status: "unavailable", reason: "conversion_facts_missing" };
  }

  const rates = extensionByMember(
    read,
    input.cik,
    conversion.conversionRate,
    "pure",
  );
  // La última fecha de tasas que no pasa la carátula: el cierre del filing.
  const rateDate = [...rates.keys()]
    .filter((date) => date <= coverDate)
    .sort()
    .at(-1);
  if (rateDate === undefined) {
    return { status: "unavailable", reason: "conversion_rate_missing" };
  }
  const rateOf = rates.get(rateDate)!;

  const classes: { member: string; shares: string; weight: string }[] = [];
  for (const fact of facts) {
    const member = fact.members[0]!.member;
    if (member === conversion.baseMember) {
      classes.push({ member, shares: fact.value, weight: "1" });
      continue;
    }
    const rate = rateOf.get(member);
    if (
      rate === undefined ||
      !parseDecimal(rate, "conversionRate").greaterThan(ZERO)
    ) {
      return { status: "unavailable", reason: "conversion_rate_missing" };
    }
    classes.push({ member, shares: fact.value, weight: rate });
  }
  if (!classes.some((entry) => entry.member === conversion.baseMember)) {
    return { status: "unavailable", reason: "conversion_rate_missing" };
  }

  const asConverted =
    extensionByMember(
      read,
      input.cik,
      conversion.asConvertedShares,
      "shares",
    ).get(rateDate) ?? new Map<string | null, string>();
  const filerTotal = asConverted.get(null);
  if (filerTotal === undefined) {
    return { status: "unavailable", reason: "as_converted_total_missing" };
  }
  const coverMembers = new Set(classes.map((entry) => entry.member));
  for (const [member, shares] of [...asConverted].sort(([left], [right]) =>
    (left ?? "").localeCompare(right ?? ""),
  )) {
    if (member === null || coverMembers.has(member)) continue;
    classes.push({ member, shares, weight: "1" });
  }

  const total = classes.reduce(
    (sum, entry) =>
      sum.plus(
        parseDecimal(entry.shares, "coverShares").times(
          parseDecimal(entry.weight, "coverShareWeight"),
        ),
      ),
    ZERO,
  );
  const reference = parseDecimal(filerTotal, "asConvertedTotal");
  if (!total.greaterThan(ZERO) || !reference.greaterThan(ZERO)) {
    return { status: "unavailable", reason: "no_class_facts" };
  }
  const difference = total.minus(reference).div(reference);
  if (
    difference.abs().greaterThan(parseDecimal(AS_CONVERTED_TOLERANCE, "tol"))
  ) {
    return { status: "unavailable", reason: "as_converted_total_mismatch" };
  }

  return {
    status: "summed",
    observation: {
      concept: SHARES_OUTSTANDING_CONCEPT,
      asOf: coverDate,
      availableAt: input.acceptedAt,
      value: formatDecimal(total, "sharesOutstanding"),
      observationId: null,
      sourceDocumentId: input.accessionNumber,
      qualityFlags: [
        SHARES_OUTSTANDING_CLASSES_CONVERTED_VERSION,
        "share_class_conversion_reported",
      ],
    },
    classes,
    control: {
      asOf: rateDate,
      filerTotal,
      difference: formatDecimal(difference.toDecimalPlaces(6), "difference"),
    },
  };
}
