import { describe, expect, it } from "vitest";

import type { SectorMember } from "@/modules/classification/domain/resolve-sector-population";
import type { CompanyFactsBackfillSubject } from "@/modules/fundamentals/domain/plan-company-facts-backfill";

import { sectorFilers } from "./sector-filer-plan";

function member(securityId: string, issuerLegalEntityId: string): SectorMember {
  return {
    securityId,
    issuerLegalEntityId,
    code: "communication-services",
    label: "Communication Services",
    taxonomyVersion: "pin",
  };
}

function subject(
  cik: string,
  legalEntityId: string,
  successorLegalEntityId: string | null = null,
): CompanyFactsBackfillSubject {
  return {
    cik,
    legalEntityId,
    role:
      successorLegalEntityId === null
        ? "index_member"
        : "reporting_predecessor",
    symbols: [],
    successorLegalEntityId,
  };
}

describe("sectorFilers", () => {
  it("deduplicates share classes through the backfill plan and keeps reporting predecessors", () => {
    const members = [
      member("class-a", "issuer-a"),
      member("class-c", "issuer-a"),
    ];
    const subjects = [
      subject("0000000001", "issuer-a"),
      subject("0000000002", "old-issuer", "issuer-a"),
      subject("0000000003", "issuer-b"),
    ];
    expect(sectorFilers(members, subjects).map((entry) => entry.cik)).toEqual([
      "0000000001",
      "0000000002",
    ]);
  });

  it("does not turn an empty sector into a universe job", () => {
    expect(sectorFilers([], [subject("0000000001", "issuer-a")])).toEqual([]);
  });
});
