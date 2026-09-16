import { describe, expect, it } from "vitest";

import type { SecFiling } from "@/modules/fundamentals/domain/parse-sec-submissions";

import {
  buildFixtureDeclaration,
  FIXTURE_EFFECTIVE_ON,
  FIXTURE_PREDECESSOR_CIK,
  FIXTURE_PREDECESSOR_FILINGS,
  FIXTURE_PREDECESSOR_NAME,
  FIXTURE_SUCCESSION_ACCEPTED_AT,
  FIXTURE_SUCCESSION_ACCESSIONS,
  FIXTURE_SUCCESSOR_CIK,
  FIXTURE_SUCCESSOR_FILINGS,
  FIXTURE_SUCCESSOR_NAME,
} from "../infrastructure/fixture-succession";
import {
  PREDECESSOR_REPORTS_AFTER_SUCCESSION_FLAG,
  verifySuccessionEvidence,
} from "./verify-succession-evidence";

function verify(
  overrides: {
    successorFilings?: readonly SecFiling[];
    predecessorFilings?: readonly SecFiling[];
    successorCik?: string;
    predecessorName?: string | null;
    accession?: string;
  } = {},
) {
  return verifySuccessionEvidence({
    declaration: buildFixtureDeclaration(
      overrides.accession === undefined
        ? {}
        : { successionAccession: overrides.accession },
    ),
    successor: {
      cik: overrides.successorCik ?? FIXTURE_SUCCESSOR_CIK,
      entityName: FIXTURE_SUCCESSOR_NAME,
      filings: overrides.successorFilings ?? FIXTURE_SUCCESSOR_FILINGS,
    },
    predecessor: {
      cik: FIXTURE_PREDECESSOR_CIK,
      entityName:
        overrides.predecessorName === undefined
          ? FIXTURE_PREDECESSOR_NAME
          : overrides.predecessorName,
      filings: overrides.predecessorFilings ?? FIXTURE_PREDECESSOR_FILINGS,
    },
  });
}

function withSuccession(changes: Partial<SecFiling>): SecFiling[] {
  return FIXTURE_SUCCESSOR_FILINGS.map((filing) =>
    filing.accessionNumber === FIXTURE_SUCCESSION_ACCESSIONS.succession
      ? { ...filing, ...changes }
      : filing,
  );
}

describe("verifySuccessionEvidence", () => {
  it("toma la aceptación como disponibilidad y la fecha del evento como vigencia", () => {
    const result = verify();

    expect(result.ok).toBe(true);
    expect(result.ok && result.evidence).toMatchObject({
      predecessorName: FIXTURE_PREDECESSOR_NAME,
      effectiveOn: FIXTURE_EFFECTIVE_ON,
      availableAt: FIXTURE_SUCCESSION_ACCEPTED_AT,
      successionFiling: { form: "8-K12B" },
      lastPredecessorReport: {
        accessionNumber: FIXTURE_SUCCESSION_ACCESSIONS.predecessorQuarter,
      },
      qualityFlags: [],
    });
  });

  it("acepta que el sucesor reporte un período anterior a la vigencia si lo presentó después", () => {
    // El 10-Q conjunto cierra el 30 de junio y se acepta en agosto: es el caso
    // real, y la regla que lo prohibía habría rechazado a ExxonMobil.
    expect(verify().ok).toBe(true);
  });

  it("no rechaza que el 10-Q conjunto figure también en el índice del antecesor", () => {
    const result = verify();

    expect(result.ok && result.evidence.qualityFlags).toStrictEqual([]);
  });

  it("marca un antecesor que sigue reportando períodos posteriores a la vigencia", () => {
    const later: SecFiling = {
      accessionNumber: "0000000071-25-000040",
      form: "10-Q",
      filingDate: "2025-11-03",
      reportDate: "2025-09-30",
      acceptedAt: "2025-11-03T20:00:00.000Z",
    };
    const result = verify({
      predecessorFilings: [later, ...FIXTURE_PREDECESSOR_FILINGS],
    });

    expect(result.ok && result.evidence.qualityFlags).toStrictEqual([
      PREDECESSOR_REPORTS_AFTER_SUCCESSION_FLAG,
    ]);
  });

  it.each([
    ["subject_mismatch", () => verify({ successorCik: "0000000099" })],
    [
      "evidence_filing_not_found",
      () => verify({ accession: "0000000900-25-999999" }),
    ],
    [
      "evidence_filing_conflicting",
      () =>
        verify({
          successorFilings: [
            ...FIXTURE_SUCCESSOR_FILINGS,
            {
              accessionNumber: FIXTURE_SUCCESSION_ACCESSIONS.succession,
              form: "8-K12B",
              filingDate: "2025-07-02",
              reportDate: FIXTURE_EFFECTIVE_ON,
              acceptedAt: FIXTURE_SUCCESSION_ACCEPTED_AT,
            },
          ],
        }),
    ],
    [
      "evidence_form_not_succession",
      () => verify({ successorFilings: withSuccession({ form: "8-K" }) }),
    ],
    [
      "evidence_not_accepted",
      () => verify({ successorFilings: withSuccession({ acceptedAt: null }) }),
    ],
    [
      "effective_date_missing",
      () => verify({ successorFilings: withSuccession({ reportDate: null }) }),
    ],
    [
      "effective_date_after_filing",
      () =>
        verify({
          successorFilings: withSuccession({ reportDate: "2025-07-05" }),
        }),
    ],
    [
      "successor_reported_before_succession",
      () =>
        verify({
          successorFilings: [
            ...FIXTURE_SUCCESSOR_FILINGS,
            {
              accessionNumber: "0000000072-24-000010",
              form: "10-K",
              filingDate: "2024-02-20",
              reportDate: "2023-12-31",
              acceptedAt: "2024-02-20T21:00:00.000Z",
            },
          ],
        }),
    ],
    [
      "predecessor_without_periodic_reports",
      () =>
        verify({
          predecessorFilings: FIXTURE_PREDECESSOR_FILINGS.filter(
            (filing) => filing.form === "25-NSE",
          ),
        }),
    ],
    ["predecessor_name_missing", () => verify({ predecessorName: null })],
  ])("rechaza con %s", (code, run) => {
    expect(run()).toMatchObject({ ok: false, code });
  });

  it("no cuenta como previo un reporte del antecesor presentado después de la sucesión", () => {
    const result = verify({
      predecessorFilings: FIXTURE_PREDECESSOR_FILINGS.filter(
        (filing) =>
          filing.accessionNumber === FIXTURE_SUCCESSION_ACCESSIONS.jointQuarter,
      ),
    });

    expect(result).toMatchObject({
      ok: false,
      code: "predecessor_without_periodic_reports",
    });
  });
});
