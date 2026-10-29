import { describe, expect, it } from "vitest";

import {
  VALUATION_DATA_RULE_VERSION,
  type ValuationDataStep,
} from "./valuation-data-step";
import {
  VALUATION_QUALITATIVE_RULE_VERSION,
  type ValuationQualitativeStep,
} from "./valuation-qualitative-step";
import {
  addMilliseconds,
  beatValuationJob,
  claimValuationJob,
  finishValuationJob,
  outcomeForAssessment,
  outcomeForDataStep,
  outcomeForFailure,
  outcomeForIdentity,
  outcomeForQualitativeStep,
  queueValuationJob,
  toValuationJobView,
  VALUATION_JOB_STALE_AFTER_MS,
  valuationJobOutcomeSchema,
  valuationJobSchema,
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
    expect(outcome.snapshotGap).toBe("method_not_derived");
    expect(outcome.method).toBe("fcff_base");
    expect(outcome.rigor).toBe("standard");
  });

  const SELECTED = {
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
  } as const;
  const RUN = "66666666-6666-4666-8666-666666666666";

  it("valuation-job-1.1.0: nombra por qué no armó el snapshot", () => {
    const outcome = outcomeForAssessment(SELECTED, {
      gap: "employee_equity_not_proposed",
    });

    expect(outcome.gap).toBe("snapshot_not_assembled");
    expect(outcome.snapshotGap).toBe("employee_equity_not_proposed");
    expect(outcome.valuationRunId).toBeNull();
  });

  it("records a selected REIT's missing annual AFFO as a snapshot refusal", () => {
    const outcome = outcomeForAssessment(
      {
        ...SELECTED,
        assetProfile: "reit",
        method: "affo_nav",
        rigor: "screening",
      },
      { gap: "reit_affo_reconciliation_missing" },
    );
    expect(outcome).toMatchObject({
      gap: "snapshot_not_assembled",
      methodStatus: "selected",
      assetProfile: "reit",
      method: "affo_nav",
      snapshotGap: "reit_affo_reconciliation_missing",
      valuationRunId: null,
    });
  });

  it("valuation-job-1.1.0: registra la corrida con su estado", () => {
    const outcome = outcomeForAssessment(SELECTED, {
      valuationRunId: RUN,
      runStatus: "rejected",
    });

    expect(outcome.gap).toBe("run_recorded");
    expect(outcome.valuationRunId).toBe(RUN);
    expect(outcome.runStatus).toBe("rejected");
    expect(outcome.snapshotGap).toBeNull();

    const running = claimValuationJob(queued(), {
      startedAt: T0,
      claimToken: TOKEN,
      staleBefore: T0,
    })!;
    const done = finishValuationJob(running, {
      claimToken: TOKEN,
      finishedAt: T0,
      outcome,
    });

    expect(done?.ruleVersion).toBe("valuation-job-1.3.0");
    expect(done?.valuationRunId).toBe(RUN);
  });

  it("rechaza una corrida fuera de run_recorded, un hueco sin motivo y un método sin regla", () => {
    const recorded = outcomeForAssessment(SELECTED, {
      valuationRunId: RUN,
      runStatus: "computed",
    });

    expect(
      valuationJobOutcomeSchema.safeParse({
        ...recorded,
        gap: "snapshot_not_assembled",
      }).success,
    ).toBe(false);
    expect(
      valuationJobOutcomeSchema.safeParse({
        ...recorded,
        gap: "snapshot_not_assembled",
        valuationRunId: null,
        runStatus: null,
      }).success,
    ).toBe(false);
    expect(
      valuationJobOutcomeSchema.safeParse({ ...recorded, runStatus: null })
        .success,
    ).toBe(false);
    expect(
      valuationJobOutcomeSchema.safeParse({
        ...recorded,
        method: "affo_nav",
      }).success,
    ).toBe(false);
  });

  it.each(["fcff_three_stage", "revenue_margin_survival"] as const)(
    "registra el método de crecimiento %s derivado por el job (F6-21)",
    (method) => {
      const recorded = outcomeForAssessment(
        {
          ...SELECTED,
          assetProfile:
            method === "fcff_three_stage" ? "high_growth" : "loss_making",
          method,
        },
        { valuationRunId: RUN, runStatus: "requires_review" },
      );
      expect(valuationJobOutcomeSchema.safeParse(recorded).success).toBe(true);
    },
  );

  it("registra una corrida de margen de ciclo, que el job sabe derivar (F6-18)", () => {
    const recorded = outcomeForAssessment(
      { ...SELECTED, assetProfile: "cyclical", method: "normalized_fcff" },
      { valuationRunId: RUN, runStatus: "requires_review" },
    );

    expect(recorded.gap).toBe("run_recorded");
    expect(valuationJobOutcomeSchema.safeParse(recorded).success).toBe(true);
  });

  it("una fila 1.0.0 conserva lo que dijo, sin motivo ni corrida", () => {
    const job = {
      ...queued(),
      ruleVersion: "valuation-job-1.0.0",
      status: "completed",
      startedAt: T0,
      finishedAt: T0,
      identityStatus: "resolved",
      legalEntityId: ENTITY,
      securityId: SECURITY,
      listingId: LISTING,
      gap: "snapshot_not_assembled",
      methodStatus: "selected",
      assetProfile: "non_financial_mature",
      method: "fcff_base",
      rigor: "standard",
    };

    expect(valuationJobSchema.safeParse(job).success).toBe(true);
    expect(
      valuationJobSchema.safeParse({
        ...job,
        snapshotGap: "market_unavailable",
      }).success,
    ).toBe(false);
    expect(
      valuationJobSchema.safeParse({
        ...job,
        ruleVersion: "valuation-job-1.1.0",
      }).success,
    ).toBe(false);
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

  describe("valuation-job-1.2.0", () => {
    const SUBJECT = {
      legalEntityId: ENTITY,
      securityId: SECURITY,
      listingId: LISTING,
    };
    const PASSED: ValuationDataStep["audit"] = {
      status: "passed",
      chains: 4,
      notExercised: [],
    };

    function dataStep(
      overrides: Partial<ValuationDataStep> = {},
    ): ValuationDataStep {
      return {
        ruleVersion: VALUATION_DATA_RULE_VERSION,
        fundamentals: { status: "ingested", filers: 1 },
        sic: { status: "observed", code: "3571" },
        prices: { status: "ingested" },
        audit: PASSED,
        ...overrides,
      };
    }

    it("cada gap del paso de datos dice lo mismo que su registro", () => {
      expect(outcomeForDataStep(SUBJECT, "data_ingested", dataStep()).gap).toBe(
        "data_ingested",
      );
      expect(
        outcomeForDataStep(
          SUBJECT,
          "ingestion_pending",
          dataStep({
            fundamentals: {
              status: "pending",
              reason: "daily_budget_exhausted",
              resumesAt: "2026-10-22T00:00:00.000Z",
            },
            audit: null,
          }),
        ).dataStep?.fundamentals.status,
      ).toBe("pending");
      expect(
        outcomeForDataStep(
          SUBJECT,
          "point_in_time_audit_failed",
          dataStep({
            audit: {
              status: "failed",
              chains: 4,
              failures: 2,
              claim: "revision_chain_ordered",
              metricId: "Revenues",
              asOf: "2025-12-31",
            },
          }),
        ).gap,
      ).toBe("point_in_time_audit_failed");

      // Bajó algo pero no auditó: no es `data_ingested`.
      expect(() =>
        outcomeForDataStep(SUBJECT, "data_ingested", dataStep({ audit: null })),
      ).toThrow();
      // Nada bajó: no hay qué continuar.
      expect(() =>
        outcomeForDataStep(
          SUBJECT,
          "data_ingested",
          dataStep({
            fundamentals: { status: "present" },
            sic: { status: "present" },
            prices: { status: "current", latestClose: "2026-10-20" },
          }),
        ),
      ).toThrow();
      // Un pendiente no se audita a medias.
      expect(() =>
        outcomeForDataStep(SUBJECT, "ingestion_pending", dataStep()),
      ).toThrow();
      // Una falla de auditoría sin falla no existe.
      expect(() =>
        outcomeForDataStep(SUBJECT, "point_in_time_audit_failed", dataStep()),
      ).toThrow();
    });

    it("un gap del paso de datos exige el registro y no lleva método", () => {
      expect(
        valuationJobOutcomeSchema.safeParse({
          ...outcomeForDataStep(SUBJECT, "data_ingested", dataStep()),
          dataStep: null,
        }).success,
      ).toBe(false);
      expect(
        valuationJobOutcomeSchema.safeParse({
          ...outcomeForDataStep(SUBJECT, "data_ingested", dataStep()),
          methodStatus: "selected",
          assetProfile: "non_financial_mature",
          method: "fcff_base",
          rigor: "standard",
        }).success,
      ).toBe(false);
    });

    it("una fila 1.1.0 no tiene paso de datos ni continuación", () => {
      const done = finishValuationJob(
        claimValuationJob(queued(), {
          startedAt: T0,
          claimToken: TOKEN,
          staleBefore: T0,
        })!,
        {
          claimToken: TOKEN,
          finishedAt: T0,
          outcome: outcomeForDataStep(SUBJECT, "data_ingested", dataStep()),
        },
      )!;

      expect(done.ruleVersion).toBe("valuation-job-1.3.0");
      expect(
        valuationJobSchema.safeParse({
          ...done,
          ruleVersion: "valuation-job-1.1.0",
        }).success,
      ).toBe(false);
      expect(
        valuationJobSchema.safeParse({
          ...queued(),
          ruleVersion: "valuation-job-1.1.0",
          followsJobId: TOKEN,
        }).success,
      ).toBe(false);
    });

    it("un job no se continúa a sí mismo", () => {
      expect(() =>
        queueValuationJob({
          jobId: JOB_ID,
          ticker: "AAPL",
          knownAt: T0,
          createdAt: T0,
          followsJobId: JOB_ID,
        }),
      ).toThrow();
    });

    it("el latido mantiene vivo el reclamo y sólo lo da el token vigente", () => {
      const running = claimValuationJob(queued(), {
        startedAt: T0,
        claimToken: TOKEN,
        staleBefore: T0,
      })!;
      const later = addMilliseconds(T0, VALUATION_JOB_STALE_AFTER_MS + 1);
      const beaten = beatValuationJob(running, {
        claimToken: TOKEN,
        at: addMilliseconds(T0, VALUATION_JOB_STALE_AFTER_MS),
      })!;

      expect(
        beatValuationJob(running, { claimToken: JOB_ID, at: later }),
      ).toBeNull();
      // Sin latido, a los dos minutos se retoma; con latido, no.
      expect(
        claimValuationJob(running, {
          startedAt: later,
          claimToken: JOB_ID,
          staleBefore: addMilliseconds(later, -VALUATION_JOB_STALE_AFTER_MS),
        }),
      ).not.toBeNull();
      expect(
        claimValuationJob(beaten, {
          startedAt: later,
          claimToken: JOB_ID,
          staleBefore: addMilliseconds(later, -VALUATION_JOB_STALE_AFTER_MS),
        }),
      ).toBeNull();
      expect(() =>
        valuationJobSchema.parse({
          ...running,
          heartbeatAt: addMilliseconds(T0, -1),
        }),
      ).toThrow();
    });

    it("la vista lleva el paso de datos y si continúa a otro, nunca el ID", () => {
      const follower = queueValuationJob({
        jobId: TOKEN,
        ticker: "AAPL",
        knownAt: T0,
        createdAt: T0,
        followsJobId: JOB_ID,
      });
      const view = toValuationJobView(follower);

      expect(view).toMatchObject({ follows: true, dataStep: null });
      expect(JSON.stringify(view)).not.toContain(JOB_ID);
    });
  });

  describe("valuation-job-1.3.0", () => {
    const SUBJECT = {
      legalEntityId: ENTITY,
      securityId: SECURITY,
      listingId: LISTING,
    };
    const DATA: ValuationDataStep = {
      ruleVersion: VALUATION_DATA_RULE_VERSION,
      fundamentals: { status: "present" },
      sic: { status: "present" },
      prices: { status: "current", latestClose: "2026-10-20" },
      audit: { status: "passed", chains: 4, notExercised: [] },
    };
    const READING = {
      ...SUBJECT,
      cik: "0000320193",
      hasAnnualFundamentals: true,
      methodStatus: "selected",
      assetProfile: "non_financial_mature",
      method: "fcff_base",
      rigor: "standard",
      unsupportedReason: null,
    } as const;

    function step(
      overrides: Partial<ValuationQualitativeStep> = {},
    ): ValuationQualitativeStep {
      return {
        ruleVersion: VALUATION_QUALITATIVE_RULE_VERSION,
        industry: { status: "accepted", rung: 1 },
        employeeEquity: { status: "present" },
        operationsMix: { status: "abstained", reason: "ladder_exhausted" },
        chargedNanoUsd: 2_600_000,
        ...overrides,
      };
    }

    it("qualitative_resolved needs an accepted decision and carries no method", () => {
      const outcome = outcomeForQualitativeStep(SUBJECT, DATA, step());

      expect(outcome.gap).toBe("qualitative_resolved");
      expect(outcome.methodStatus).toBeNull();
      expect(() =>
        outcomeForQualitativeStep(
          SUBJECT,
          DATA,
          step({ industry: { status: "skipped", reason: "already_asked" } }),
        ),
      ).toThrow();
    });

    it("the snapshot gap and the recorded run keep what the AI was asked", () => {
      const missing = outcomeForAssessment(
        READING,
        { gap: "employee_equity_not_proposed" },
        DATA,
        step({
          industry: { status: "present" },
          employeeEquity: { status: "abstained", reason: "ladder_exhausted" },
        }),
      );

      expect(missing.qualitativeStep?.employeeEquity.status).toBe("abstained");
      // Una evaluación que no llegó al snapshot no le preguntó nada a la IA.
      expect(
        valuationJobOutcomeSchema.safeParse({
          ...outcomeForDataStep(SUBJECT, "point_in_time_audit_failed", {
            ...DATA,
            audit: {
              status: "failed",
              chains: 4,
              failures: 1,
              claim: "revision_chain_ordered",
              metricId: "Revenues",
              asOf: "2025-12-31",
            },
          }),
          qualitativeStep: step(),
        }).success,
      ).toBe(false);
    });

    it("a 1.2.0 row keeps its data step and never has a qualitative step", () => {
      const done = finishValuationJob(
        claimValuationJob(queued(), {
          startedAt: T0,
          claimToken: TOKEN,
          staleBefore: T0,
        })!,
        {
          claimToken: TOKEN,
          finishedAt: T0,
          outcome: outcomeForAssessment(
            READING,
            { gap: "employee_equity_not_proposed" },
            DATA,
          ),
        },
      )!;

      expect(
        valuationJobSchema.safeParse({
          ...done,
          ruleVersion: "valuation-job-1.2.0",
        }).success,
      ).toBe(true);
      expect(
        valuationJobSchema.safeParse({
          ...done,
          ruleVersion: "valuation-job-1.2.0",
          qualitativeStep: step({ industry: { status: "present" } }),
        }).success,
      ).toBe(false);
    });

    it("the view carries the step's codes", () => {
      const done = finishValuationJob(
        claimValuationJob(queued(), {
          startedAt: T0,
          claimToken: TOKEN,
          staleBefore: T0,
        })!,
        {
          claimToken: TOKEN,
          finishedAt: T0,
          outcome: outcomeForQualitativeStep(SUBJECT, DATA, step()),
        },
      )!;

      expect(toValuationJobView(done)).toMatchObject({
        gap: "qualitative_resolved",
        qualitativeStep: { industry: { status: "accepted", rung: 1 } },
      });
    });
  });
});
