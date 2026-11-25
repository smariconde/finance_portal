import { describe, expect, it } from "vitest";

import {
  EXPERIMENTAL_MODEL_CHECK_IDS,
  readRunReview,
  reviewOfRun,
  RUN_REVIEW_VERSION,
} from "./run-review";

const failed = (
  id: string,
  mode: "reject" | "require_review" = "require_review",
) => ({ id, mode, status: "failed" }) as const;
const passed = (id: string) =>
  ({ id, mode: "require_review", status: "passed" }) as const;

describe("readRunReview", () => {
  it("a computed run with every check passed reads computed", () => {
    expect(
      readRunReview({
        status: "computed",
        checks: { base: [passed("terminal_value_share")], bear: [], bull: [] },
      }),
    ).toEqual({
      version: RUN_REVIEW_VERSION,
      marks: ["computed"],
      experimentalModel: null,
      reviewChecks: [],
    });
  });

  it("GOOGL: the bull scenario's terminal value is the only cause, and it is named", () => {
    const review = readRunReview({
      status: "requires_review",
      checks: {
        base: [passed("terminal_value_share")],
        bear: [passed("terminal_value_share")],
        bull: [failed("terminal_value_share")],
      },
    });

    expect(review.marks).toEqual(["requires_review"]);
    expect(review.reviewChecks).toEqual([
      { id: "terminal_value_share", origins: ["bull"] },
    ]);
  });

  it("AMZN: one check failed in base and bull is listed once with both origins", () => {
    expect(
      readRunReview({
        status: "requires_review",
        checks: {
          base: [failed("terminal_value_share")],
          bear: [],
          bull: [failed("terminal_value_share")],
        },
      }).reviewChecks,
    ).toEqual([{ id: "terminal_value_share", origins: ["base", "bull"] }]);
  });

  it.each(EXPERIMENTAL_MODEL_CHECK_IDS)(
    "%s alone reads Experimental, without review",
    (id) => {
      const review = readRunReview({
        status: "requires_review",
        checks: { base: [failed(id)], bear: [failed(id)], bull: [failed(id)] },
      });

      expect(review.marks).toEqual(["experimental"]);
      expect(review.experimentalModel).toBe(id);
      expect(review.reviewChecks).toEqual([]);
    },
  );

  it("LLY: experimental plus a terminal value over the limit marks both", () => {
    const review = readRunReview({
      status: "requires_review",
      checks: {
        base: [
          failed("growth_model_experimental"),
          failed("terminal_value_share"),
        ],
        bear: [],
        bull: [],
      },
    });

    expect(review.marks).toEqual(["experimental", "requires_review"]);
    expect(review.reviewChecks).toEqual([
      { id: "terminal_value_share", origins: ["base"] },
    ]);
  });

  it("an experimental label that passed does not make a run experimental", () => {
    expect(
      readRunReview({
        status: "computed",
        checks: { base: [passed("growth_model_experimental")] },
      }).marks,
    ).toEqual(["computed"]);
  });

  it("a failed reject check is not a review cause", () => {
    expect(
      readRunReview({
        status: "computed",
        checks: { base: [failed("required_inputs_present", "reject")] },
      }).reviewChecks,
    ).toEqual([]);
  });

  it("a rejected run reads rejected, whatever its checks", () => {
    expect(
      readRunReview({
        status: "rejected",
        checks: { base: [failed("growth_model_experimental")] },
      }).marks,
    ).toEqual(["rejected"]);
  });

  it("a stored requires_review with no readable cause keeps the stored mark", () => {
    expect(
      readRunReview({ status: "requires_review", checks: {} }).marks,
    ).toEqual(["requires_review"]);
  });

  it("an experimental run stored as requires_review without other causes does not invent review", () => {
    expect(
      readRunReview({
        status: "requires_review",
        checks: { base: [failed("cycle_model_experimental")] },
      }).marks,
    ).toEqual(["experimental"]);
  });
});

describe("reviewOfRun", () => {
  it("reads base and scenario checks of a stored FCFF run", () => {
    expect(
      reviewOfRun({
        status: "requires_review",
        result: {
          checks: [failed("cycle_model_experimental")],
          scenarios: {
            bear: { checks: [failed("cycle_model_experimental")] },
            bull: { checks: [failed("terminal_value_share")] },
          },
        },
      }),
    ).toMatchObject({
      marks: ["experimental", "requires_review"],
      reviewChecks: [{ id: "terminal_value_share", origins: ["bull"] }],
    });
  });

  it("reads a financial run whose scenarios keep no checks", () => {
    expect(
      reviewOfRun({
        status: "requires_review",
        result: {
          checks: [
            failed("financial_model_experimental"),
            failed("financial_country_risk_basis"),
          ],
          scenarios: { bear: {}, bull: {} },
        },
      }),
    ).toMatchObject({
      marks: ["experimental", "requires_review"],
      reviewChecks: [{ id: "financial_country_risk_basis", origins: ["base"] }],
    });
  });

  it("a rejected run without a result reads rejected", () => {
    expect(reviewOfRun({ status: "rejected", result: null }).marks).toEqual([
      "rejected",
    ]);
  });
});
