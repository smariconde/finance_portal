import { z } from "zod";

import {
  segmentFacts,
  type XbrlInstance,
  type XbrlMember,
} from "@/modules/fundamentals/domain/sec-xbrl-instance";
import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";

import {
  LINE_ITEMS,
  type FiscalYear,
  type LineItemId,
  type LineItemValue,
} from "./annual-fundamentals";
import type { CoverageEvidence } from "./cost-of-capital";
import { divide, formatDecimal, parseDecimal, ZERO } from "./decimal-policy";
import {
  CAPTIVE_FINANCE_DECLARATIONS_VERSION,
  type CaptiveFinanceDeclaration,
} from "./declared-captive-finance";
import {
  freezeInterest,
  frozenInterestSchema,
  frozenInterestValue,
  interestExpenseOf,
} from "./interest-expense";
import {
  DEBT_COMPONENT_KEYS,
  DEBT_ITEMS,
  resolveReportedDebt,
  type DebtComponentKey,
  type ReportedDebt,
} from "./reported-debt";
import { conceptFactSchema, type ConceptFact } from "./valuation-facts";

/**
 * La deuda de una empresa con financiera cautiva (`F6-23`,
 * [ADR 0082](../../../../docs/architecture/adr/0082-captive-finance-split.md)).
 *
 * Decisión del owner del 2026-11-18, con la tabla medida: **se resta la deuda
 * industrial**. La financiera queda dentro del negocio como capital neto: su
 * ganancia después de sus intereses ya está en el EBIT y sus activos netos de su
 * deuda, en el capital invertido. Restar también su deuda valuaría un negocio
 * de diferencial al WACC industrial y descontaría dos veces lo que el EBIT ya
 * descontó.
 *
 * `captive-finance-split-1.0.0`, sobre el 10-K cuyo cierre es el ejercicio
 * base:
 *
 * 1. la deuda industrial son las partidas y las recetas de `reported-debt-1.0.0`
 *    aplicadas a los hechos del miembro industrial; sin receta,
 *    `industrial_debt_unresolved`;
 * 2. el interés industrial es la regla de `interest-expense-1.0.0` sobre los
 *    hechos del miembro del interés en el ejercicio; sin gasto,
 *    `industrial_interest_missing`;
 * 3. el EBIT tiene que ser el resultado operativo publicado: uno derivado del
 *    resultado antes de impuestos no prueba que ya descuente el interés de la
 *    financiera (`ebit_derived_from_pretax`).
 *
 * La caja sigue consolidada: la de la financiera cuenta como excedente. Es una
 * aproximación que la ADR nombra; CAT y GM no etiquetan una caja industrial.
 */
export const CAPTIVE_FINANCE_SPLIT_VERSION = "captive-finance-split-1.0.0";

/** Un ejercicio dura entre 52 semanas y un año bisiesto más una semana. */
const MIN_FISCAL_YEAR_DAYS = 357;
const MAX_FISCAL_YEAR_DAYS = 373;

const memberSchema = z.object({
  axis: z.string().trim().min(1).max(128),
  member: z.string().trim().min(1).max(128),
});

const debtFact = conceptFactSchema.nullable();
const debtFactsSchema = z.object(
  Object.fromEntries(
    DEBT_COMPONENT_KEYS.map((key) => [key, debtFact]),
  ) as Record<DebtComponentKey, typeof debtFact>,
);

export type CaptiveDebtFacts = z.infer<typeof debtFactsSchema>;

export const captiveFinanceSplitSchema = z.object({
  version: z.literal(CAPTIVE_FINANCE_SPLIT_VERSION),
  declarationVersion: z.literal(CAPTIVE_FINANCE_DECLARATIONS_VERSION),
  cik: z.string().regex(/^[0-9]{10}$/u),
  financeArm: z.string().trim().min(1).max(128),
  accessionNumber: z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
  fiscalYearEnd: calendarDateSchema,
  segments: z.object({
    industrialDebt: memberSchema,
    industrialInterest: memberSchema,
    financeDebt: memberSchema,
  }),
  /** Lo que la receta lee: la deuda que se resta. */
  industrialDebt: debtFactsSchema,
  /** La deuda de la financiera: se muestra, nunca se resta. */
  financeDebt: debtFactsSchema,
  /** El gasto de intereses industrial, con su base. */
  industrialInterest: frozenInterestSchema,
});

export type CaptiveFinanceSplit = z.infer<typeof captiveFinanceSplitSchema>;

export const captiveFinanceUnavailableReasonSchema = z.enum([
  /** El emisor no etiqueta su apertura (DE). */
  "split_not_tagged",
  /** No se pudo leer el 10-K del ejercicio base al corte, o su instance. */
  "filing_unavailable",
  "industrial_debt_unresolved",
  "industrial_interest_missing",
  "ebit_derived_from_pretax",
]);

export type CaptiveFinanceUnavailableReason = z.infer<
  typeof captiveFinanceUnavailableReasonSchema
>;

/** Lo que la evaluación sabe de la financiera de un emisor declarado. */
export type CaptiveFinanceAssessment =
  | {
      readonly status: "split";
      readonly declaration: CaptiveFinanceDeclaration;
      readonly split: CaptiveFinanceSplit;
    }
  | {
      readonly status: "unavailable";
      readonly declaration: CaptiveFinanceDeclaration;
      readonly reason: CaptiveFinanceUnavailableReason;
    };

/** El 10-K leído: lo que el job le pasa a la evaluación. */
export type CaptiveFinanceFiling = {
  readonly accessionNumber: string;
  readonly acceptedAt: string;
  readonly reportDate: string;
  readonly instance: XbrlInstance;
};

const DEBT_CONCEPTS: Readonly<Record<DebtComponentKey, readonly string[]>> =
  Object.fromEntries(
    DEBT_COMPONENT_KEYS.map((key) => [key, conceptsOf(DEBT_ITEMS[key])]),
  ) as Record<DebtComponentKey, readonly string[]>;

/** Las partidas de las que `interest-expense-1.0.0` puede leer. */
const INTEREST_ITEMS: readonly LineItemId[] = [
  "interest_expense",
  "interest_expense_debt",
  "finance_lease_interest_expense",
  "interest_net_nonoperating",
  "interest_paid",
];

function conceptsOf(item: LineItemId): readonly string[] {
  const definition = LINE_ITEMS.find((line) => line.item === item);
  if (definition === undefined) {
    throw new Error(`Line item ${item} is not declared.`);
  }
  return definition.concepts;
}

function factOf(
  concept: string,
  value: string,
  member: XbrlMember,
  filing: CaptiveFinanceFiling,
  sourceId: string,
): ConceptFact {
  return {
    asOf: filing.reportDate,
    availableAt: filing.acceptedAt,
    sourceId,
    sourceDocumentId: filing.accessionNumber,
    observationId: null,
    qualityFlags: [`xbrl_member:${member.member}`],
    // El valor publicado, como decimal del motor: nunca pasa por `number`.
    value: formatDecimal(
      parseDecimal(value, `captiveFinance.${concept}`),
      `captiveFinance.${concept}`,
    ),
    currency: "USD",
    unit: "monetary",
    concept,
  };
}

function debtFactsOf(
  filing: CaptiveFinanceFiling,
  cik: string,
  member: XbrlMember,
  sourceId: string,
): CaptiveDebtFacts {
  const facts = segmentFacts(filing.instance, {
    cik,
    member,
    period: { kind: "instant", date: filing.reportDate },
  });

  return Object.fromEntries(
    DEBT_COMPONENT_KEYS.map((key) => {
      const concept = DEBT_CONCEPTS[key].find((candidate) =>
        facts.has(candidate),
      );
      return [
        key,
        concept === undefined
          ? null
          : factOf(concept, facts.get(concept)!, member, filing, sourceId),
      ];
    }),
  ) as CaptiveDebtFacts;
}

/** Los componentes de deuda congelados, como los lee la receta. */
export function captiveDebtInput(
  facts: CaptiveDebtFacts,
): Record<DebtComponentKey, { value: string; concept: string } | null> {
  return Object.fromEntries(
    DEBT_COMPONENT_KEYS.map((key) => {
      const fact = facts[key];
      return [
        key,
        fact === null ? null : { value: fact.value, concept: fact.concept },
      ];
    }),
  ) as Record<DebtComponentKey, { value: string; concept: string } | null>;
}

/** La deuda industrial que resta la corrida. Pura. */
export function industrialDebtOf(split: CaptiveFinanceSplit): ReportedDebt {
  return resolveReportedDebt(captiveDebtInput(split.industrialDebt));
}

/** La deuda de la financiera, sólo para mostrarla. */
export function financeDebtOf(split: CaptiveFinanceSplit): ReportedDebt {
  return resolveReportedDebt(captiveDebtInput(split.financeDebt));
}

function interestYear(
  filing: CaptiveFinanceFiling,
  cik: string,
  member: XbrlMember,
): FiscalYear {
  const facts = segmentFacts(filing.instance, {
    cik,
    member,
    period: {
      kind: "duration",
      endDate: filing.reportDate,
      minDays: MIN_FISCAL_YEAR_DAYS,
      maxDays: MAX_FISCAL_YEAR_DAYS,
    },
  });
  const items: Partial<Record<LineItemId, LineItemValue>> = {};

  for (const item of INTEREST_ITEMS) {
    const concept = conceptsOf(item).find((candidate) => facts.has(candidate));
    if (concept !== undefined) {
      items[item] = {
        item,
        concept,
        value: facts.get(concept)!,
        unit: "USD",
        currency: "USD",
        asOf: filing.reportDate,
        observationId: `${filing.accessionNumber}:${concept}`,
        availableAt: filing.acceptedAt,
        recordedAt: filing.acceptedAt,
        sourceDocumentId: filing.accessionNumber,
      };
    }
  }

  return { fiscalYearEnd: filing.reportDate, items };
}

/**
 * Aplica la regla a un 10-K leído. Pura: el job ya eligió el 10-K del ejercicio
 * base visible al corte.
 */
export function deriveCaptiveFinanceSplit(input: {
  readonly declaration: CaptiveFinanceDeclaration;
  readonly filing: CaptiveFinanceFiling | null;
  readonly baseYear: FiscalYear;
  readonly sourceId: string;
}): CaptiveFinanceAssessment {
  const { declaration, filing, baseYear, sourceId } = input;
  const unavailable = (
    reason: CaptiveFinanceUnavailableReason,
  ): CaptiveFinanceAssessment => ({
    status: "unavailable",
    declaration,
    reason,
  });

  if (declaration.segments === null) {
    return unavailable("split_not_tagged");
  }

  if (filing === null || filing.reportDate !== baseYear.fiscalYearEnd) {
    return unavailable("filing_unavailable");
  }

  const { segments } = declaration;
  const industrialDebt = debtFactsOf(
    filing,
    declaration.cik,
    segments.industrialDebt,
    sourceId,
  );

  if (
    resolveReportedDebt(captiveDebtInput(industrialDebt)).status !== "resolved"
  ) {
    return unavailable("industrial_debt_unresolved");
  }

  const reading = interestExpenseOf(
    interestYear(filing, declaration.cik, segments.industrialInterest),
  );

  if (reading === null || !reading.value.greaterThan(ZERO)) {
    return unavailable("industrial_interest_missing");
  }

  if (baseYear.items.operating_income === undefined) {
    return unavailable("ebit_derived_from_pretax");
  }

  const split = captiveFinanceSplitSchema.parse({
    version: CAPTIVE_FINANCE_SPLIT_VERSION,
    declarationVersion: CAPTIVE_FINANCE_DECLARATIONS_VERSION,
    cik: declaration.cik,
    financeArm: declaration.financeArm,
    accessionNumber: filing.accessionNumber,
    fiscalYearEnd: filing.reportDate,
    segments,
    industrialDebt,
    financeDebt: debtFactsOf(
      filing,
      declaration.cik,
      segments.financeDebt,
      sourceId,
    ),
    industrialInterest: freezeInterest(reading, (item) =>
      factOf(
        item.concept,
        item.value,
        segments.industrialInterest,
        filing,
        sourceId,
      ),
    ),
  });

  return { status: "split", declaration, split };
}

/** Los hechos de la apertura con su ruta, para los checks de tiempo. */
export function listCaptiveFinanceFacts(
  split: CaptiveFinanceSplit,
  path: string,
): readonly { path: string; fact: ConceptFact }[] {
  return [
    ...(["industrialDebt", "financeDebt"] as const).flatMap((block) =>
      DEBT_COMPONENT_KEYS.flatMap((key) => {
        const fact = split[block][key];
        return fact === null ? [] : [{ path: `${path}.${block}.${key}`, fact }];
      }),
    ),
    ...split.industrialInterest.facts.map((fact, index) => ({
      path: `${path}.industrialInterest.facts.${index}`,
      fact,
    })),
  ];
}

/**
 * La cobertura del rating sintético: el EBIT publicado sobre el interés
 * industrial del mismo ejercicio. Con el consolidado, GM tendría 0,44.
 */
export function captiveCoverage(
  split: CaptiveFinanceSplit,
  ebit: { readonly value: string; readonly availableAt: string },
): CoverageEvidence {
  const interest = frozenInterestValue(split.industrialInterest);
  const availableAt = [
    ebit.availableAt,
    ...split.industrialInterest.facts.map((fact) => fact.availableAt),
  ].sort((left, right) => right.localeCompare(left))[0]!;

  return {
    value: formatDecimal(
      divide(
        parseDecimal(ebit.value, "interest_coverage.ebit"),
        interest,
        "interest_coverage",
      ),
      "interest_coverage",
    ),
    fiscalYearEnd: split.fiscalYearEnd,
    fromLatestFiscalYear: true,
    availableAt,
    interestBasis: "captive_industrial",
  };
}
