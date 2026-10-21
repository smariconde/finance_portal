import { describe, expect, it } from "vitest";

import {
  addMilliseconds,
  claimValuationJob,
  finishValuationJob,
  outcomeForAssessment,
  outcomeForFailure,
  outcomeForIdentity,
  queueValuationJob,
  VALUATION_JOB_STALE_AFTER_MS,
  valuationTickerSchema,
} from "./valuation-job";

const T0 = "2026-10-21T15:00:00.000Z";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "22222222-2222-4222-8222-222222222222";
const ENTITY = "33333333-3333-4333-8333-333333333333";
const SECURITY = "44444444-4444-4444-8444-444444444444";
const LISTING = "55555555-5555-4555-8555-555555555555";

function queued() {
  return queueValuationJob({
    jobId: JOB_ID,
    ticker: "aapl",
    knownAt: T0,
    createdAt: T0,
  });
}

describe("valuation job", () => {
  it("normaliza el ticker y rechaza lo que no es un símbolo", () => {
    expect(valuationTickerSchema.parse(" aapl ")).toBe("AAPL");
    expect(valuationTickerSchema.parse("brk.b")).toBe("BRK.B");
    expect(
      valuationTickerSchema.safeParse("http://169.254.169.254").success,
    ).toBe(false);
    expect(valuationTickerSchema.safeParse("0000320193").success).toBe(false);
    expect(valuationTickerSchema.safeParse("").success).toBe(false);
  });

  it("encola un pedido sin resultado y sin reclamo", () => {
    const job = queued();

    expect(job.ticker).toBe("AAPL");
    expect(job.status).toBe("queued");
    expect(job.gap).toBeNull();
    expect(job.claimToken).toBeNull();
  });

  it("reclama una cola y retoma un running viejo, no uno fresco ni uno cerrado", () => {
    const running = claimValuationJob(queued(), {
      startedAt: T0,
      claimToken: TOKEN,
      staleBefore: T0,
    });

    expect(running?.status).toBe("running");
    expect(running?.claimToken).toBe(TOKEN);

    expect(
      claimValuationJob(running!, {
        startedAt: addMilliseconds(T0, 1_000),
        claimToken: "66666666-6666-4666-8666-666666666666",
        staleBefore: T0,
      }),
    ).toBeNull();

    const taken = claimValuationJob(running!, {
      startedAt: addMilliseconds(T0, VALUATION_JOB_STALE_AFTER_MS + 1),
      claimToken: "66666666-6666-4666-8666-666666666666",
      staleBefore: addMilliseconds(T0, VALUATION_JOB_STALE_AFTER_MS + 1),
    });

    expect(taken?.claimToken).toBe("66666666-6666-4666-8666-666666666666");

    const finished = finishValuationJob(running!, {
      claimToken: TOKEN,
      finishedAt: addMilliseconds(T0, 10),
      outcome: outcomeForIdentity("not_found"),
    });

    expect(
      claimValuationJob(finished!, {
        startedAt: T0,
        claimToken: TOKEN,
        staleBefore: T0,
      }),
    ).toBeNull();
  });

  it("cierra sólo con el token vigente", () => {
    const running = claimValuationJob(queued(), {
      startedAt: T0,
      claimToken: TOKEN,
      staleBefore: T0,
    })!;

    expect(
      finishValuationJob(running, {
        claimToken: "66666666-6666-4666-8666-666666666666",
        finishedAt: addMilliseconds(T0, 10),
        outcome: outcomeForFailure(),
      }),
    ).toBeNull();

    const finished = finishValuationJob(running, {
      claimToken: TOKEN,
      finishedAt: addMilliseconds(T0, 10),
      outcome: outcomeForIdentity("ambiguous"),
    });

    expect(finished?.gap).toBe("ambiguous_ticker");
    expect(finished?.claimToken).toBeNull();
  });

  it("prioriza el CIK y la serie anual sobre el método", () => {
    expect(
      outcomeForAssessment({
        legalEntityId: ENTITY,
        securityId: SECURITY,
        listingId: LISTING,
        cik: null,
        hasAnnualFundamentals: true,
        methodStatus: "selected",
        assetProfile: "non_financial_mature",
        method: "fcff_base",
        rigor: "standard",
        unsupportedReason: null,
      }).gap,
    ).toBe("cik_missing");

    expect(
      outcomeForAssessment({
        legalEntityId: ENTITY,
        securityId: SECURITY,
        listingId: LISTING,
        cik: "0000320193",
        hasAnnualFundamentals: false,
        methodStatus: "unsupported_method",
        assetProfile: null,
        method: null,
        rigor: null,
        unsupportedReason: "missing_required_input",
      }).gap,
    ).toBe("annual_fundamentals");
  });

  it("un método elegido no publica un valor: nombra el snapshot que falta", () => {
    const outcome = outcomeForAssessment({
      legalEntityId: ENTITY,
      securityId: SECURITY,
      listingId: LISTING,
      cik: "0000320193",
      hasAnnualFundamentals: true,
      methodStatus: "selected",
      assetProfile: "non_financial_mature",
      method: "fcff_base",
      rigor: "standard",
      unsupportedReason: null,
    });

    expect(outcome.gap).toBe("snapshot_not_assembled");
    expect(outcome.method).toBe("fcff_base");
    expect(outcome.rigor).toBe("standard");
  });

  it("un método rechazado conserva el motivo del selector", () => {
    const outcome = outcomeForAssessment({
      legalEntityId: ENTITY,
      securityId: null,
      listingId: null,
      cik: "0000320193",
      hasAnnualFundamentals: true,
      methodStatus: "unsupported_method",
      assetProfile: "holding",
      method: null,
      rigor: null,
      unsupportedReason: "method_not_implemented",
    });

    expect(outcome.gap).toBe("unsupported_method");
    expect(outcome.unsupportedReason).toBe("method_not_implemented");
    expect(outcome.assetProfile).toBe("holding");
  });
});
