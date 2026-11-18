import type { XbrlMember } from "@/modules/fundamentals/domain/sec-xbrl-instance";

/**
 * Emisores con financiera cautiva, declarados por el owner (`F6-23`,
 * [ADR 0082](../../../../docs/architecture/adr/0082-captive-finance-split.md)).
 *
 * Nada en la presentación dice cuál de sus segmentos es la financiera: se
 * declara, como una sucesión. Cada uso nombra su eje y su miembro por nombre
 * local, medidos sobre el último 10-K de cada uno (2026-11-18). Un miembro que
 * el emisor renombre deja de encontrar hechos y la corrida lo nombra; nunca
 * vuelve a la deuda consolidada.
 *
 * `segments: null` es un emisor cuya apertura no está etiquetada: el job lo dice
 * en vez de caer en una receta que no cierra.
 */
export const CAPTIVE_FINANCE_DECLARATIONS_VERSION =
  "captive-finance-declarations-1.0.0";

export type CaptiveFinanceSegments = {
  /** El balance de la parte industrial: de acá sale la deuda que se resta. */
  readonly industrialDebt: XbrlMember;
  /** El gasto de intereses de la parte industrial, para la cobertura. */
  readonly industrialInterest: XbrlMember;
  /** La deuda de la financiera: se muestra, nunca se resta. */
  readonly financeDebt: XbrlMember;
};

export type CaptiveFinanceDeclaration = {
  readonly cik: string;
  readonly issuer: string;
  readonly financeArm: string;
  readonly segments: CaptiveFinanceSegments | null;
  readonly rationale: string;
};

export const DECLARED_CAPTIVE_FINANCE: readonly CaptiveFinanceDeclaration[] =
  Object.freeze([
    {
      cik: "0000018230",
      issuer: "Caterpillar",
      financeArm: "Cat Financial",
      segments: {
        industrialDebt: {
          axis: "ProductOrServiceAxis",
          member: "MachineryPowerEnergyMember",
        },
        industrialInterest: {
          axis: "ProductOrServiceAxis",
          member: "AllOtherExcludingFinancialProductsMember",
        },
        financeDebt: {
          axis: "ProductOrServiceAxis",
          member: "FinancialProductsMember",
        },
      },
      rationale:
        "El balance separa Machinery, Power & Energy de Financial Products; el interés industrial se publica como «excluding Financial Products».",
    },
    {
      cik: "0000315189",
      issuer: "Deere & Company",
      financeArm: "John Deere Financial",
      segments: null,
      rationale:
        "El 10-K no etiqueta la apertura Equipment Operations / Financial Services del balance: la deuda industrial no se puede leer del instance.",
    },
    {
      cik: "0001467858",
      issuer: "General Motors",
      financeArm: "GM Financial",
      segments: {
        industrialDebt: {
          axis: "BusinessGroupAxis",
          member: "AutomotiveMember",
        },
        industrialInterest: {
          axis: "BusinessGroupAxis",
          member: "AutomotiveMember",
        },
        financeDebt: { axis: "BusinessGroupAxis", member: "GmFinancialMember" },
      },
      rationale:
        "El balance separa Automotive de GM Financial en un eje propio del emisor.",
    },
    {
      cik: "0000037996",
      issuer: "Ford Motor",
      financeArm: "Ford Credit",
      segments: {
        industrialDebt: {
          axis: "StatementBusinessSegmentsAxis",
          member: "CompanyExcludingFordCreditMember",
        },
        industrialInterest: {
          axis: "StatementBusinessSegmentsAxis",
          member: "CompanyExcludingFordCreditMember",
        },
        financeDebt: {
          axis: "StatementBusinessSegmentsAxis",
          member: "FordCreditMember",
        },
      },
      rationale:
        "El balance separa la compañía sin Ford Credit de Ford Credit; el interés industrial es el de la deuda sin Ford Credit.",
    },
    {
      cik: "0000075362",
      issuer: "PACCAR",
      financeArm: "PACCAR Financial Services",
      segments: {
        industrialDebt: {
          axis: "StatementBusinessSegmentsAxis",
          member: "TruckPartsAndOtherMember",
        },
        industrialInterest: {
          axis: "StatementBusinessSegmentsAxis",
          member: "TruckPartsAndOtherMember",
        },
        financeDebt: {
          axis: "StatementBusinessSegmentsAxis",
          member: "FinancialServicesMember",
        },
      },
      rationale:
        "El balance separa Truck, Parts and Other de Financial Services; la parte industrial no presenta una línea de deuda.",
    },
    {
      cik: "0000217346",
      issuer: "Textron",
      financeArm: "Textron Financial",
      segments: {
        industrialDebt: {
          axis: "ConsolidatedEntitiesAxis",
          member: "ManufacturingGroupMember",
        },
        industrialInterest: {
          axis: "ConsolidatedEntitiesAxis",
          member: "ManufacturingGroupMember",
        },
        financeDebt: {
          axis: "ConsolidatedEntitiesAxis",
          member: "FinanceGroupMember",
        },
      },
      rationale: "El balance separa el Manufacturing group del Finance group.",
    },
  ]);

export function declaredCaptiveFinance(
  cik: string | null,
): CaptiveFinanceDeclaration | null {
  return cik === null
    ? null
    : (DECLARED_CAPTIVE_FINANCE.find(
        (declaration) => declaration.cik === cik,
      ) ?? null);
}
