import { describe, expect, it } from "vitest";

import type { RefreshCompanyFactsOutcome } from "@/modules/fundamentals/application/refresh-company-facts";
import type { SecFiling } from "@/modules/fundamentals/domain/parse-sec-submissions";
import {
  COMPANY_FACTS_FORM_SELECTION_VERSION,
  decideFilerRefresh,
} from "@/modules/fundamentals/domain/sec-refresh-decision";
import type { IngestionRunStatus } from "@/modules/ingestion/domain/ingestion-run";

import { filingsStepFromRefresh } from "./filings-step";

const QUARTER: SecFiling = {
  accessionNumber: "0000320193-26-000079",
  form: "10-Q",
  filingDate: "2026-07-31",
  reportDate: "2026-06-27",
  acceptedAt: "2026-07-31T10:01:02.000Z",
};

const ANNUAL: SecFiling = {
  accessionNumber: "0000320193-26-000100",
  form: "10-K",
  filingDate: "2026-11-03",
  reportDate: "2026-09-26",
  acceptedAt: "2026-11-03T21:00:00.000Z",
};

const EIGHT_K: SecFiling = {
  accessionNumber: "0000320193-26-000105",
  form: "8-K",
  filingDate: "2026-11-10",
  reportDate: null,
  acceptedAt: "2026-11-10T21:00:00.000Z",
};

const AT_ANNUAL = {
  acceptedAt: ANNUAL.acceptedAt!,
  accessionNumber: ANNUAL.accessionNumber,
  formSelectionVersion: COMPANY_FACTS_FORM_SELECTION_VERSION,
};

const WATERMARK = {
  acceptedAt: QUARTER.acceptedAt!,
  accessionNumber: QUARTER.accessionNumber,
  formSelectionVersion: COMPANY_FACTS_FORM_SELECTION_VERSION,
};

const ANNUAL_STEP = {
  form: "10-K",
  acceptedAt: ANNUAL.acceptedAt,
  accessionNumber: ANNUAL.accessionNumber,
};

// Sólo se leen el estado de las corridas, la decisión y la salvaguarda.
function outcome(input: {
  readonly filings: readonly SecFiling[];
  readonly watermark?: typeof WATERMARK | null;
  readonly ingestion?: IngestionRunStatus | null;
  readonly probe?: IngestionRunStatus;
  readonly missing?: SecFiling | null;
}): RefreshCompanyFactsOutcome {
  return {
    probeRun: { status: input.probe ?? "succeeded" },
    decision: decideFilerRefresh({
      filings: input.filings,
      watermark: input.watermark ?? null,
    }),
    ingestion:
      input.ingestion == null ? null : { run: { status: input.ingestion } },
    periodicFilingMissing: input.missing ?? null,
  } as unknown as RefreshCompanyFactsOutcome;
}

describe("filingsStepFromRefresh (F6-44)", () => {
  it("a new 10-K that published facts is a refresh, with the filing named", () => {
    expect(
      filingsStepFromRefresh(
        outcome({
          filings: [QUARTER, ANNUAL],
          watermark: WATERMARK,
          ingestion: "succeeded",
        }),
      ),
    ).toEqual({
      status: "refreshed",
      reason: "new_filing",
      latest: ANNUAL_STEP,
    });
  });

  it("a first probe whose download published nothing new is current", () => {
    expect(
      filingsStepFromRefresh(
        outcome({ filings: [QUARTER], ingestion: "duplicate" }),
      ),
    ).toEqual({
      status: "current",
      latest: {
        form: "10-Q",
        acceptedAt: QUARTER.acceptedAt,
        accessionNumber: QUARTER.accessionNumber,
      },
    });
  });

  it("nothing new and only an 8-K both keep the newest periodic report in view", () => {
    expect(
      filingsStepFromRefresh(
        outcome({ filings: [QUARTER, ANNUAL], watermark: AT_ANNUAL }),
      ),
    ).toEqual({ status: "current", latest: ANNUAL_STEP });
    expect(
      filingsStepFromRefresh(
        outcome({
          filings: [ANNUAL, EIGHT_K],
          watermark: AT_ANNUAL,
          ingestion: "succeeded",
        }),
      ),
    ).toEqual({
      status: "refreshed",
      reason: "new_filing",
      latest: ANNUAL_STEP,
    });
  });

  it("a 10-K that companyfacts does not carry yet is named, never a refresh", () => {
    expect(
      filingsStepFromRefresh(
        outcome({
          filings: [QUARTER, ANNUAL],
          watermark: WATERMARK,
          ingestion: "succeeded",
          missing: ANNUAL,
        }),
      ),
    ).toEqual({ status: "not_in_companyfacts", latest: ANNUAL_STEP });
  });

  it("an unreadable index or a missing outcome is a failure that does not block", () => {
    expect(
      filingsStepFromRefresh(
        outcome({ filings: [QUARTER], probe: "quarantined" }),
      ),
    ).toEqual({ status: "failed", code: "submissions_quarantined" });
    expect(filingsStepFromRefresh(null)).toEqual({
      status: "failed",
      code: "refresh_not_observed",
    });
  });
});
