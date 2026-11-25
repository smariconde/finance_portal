import type { XbrlContext, XbrlInstance } from "./sec-xbrl-instance";

/**
 * Las líneas de negocio de un 10-K (`F6-48`,
 * [ADR 0086](../../../../docs/architecture/adr/0086-business-mix-beta.md),
 * decisión 1): los ingresos del ejercicio por segmento o por producto, leídos
 * del instance XBRL. companyfacts no trae dimensiones.
 *
 * Se leen dos ejes porque ninguno alcanza solo: Apple segmenta por geografía y
 * publica lo de industria en `ProductOrServiceAxis`, y Corning etiqueta sus
 * segmentos en ese mismo eje. Qué eje describe el negocio lo decide quien
 * mapea; este lector sólo ofrece lo que el filing publicó.
 *
 * - El período es el ejercicio completo que cierra el 10-K: termina en su
 *   fecha y dura entre 350 y 380 días.
 * - Un contexto entra con **un** miembro en el eje, solo o acompañado de
 *   `ConsolidationItemsAxis = OperatingSegmentsMember` (así etiquetan sus
 *   segmentos Walmart, Costco o Coca-Cola). Cualquier otra combinación es un
 *   cruce —segmento por país, producto por cliente— y no es una línea.
 * - Por eje gana el primer concepto de ingresos que publique dos o más líneas
 *   positivas. Un miembro con dos valores distintos se descarta.
 * - Un eje con menos de dos líneas no se ofrece; sin ninguno, no hay mezcla
 *   que preguntar.
 */
export const SEC_XBRL_BUSINESS_LINES_VERSION = "sec-xbrl-business-lines-1.0.0";

export const BUSINESS_LINE_AXES = [
  "StatementBusinessSegmentsAxis",
  "ProductOrServiceAxis",
] as const;

export type BusinessLineAxis = (typeof BUSINESS_LINE_AXES)[number];

export const BUSINESS_LINE_CONCEPTS = [
  "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
  "us-gaap:Revenues",
  "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
  "us-gaap:SalesRevenueNet",
] as const;

const CONSOLIDATION_AXIS = "ConsolidationItemsAxis";
const OPERATING_SEGMENTS = "OperatingSegmentsMember";
const MIN_DAYS = 350;
const MAX_DAYS = 380;
const MAX_LINES_PER_AXIS = 40;
const DAY_MS = 86_400_000;

export type BusinessLine = {
  /** `L1`…: lo único que la tarea puede nombrar. */
  readonly lineId: string;
  readonly axis: BusinessLineAxis;
  /** Nombre local del miembro, sin prefijo (`GoogleCloudMember`). */
  readonly member: string;
  readonly concept: string;
  /** El texto publicado en USD, nunca un `number`. */
  readonly amount: string;
};

export type BusinessLines = {
  readonly version: typeof SEC_XBRL_BUSINESS_LINES_VERSION;
  readonly fiscalYearEnd: string;
  readonly lines: readonly BusinessLine[];
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

/** El miembro del eje si el contexto es una línea, o `null`. */
function lineMember(context: XbrlContext, axis: string): string | null {
  if (context.typed) return null;
  const onAxis = context.members.filter((item) => item.axis === axis);
  const others = context.members.filter((item) => item.axis !== axis);
  if (onAxis.length !== 1) return null;
  if (
    others.length > 1 ||
    (others.length === 1 &&
      (others[0]!.axis !== CONSOLIDATION_AXIS ||
        others[0]!.member !== OPERATING_SEGMENTS))
  ) {
    return null;
  }
  return onAxis[0]!.member;
}

function positive(value: string): boolean {
  return !value.startsWith("-") && /[1-9]/u.test(value);
}

/** Orden por monto descendente sin pasar por `number`. */
function compareAmounts(left: string, right: string): number {
  const whole = (value: string) => value.split(".")[0]!.replace(/^0+/u, "");
  const [a, b] = [whole(left), whole(right)];
  if (a.length !== b.length) return b.length - a.length;
  return b < a ? -1 : b > a ? 1 : 0;
}

export function readBusinessLines(
  instance: XbrlInstance,
  selection: { readonly cik: string; readonly fiscalYearEnd: string },
): BusinessLines | null {
  const offered: Omit<BusinessLine, "lineId">[] = [];

  for (const axis of BUSINESS_LINE_AXES) {
    for (const concept of BUSINESS_LINE_CONCEPTS) {
      const values = new Map<string, string>();
      const ambiguous = new Set<string>();

      for (const fact of instance.facts) {
        if (fact.concept !== concept) continue;
        const context = instance.contexts.get(fact.contextId);
        if (
          context === undefined ||
          context.cik !== selection.cik ||
          !fullYearEndingOn(context, selection.fiscalYearEnd)
        ) {
          continue;
        }
        const member = lineMember(context, axis);
        if (member === null) continue;
        const previous = values.get(member);
        if (previous === undefined) values.set(member, fact.value);
        else if (previous !== fact.value) ambiguous.add(member);
      }

      const lines = [...values.entries()]
        .filter(([member, value]) => !ambiguous.has(member) && positive(value))
        .sort(
          ([leftMember, left], [rightMember, right]) =>
            compareAmounts(left, right) || (leftMember < rightMember ? -1 : 1),
        )
        .slice(0, MAX_LINES_PER_AXIS);

      if (lines.length >= 2) {
        offered.push(
          ...lines.map(([member, amount]) => ({
            axis,
            member,
            concept,
            amount,
          })),
        );
        break;
      }
    }
  }

  if (offered.length === 0) return null;

  return {
    version: SEC_XBRL_BUSINESS_LINES_VERSION,
    fiscalYearEnd: selection.fiscalYearEnd,
    lines: offered.map((line, index) => ({
      lineId: `L${index + 1}`,
      ...line,
    })),
  };
}

/** Las líneas como texto: lo que ve el modelo y lo que la evidencia hashea. */
export function businessLinesText(lines: BusinessLines): string {
  return [
    `Revenue by business line, fiscal year ended ${lines.fiscalYearEnd}, in USD, from the 10-K's XBRL:`,
    ...lines.lines.map(
      (line) =>
        `${line.lineId} | ${line.axis} | ${line.member} | ${line.amount}`,
    ),
  ].join("\n");
}
