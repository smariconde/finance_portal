import { z } from "zod";

import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
  refineTemporalVersion,
  temporalVersionShape,
} from "@/modules/temporal/domain/temporal-version";

import { assetProfileSchema, type AssetProfile } from "./asset-profile";

/**
 * Selección sobre evidencia ya clasificada y fechada (`F3-01`).
 *
 * La 0.2.0 reemplaza «dos señales positivas son siempre un conflicto» por una
 * **precedencia estricta**, la que el contrato del incremento 1 ya enunciaba:
 * banco, aseguradora o REIT; después holding; distress; commodity; ciclo;
 * pérdidas persistentes; alto crecimiento. Una empresa cíclica que además crece
 * rápido es cíclica —normalizar el margen va antes que extrapolar el
 * crecimiento—, y la señal de menor precedencia queda como alternativa.
 *
 * Sólo los tres perfiles financieros comparten nivel: un banco que también es
 * REIT no tiene un orden defendible y sigue siendo `conflicting_evidence`.
 *
 * `non_financial_mature` **no es una señal**: es el residuo. Se elige cuando cada
 * perfil de mayor precedencia tiene evidencia negativa explícita, y por eso una
 * señal positiva tampoco alcanza si un perfil que la precede quedó sin evidencia:
 * podría ser él el que corresponde.
 */
export const METHOD_SELECTION_VERSION = "method-selection-0.2.0";

export const signalProfileSchema = assetProfileSchema.exclude([
  "non_financial_mature",
]);

export type SignalProfile = z.infer<typeof signalProfileSchema>;

export const profileEvidenceSchema = z
  .object({
    ...temporalVersionShape,
    legalEntityId: z.uuid(),
    profile: signalProfileSchema,
    present: z.boolean(),
    /** Regla versionada que produjo la señal, para leerla en la salida. */
    rule: z.string().trim().min(1).max(64),
    /**
     * `primary` si la regla decidió con su dato principal; `declared_alternative`
     * si tuvo que usar una alternativa escrita —EBIT reconstruido, resultado neto,
     * liquidez—. La confianza lo descuenta.
     */
    derivation: z.enum(["primary", "declared_alternative"]),
  })
  .superRefine(refineTemporalVersion);

export type ProfileEvidence = z.infer<typeof profileEvidenceSchema>;

export const methodSelectionInputSchema = z
  .object({
    legalEntityId: z.uuid(),
    knowledge: pointInTimeQuerySchema,
    evidence: z.array(profileEvidenceSchema).max(100),
    /** Preflight estructural del snapshot FCFF, no una estimación de faltantes. */
    fcffInputsComplete: z.boolean(),
  })
  .superRefine((input, context) => {
    input.evidence.forEach((item, index) => {
      if (item.legalEntityId !== input.legalEntityId) {
        context.addIssue({
          code: "custom",
          path: ["evidence", index, "legalEntityId"],
          message: "Profile evidence belongs to another legal entity.",
        });
      }
    });
  });

export type MethodSelectionInput = z.input<typeof methodSelectionInputSchema>;

export const methodSelectionReasonSchema = z.enum([
  "missing_classification_evidence",
  "conflicting_evidence",
  "method_not_implemented",
  "missing_required_input",
]);

export type MethodSelectionReason = z.infer<typeof methodSelectionReasonSchema>;

/**
 * Confianza **ordinal**, no una probabilidad: dice cuánto de la decisión se apoyó
 * en alternativas declaradas y cuántas señales cedieron por precedencia. Sin
 * calibración contra resultados no se publica un número, porque un 0,8 se lee
 * como «acierta ocho de cada diez» y nadie midió eso.
 *
 * - `high`: toda la evidencia que decidió es primaria y ninguna otra señal se
 *   activó.
 * - `medium`: una de las dos cosas —una alternativa declarada o una señal que
 *   cedió—.
 * - `low`: las dos.
 *
 * Sin perfil identificado —abstención por falta de evidencia o por conflicto— es
 * `null`.
 */
export const selectionConfidenceSchema = z.enum(["high", "medium", "low"]);

export type SelectionConfidence = z.infer<typeof selectionConfidenceSchema>;

const codeSchema = z.string().trim().min(1).max(96);

/** La salida del selector como contrato: viaja dentro del snapshot de la corrida. */
export const methodSelectionSchema = z.object({
  version: z.literal(METHOD_SELECTION_VERSION),
  status: z.enum(["selected", "unsupported_method"]),
  assetProfile: assetProfileSchema.nullable(),
  recommendedMethod: codeSchema.nullable(),
  alternatives: z.array(codeSchema).max(16),
  requiredInputs: z.array(codeSchema).max(32),
  /** Ordinal y nunca una probabilidad; `null` cuando no hay perfil. */
  confidence: selectionConfidenceSchema.nullable(),
  activatedRules: z.array(codeSchema).max(16),
  unsupportedReasons: z.array(methodSelectionReasonSchema).max(4),
});

export type MethodSelection = z.infer<typeof methodSelectionSchema>;

export const PROFILE_METHODS: Readonly<
  Record<
    AssetProfile,
    { method: string; rule: string; requiredInputs: readonly string[] }
  >
> = Object.freeze({
  non_financial_mature: {
    method: "fcff_base",
    rule: "mature_non_financial",
    requiredInputs: ["fcff_inputs"],
  },
  high_growth: {
    method: "fcff_three_stage",
    rule: "high_growth",
    requiredInputs: ["revenue_growth", "target_margin"],
  },
  loss_making: {
    method: "revenue_margin_survival",
    rule: "persistent_losses",
    requiredInputs: ["revenue_path", "target_margin", "survival_probability"],
  },
  bank: {
    method: "excess_return",
    rule: "bank_regulated",
    requiredInputs: ["book_equity", "roe", "cost_of_equity"],
  },
  insurer: {
    method: "excess_return",
    rule: "insurer_regulated",
    requiredInputs: ["book_equity", "roe", "cost_of_equity"],
  },
  reit: {
    method: "affo_nav",
    rule: "reit_structure",
    requiredInputs: ["affo", "nav"],
  },
  cyclical: {
    method: "normalized_fcff",
    rule: "cyclical_exposure",
    requiredInputs: ["cycle_margins"],
  },
  commodity: {
    method: "normalized_fcff",
    rule: "commodity_exposure",
    requiredInputs: ["normalized_price"],
  },
  holding: {
    method: "sotp_nav",
    rule: "holding_structure",
    requiredInputs: ["segment_values"],
  },
  distressed: {
    method: "apv_scenarios",
    rule: "distress",
    requiredInputs: ["failure_scenarios"],
  },
});

/** Niveles de precedencia, del que manda al que cede. */
export const PROFILE_PRECEDENCE: readonly (readonly SignalProfile[])[] =
  Object.freeze([
    ["bank", "insurer", "reit"],
    ["holding"],
    ["distressed"],
    ["commodity"],
    ["cyclical"],
    ["loss_making"],
    ["high_growth"],
  ]);

function confidenceOf(
  deciding: readonly ProfileEvidence[],
  yielded: number,
): SelectionConfidence {
  const demerits =
    (deciding.some((item) => item.derivation === "declared_alternative")
      ? 1
      : 0) + (yielded > 0 ? 1 : 0);

  return demerits === 0 ? "high" : demerits === 1 ? "medium" : "low";
}

function result(
  assetProfile: AssetProfile | null,
  reason: MethodSelectionReason | null,
  requiredInputs: readonly string[],
  activatedRules: readonly string[],
  alternatives: readonly string[] = [],
  confidence: SelectionConfidence | null = null,
): MethodSelection {
  const descriptor =
    assetProfile === null ? null : PROFILE_METHODS[assetProfile];

  return {
    version: METHOD_SELECTION_VERSION,
    status: reason === null ? "selected" : "unsupported_method",
    assetProfile,
    recommendedMethod: descriptor?.method ?? null,
    alternatives: [...alternatives],
    requiredInputs: [...requiredInputs],
    confidence,
    activatedRules: [...activatedRules],
    unsupportedReasons: reason === null ? [] : [reason],
  };
}

export function selectValuationMethod(
  candidate: MethodSelectionInput,
): MethodSelection {
  const input = methodSelectionInputSchema.parse(candidate);
  const visible = input.evidence.filter(
    (item) =>
      isEffectiveAt(item, input.knowledge.effectiveAt) &&
      isKnownAt(item, input.knowledge),
  );

  const byProfile = new Map<SignalProfile, ProfileEvidence[]>();
  for (const item of visible) {
    byProfile.set(item.profile, [...(byProfile.get(item.profile) ?? []), item]);
  }

  // Dos versiones simultáneas de un mismo perfil no se desempatan.
  const duplicated = [...byProfile.entries()].filter(
    ([, matches]) => matches.length > 1,
  );
  if (duplicated.length > 0) {
    return result(
      null,
      "conflicting_evidence",
      [],
      duplicated.map(([profile]) => PROFILE_METHODS[profile].rule),
    );
  }

  const stateOf = (
    profile: SignalProfile,
  ): "present" | "absent" | "unknown" => {
    const match = byProfile.get(profile)?.[0];
    return match === undefined
      ? "unknown"
      : match.present
        ? "present"
        : "absent";
  };

  const unknownAbove: SignalProfile[] = [];
  /** Evidencia negativa de los niveles ya recorridos: también decidió. */
  const decidedAbove: ProfileEvidence[] = [];

  for (const [level, tier] of PROFILE_PRECEDENCE.entries()) {
    const positives = tier.filter((profile) => stateOf(profile) === "present");

    if (positives.length > 1) {
      return result(
        null,
        "conflicting_evidence",
        [],
        positives.map((profile) => PROFILE_METHODS[profile].rule),
      );
    }

    const selected = positives[0];

    if (selected !== undefined) {
      const descriptor = PROFILE_METHODS[selected];
      // Las señales que ceden ante la elegida quedan a la vista como alternativas.
      const yielded = PROFILE_PRECEDENCE.slice(level + 1)
        .flat()
        .filter((profile) => stateOf(profile) === "present");
      const rules = [
        descriptor.rule,
        ...yielded.map((profile) => PROFILE_METHODS[profile].rule),
      ];

      if (unknownAbove.length > 0) {
        return result(
          null,
          "missing_classification_evidence",
          unknownAbove.map((profile) => "profile_evidence." + profile),
          rules,
        );
      }

      const alternatives = [
        ...new Set(
          yielded
            .map((profile) => PROFILE_METHODS[profile].method)
            .filter((method) => method !== descriptor.method),
        ),
      ];

      const deciding = [
        ...decidedAbove,
        ...tier.flatMap((profile) => byProfile.get(profile) ?? []),
      ];

      return result(
        selected,
        "method_not_implemented",
        descriptor.requiredInputs,
        rules,
        alternatives,
        confidenceOf(deciding, yielded.length),
      );
    }

    unknownAbove.push(
      ...tier.filter((profile) => stateOf(profile) === "unknown"),
    );
    decidedAbove.push(
      ...tier.flatMap((profile) => byProfile.get(profile) ?? []),
    );
  }

  if (unknownAbove.length > 0) {
    return result(
      null,
      "missing_classification_evidence",
      unknownAbove.map((profile) => "profile_evidence." + profile),
      [],
    );
  }

  const mature = PROFILE_METHODS.non_financial_mature;
  const confidence = confidenceOf(decidedAbove, 0);

  if (!input.fcffInputsComplete) {
    return result(
      "non_financial_mature",
      "missing_required_input",
      mature.requiredInputs,
      [mature.rule],
      [],
      confidence,
    );
  }

  return result(
    "non_financial_mature",
    null,
    [],
    [mature.rule],
    [],
    confidence,
  );
}
