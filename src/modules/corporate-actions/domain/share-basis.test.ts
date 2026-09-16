import { describe, expect, it } from "vitest";

import {
  pointInTimeQuerySchema,
  type PointInTimeQueryInput,
} from "@/modules/temporal/domain/point-in-time-query";

import type { CorporateAction } from "./reporting-succession";
import {
  classifyCoherence,
  declaredShareSensitivity,
  isShareBasisError,
  isSplitVisibleAt,
  laterSplitFactor,
  shareBasisDecimal,
  shareSensitivity,
  toBasisChange,
  type ShareSensitivity,
} from "./share-basis";

const d = (value: string) => shareBasisDecimal.parseDecimal(value, "test");

function coherence(
  sensitivity: ShareSensitivity,
  previous: string,
  next: string,
  factor: string,
) {
  return classifyCoherence({ sensitivity, previous, next, factor: d(factor) });
}

function split(overrides: Partial<CorporateAction> = {}): CorporateAction {
  return {
    corporateActionId: "00000000-0000-4000-8000-00000000a001",
    actionType: "split",
    subjectType: "legal_entity",
    subjectId: "00000000-0000-4000-8000-00000000a0e1",
    announcedAt: null,
    effectiveOn: "2024-12-31",
    availableAt: "2025-02-20T21:00:00.000Z",
    sourceId: "sec-edgar",
    sourceDocumentId: "0000000073-25-000010",
    terms: { ratio: "4" },
    contentHash: "a".repeat(64),
    recordedAt: "2025-09-15T12:00:00.000Z",
    ...overrides,
  };
}

function query(overrides: Partial<PointInTimeQueryInput> = {}) {
  return pointInTimeQuerySchema.parse({
    effectiveAt: "2026-01-01T00:00:00.000Z",
    revisionPolicy: "as_known",
    knownAt: "2026-01-01T00:00:00.000Z",
    sourcePolicyVersion: "source-policy-1.0.0",
    ...overrides,
  } as PointInTimeQueryInput);
}

describe("classifyCoherence", () => {
  // Valores reales de Apple medidos el 2026-09-15 en PostgreSQL personal: son la
  // razón de ser de la tolerancia, no una elección estética.
  it.each([
    ["2.18", "0.55", "4", "EPS diluido Q3 FY2019, factor aparente 3,9636"],
    ["12.01", "3", "4", "EPS básico FY2018"],
    ["2.58", "0.65", "4", "EPS diluido Q3 FY2020, factor aparente 3,9692"],
    ["44.64", "6.38", "7", "EPS básico FY2012"],
    ["7.51", "1.07", "7", "EPS básico Q3 FY2013, factor aparente 7,0187"],
  ])(
    "acepta el EPS re-expresado con redondeo de centavos: %s → %s por %s (%s)",
    (previous, next, factor) => {
      expect(coherence("per_share", previous, next, factor)).toBe("coherent");
    },
  );

  it("acepta un conteo de acciones re-expresado exactamente", () => {
    expect(coherence("share_count", "4617834000", "18471336000", "4")).toBe(
      "coherent",
    );
  });

  it("rechaza la corrección de escala que Apple publicó junto al split de 2014", () => {
    // 899.213 (en miles, por error) pasó a 6.294.494.000: factor 7.000, no 7.
    expect(coherence("share_count", "899213", "6294494000", "7")).toBe(
      "incoherent",
    );
  });

  it("no confunde un restatement contable con un split", () => {
    // El restatement de 2010 de Apple: 5,48 pasó a 6,94.
    expect(coherence("per_share", "5.48", "6.94", "4")).toBe("incoherent");
    expect(coherence("per_share", "5.48", "6.94", "1")).toBe("incoherent");
  });

  it("no confunde un split con otro de ratio cercano", () => {
    expect(coherence("share_count", "100000000", "150000000", "1.3333")).toBe(
      "incoherent",
    );
    expect(coherence("per_share", "3", "1", "2")).toBe("incoherent");
  });

  it("valida un reverse split con la misma fórmula", () => {
    expect(coherence("per_share", "0.13", "1.3", "0.1")).toBe("coherent");
    expect(coherence("per_share", "0.13", "1.35", "0.1")).toBe("coherent");
    expect(coherence("share_count", "1000000000", "100000000", "0.1")).toBe(
      "coherent",
    );
  });

  it("usa la banda relativa para un EPS grande redondeado a unidades", () => {
    expect(coherence("per_share", "41019", "2051", "20")).toBe("coherent");
  });

  it("no toma un cero ni un cambio de signo como evidencia", () => {
    expect(coherence("per_share", "0", "0", "4")).toBe("uninformative");
    expect(coherence("per_share", "-0.4", "0.1", "4")).toBe("uninformative");
    expect(coherence("per_share", "-0.4", "-0.1", "4")).toBe("coherent");
  });
});

describe("shareSensitivity", () => {
  const observation = (concept: string, unit: string) => ({
    concept,
    unit,
    observationId: "00000000-0000-4000-8000-00000000b001",
  });

  it("clasifica los conceptos declarados por su dirección", () => {
    expect(
      shareSensitivity(
        observation("us-gaap:EarningsPerShareDiluted", "monetary_per_share"),
      ),
    ).toBe("per_share");
    expect(
      shareSensitivity(
        observation("dei:EntityCommonStockSharesOutstanding", "shares"),
      ),
    ).toBe("share_count");
    expect(
      shareSensitivity(observation("us-gaap:Revenues", "monetary")),
    ).toBeNull();
  });

  it("no adivina una unidad de acciones fuera de la lista", () => {
    const preferred = observation(
      "us-gaap:PreferredStockSharesOutstanding",
      "shares",
    );

    expect(declaredShareSensitivity(preferred)).toBe("unclassified");
    try {
      shareSensitivity(preferred);
      expect.unreachable("una unidad de acciones sin clasificar no se ajusta");
    } catch (error) {
      expect(isShareBasisError(error, "unclassified_share_unit")).toBe(true);
    }
  });

  it("no acepta un concepto declarado en otra unidad", () => {
    expect(() =>
      shareSensitivity(
        observation("us-gaap:EarningsPerShareBasic", "monetary"),
      ),
    ).toThrow(/unexpected unit|no declared/u);
  });
});

describe("laterSplitFactor", () => {
  const change = toBasisChange(split());
  const earlier = toBasisChange(
    split({
      corporateActionId: "00000000-0000-4000-8000-00000000a002",
      availableAt: "2021-02-20T21:00:00.000Z",
      sourceDocumentId: "0000000073-21-000010",
      terms: { ratio: "2" },
    }),
  );

  it("aplica sólo los splits conocibles después de la vintage", () => {
    const before = laterSplitFactor([change, earlier], {
      availableAt: "2020-05-01T20:00:00.000Z",
      document: "0000000073-20-000020",
    });
    const between = laterSplitFactor([change, earlier], {
      availableAt: "2023-05-01T20:00:00.000Z",
      document: "0000000073-23-000020",
    });

    expect(shareBasisDecimal.formatDecimal(before.factor, "f")).toBe("8");
    expect(before.changeIds).toHaveLength(2);
    expect(shareBasisDecimal.formatDecimal(between.factor, "f")).toBe("4");
  });

  it("considera la presentación del split ya en base nueva", () => {
    const own = laterSplitFactor([change], {
      availableAt: change.availableAt,
      document: change.document,
    });

    expect(own.changeIds).toStrictEqual([]);
  });

  it("no elige base para otra presentación del mismo instante", () => {
    try {
      laterSplitFactor([change], {
        availableAt: change.availableAt,
        document: "0000000073-25-000999",
      });
      expect.unreachable("dos presentaciones simultáneas no tienen desempate");
    } catch (error) {
      expect(isShareBasisError(error, "ambiguous_share_basis")).toBe(true);
    }
  });

  it("acota por arriba e incluye el split que publicó la revisión nueva", () => {
    const window = laterSplitFactor(
      [change, earlier],
      { availableAt: "2020-05-01T20:00:00.000Z", document: "x" },
      { availableAt: change.availableAt, document: change.document },
    );
    const shorter = laterSplitFactor(
      [change, earlier],
      { availableAt: "2020-05-01T20:00:00.000Z", document: "x" },
      { availableAt: "2024-01-01T00:00:00.000Z", document: "y" },
    );

    expect(shareBasisDecimal.formatDecimal(window.factor, "f")).toBe("8");
    expect(shareBasisDecimal.formatDecimal(shorter.factor, "f")).toBe("2");
  });
});

describe("isSplitVisibleAt", () => {
  it("un as_known anterior a la presentación del split no lo ve", () => {
    expect(
      isSplitVisibleAt(split(), query({ knownAt: "2025-02-20T20:59:59.000Z" })),
    ).toBe(false);
    expect(
      isSplitVisibleAt(split(), query({ knownAt: "2025-02-20T21:00:00.000Z" })),
    ).toBe(true);
  });

  it("bajo system_recorded exige además que la instalación lo registrara", () => {
    const at = query({
      knownAt: "2025-06-01T00:00:00.000Z",
      knowledgeBasis: "system_recorded",
    });

    expect(isSplitVisibleAt(split(), at)).toBe(false);
  });

  it("latest_restated ve todos", () => {
    expect(
      isSplitVisibleAt(
        split(),
        query({ revisionPolicy: "latest_restated", knownAt: null }),
      ),
    ).toBe(true);
  });
});
