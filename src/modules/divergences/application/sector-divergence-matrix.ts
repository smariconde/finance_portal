import type { StoredCedearRegistry } from "@/modules/cedears/domain/plan-cedear-registry";
import { resolveCedearAccess } from "@/modules/cedears/domain/resolve-cedear-access";

import {
  computeDilutionBridge,
  type DilutionBridge,
} from "../domain/dilution-bridge";
import {
  computeDivergenceViews,
  type DivergenceViews,
} from "../domain/divergence-views";
import type { FiscalEndpointPair } from "../domain/fiscal-endpoints";

import type { SectorFiscalReading } from "./load-sector-fiscal-endpoints";

/**
 * What the divergence surface reads (`F8-02`): every view and the dilution
 * bridge per security and horizon, the CEDEAR access at the cutoff and the
 * sector's SEC coverage. Plain data: it crosses to the client as is.
 */
export const SECTOR_DIVERGENCE_MATRIX_VERSION =
  "sector-divergence-matrix-1.0.0";

export type DivergenceHorizon = {
  readonly earlierFiscalYearEnd: string | null;
  readonly latestFiscalYearEnd: string | null;
  readonly pairReason: FiscalEndpointPair["reason"];
  /** Every input either endpoint lacks, named by `fiscal-endpoints`. */
  readonly missing: readonly string[];
  readonly views: DivergenceViews;
  readonly bridge: DilutionBridge;
};

export type SectorDivergenceRow = {
  readonly securityId: string;
  readonly issuerLegalEntityId: string;
  readonly ticker: string | null;
  readonly issuerName: string | null;
  readonly cedear: boolean;
  readonly twoYears: DivergenceHorizon;
  readonly fiveYears: DivergenceHorizon;
};

export type SectorDivergenceMatrix = {
  readonly version: typeof SECTOR_DIVERGENCE_MATRIX_VERSION;
  readonly sectorCode: string;
  readonly knownAt: string;
  readonly rows: readonly SectorDivergenceRow[];
  readonly coverage: {
    readonly issuers: number;
    /** Issuers with at least one stored fiscal year at the cutoff. */
    readonly issuersWithFiscalYear: number;
  };
};

function horizon(pair: FiscalEndpointPair): DivergenceHorizon {
  const views = computeDivergenceViews(pair);
  return {
    earlierFiscalYearEnd: pair.earlier?.fiscalYearEnd ?? null,
    latestFiscalYearEnd: pair.latest?.fiscalYearEnd ?? null,
    pairReason: pair.reason,
    missing: [
      ...new Set([
        ...(pair.latest?.missing ?? []),
        ...(pair.earlier?.missing ?? []),
      ]),
    ],
    views,
    bridge: computeDilutionBridge(pair, views),
  };
}

export function buildSectorDivergenceMatrix(
  reading: SectorFiscalReading,
  registry: StoredCedearRegistry,
): SectorDivergenceMatrix {
  const issuers = new Set(reading.members.map((m) => m.issuerLegalEntityId));
  const covered = new Set(
    reading.members
      .filter((member) => member.twoYears.reason !== "no_fiscal_year")
      .map((member) => member.issuerLegalEntityId),
  );
  return {
    version: SECTOR_DIVERGENCE_MATRIX_VERSION,
    sectorCode: reading.sectorCode,
    knownAt: reading.query.knownAt ?? reading.query.effectiveAt,
    rows: reading.members.map((member) => ({
      securityId: member.securityId,
      issuerLegalEntityId: member.issuerLegalEntityId,
      ticker: member.ticker,
      issuerName: member.issuerName,
      cedear:
        resolveCedearAccess(registry, member.securityId, reading.query)
          .status === "program",
      twoYears: horizon(member.twoYears),
      fiveYears: horizon(member.fiveYears),
    })),
    coverage: {
      issuers: issuers.size,
      issuersWithFiscalYear: covered.size,
    },
  };
}
