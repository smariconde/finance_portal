import { describe, expect, it } from "vitest";

import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";

import { FISCAL_ENDPOINTS_VERSION } from "../domain/fiscal-endpoints";

import type {
  SectorFiscalMember,
  SectorFiscalReading,
} from "./load-sector-fiscal-endpoints";
import {
  buildSectorDivergenceMatrix,
  SECTOR_DIVERGENCE_MATRIX_VERSION,
} from "./sector-divergence-matrix";

const query = pointInTimeQuerySchema.parse({
  effectiveAt: "2026-10-30T12:00:00.000Z",
  revisionPolicy: "as_known",
  knownAt: "2026-10-30T12:00:00.000Z",
  sourcePolicyVersion: "source-policy-1.0.0",
});

function member(
  securityId: string,
  issuer: string,
  reason: "no_fiscal_year" | "no_comparable_year",
): SectorFiscalMember {
  const pair = {
    version: FISCAL_ENDPOINTS_VERSION,
    horizonYears: 2,
    actualYears: null,
    latest: null,
    earlier: null,
    reason,
  } as const;
  return {
    securityId,
    issuerLegalEntityId: issuer,
    ticker: securityId,
    issuerName: null,
    twoYears: pair,
    fiveYears: { ...pair, horizonYears: 5 },
  };
}

describe("sector divergence matrix", () => {
  it("counts SEC coverage by issuer, not by security", () => {
    const reading: SectorFiscalReading = {
      sectorCode: "communication-services",
      query,
      populationVersion: "population",
      taxonomyVersion: null,
      members: [
        // Two classes of one issuer count once.
        member("GOOGL", "alphabet", "no_comparable_year"),
        member("GOOG", "alphabet", "no_comparable_year"),
        member("TTD", "trade-desk", "no_fiscal_year"),
      ],
    };

    const matrix = buildSectorDivergenceMatrix(reading, {
      programs: [],
      ratios: [],
    });

    expect(matrix.version).toBe(SECTOR_DIVERGENCE_MATRIX_VERSION);
    expect(matrix.coverage).toEqual({ issuers: 2, issuersWithFiscalYear: 1 });
    expect(matrix.rows.every((row) => row.cedear === false)).toBe(true);
    expect(matrix.rows[0]?.twoYears.views.fundamental.category).toBe(
      "unavailable",
    );
    expect(matrix.knownAt).toBe("2026-10-30T12:00:00.000Z");
  });
});
