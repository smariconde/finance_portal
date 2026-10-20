import {
  failureProbabilityDeclarationSchema,
  type FailureProbabilityDeclaration,
} from "../domain/failure-risk";

/** Owner decisions only, by CIK, with a reason and their real declaration time. */
export const DECLARED_FAILURE_PROBABILITIES: readonly FailureProbabilityDeclaration[] =
  Object.freeze(
    ([] as const satisfies readonly unknown[]).map((entry) =>
      failureProbabilityDeclarationSchema.parse(entry),
    ),
  );
