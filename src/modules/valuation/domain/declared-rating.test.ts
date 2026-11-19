import { describe, expect, it } from "vitest";

import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";

import { DECLARED_RATINGS } from "../application/declared-ratings";
import { fixtureCostOfCapitalReadings } from "../infrastructure/fixture-cost-of-capital-readings";
import { ratingBandFloor } from "./cost-of-capital";
import {
  assessDeclaredRating,
  DECLARED_RATING_VERSION,
  declaredRatingAt,
  declaredRatingMismatches,
  type RatingDeclaration,
} from "./declared-rating";

const ENTITY = "00000000-0000-4000-8000-0000000000aa";
const declaration: RatingDeclaration = {
  cik: "0000037996",
  ticker: "F",
  rating: "Ba1/BB+",
  decidedBy: "owner",
  declaredAt: "2026-11-19T16:00:00.000Z",
  rationale: "The lowest of the three published ratings, Moody's Ba1.",
  publishedRatings: [
    { agency: "Moody's", rating: "Ba1", source: "https://example.com/m" },
  ],
};
const at = (instant: string) =>
  pointInTimeQuerySchema.parse({
    effectiveAt: instant,
    knownAt: instant,
    revisionPolicy: "as_known",
    adjustmentPolicy: "as_known",
    sourcePolicyVersion: "source-policy-1.0.0",
  });

describe(DECLARED_RATING_VERSION, () => {
  it("is invisible before it was declared and found by CIK after", () => {
    expect(
      declaredRatingAt(
        [declaration],
        "0000037996",
        at("2026-11-18T00:00:00.000Z"),
      ),
    ).toBeNull();
    expect(
      declaredRatingAt(
        [declaration],
        "0000037996",
        at("2026-11-20T00:00:00.000Z"),
      ),
    ).toEqual(declaration);
    expect(
      declaredRatingAt(
        [declaration],
        "0000000001",
        at("2026-11-20T00:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("takes the floor of the declared band, and refuses a label the table lacks", () => {
    const ratings = fixtureCostOfCapitalReadings().ratings;
    const floor = ratingBandFloor(ratings, "Ba1/BB+");
    expect(floor?.value).toBe("2.25");
    expect(ratingBandFloor(ratings, "Baa3/BBB-")).toBeNull();
    expect(assessDeclaredRating(declaration, ENTITY, null)).toEqual({
      status: "unavailable",
      reason: "rating_not_in_table",
    });
    const result = assessDeclaredRating(declaration, ENTITY, floor);
    expect(result.status).toBe("declared");
  });

  it("names a declaration of another entity, unseen, or not the run's rating", () => {
    const floor = ratingBandFloor(
      fixtureCostOfCapitalReadings().ratings,
      "Ba1/BB+",
    );
    const result = assessDeclaredRating(declaration, ENTITY, floor);
    if (result.status !== "declared") throw new Error(result.status);
    const context = {
      legalEntityId: ENTITY,
      knowledge: at("2026-11-20T00:00:00.000Z"),
      syntheticRating: "Ba1/BB+",
    };
    expect(declaredRatingMismatches(result.declared, context, "d")).toEqual([]);
    expect(
      declaredRatingMismatches(
        result.declared,
        {
          legalEntityId: "00000000-0000-4000-8000-0000000000bb",
          knowledge: at("2026-11-18T00:00:00.000Z"),
          syntheticRating: "D2/D",
        },
        "d",
      ),
    ).toEqual([
      "d.legalEntityId",
      "d.declaration.declaredAt",
      "d.declaration.rating",
    ]);
  });

  it("declares Ford at the lowest published rating, a row the table has", () => {
    expect(DECLARED_RATINGS.map((item) => [item.ticker, item.rating])).toEqual([
      ["F", "Ba1/BB+"],
    ]);
    expect(
      ratingBandFloor(
        fixtureCostOfCapitalReadings().ratings,
        DECLARED_RATINGS[0]!.rating,
      ),
    ).not.toBeNull();
  });
});
