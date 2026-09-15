import { describe, expect, it } from "vitest";

import type { Observation } from "@/modules/observations/domain/observation";

import {
  buildRevisionChain,
  buildSplitClaim,
  buildSplitFixtureClaims,
  buildSplitFixtureDocuments,
  buildSplitFixtureSensitiveObservations,
  SPLIT_ACCEPTED_AT,
  SPLIT_ACCESSIONS,
  SPLIT_FACTS,
  SPLIT_FILER_ENTITY_ID,
} from "../infrastructure/fixture-split";
import { isShareBasisError, SPLIT_BASIS_RULE_VERSION } from "./share-basis";
import {
  evaluateSplitEvidence,
  SPLIT_EVIDENCE_RULE_VERSION,
  type SplitEvidenceInput,
} from "./verify-split-evidence";

const A = SPLIT_ACCESSIONS;

function evaluate(overrides: Partial<SplitEvidenceInput> = {}) {
  return evaluateSplitEvidence({
    legalEntityId: SPLIT_FILER_ENTITY_ID,
    claims: buildSplitFixtureClaims(),
    observations: buildSplitFixtureSensitiveObservations(),
    documents: buildSplitFixtureDocuments(),
    ...overrides,
  });
}

function statuses(evidence: ReturnType<typeof evaluate>) {
  return evidence.filings.map((filing) => [
    filing.accessionNumber,
    filing.status,
    filing.code,
  ]);
}

/** Quita las revisiones que la presentación indicada publicó para un concepto. */
function withoutRevision(
  observations: readonly Observation[],
  concept: string,
  accession: string,
): Observation[] {
  return observations.filter(
    (observation) =>
      !(
        observation.concept === concept &&
        observation.sourceDocumentId === accession
      ),
  );
}

describe("evaluateSplitEvidence", () => {
  it("confirma el split en la primera presentación que declara el ratio y re-expresa", () => {
    const evidence = evaluate();

    expect(evidence.ruleVersion).toBe(SPLIT_EVIDENCE_RULE_VERSION);
    expect(evidence.basisRuleVersion).toBe(SPLIT_BASIS_RULE_VERSION);
    expect(evidence.splits).toStrictEqual([
      {
        accessionNumber: A.annual2024,
        form: "10-K",
        actionType: "split",
        ratio: "4",
        availableAt: SPLIT_ACCEPTED_AT,
        acceptedAt: SPLIT_ACCEPTED_AT,
        publishedOn: "2025-02-20",
        // El cierre del primer período en base nueva, no una fecha declarada.
        effectiveOn: "2024-12-31",
        claimedPeriods: ["2024-05-20", "2024-06-14"],
        // Tres EPS y un promedio de acciones; la corrección de escala no cierra.
        evidence: { perShare: 3, shareCount: 1, outliers: 1, uninformative: 0 },
        qualityFlags: ["split_evidence_outliers"],
      },
    ]);
  });

  it("el anuncio previo, el 8-K y el 10-Q siguiente corroboran el mismo split", () => {
    const evidence = evaluate();

    expect(statuses(evidence)).toStrictEqual([
      [A.quarter2024q2, "corroborating", null],
      [A.annual2024, "confirming", null],
      [A.currentReport, "corroborating", null],
      [A.quarter2025q1, "corroborating", null],
    ]);
    expect(
      evidence.filings.every(
        (filing) => filing.splitAccession === A.annual2024,
      ),
    ).toBe(true);
  });

  it("un ratio sin re-expresión en ninguna presentación queda candidato", () => {
    const evidence = evaluate({
      observations: buildSplitFixtureSensitiveObservations().filter(
        (observation) =>
          observation.sourceDocumentId !== A.annual2024 &&
          observation.sourceDocumentId !== A.quarter2025q1,
      ),
    });

    expect(evidence.splits).toStrictEqual([]);
    expect(statuses(evidence)).toStrictEqual([
      [A.quarter2024q2, "candidate", "no_coherent_reexpression"],
      [A.annual2024, "candidate", "no_coherent_reexpression"],
      [A.currentReport, "candidate", "claim_filing_not_published"],
      [A.quarter2025q1, "candidate", "no_coherent_reexpression"],
    ]);
  });

  it("nombra la presentación que re-expresó cuando el ratio se declara después", () => {
    // Forma de Duke Energy: el 10-K de 2024 re-expresa sin declarar el ratio y el
    // 10-Q de 2025 lo declara sin re-expresar nada.
    const evidence = evaluate({
      claims: [buildSplitClaim({ filing: "quarter2025q1", end: "2024-06-14" })],
    });

    expect(evidence.splits).toStrictEqual([]);
    expect(evidence.filings).toStrictEqual([
      {
        accessionNumber: A.quarter2025q1,
        form: "10-Q",
        filed: "2025-05-01",
        ratio: "4",
        claimedPeriods: ["2024-06-14"],
        status: "candidate",
        code: "ratio_declared_after_reexpression",
        splitAccession: null,
        reexpressingAccession: A.annual2024,
      },
    ]);
  });

  it("nombra la primera presentación en base nueva aunque sólo re-expresara acciones", () => {
    // Forma de Duke Energy: un 10-Q publica las acciones ya divididas y el 10-K
    // siguiente re-expresa EPS y acciones; el ratio llega después.
    const observations = [
      ...buildRevisionChain(SPLIT_FACTS.epsBasic2023, [
        { value: "3.1", filing: "annual2023" },
        { value: "0.78", filing: "annual2024" },
      ]),
      ...buildRevisionChain(SPLIT_FACTS.sharesBasic2023, [
        { value: "100000000", filing: "annual2023" },
        { value: "400000000", filing: "annual2024" },
      ]),
      ...buildRevisionChain(SPLIT_FACTS.sharesOutstanding2023, [
        { value: "99000000", filing: "annual2023" },
        { value: "396000000", filing: "quarter2024q2" },
      ]),
    ];
    const evidence = evaluate({
      observations,
      claims: [buildSplitClaim({ filing: "quarter2025q1", end: "2024-06-14" })],
    });

    expect(evidence.filings[0]).toMatchObject({
      code: "ratio_declared_after_reexpression",
      reexpressingAccession: A.quarter2024q2,
    });
  });

  it("una re-expresión sin ratio declarado no registra nada", () => {
    const evidence = evaluate({ claims: [] });

    expect(evidence.splits).toStrictEqual([]);
    expect(evidence.filings).toStrictEqual([]);
  });

  it("re-expresar sólo EPS no alcanza: hacen falta EPS y acciones", () => {
    const observations = withoutRevision(
      withoutRevision(
        buildSplitFixtureSensitiveObservations(),
        SPLIT_FACTS.sharesBasic2023.concept,
        A.annual2024,
      ),
      SPLIT_FACTS.sharesOutstanding2023.concept,
      A.annual2024,
    );
    const evidence = evaluate({ observations });

    expect(evidence.splits).toStrictEqual([]);
    expect(
      evidence.filings.find((filing) => filing.accessionNumber === A.annual2024)
        ?.code,
    ).toBe("reexpression_incomplete");
  });

  it("nombra un ratio declarado al revés en vez de invertirlo", () => {
    const evidence = evaluate({
      claims: [
        buildSplitClaim({
          filing: "annual2024",
          end: "2024-06-14",
          value: "0.25",
        }),
      ],
    });

    expect(evidence.splits).toStrictEqual([]);
    expect(statuses(evidence)).toStrictEqual([
      [A.annual2024, "candidate", "reexpression_matches_inverse_ratio"],
    ]);
  });

  it("no confirma si otra presentación anterior ya mostraba la base nueva", () => {
    // El EPS de 2023 aparece en base nueva en el 10-Q de 2024-Q2, que no declara
    // ningún ratio: fijar la base nueva en el 10-K ajustaría ese valor dos veces.
    const observations = [
      ...buildSplitFixtureSensitiveObservations().filter(
        (observation) =>
          !(
            observation.concept === SPLIT_FACTS.epsBasic2023.concept &&
            observation.asOf === SPLIT_FACTS.epsBasic2023.asOf
          ),
      ),
      ...buildRevisionChain(SPLIT_FACTS.epsBasic2023, [
        { value: "3.1", filing: "annual2023" },
        { value: "0.78", filing: "quarter2024q2" },
      ]),
    ];
    const evidence = evaluate({
      observations,
      claims: [buildSplitClaim({ filing: "annual2024", end: "2024-06-14" })],
    });

    expect(evidence.splits).toStrictEqual([]);
    expect(statuses(evidence)).toStrictEqual([
      [A.annual2024, "candidate", "reexpressed_before_ratio_filing"],
    ]);
  });

  it("dos ratios distintos en una presentación no tienen desempate", () => {
    const evidence = evaluate({
      claims: [
        buildSplitClaim({ filing: "annual2024", end: "2024-06-14" }),
        buildSplitClaim({
          filing: "annual2024",
          end: "2024-05-20",
          value: "2",
        }),
      ],
    });

    expect(statuses(evidence)).toStrictEqual([
      [A.annual2024, "candidate", "conflicting_ratios_in_filing"],
    ]);
  });

  it.each([
    ["1", "pure", "invalid_ratio"],
    ["0", "pure", "invalid_ratio"],
    ["-4", "pure", "invalid_ratio"],
    ["4", "shares", "unexpected_unit"],
  ])("rechaza por nombre un ratio %s en %s", (value, unit, code) => {
    const evidence = evaluate({
      claims: [
        buildSplitClaim({
          filing: "annual2024",
          end: "2024-06-14",
          value,
          unit,
        }),
      ],
    });

    expect(statuses(evidence)).toStrictEqual([
      [A.annual2024, "candidate", code],
    ]);
  });

  it("sin fecha de reporte no hay vigencia que registrar", () => {
    const evidence = evaluate({
      documents: buildSplitFixtureDocuments({
        annual2024: { periodEndOn: null },
      }),
    });

    expect(evidence.splits).toStrictEqual([]);
    expect(
      evidence.filings.find((filing) => filing.accessionNumber === A.annual2024)
        ?.code,
    ).toBe("missing_report_date");
  });

  it("marca una disponibilidad inferida en el split", () => {
    const evidence = evaluate({
      documents: buildSplitFixtureDocuments({
        annual2024: {
          acceptedAt: null,
          availableAt: SPLIT_ACCEPTED_AT,
          availabilityRule: "sec_filing_date_next_day_est",
        },
      }),
    });

    expect(evidence.splits[0]?.qualityFlags).toContain("availability_inferred");
  });

  it("confirma un reverse split con el ratio como fracción", () => {
    const observations = [
      ...buildRevisionChain(SPLIT_FACTS.epsBasic2023, [
        { value: "0.13", filing: "annual2023" },
        { value: "1.3", filing: "annual2024" },
      ]),
      ...buildRevisionChain(SPLIT_FACTS.sharesBasic2023, [
        { value: "1000000000", filing: "annual2023" },
        { value: "100000000", filing: "annual2024" },
      ]),
    ];
    const evidence = evaluate({
      observations,
      claims: [
        buildSplitClaim({
          filing: "annual2024",
          end: "2024-06-14",
          value: "0.1",
        }),
      ],
    });

    expect(evidence.splits.map((s) => [s.actionType, s.ratio])).toStrictEqual([
      ["reverse_split", "0.1"],
    ]);
  });

  it("confirma dos splits sucesivos y la re-expresión que cruza los dos", () => {
    // 2:1 en el 10-K de 2023 y otro 2:1 en el de 2024. El EPS de 2021 se
    // re-expresa recién en 2024, con el producto de los dos.
    const observations = [
      ...buildRevisionChain(SPLIT_FACTS.epsBasic2022, [
        { value: "2", filing: "annual2022" },
        { value: "1", filing: "annual2023" },
        { value: "0.5", filing: "annual2024" },
      ]),
      ...buildRevisionChain(SPLIT_FACTS.sharesBasic2021, [
        { value: "96000000", filing: "annual2022" },
        { value: "192000000", filing: "annual2023" },
      ]),
      ...buildRevisionChain(SPLIT_FACTS.sharesBasic2023, [
        { value: "100000000", filing: "annual2023" },
        { value: "200000000", filing: "annual2024" },
      ]),
      ...buildRevisionChain(SPLIT_FACTS.epsBasic2021, [
        { value: "1.6", filing: "annual2022" },
        { value: "0.4", filing: "annual2024" },
      ]),
    ];
    const evidence = evaluate({
      observations,
      claims: [
        buildSplitClaim({
          filing: "annual2023",
          end: "2023-06-01",
          value: "2",
        }),
        buildSplitClaim({
          filing: "annual2024",
          end: "2024-06-01",
          value: "2",
        }),
      ],
    });

    expect(
      evidence.splits.map((s) => [s.accessionNumber, s.evidence]),
    ).toStrictEqual([
      [
        A.annual2023,
        { perShare: 1, shareCount: 1, outliers: 0, uninformative: 0 },
      ],
      // El EPS de 2021 cruza los dos: cierra con 2 × 2 y es evidencia del
      // segundo, no un outlier.
      [
        A.annual2024,
        { perShare: 2, shareCount: 1, outliers: 0, uninformative: 0 },
      ],
    ]);
  });

  it("no mezcla hechos de otro filer en la evidencia", () => {
    const foreign = buildRevisionChain(
      SPLIT_FACTS.epsBasic2024,
      [{ value: "1", filing: "annual2024" }],
      { subjectId: "00000000-0000-4000-8000-00000000d999" },
    );

    try {
      evaluate({
        observations: [...buildSplitFixtureSensitiveObservations(), ...foreign],
      });
      expect.unreachable("la evidencia es de un solo filer");
    } catch (error) {
      expect(isShareBasisError(error, "adjustment_across_succession")).toBe(
        true,
      );
    }
  });

  it("exige la revisión anterior de cada re-expresión", () => {
    const observations = buildSplitFixtureSensitiveObservations().filter(
      (observation) =>
        !(
          observation.concept === SPLIT_FACTS.epsBasic2023.concept &&
          observation.sourceDocumentId === A.annual2023
        ),
    );

    try {
      evaluate({ observations });
      expect.unreachable("una cadena incompleta no es evidencia");
    } catch (error) {
      expect(isShareBasisError(error, "revision_chain_incomplete")).toBe(true);
    }
  });
});
