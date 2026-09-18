import { describe, expect, it } from "vitest";

import type { SecFiling } from "./parse-sec-submissions";
import {
  COMPANY_FACTS_FORM_SELECTION_VERSION,
  decideFilerRefresh,
  type FilerRefreshWatermark,
} from "./sec-refresh-decision";

function filing(overrides: Partial<SecFiling> & { accessionNumber: string }) {
  return {
    form: "10-Q",
    filingDate: "2026-07-31",
    reportDate: "2026-06-27",
    acceptedAt: "2026-07-31T10:01:02.000Z",
    ...overrides,
  } satisfies SecFiling;
}

function watermark(
  overrides: Partial<FilerRefreshWatermark> = {},
): FilerRefreshWatermark {
  return {
    acceptedAt: "2026-07-31T10:01:02.000Z",
    accessionNumber: "0000320193-26-000079",
    formSelectionVersion: COMPANY_FACTS_FORM_SELECTION_VERSION,
    ...overrides,
  };
}

const QUARTER = filing({ accessionNumber: "0000320193-26-000079" });

describe("decideFilerRefresh", () => {
  it("sin marca previa refresca una vez y deja la marca escrita", () => {
    const decision = decideFilerRefresh({
      filings: [QUARTER],
      watermark: null,
    });

    expect(decision.reason).toBe("never_probed");
    expect(decision.refresh).toBe(true);
    expect(decision.observed).toEqual(watermark());
    expect(decision.probeVersion).toBe("sec-refresh-probe-1.0.0");
  });

  it("con la marca en la presentación más nueva no baja nada", () => {
    const decision = decideFilerRefresh({
      filings: [QUARTER],
      watermark: watermark(),
    });

    expect(decision.reason).toBe("up_to_date");
    expect(decision.refresh).toBe(false);
    expect(decision.newFilings).toEqual([]);
    // La marca se reescribe igual: el sondeo la confirma.
    expect(decision.observed).toEqual(watermark());
  });

  it("refresca cuando aparece una presentación relevante posterior", () => {
    const annual = filing({
      accessionNumber: "0000320193-26-000101",
      form: "10-K",
      filingDate: "2026-10-30",
      acceptedAt: "2026-10-30T18:04:11.000Z",
    });

    const decision = decideFilerRefresh({
      filings: [QUARTER, annual],
      watermark: watermark(),
    });

    expect(decision.reason).toBe("new_filing");
    expect(decision.refresh).toBe(true);
    expect(decision.newFilings).toEqual([annual]);
    expect(decision.observed?.accessionNumber).toBe("0000320193-26-000101");
  });

  it("ignora los formularios que no pueden traer hechos", () => {
    const insider = filing({
      accessionNumber: "0000320193-26-000090",
      form: "4",
      acceptedAt: "2026-08-15T20:30:00.000Z",
    });

    const decision = decideFilerRefresh({
      filings: [QUARTER, insider],
      watermark: watermark(),
    });

    expect(decision.reason).toBe("up_to_date");
    expect(decision.observed?.accessionNumber).toBe("0000320193-26-000079");
  });

  it("desempata por accession cuando dos presentaciones comparten el segundo", () => {
    const twin = filing({ accessionNumber: "0000320193-26-000080" });
    const decision = decideFilerRefresh({
      filings: [QUARTER, twin],
      watermark: watermark(),
    });

    expect(decision.reason).toBe("new_filing");
    expect(decision.newFilings).toEqual([twin]);

    // Y con la marca ya en el mayor del empate, no queda nada nuevo.
    expect(
      decideFilerRefresh({
        filings: [QUARTER, twin],
        watermark: watermark({ accessionNumber: "0000320193-26-000080" }),
      }).reason,
    ).toBe("up_to_date");
  });

  it("refresca una vez cuando la lista de formularios quedó superada", () => {
    const decision = decideFilerRefresh({
      filings: [QUARTER],
      watermark: watermark({
        formSelectionVersion: "sec-companyfacts-forms-0.9.0",
      }),
    });

    expect(decision.reason).toBe("form_selection_superseded");
    expect(decision.refresh).toBe(true);
    expect(decision.observed?.formSelectionVersion).toBe(
      COMPANY_FACTS_FORM_SELECTION_VERSION,
    );
  });

  it("cuenta las relevantes sin aceptación en vez de compararlas a ciegas", () => {
    const decision = decideFilerRefresh({
      filings: [
        QUARTER,
        filing({ accessionNumber: "0000320193-26-000081", acceptedAt: null }),
      ],
      watermark: watermark(),
    });

    expect(decision.withoutAcceptance).toBe(1);
    expect(decision.reason).toBe("up_to_date");
  });

  it("no deja marca cuando el índice no trae ninguna relevante", () => {
    const decision = decideFilerRefresh({
      filings: [filing({ accessionNumber: "0000320193-26-000090", form: "4" })],
      watermark: null,
    });

    expect(decision.reason).toBe("no_relevant_filings");
    expect(decision.refresh).toBe(false);
    expect(decision.observed).toBeNull();
  });
});
