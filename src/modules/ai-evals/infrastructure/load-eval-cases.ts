import {
  DECLARED_EVAL_DOCUMENTS,
  DECLARED_EVAL_TARGETS,
  DECLARED_INDUSTRY_EVAL_BASES,
  DECLARED_MIX_EVAL_BASES,
} from "../application/declared-eval-cases";
import {
  DECLARED_INDUSTRY_GOLD,
  DECLARED_MIX_GOLD,
} from "../application/declared-eval-gold";
import {
  buildEvalCases,
  type EvalCase,
  type EvalWebResult,
} from "../domain/eval-cases";

import {
  loadEvalCorpusManifest,
  readEvalCorpusTexts,
  type EvalCorpusManifest,
} from "./eval-corpus";

/**
 * Los casos de los evals armados desde el corpus congelado. Un documento del
 * manifiesto que no es el `accession` declarado es un corpus viejo: se niega
 * antes de armar nada, para no medir contra otra evidencia que la que se cree.
 */
export function loadEvalCases(
  webResults?: ReadonlyMap<string, readonly EvalWebResult[]>,
): {
  readonly manifest: EvalCorpusManifest;
  readonly cases: readonly EvalCase[];
} {
  const manifest = loadEvalCorpusManifest();
  const captured = new Map(
    manifest.documents.map((document) => [document.cik, document]),
  );

  for (const declared of DECLARED_EVAL_DOCUMENTS) {
    const document = captured.get(declared.cik);

    if (
      document !== undefined &&
      document.accessionNumber !== declared.accessionNumber
    ) {
      throw new Error(
        `The eval corpus holds ${document.accessionNumber} for ${declared.ticker}, not the declared ${declared.accessionNumber}: run pnpm ai:eval-capture --apply.`,
      );
    }
  }

  return {
    manifest,
    cases: buildEvalCases({
      documents: DECLARED_EVAL_DOCUMENTS,
      industryBases: DECLARED_INDUSTRY_EVAL_BASES,
      mixBases: DECLARED_MIX_EVAL_BASES,
      targets: DECLARED_EVAL_TARGETS,
      texts: readEvalCorpusTexts(manifest),
      exposureKeys: manifest.exposureKeys,
      industryGold: DECLARED_INDUSTRY_GOLD,
      mixGold: DECLARED_MIX_GOLD,
      ...(webResults === undefined ? {} : { webResults }),
    }),
  };
}
