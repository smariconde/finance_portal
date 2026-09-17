import { describe, expect, it } from "vitest";

import type { SecReportedFact } from "@/modules/fundamentals/domain/parse-sec-company-facts";

import {
  buildSplitClaim,
  buildSplitFixtureClaims,
  buildSplitFixtureDocuments,
  buildSplitFixtureSensitiveObservations,
  SPLIT_ACCESSIONS,
  SPLIT_FILER_ENTITY_ID,
  SPLIT_FILINGS,
} from "../infrastructure/fixture-split";
import {
  partitionSplitClaimsByHistory,
  SPLIT_CLAIM_HORIZON_VERSION,
} from "./split-claim-horizon";
import { evaluateSplitEvidence } from "./verify-split-evidence";

/**
 * Un 4:1 declarado en 2020, antes de todo lo publicado del filer sintético: la
 * historia empieza con el 10-K de 2022, como si la ventana la hubiera recortado.
 */
const OLD_ACCESSION = "0000000073-20-000011";

function oldClaim(overrides: Partial<SecReportedFact> = {}): SecReportedFact {
  return {
    ...buildSplitClaim({ filing: "annual2022", end: "2019-06-01" }),
    accessionNumber: OLD_ACCESSION,
    form: "10-K",
    filed: "2020-02-20",
    ...overrides,
  };
}

const observations = buildSplitFixtureSensitiveObservations();
const documents = buildSplitFixtureDocuments();

describe("partitionSplitClaimsByHistory", () => {
  it("names the claims declared before the first published sensitive vintage", () => {
    const horizon = partitionSplitClaimsByHistory({
      claims: [...buildSplitFixtureClaims(), oldClaim()],
      observations,
      documents,
    });

    expect(horizon.version).toBe(SPLIT_CLAIM_HORIZON_VERSION);
    expect(horizon.publishedFrom).toBe(SPLIT_FILINGS.annual2022.acceptedAt);
    expect(horizon.before).toStrictEqual([
      {
        accessionNumber: OLD_ACCESSION,
        form: "10-K",
        filed: "2020-02-20",
        ratios: ["4"],
        code: "precedes_published_history",
      },
    ]);
    expect(horizon.within).toStrictEqual(buildSplitFixtureClaims());
  });

  it("keeps a claim out of the rule so it cannot corroborate a later split", () => {
    const claims = [...buildSplitFixtureClaims(), oldClaim()];
    const judge = (input: readonly SecReportedFact[]) =>
      evaluateSplitEvidence({
        legalEntityId: SPLIT_FILER_ENTITY_ID,
        claims: input,
        observations,
        documents,
      });

    // Sin el horizonte, el anuncio de un split viejo que nadie confirmó pasa por
    // anuncio del split de 2024, que tiene el mismo ratio.
    expect(
      judge(claims).filings.find(
        (filing) => filing.accessionNumber === OLD_ACCESSION,
      ),
    ).toMatchObject({
      status: "corroborating",
      splitAccession: SPLIT_ACCESSIONS.annual2024,
    });

    const horizon = partitionSplitClaimsByHistory({
      claims,
      observations,
      documents,
    });
    const evidence = judge(horizon.within);

    expect(evidence).toStrictEqual(judge(buildSplitFixtureClaims()));
    expect(evidence.splits.map((split) => split.accessionNumber)).toEqual([
      SPLIT_ACCESSIONS.annual2024,
    ]);
  });

  it("treats the first published filing as having nothing to compare against", () => {
    const horizon = partitionSplitClaimsByHistory({
      claims: [
        buildSplitClaim({ filing: "annual2022", end: "2022-06-01" }),
        buildSplitClaim({ filing: "annual2023", end: "2023-06-01" }),
      ],
      observations,
      documents,
    });

    expect(horizon.before.map((claim) => claim.accessionNumber)).toEqual([
      SPLIT_ACCESSIONS.annual2022,
    ]);
    expect(horizon.within.map((claim) => claim.accessionNumber)).toEqual([
      SPLIT_ACCESSIONS.annual2023,
    ]);
  });

  it("bounds a claim without a document by the day after its filing", () => {
    // Presentado el mismo día que la primera vintage: pudo conocerse después, así
    // que la regla lo juzga.
    const sameDay = oldClaim({ filed: SPLIT_FILINGS.annual2022.filed });
    const dayBefore = oldClaim({
      accessionNumber: "0000000073-23-000001",
      filed: "2023-02-20",
    });
    const horizon = partitionSplitClaimsByHistory({
      claims: [sameDay, dayBefore],
      observations,
      documents,
    });

    expect(horizon.within).toStrictEqual([sameDay]);
    expect(horizon.before.map((claim) => claim.accessionNumber)).toEqual([
      "0000000073-23-000001",
    ]);
  });

  it("lists every ratio of a filing that declares more than one", () => {
    const horizon = partitionSplitClaimsByHistory({
      claims: [
        oldClaim({ value: "4" }),
        oldClaim({ value: "2", end: "2018-06-01" }),
      ],
      observations,
      documents,
    });

    expect(horizon.before[0]?.ratios).toEqual(["2", "4"]);
  });

  it("applies no horizon without published history", () => {
    const claims = [oldClaim()];
    const horizon = partitionSplitClaimsByHistory({
      claims,
      observations: [],
      documents,
    });

    expect(horizon).toStrictEqual({
      version: SPLIT_CLAIM_HORIZON_VERSION,
      publishedFrom: null,
      within: claims,
      before: [],
    });
  });
});
