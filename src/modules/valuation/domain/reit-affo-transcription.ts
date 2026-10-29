import { affoReconciliationSchema } from "./reit-input";
import {
  judgeReitAffo,
  REIT_AFFO_POLICY_VERSION,
  type ReitAffoInput,
  type ReitAffoOutput,
} from "./reit-affo-task";
import { parsePrintedAmount } from "./operations-mix-task";

const factors = {
  units: "1",
  thousands: "1000",
  millions: "1000000",
  billions: "1000000000",
} as const;

/** Only a policy-accepted, dated 10-K transcription becomes snapshot facts. */
export function reitAffoFromTranscription(input: {
  readonly proposal: ReitAffoOutput;
  readonly evidence: ReitAffoInput;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly acceptedAt: string;
  readonly accessionNumber: string;
  readonly currency: string;
}) {
  if (judgeReitAffo(input.proposal, input.evidence).verdict !== "accept")
    return null;
  const factor =
    input.proposal.unit === null ? null : factors[input.proposal.unit];
  if (factor === null) return null;
  const fact = (name: keyof ReitAffoOutput["components"]) => {
    const printed = input.proposal.components[name];
    const amount = printed === null ? null : parsePrintedAmount(printed.amount);
    if (amount === null) return null;
    return {
      asOf: input.periodEnd,
      availableAt: input.acceptedAt,
      sourceId: "sec-edgar",
      sourceDocumentId: input.accessionNumber,
      observationId: null,
      qualityFlags: ["ai_transcription_policy_accepted"],
      value: amount.times(factor).toString(),
      currency: input.currency,
      unit: "monetary",
    };
  };
  return affoReconciliationSchema.parse({
    version: "affo-reconciliation-1.0.0",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    rationale: `AI transcription checked by ${REIT_AFFO_POLICY_VERSION} against 10-K ${input.accessionNumber} and same-filing common income; ${input.proposal.rationale.slice(0, 700)}`,
    commonNetIncome: fact("commonNetIncome"),
    realEstateDepreciation: fact("realEstateDepreciation"),
    propertySaleGains: fact("propertySaleGains"),
    realEstateImpairments: fact("realEstateImpairments"),
    jointVentureAdjustment: fact("jointVentureAdjustment"),
    recurringCapex: fact("recurringCapex"),
    straightLineRent: fact("straightLineRent"),
  });
}
