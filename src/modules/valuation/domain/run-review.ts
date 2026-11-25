/**
 * Lo que dice el estado de una corrida, separado en sus dos causas (`F6-51`).
 *
 * El motor guarda `requires_review` cuando falla **cualquier** control de
 * revisión, en el caso base o en bear o bull (`run-valuation.ts`). Dos de esas
 * causas no se parecen: un método experimental (crecimiento, ciclo, financiero,
 * REIT) emite siempre su rótulo fallado, corrida tras corrida, y un control
 * como el valor terminal falla por los números de esa corrida. Leídos juntos,
 * once de trece corridas en revisión de Production decían lo mismo que GOOGL,
 * cuya única causa era el valor terminal del escenario bull.
 *
 * Es una lectura: no toca el estado guardado, el snapshot ni los hashes. El
 * rótulo del método sale del control que la corrida guardó, no del nombre del
 * método, así que una corrida dice «Experimental» sólo si su motor lo dijo.
 */
export const RUN_REVIEW_VERSION = "run-review-1.0.0";

/** Los controles que rotulan un método, no un resultado: fallan siempre. */
export const EXPERIMENTAL_MODEL_CHECK_IDS = [
  "growth_model_experimental",
  "cycle_model_experimental",
  "financial_model_experimental",
  "reit_model_experimental",
] as const;

export type ExperimentalModelCheckId =
  (typeof EXPERIMENTAL_MODEL_CHECK_IDS)[number];

export const RUN_CHECK_ORIGINS = ["base", "bear", "bull"] as const;
export type RunCheckOrigin = (typeof RUN_CHECK_ORIGINS)[number];

type StoredCheck = {
  readonly id: string;
  readonly mode: "reject" | "require_review";
  readonly status: "passed" | "failed";
};

export type RunReviewInput = {
  readonly status: "computed" | "requires_review" | "rejected";
  /** Los controles de cada caso; un escenario que no guarda controles falta. */
  readonly checks: Partial<
    Record<RunCheckOrigin, readonly StoredCheck[] | null | undefined>
  >;
};

/** Un control de revisión que falló, una vez, con los casos donde falló. */
export type RunReviewCheck = {
  readonly id: string;
  readonly origins: readonly RunCheckOrigin[];
};

/**
 * Las marcas que se muestran, en orden de lectura. Una corrida calculada sin
 * nada pendiente es `computed`; una rechazada, `rejected`; las demás pueden
 * llevar `experimental`, `requires_review` o las dos.
 */
export type RunReviewMark =
  "computed" | "experimental" | "requires_review" | "rejected";

export type RunReview = {
  readonly version: typeof RUN_REVIEW_VERSION;
  readonly marks: readonly RunReviewMark[];
  /** El rótulo que la corrida guardó fallado, o `null` si no es experimental. */
  readonly experimentalModel: ExperimentalModelCheckId | null;
  /** Los controles de revisión fallados, sin el rótulo del método. */
  readonly reviewChecks: readonly RunReviewCheck[];
};

export function isExperimentalModelCheck(
  id: string,
): id is ExperimentalModelCheckId {
  return (EXPERIMENTAL_MODEL_CHECK_IDS as readonly string[]).includes(id);
}

export function readRunReview(input: RunReviewInput): RunReview {
  const failed = new Map<string, RunCheckOrigin[]>();
  let experimentalModel: ExperimentalModelCheckId | null = null;

  for (const origin of RUN_CHECK_ORIGINS) {
    for (const check of input.checks[origin] ?? []) {
      if (check.mode !== "require_review" || check.status !== "failed")
        continue;
      if (isExperimentalModelCheck(check.id)) {
        experimentalModel ??= check.id;
        continue;
      }
      const origins = failed.get(check.id) ?? [];
      if (!origins.includes(origin)) origins.push(origin);
      failed.set(check.id, origins);
    }
  }

  const reviewChecks = [...failed].map(([id, origins]) => ({ id, origins }));
  const marks: RunReviewMark[] = [];

  if (input.status === "rejected") {
    marks.push("rejected");
  } else {
    const experimental = experimentalModel !== null;
    if (experimental) marks.push("experimental");
    // Un `requires_review` guardado sin ninguna causa legible no se calla:
    // se muestra como lo guardó el motor.
    if (
      reviewChecks.length > 0 ||
      (input.status === "requires_review" && !experimental)
    )
      marks.push("requires_review");
    if (marks.length === 0) marks.push("computed");
  }

  return {
    version: RUN_REVIEW_VERSION,
    marks,
    experimentalModel,
    reviewChecks,
  };
}

/** Un escenario guardado: el FCFF guarda sus controles, el financiero no. */
type StoredScenario = {
  readonly checks?: readonly StoredCheck[];
  readonly [field: string]: unknown;
};

type StoredRun = {
  readonly status: RunReviewInput["status"];
  readonly result: {
    readonly checks?: readonly StoredCheck[];
    readonly scenarios?: {
      readonly bear: StoredScenario;
      readonly bull: StoredScenario;
    } | null;
  } | null;
};

/**
 * La lectura de una corrida guardada, FCFF o financiera: el caso base en
 * `result.checks` y cada escenario en los suyos cuando los guarda.
 */
export function reviewOfRun(run: StoredRun): RunReview {
  return readRunReview({
    status: run.status,
    checks: {
      base: run.result?.checks,
      bear: run.result?.scenarios?.bear.checks,
      bull: run.result?.scenarios?.bull.checks,
    },
  });
}
