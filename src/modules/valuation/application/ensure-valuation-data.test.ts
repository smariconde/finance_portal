import { describe, expect, it } from "vitest";

import {
  EMPTY_ITEM_COUNTS,
  type IngestionJob,
} from "@/modules/ingestion/domain/ingestion-job";

import {
  classifyDurableRun,
  ensureValuationData,
  type DurableDownload,
  type SicObservation,
  type ValuationDataDependencies,
  type ValuationDataRequest,
} from "./ensure-valuation-data";

const ENTITY = "33333333-3333-4333-8333-333333333333";
const PREDECESSOR = "66666666-6666-4666-8666-666666666666";
const SECURITY = "44444444-4444-4444-8444-444444444444";
// Miércoles después de las 22:00 UTC: la rueda del día ya se asentó.
const NOW = "2026-10-21T23:00:00.000Z";

const PASSING_REPORT = {
  chains: 8,
  verdicts: (
    [
      "provenance_resolves",
      "availability_precedes_fetch",
      "revision_chain_ordered",
      "as_known_excludes_later_revision",
      "restatement_changes_content",
    ] as const
  ).map((claim) => ({ claim, status: "pass" as const, failed: 0 })),
  findings: [],
};

function request(
  overrides: Partial<ValuationDataRequest> = {},
): ValuationDataRequest {
  return {
    legalEntityId: ENTITY,
    cik: "0000789019",
    securityId: SECURITY,
    lineageCiks: ["0000789019"],
    lineageSubjectIds: [ENTITY],
    needsFundamentals: false,
    needsSic: false,
    mayDownload: true,
    ...overrides,
  };
}

function fake(
  overrides: {
    readonly fundamentals?: DurableDownload;
    readonly sic?: SicObservation;
    readonly prices?: DurableDownload;
    readonly latestClose?: string | null;
    readonly lastPriceCheck?: string | null;
  } = {},
) {
  const calls: string[] = [];
  const dependencies: ValuationDataDependencies = {
    ingestFundamentals: async (ciks) => {
      calls.push(`fundamentals:${ciks.join(",")}`);
      return overrides.fundamentals ?? { status: "completed" };
    },
    observeSic: async ({ cik }) => {
      calls.push(`sic:${cik}`);
      return overrides.sic ?? { status: "observed", code: "7372" };
    },
    latestClose: async () =>
      "latestClose" in overrides ? overrides.latestClose! : "2026-10-21",
    lastPriceCheck: async () => overrides.lastPriceCheck ?? null,
    ingestPrices: async (securityId) => {
      calls.push(`prices:${securityId}`);
      return overrides.prices ?? { status: "completed" };
    },
    auditSubjects: async (subjectIds) => {
      calls.push(`audit:${subjectIds.join(",")}`);
      return PASSING_REPORT;
    },
    now: () => NOW,
  };

  return { calls, dependencies };
}

describe("ensureValuationData", () => {
  it("con todo guardado y al día no baja nada y audita el linaje", async () => {
    const { calls, dependencies } = fake();
    const step = await ensureValuationData(
      request({ lineageSubjectIds: [ENTITY, PREDECESSOR] }),
      dependencies,
    );

    expect(step).toMatchObject({
      fundamentals: { status: "present" },
      sic: { status: "present" },
      prices: { status: "current", latestClose: "2026-10-21" },
      audit: { status: "passed", chains: 8 },
    });
    expect(calls).toEqual([`audit:${ENTITY},${PREDECESSOR}`]);
  });

  it("una empresa nueva baja su ventana con los antecesores, el SIC y el cierre", async () => {
    const { calls, dependencies } = fake({ latestClose: null });
    const step = await ensureValuationData(
      request({
        needsFundamentals: true,
        needsSic: true,
        lineageCiks: ["0000789019", "0000034088"],
      }),
      dependencies,
    );

    expect(step.fundamentals).toEqual({ status: "ingested", filers: 2 });
    expect(step.sic).toEqual({ status: "observed", code: "7372" });
    expect(step.prices).toEqual({ status: "ingested" });
    expect(step.audit?.status).toBe("passed");
    expect(calls).toEqual([
      "fundamentals:0000789019,0000034088",
      "sic:0000789019",
      `prices:${SECURITY}`,
      `audit:${ENTITY}`,
    ]);
  });

  it("un job que continúa a otro nunca baja: nombra lo que sigue faltando", async () => {
    const { calls, dependencies } = fake({ latestClose: "2026-10-16" });
    const step = await ensureValuationData(
      request({ needsFundamentals: true, needsSic: true, mayDownload: false }),
      dependencies,
    );

    expect(step).toMatchObject({
      fundamentals: { status: "missing" },
      sic: { status: "missing" },
      prices: { status: "missing", latestClose: "2026-10-16" },
      audit: { status: "passed" },
    });
    expect(calls).toEqual([`audit:${ENTITY}`]);
  });

  it("una ventana bajada con una selección vieja se baja otra vez, y lo dice (F6-14)", async () => {
    const { calls, dependencies } = fake();
    const step = await ensureValuationData(
      request({ fundamentalsOutdated: true }),
      dependencies,
    );

    expect(step.fundamentals).toEqual({
      status: "ingested",
      filers: 1,
      selectionOutdated: true,
    });
    expect(calls).toContain("fundamentals:0000789019");
  });

  it("una ventana vieja no frena: ni en el job que continúa ni con la fuente ocupada", async () => {
    const following = fake();

    expect(
      (
        await ensureValuationData(
          request({ fundamentalsOutdated: true, mayDownload: false }),
          following.dependencies,
        )
      ).fundamentals,
    ).toEqual({ status: "present" });
    expect(following.calls).not.toContain("fundamentals:0000789019");

    const busy = fake({
      fundamentals: {
        status: "pending",
        reason: "source_busy",
        resumesAt: null,
      },
    });
    const step = await ensureValuationData(
      request({ fundamentalsOutdated: true }),
      busy.dependencies,
    );

    expect(step.fundamentals).toEqual({ status: "present" });
    expect(step.audit?.status).toBe("passed");
  });

  it("una descarga pendiente no audita a medias", async () => {
    const pending = {
      status: "pending",
      reason: "source_busy",
      resumesAt: "2026-10-21T23:05:00.000Z",
    } as const;
    const { calls, dependencies } = fake({ fundamentals: pending });
    const step = await ensureValuationData(
      request({ needsFundamentals: true }),
      dependencies,
    );

    expect(step.fundamentals).toEqual(pending);
    expect(step.audit).toBeNull();
    expect(calls.some((call) => call.startsWith("audit:"))).toBe(false);
  });

  it("un precio que falla no bloquea: se audita y se sigue", async () => {
    const { dependencies } = fake({
      latestClose: "2026-10-16",
      prices: { status: "failed", code: "provider_error" },
    });
    const step = await ensureValuationData(request(), dependencies);

    expect(step.prices).toEqual({ status: "failed", code: "provider_error" });
    expect(step.audit?.status).toBe("passed");
  });

  it("una security revisada después de la rueda no se vuelve a pedir (feriado, suspensión)", async () => {
    const { calls, dependencies } = fake({
      latestClose: "2026-10-20",
      lastPriceCheck: "2026-10-21T22:30:00.000Z",
    });
    const step = await ensureValuationData(request(), dependencies);

    expect(step.prices).toEqual({
      status: "current",
      latestClose: "2026-10-20",
    });
    expect(calls.some((call) => call.startsWith("prices:"))).toBe(false);
  });

  it("sin security no hay serie que pedir", async () => {
    const { dependencies } = fake();

    expect(
      (await ensureValuationData(request({ securityId: null }), dependencies))
        .prices,
    ).toEqual({ status: "not_applicable" });
  });

  it("un SIC que la SEC no publica no bloquea ni cuenta como bajado", async () => {
    const { dependencies } = fake({ sic: { status: "not_published" } });
    const step = await ensureValuationData(
      request({ needsSic: true }),
      dependencies,
    );

    expect(step.sic).toEqual({ status: "not_published" });
    expect(step.audit?.status).toBe("passed");
  });
});

describe("classifyDurableRun", () => {
  const JOB = {
    jobId: "77777777-7777-4777-8777-777777777777",
    status: "open",
    notBefore: null,
  } as unknown as IngestionJob;

  function classify(
    stopReason: Parameters<
      typeof classifyDurableRun
    >[0]["result"]["stopReason"],
    job: Partial<IngestionJob> = {},
    counts = EMPTY_ITEM_COUNTS,
  ) {
    return classifyDurableRun({
      result: {
        stopReason,
        job: { ...JOB, ...job } as IngestionJob,
        busyLease: null,
        waitUntil: "2026-10-22T00:00:00.000Z",
      },
      counts,
      failedItem:
        counts.failed + counts.poisoned > 0
          ? {
              lastFailure: {
                code: "subject_rejected",
                message: "x",
                retryable: false,
              },
            }
          : null,
    });
  }

  it("un job terminado con todo completo está bajado; uno con un item caído, falló", () => {
    expect(
      classify(
        "completed",
        { status: "completed" },
        {
          ...EMPTY_ITEM_COUNTS,
          completed: 2,
        },
      ),
    ).toEqual({ status: "completed" });
    expect(
      classify(
        "completed",
        { status: "completed" },
        {
          ...EMPTY_ITEM_COUNTS,
          completed: 1,
          poisoned: 1,
        },
      ),
    ).toEqual({ status: "failed", code: "subject_rejected" });
  });

  it("cada parada de la fuente deja el job abierto con su motivo", () => {
    expect(classify("source_busy")).toMatchObject({ reason: "source_busy" });
    expect(classify("source_disabled")).toMatchObject({
      reason: "source_disabled",
    });
    expect(classify("daily_budget_exhausted")).toEqual({
      status: "pending",
      reason: "daily_budget_exhausted",
      resumesAt: "2026-10-22T00:00:00.000Z",
    });
    expect(classify("budget_reserve")).toMatchObject({ reason: "run_budget" });
    expect(classify("source_signal")).toMatchObject({
      reason: "source_backoff",
    });
    expect(classify("job_not_runnable", { status: "paused" })).toMatchObject({
      reason: "job_paused",
    });
    expect(classify("job_not_runnable", { status: "cancelled" })).toEqual({
      status: "failed",
      code: "job_cancelled",
    });
  });
});

describe("on-demand CEDEAR prices", () => {
  it("checks the CEDEAR even if the US close is current, and never on a continuation", async () => {
    const { dependencies } = fake();
    const calls: string[] = [];
    const local = {
      ...dependencies,
      ensureCedearPrices: async (id: string) => {
        calls.push(id);
      },
    };
    await ensureValuationData(request(), local);
    expect(calls).toEqual([SECURITY]);
    await ensureValuationData(request({ mayDownload: false }), local);
    expect(calls).toEqual([SECURITY]);
  });
});
