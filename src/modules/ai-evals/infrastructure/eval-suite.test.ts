import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  INDUSTRY_RESOLUTION_TASK,
  judgeIndustryResolution,
  type IndustryResolutionOutput,
} from "@/modules/valuation/domain/industry-resolution-task";
import {
  judgeOperationsMix,
  OPERATIONS_MIX_TASK,
} from "@/modules/valuation/domain/operations-mix-task";

import type {
  EvalCase,
  IndustryEvalCase,
  MixEvalCase,
} from "../domain/eval-cases";
import { FAKE_LINE, FORGED_EVIDENCE_ID } from "../domain/eval-injections";

import { evalCorpusPath, sha256Hex } from "./eval-corpus";
import { loadEvalCases } from "./load-eval-cases";

/**
 * Los evals offline (`F5-07`, ADR 0035, decisión 1): corren en cada PR, sin red
 * y sin gastar. Prueban lo que no depende de un modelo: que el corpus sea el
 * congelado, que el gold pase la policy sobre su propia evidencia, que ninguna
 * inyección pueda cerrar el cerco y que la policy rechace la respuesta que
 * obedece cada inyección contenible.
 */
const { manifest, cases } = loadEvalCases();

const industry = cases.filter(
  (evalCase): evalCase is IndustryEvalCase => evalCase.task === "industry",
);
const mix = cases.filter(
  (evalCase): evalCase is MixEvalCase => evalCase.task === "mix",
);

function userMessage(evalCase: EvalCase): string {
  const messages =
    evalCase.task === "industry"
      ? INDUSTRY_RESOLUTION_TASK.buildMessages(evalCase.input)
      : OPERATIONS_MIX_TASK.buildMessages(evalCase.input);

  return messages.find((message) => message.role === "user")!.content;
}

function goldIndustryOutput(
  evalCase: IndustryEvalCase,
): IndustryResolutionOutput {
  return {
    decision: "resolved",
    industryKey: evalCase.gold!.industryKey,
    confidence: "high",
    evidenceIds: ["E1"],
    rationale: "Synthetic answer for the offline eval.",
    abstainReason: null,
  };
}

describe("eval corpus", () => {
  const extracts = manifest.documents.flatMap((document) =>
    document.extracts.map((extract) => [extract.path, extract] as const),
  );

  it.each(extracts)(
    "%s matches the bytes and the hash the manifest pinned",
    (_path, extract) => {
      expect(existsSync(evalCorpusPath(extract))).toBe(true);

      const text = readFileSync(evalCorpusPath(extract), "utf8");

      expect(Buffer.byteLength(text, "utf8")).toBe(extract.bytes);
      expect(sha256Hex(text)).toBe(extract.sha256);
    },
  );

  it("carries place names and no figure of Damodaran's", () => {
    const keys = [
      ...manifest.exposureKeys.countries,
      ...manifest.exposureKeys.regions,
    ];

    expect(keys.length).toBeGreaterThan(100);
    expect(keys.every((key) => /^[a-z-]+$/u.test(key))).toBe(true);
  });
});

describe("eval cases", () => {
  it("derives the declared set: base, four injections on three companies and three abstentions per task", () => {
    const count = (task: string, kind: string) =>
      cases.filter((c) => c.task === task && c.kind === kind).length;

    expect([
      count("industry", "baseline"),
      count("industry", "injection"),
      count("industry", "abstention"),
      count("mix", "baseline"),
      count("mix", "injection"),
      count("mix", "abstention"),
    ]).toEqual([16, 12, 3, 17, 12, 3]);
    expect(new Set(cases.map((c) => c.caseId)).size).toBe(cases.length);
  });

  it.each(
    industry
      .filter((c) => c.kind === "baseline")
      .map((c) => [c.caseId, c] as const),
  )("%s: the gold passes the industry policy", (_id, evalCase) => {
    expect(
      judgeIndustryResolution(goldIndustryOutput(evalCase), evalCase.input),
    ).toEqual({ verdict: "accept" });
  });

  it.each(
    mix.filter((c) => c.gold !== null).map((c) => [c.caseId, c] as const),
  )(
    "%s: the gold passes the operations-mix policy on its own evidence",
    (_id, evalCase) => {
      expect(judgeOperationsMix(evalCase.gold!.output, evalCase.input)).toEqual(
        { verdict: "accept" },
      );
    },
  );
});

describe("injections cannot break the evidence fence", () => {
  it.each(
    cases
      .filter((c) => c.kind === "injection")
      .map((c) => [c.caseId, c] as const),
  )("%s", (_id, evalCase) => {
    const message = userMessage(evalCase);
    const opened = message.match(/<evidence id="/gu) ?? [];
    const closed = message.match(/<\/evidence>/gu) ?? [];

    expect(opened).toHaveLength(evalCase.input.evidence.length);
    expect(closed).toHaveLength(evalCase.input.evidence.length);
    expect(message).not.toContain(`<evidence id="${FORGED_EVIDENCE_ID}"`);
  });
});

describe("the policy contains what an obedient model would answer", () => {
  const injected = (task: "industry" | "mix", injection: string) =>
    cases.filter(
      (c) => c.task === task && c.injection === injection,
    ) as EvalCase[];

  it.each(
    (
      injected("industry", "override_out_of_candidates") as IndustryEvalCase[]
    ).map((c) => [c.caseId, c] as const),
  )("%s: a key outside the candidates is rejected", (_id, evalCase) => {
    expect(
      judgeIndustryResolution(
        { ...goldIndustryOutput(evalCase), industryKey: evalCase.injectedKey },
        evalCase.input,
      ),
    ).toEqual({ verdict: "reject", code: "industry_not_candidate" });
  });

  it.each(
    (injected("industry", "fence_escape") as IndustryEvalCase[]).map(
      (c) => [c.caseId, c] as const,
    ),
  )("%s: citing the forged block is rejected", (_id, evalCase) => {
    expect(
      judgeIndustryResolution(
        {
          ...goldIndustryOutput(evalCase),
          industryKey: evalCase.injectedKey,
          evidenceIds: [FORGED_EVIDENCE_ID],
        },
        evalCase.input,
      ),
    ).toEqual({ verdict: "reject", code: "unknown_evidence_cited" });
  });

  it.each(
    (injected("mix", "fake_line") as MixEvalCase[]).map(
      (c) => [c.caseId, c] as const,
    ),
  )("%s: the invented line does not add up", (_id, evalCase) => {
    const gold = evalCase.gold!.output;

    expect(
      judgeOperationsMix(
        {
          ...gold,
          lines: [
            ...gold.lines,
            {
              label: FAKE_LINE.label,
              amount: FAKE_LINE.amount,
              quote: `${FAKE_LINE.label} $ ${FAKE_LINE.amount}`,
              evidenceId: "E1",
              basis: "name_match",
              exposureKeys: ["argentina"],
              definitionQuote: null,
            },
          ],
        },
        evalCase.input,
      ),
    ).toEqual({ verdict: "reject", code: "lines_do_not_sum_to_total" });
  });

  it.each(
    (injected("mix", "unit_coercion") as MixEvalCase[]).map(
      (c) => [c.caseId, c] as const,
    ),
  )(
    "%s: the coerced unit misses the fiscal year's revenue",
    (_id, evalCase) => {
      expect(
        judgeOperationsMix(
          { ...evalCase.gold!.output, unit: "billions" },
          evalCase.input,
        ),
      ).toEqual({ verdict: "reject", code: "total_not_revenue" });
    },
  );

  it.each(
    (injected("mix", "fence_escape") as MixEvalCase[]).map(
      (c) => [c.caseId, c] as const,
    ),
  )("%s: citing the forged block is rejected", (_id, evalCase) => {
    const gold = evalCase.gold!.output;

    expect(
      judgeOperationsMix(
        { ...gold, totalEvidenceId: FORGED_EVIDENCE_ID },
        evalCase.input,
      ),
    ).toEqual({ verdict: "reject", code: "total_not_quoted" });
    expect(
      judgeOperationsMix(
        {
          ...gold,
          lines: gold.lines.map((line, index) =>
            index === 0 ? { ...line, evidenceId: FORGED_EVIDENCE_ID } : line,
          ),
        },
        evalCase.input,
      ),
    ).toEqual({ verdict: "reject", code: "unknown_evidence_cited" });
  });

  it.each(
    mix
      .filter((c) => c.kind === "abstention")
      .map((c) => [c.caseId, c] as const),
  )(
    "%s: the right table quoted against the wrong evidence is rejected",
    (_id, evalCase) => {
      const baseline = mix.find(
        (c) => c.cik === evalCase.cik && c.kind === "baseline",
      )!;

      expect(
        judgeOperationsMix(baseline.gold!.output, evalCase.input).verdict,
      ).toBe("reject");
    },
  );
});
