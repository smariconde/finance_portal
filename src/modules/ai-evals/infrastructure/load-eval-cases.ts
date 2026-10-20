import {
  DECLARED_EVAL_DOCUMENTS,
  DECLARED_EMPLOYEE_EQUITY_EVAL_BASES,
  DECLARED_EMPLOYEE_EQUITY_TARGETS,
  DECLARED_EVAL_TARGETS,
  DECLARED_INDUSTRY_EVAL_BASES,
  DECLARED_MIX_EVAL_BASES,
} from "../application/declared-eval-cases";
import { DECLARED_EMPLOYEE_EQUITY_GOLD } from "../application/declared-employee-equity-gold";
import {
  DECLARED_INDUSTRY_GOLD,
  DECLARED_MIX_GOLD,
} from "../application/declared-eval-gold";
import { buildEmployeeEquityEvalCases } from "../domain/employee-equity-eval-cases";
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

import { readEmployeeEquityCorroboration } from "./employee-equity-corpus";

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
      (document.accessionNumber !== declared.accessionNumber ||
        document.sourceUrl !== declared.documentUrl)
    ) {
      throw new Error(
        `The eval corpus document of ${declared.ticker} differs from its declared accession or URL: run pnpm ai:eval-capture --apply.`,
      );
    }
  }

  const texts = readEvalCorpusTexts(manifest);
  const employeeCases = buildEmployeeEquityEvalCases(
    DECLARED_EMPLOYEE_EQUITY_EVAL_BASES.map((base) => {
      const document = DECLARED_EVAL_DOCUMENTS.find(
        (doc) => doc.cik === base.cik,
      );
      const gold = DECLARED_EMPLOYEE_EQUITY_GOLD.find(
        (item) => item.cik === base.cik,
      );
      const note = texts.get(base.cik)?.equity_compensation;
      if (document === undefined || gold === undefined || note === undefined)
        throw new Error(
          `Missing declared employee-equity corpus or gold for ${base.cik}.`,
        );
      const abstentionText =
        DECLARED_EMPLOYEE_EQUITY_TARGETS.abstentions.includes(base.cik)
          ? texts.get(base.cik)?.geographic_revenue
          : undefined;
      if (
        DECLARED_EMPLOYEE_EQUITY_TARGETS.abstentions.includes(base.cik) &&
        abstentionText === undefined
      )
        throw new Error(
          `Missing employee-equity abstention text for ${base.cik}.`,
        );
      return {
        cik: base.cik,
        ticker: document.ticker,
        gold,
        input: {
          companyName: document.companyName,
          fiscalYearEnd: base.fiscalYearEnd,
          evidence: { sourceId: "sec-edgar", text: note },
          xbrl: readEmployeeEquityCorroboration(manifest, {
            ...base,
            accessionNumber: document.accessionNumber,
          }),
        },
        injections: DECLARED_EMPLOYEE_EQUITY_TARGETS.injections.includes(
          base.cik,
        ),
        ...(abstentionText === undefined ? {} : { abstentionText }),
      };
    }),
  );
  return {
    manifest,
    cases: [
      ...buildEvalCases({
        documents: DECLARED_EVAL_DOCUMENTS,
        industryBases: DECLARED_INDUSTRY_EVAL_BASES,
        mixBases: DECLARED_MIX_EVAL_BASES,
        targets: DECLARED_EVAL_TARGETS,
        texts,
        exposureKeys: manifest.exposureKeys,
        industryGold: DECLARED_INDUSTRY_GOLD,
        mixGold: DECLARED_MIX_GOLD,
        ...(webResults === undefined ? {} : { webResults }),
      }),
      ...employeeCases,
    ],
  };
}
