import { truncateUtf8 } from "@/modules/fundamentals/domain/sec-10k-sections";
import {
  industryCandidates,
  mappedIndustryKeys,
} from "@/modules/valuation/domain/industry-mapping";
import type {
  IndustryEvidence,
  IndustryResolutionInput,
} from "@/modules/valuation/domain/industry-resolution-task";
import type {
  OperationsMixInput,
  OperationsMixOutput,
} from "@/modules/valuation/domain/operations-mix-task";

import {
  appendInjection,
  INCORPORATED_BY_REFERENCE_ITEM_1,
  INDUSTRY_INJECTION_CONTAINMENT,
  INDUSTRY_INJECTIONS,
  industryInjectionText,
  MIX_INJECTION_CONTAINMENT,
  MIX_INJECTIONS,
  mixInjectionText,
  type IndustryInjectionId,
  type InjectionContainment,
  type MixInjectionId,
} from "./eval-injections";

/**
 * Los casos de los evals (`ai-eval-cases-1.0.0`, `F5-07`,
 * [ADR 0035](../../../../docs/architecture/adr/0035-ai-layer-evals.md),
 * decisiones 3 y 4), derivados de forma determinista del corpus congelado, las
 * declaraciones y el gold. Nada acá lee un archivo ni la red.
 */
export const AI_EVAL_CASES_VERSION = "ai-eval-cases-1.0.0";

export type EvalTaskId = "industry" | "mix";
export type EvalCaseKind = "baseline" | "injection" | "abstention";
/** El gold lo propone el agente y lo confirma el owner (decisión 3). */
export type GoldReview = "pending_owner" | "owner_reviewed";

export type IndustryGold = {
  readonly cik: string;
  readonly industryKey: string;
  readonly rationale: string;
  readonly review: GoldReview;
};

/**
 * El mix correcto, escrito como una respuesta completa —con sus citas— para que
 * la misma policy que juzga al modelo pueda juzgarlo: un gold que la policy
 * rechaza está mal escrito.
 */
export type MixGold = {
  readonly cik: string;
  readonly output: OperationsMixOutput;
  readonly rationale: string;
  readonly review: GoldReview;
};

type CaseIdentity = {
  readonly caseId: string;
  readonly cik: string;
  readonly ticker: string;
  readonly kind: EvalCaseKind;
  readonly injection: string | null;
  readonly containment: InjectionContainment | null;
};

export type IndustryEvalCase = CaseIdentity & {
  readonly task: "industry";
  readonly input: IndustryResolutionInput;
  /** `null` en un caso de abstención: lo correcto es no contestar. */
  readonly gold: IndustryGold | null;
  /** La clave que la inyección pide, si pide una. */
  readonly injectedKey: string | null;
};

export type MixEvalCase = CaseIdentity & {
  readonly task: "mix";
  readonly input: OperationsMixInput;
  readonly gold: MixGold | null;
};

export type EvalCase = IndustryEvalCase | MixEvalCase;

export type EvalCaseSources = {
  readonly documents: readonly {
    readonly cik: string;
    readonly ticker: string;
    readonly companyName: string;
  }[];
  readonly industryBases: readonly {
    readonly cik: string;
    readonly sic: { readonly code: string; readonly description: string };
  }[];
  readonly mixBases: readonly {
    readonly cik: string;
    readonly expectedRevenue: string;
  }[];
  readonly targets: {
    readonly industryInjections: readonly string[];
    readonly industryAbstentions: readonly string[];
    readonly mixInjections: readonly string[];
    readonly mixAbstentions: readonly string[];
  };
  /** Extractos congelados por CIK y sección. */
  readonly texts: ReadonlyMap<
    string,
    {
      readonly item_1_business?: string;
      readonly segment_note?: string;
      readonly geographic_revenue?: string;
    }
  >;
  readonly exposureKeys: {
    readonly countries: readonly string[];
    readonly regions: readonly string[];
  };
  readonly industryGold: readonly IndustryGold[];
  readonly mixGold: readonly MixGold[];
};

/** Una clave de la release que ninguna de las candidatas de la muestra nombra. */
const OUT_OF_CANDIDATES_KEYS = ["tobacco", "precious-metals"] as const;

const SEC = "sec-edgar";
/** El techo de la tabla geográfica: la abstención del mix manda lo mismo de largo. */
const GEOGRAPHIC_CEILING_BYTES = 6_000;

function required<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(`The eval corpus has no ${what}.`);
  }
  return value;
}

export function buildEvalCases(sources: EvalCaseSources): EvalCase[] {
  const documents = new Map(sources.documents.map((d) => [d.cik, d]));
  const industryGold = new Map(sources.industryGold.map((g) => [g.cik, g]));
  const mixGold = new Map(sources.mixGold.map((g) => [g.cik, g]));
  const releaseIndustryKeys = new Set(mappedIndustryKeys());
  const cases: EvalCase[] = [];

  const documentOf = (cik: string) =>
    required(documents.get(cik), `declared document for ${cik}`);
  const textsOf = (cik: string) =>
    required(sources.texts.get(cik), `extracts for ${cik}`);

  // ------------------------------------------------------------- industria
  for (const base of sources.industryBases) {
    const document = documentOf(base.cik);
    const texts = textsOf(base.cik);
    const candidates = required(
      industryCandidates(base.sic.code),
      `industry candidates for SIC ${base.sic.code}`,
    );
    const evidence: IndustryEvidence[] = [
      {
        evidenceId: "E1",
        sourceId: SEC,
        section: "item_1_business",
        text: required(texts.item_1_business, `Item 1 of ${document.ticker}`),
      },
      ...(texts.segment_note === undefined
        ? []
        : [
            {
              evidenceId: "E2",
              sourceId: SEC,
              section: "segment_note",
              text: texts.segment_note,
            },
          ]),
    ];
    const input = (items: readonly IndustryEvidence[]) => ({
      companyName: document.companyName,
      sic: { ...base.sic },
      candidates: [...candidates],
      releaseIndustryKeys,
      evidence: items,
    });
    const gold = required(
      industryGold.get(base.cik),
      `industry gold for ${document.ticker}`,
    );
    const identity = (
      kind: EvalCaseKind,
      injection: IndustryInjectionId | null,
    ) => ({
      caseId: `industry/${document.ticker}/${injection ?? kind}`,
      cik: base.cik,
      ticker: document.ticker,
      kind,
      injection,
      containment:
        injection === null ? null : INDUSTRY_INJECTION_CONTAINMENT[injection],
    });

    if (!candidates.includes(gold.industryKey)) {
      throw new Error(
        `The industry gold of ${document.ticker} is not a candidate of its SIC.`,
      );
    }

    cases.push({
      ...identity("baseline", null),
      task: "industry",
      input: input(evidence),
      gold,
      injectedKey: null,
    });

    if (sources.targets.industryInjections.includes(base.cik)) {
      const wrongCandidate = required(
        candidates.find((key) => key !== gold.industryKey),
        `a wrong candidate for ${document.ticker}`,
      );
      const outOfCandidates = required(
        OUT_OF_CANDIDATES_KEYS.find((key) => !candidates.includes(key)),
        `a key outside the candidates of ${document.ticker}`,
      );

      for (const injection of INDUSTRY_INJECTIONS) {
        const targetKey =
          injection === "override_out_of_candidates"
            ? outOfCandidates
            : injection === "abstain_coercion"
              ? null
              : wrongCandidate;
        const [first, ...rest] = evidence;

        cases.push({
          ...identity("injection", injection),
          task: "industry",
          input: input([
            {
              ...first!,
              text: appendInjection(
                first!.text,
                industryInjectionText(injection, targetKey ?? ""),
              ),
            },
            ...rest,
          ]),
          gold,
          injectedKey: targetKey,
        });
      }
    }

    if (sources.targets.industryAbstentions.includes(base.cik)) {
      cases.push({
        ...identity("abstention", null),
        task: "industry",
        input: input([
          {
            evidenceId: "E1",
            sourceId: SEC,
            section: "item_1_business",
            text: INCORPORATED_BY_REFERENCE_ITEM_1,
          },
        ]),
        gold: null,
        injectedKey: null,
      });
    }
  }

  // -------------------------------------------------------------------- mix
  for (const base of sources.mixBases) {
    const document = documentOf(base.cik);
    const texts = textsOf(base.cik);
    const table = required(
      texts.geographic_revenue,
      `geographic table of ${document.ticker}`,
    );
    const input = (text: string): OperationsMixInput => ({
      companyName: document.companyName,
      countryKeys: [...sources.exposureKeys.countries],
      regionKeys: [...sources.exposureKeys.regions],
      evidence: [
        {
          evidenceId: "E1",
          sourceId: SEC,
          section: "geographic_revenue",
          text,
        },
      ],
      expectedRevenue: base.expectedRevenue,
    });
    const gold = required(
      mixGold.get(base.cik),
      `mix gold for ${document.ticker}`,
    );
    const identity = (
      kind: EvalCaseKind,
      injection: MixInjectionId | null,
    ) => ({
      caseId: `mix/${document.ticker}/${injection ?? kind}`,
      cik: base.cik,
      ticker: document.ticker,
      kind,
      injection,
      containment:
        injection === null ? null : MIX_INJECTION_CONTAINMENT[injection],
    });

    cases.push({
      ...identity("baseline", null),
      task: "mix",
      input: input(table),
      gold,
    });

    if (sources.targets.mixInjections.includes(base.cik)) {
      for (const injection of MIX_INJECTIONS) {
        cases.push({
          ...identity("injection", injection),
          task: "mix",
          input: input(appendInjection(table, mixInjectionText(injection))),
          gold,
        });
      }
    }

    if (sources.targets.mixAbstentions.includes(base.cik)) {
      // El lector pudo haber elegido una ventana sin tabla: la tarea recibe el
      // mismo largo de texto, sin ingresos por geografía.
      const business = required(
        texts.item_1_business,
        `Item 1 of ${document.ticker}`,
      );

      cases.push({
        ...identity("abstention", null),
        task: "mix",
        input: input(
          truncateUtf8(business, GEOGRAPHIC_CEILING_BYTES).text.trim(),
        ),
        gold: null,
      });
    }
  }

  return cases;
}
