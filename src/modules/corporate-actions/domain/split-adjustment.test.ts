import { describe, expect, it } from "vitest";

import type { Observation } from "@/modules/observations/domain/observation";
import { queryObservations } from "@/modules/observations/domain/select-observations";
import {
  pointInTimeQuerySchema,
  type PointInTimeQuery,
  type PointInTimeQueryInput,
} from "@/modules/temporal/domain/point-in-time-query";

import {
  buildRevisionChain,
  buildSplitFixtureClaims,
  buildSplitFixtureDocuments,
  buildSplitFixtureObservations,
  buildSplitFixtureSensitiveObservations,
  SPLIT_ACCEPTED_AT,
  SPLIT_ACCESSIONS,
  SPLIT_FACTS,
  SPLIT_FILER_ENTITY_ID,
} from "../infrastructure/fixture-split";
import { planSplitRecording } from "./plan-split-recording";
import {
  corporateActionSchema,
  type CorporateAction,
} from "./reporting-succession";
import { isShareBasisError } from "./share-basis";
import {
  buildBasisRows,
  countRevisionKinds,
  SPLIT_ADJUSTMENT_VERSION,
} from "./split-adjustment";
import { evaluateSplitEvidence } from "./verify-split-evidence";

const SPLIT_RECORDED_AT = "2025-09-15T12:00:00.000Z";

const observations = buildSplitFixtureObservations();

const [SPLIT] = planSplitRecording({
  legalEntityId: SPLIT_FILER_ENTITY_ID,
  evidence: evaluateSplitEvidence({
    legalEntityId: SPLIT_FILER_ENTITY_ID,
    claims: buildSplitFixtureClaims(),
    observations: buildSplitFixtureSensitiveObservations(),
    documents: buildSplitFixtureDocuments(),
  }),
  corporateActions: [],
  recordedAt: SPLIT_RECORDED_AT,
  newId: () => "00000000-0000-4000-8000-00000000a5a1",
}).corporateActions as [CorporateAction];

function query(overrides: Partial<PointInTimeQueryInput> = {}) {
  return pointInTimeQuerySchema.parse({
    effectiveAt: "2026-01-01T00:00:00.000Z",
    revisionPolicy: "as_known",
    knownAt: "2026-01-01T00:00:00.000Z",
    adjustmentPolicy: "latest_adjusted",
    sourcePolicyVersion: "source-policy-1.0.0",
    ...overrides,
  } as PointInTimeQueryInput);
}

const LATEST = query({ revisionPolicy: "latest_restated", knownAt: null });

/** Filas de un hecho, elegidas con la política de revisión de la consulta. */
function rows(
  fact: (typeof SPLIT_FACTS)[keyof typeof SPLIT_FACTS],
  at: PointInTimeQuery,
  splits: readonly CorporateAction[] = [SPLIT],
) {
  const selected = queryObservations(
    observations,
    {
      subjectType: "legal_entity",
      subjectId: SPLIT_FILER_ENTITY_ID,
      metricIds: [fact.concept],
    },
    { ...at, adjustmentPolicy: "as_known" },
  ).filter((observation) => observation.asOf === fact.asOf);

  return buildBasisRows({
    selected,
    revisions: observations,
    corporateActions: splits,
    query: at,
    subjectId: SPLIT_FILER_ENTITY_ID,
  });
}

function value(
  fact: (typeof SPLIT_FACTS)[keyof typeof SPLIT_FACTS],
  at: PointInTimeQuery,
  splits?: readonly CorporateAction[],
) {
  const [row] = rows(fact, at, splits);
  return row?.value;
}

describe("buildBasisRows con latest_adjusted", () => {
  it("lleva toda la serie por acción a una sola base", () => {
    // 2021 sólo se reportó antes del split; 2022 y 2023 ya re-expresados; 2024
    // nació en base nueva.
    expect(value(SPLIT_FACTS.epsBasic2021, LATEST)).toBe("0.4");
    expect(value(SPLIT_FACTS.epsBasic2022, LATEST)).toBe("0.48");
    expect(value(SPLIT_FACTS.epsBasic2023, LATEST)).toBe("0.78");
    expect(value(SPLIT_FACTS.epsBasic2024, LATEST)).toBe("0.9");
    expect(value(SPLIT_FACTS.epsBasicQ2, LATEST)).toBe("0.2125");
  });

  it("multiplica las acciones por el mismo factor", () => {
    expect(value(SPLIT_FACTS.sharesBasic2021, LATEST)).toBe("384000000");
    expect(value(SPLIT_FACTS.sharesBasic2023, LATEST)).toBe("400000000");
  });

  it("nombra la transformación en cada fila sensible, con factor uno si ya estaba en base", () => {
    const [old] = rows(SPLIT_FACTS.epsBasic2021, LATEST);
    const [current] = rows(SPLIT_FACTS.epsBasic2024, LATEST);

    expect(old).toMatchObject({
      basis: "latest_split_basis",
      adjustment: {
        transformationId: SPLIT_ADJUSTMENT_VERSION,
        shareFactor: "4",
        corporateActionIds: [SPLIT.corporateActionId],
      },
    });
    expect(old!.observation.rawValue).toBe("1.6");
    // Un valor posterior a todos los splits sale igual que en latest_restated.
    expect(current).toMatchObject({
      value: "0.9",
      basis: "latest_split_basis",
      adjustment: { shareFactor: "1", corporateActionIds: [] },
    });
  });

  it("no toca un valor que no está en acciones", () => {
    const [revenue] = rows(SPLIT_FACTS.revenue2022, LATEST);

    expect(revenue).toMatchObject({
      value: "980000000",
      basis: "as_reported",
      adjustment: null,
    });
  });

  it("un as_known anterior a la presentación del split no lo aplica", () => {
    const before = query({ knownAt: "2025-02-20T20:59:59.000Z" });

    expect(value(SPLIT_FACTS.epsBasic2023, before)).toBe("3.1");
    expect(value(SPLIT_FACTS.epsBasic2021, before)).toBe("1.6");
    expect(rows(SPLIT_FACTS.epsBasic2021, before)[0]!.adjustment).toMatchObject(
      { shareFactor: "1" },
    );
  });

  it("en la aceptación del split re-expresa lo que el 10-K todavía no repitió", () => {
    const at = query({ knownAt: SPLIT_ACCEPTED_AT });

    expect(value(SPLIT_FACTS.epsBasic2023, at)).toBe("0.78");
    // El trimestre de 2024 se re-expresa recién en mayo; hasta entonces se ajusta.
    expect(value(SPLIT_FACTS.epsBasicQ1, at)).toBe("0.2");
    expect(rows(SPLIT_FACTS.epsBasicQ1, at)[0]!.observation.rawValue).toBe(
      "0.8",
    );
  });

  it("bajo system_recorded el split registrado después del corte no existe", () => {
    const recorded = query({
      knownAt: "2025-09-12T00:00:00.000Z",
      knowledgeBasis: "system_recorded",
    });

    expect(value(SPLIT_FACTS.epsBasic2021, recorded)).toBe("1.6");
  });

  it("un valor faltante sigue faltando", () => {
    const missing = buildRevisionChain(SPLIT_FACTS.epsBasic2021, [
      { value: null, filing: "annual2022" },
    ]);

    expect(
      buildBasisRows({
        selected: missing,
        revisions: missing,
        corporateActions: [SPLIT],
        query: LATEST,
        subjectId: SPLIT_FILER_ENTITY_ID,
      })[0],
    ).toMatchObject({ value: null, adjustment: { shareFactor: "4" } });
  });

  it("aplica un reverse split dividiendo acciones y multiplicando el EPS", () => {
    const reverse = corporateActionSchema.parse({
      ...SPLIT,
      actionType: "reverse_split",
      terms: { ...SPLIT.terms, ratio: "0.1" },
    });

    expect(value(SPLIT_FACTS.epsBasic2021, LATEST, [reverse])).toBe("16");
    expect(value(SPLIT_FACTS.sharesBasic2021, LATEST, [reverse])).toBe(
      "9600000",
    );
  });

  it("no lleva a la base del sucesor una fila sensible de un antecesor", () => {
    const predecessor = buildRevisionChain(
      SPLIT_FACTS.epsBasic2021,
      [{ value: "1.6", filing: "annual2022" }],
      { subjectId: "00000000-0000-4000-8000-00000000d0a1" },
    );

    try {
      buildBasisRows({
        selected: predecessor,
        revisions: predecessor,
        corporateActions: [],
        query: LATEST,
        subjectId: SPLIT_FILER_ENTITY_ID,
      });
      expect.unreachable("la conversión de la sucesión no está registrada");
    } catch (error) {
      expect(isShareBasisError(error, "adjustment_across_succession")).toBe(
        true,
      );
    }

    // Con la base reportada no hay nada que convertir.
    expect(
      buildBasisRows({
        selected: predecessor,
        revisions: predecessor,
        corporateActions: [],
        query: query({ adjustmentPolicy: "as_known" }),
        subjectId: SPLIT_FILER_ENTITY_ID,
      })[0]!.value,
    ).toBe("1.6");
  });

  it("no ajusta una unidad de acciones que la regla no clasifica", () => {
    const preferred = buildRevisionChain(
      {
        concept: "us-gaap:PreferredStockSharesOutstanding",
        periodType: "instant",
        periodStart: null,
        asOf: "2023-12-31",
        unit: "shares",
        currency: null,
      },
      [{ value: "5000", filing: "annual2023" }],
    );
    const input = {
      selected: preferred,
      revisions: preferred,
      corporateActions: [SPLIT],
      subjectId: SPLIT_FILER_ENTITY_ID,
    };

    expect(() => buildBasisRows({ ...input, query: LATEST })).toThrow(
      /no declared share sensitivity/u,
    );
    expect(
      buildBasisRows({
        ...input,
        query: query({ adjustmentPolicy: "as_known" }),
      })[0]!.basis,
    ).toBe("as_reported");
  });
});

describe("buildBasisRows con as_known", () => {
  it("devuelve la base reportada sin transformación", () => {
    const reported = query({
      revisionPolicy: "latest_restated",
      knownAt: null,
      adjustmentPolicy: "as_known",
    });

    expect(rows(SPLIT_FACTS.epsBasic2021, reported)[0]).toMatchObject({
      value: "1.6",
      basis: "as_reported",
      adjustment: null,
    });
  });
});

describe("clasificación de revisiones", () => {
  const kinds = (fact: (typeof SPLIT_FACTS)[keyof typeof SPLIT_FACTS]) =>
    observations
      .filter(
        (observation: Observation) =>
          observation.concept === fact.concept &&
          observation.asOf === fact.asOf,
      )
      .map(
        (observation) =>
          buildBasisRows({
            selected: [observation],
            revisions: observations,
            corporateActions: [SPLIT],
            query: LATEST,
            subjectId: SPLIT_FILER_ENTITY_ID,
          })[0]!.revisionKind,
      );

  it("separa el restatement contable de la re-expresión por split", () => {
    expect(kinds(SPLIT_FACTS.epsBasic2022)).toStrictEqual([
      "original",
      "restatement",
      "split_reexpression",
    ]);
  });

  it("una re-expresión tardía también es del split", () => {
    expect(kinds(SPLIT_FACTS.epsBasicQ1)).toStrictEqual([
      "original",
      "split_reexpression",
    ]);
  });

  it("una corrección de escala publicada junto al split no es del split", () => {
    expect(kinds(SPLIT_FACTS.sharesOutstanding2023)).toStrictEqual([
      "original",
      "restatement",
      "restatement",
    ]);
  });

  it("cuenta sobre la historia completa", () => {
    // Cinco re-expresiones por el split; el restatement del EPS y del ingreso de
    // 2022 y las dos revisiones de la cantidad mal escalada no lo son.
    expect(countRevisionKinds(observations, [SPLIT], LATEST)).toStrictEqual({
      restated: 9,
      splitReexpressions: 5,
      restatements: 4,
    });
    // Sin splits registrados todo lo re-expresado parece restatement.
    expect(countRevisionKinds(observations, [], LATEST)).toStrictEqual({
      restated: 9,
      splitReexpressions: 0,
      restatements: 9,
    });
  });

  it("antes de conocer el split la misma revisión no se clasifica como suya", () => {
    expect(
      countRevisionKinds(
        observations,
        [SPLIT],
        query({ knownAt: "2025-02-20T20:59:59.000Z" }),
      ).splitReexpressions,
    ).toBe(0);
  });

  it("exige la revisión anterior en la lectura", () => {
    const orphan = observations.filter(
      (observation) =>
        observation.sourceDocumentId === SPLIT_ACCESSIONS.annual2024,
    );

    try {
      countRevisionKinds(orphan, [SPLIT], LATEST);
      expect.unreachable("sin la revisión anterior no hay clasificación");
    } catch (error) {
      expect(isShareBasisError(error, "revision_chain_incomplete")).toBe(true);
    }
  });
});
