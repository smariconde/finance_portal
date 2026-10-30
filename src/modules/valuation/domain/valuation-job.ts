import { z } from "zod";

import { normalizeSymbol } from "@/modules/identity/domain/identity-graph";
import { utcTimestampSchema } from "@/modules/temporal/domain/temporal-version";

import { assetProfileSchema } from "./asset-profile";
import {
  dataStepBlock,
  dataStepIngested,
  valuationDataStepSchema,
  type ValuationDataStep,
} from "./valuation-data-step";
import { methodSelectionReasonSchema } from "./method-selection";
import {
  qualitativeStepAccepted,
  valuationQualitativeStepSchema,
  type ValuationQualitativeStep,
} from "./valuation-qualitative-step";
import { rigorLevelSchema } from "./rigor-level";
import { valuationRunStatusSchema } from "./valuation-run";

/**
 * Corrida por ticker encolada (`F6-01`,
 * [ADR 0045](../../../../docs/architecture/adr/0045-ticker-valuation-job.md)).
 *
 * Un job evalúa y termina con un código. Nada de este archivo lee un reloj.
 *
 * `valuation-job-1.1.0` (`F6-07`,
 * [ADR 0046](../../../../docs/architecture/adr/0046-derived-valuation-assumptions.md)):
 * con un método `fcff_base` el job arma el snapshot desde lo guardado, corre
 * el motor y registra la corrida (`run_recorded`), o nombra por qué no pudo
 * armarlo (`snapshotGap`). Una fila `1.0.0` conserva lo que dijo.
 *
 * `valuation-job-1.2.0` (`F6-05`,
 * [ADR 0051](../../../../docs/architecture/adr/0051-on-demand-valuation-data.md)):
 * antes de valuar, el job baja lo que falta y audita su sujeto (`dataStep`).
 * Si bajó algo termina en `data_ingested` y otro job, con corte nuevo, lo
 * continúa (`followsJobId`). Ese segundo job nunca baja nada.
 *
 * `valuation-job-1.3.0` (`F6-13`,
 * [ADR 0052](../../../../docs/architecture/adr/0052-qualitative-decisions-in-valuation-job.md)):
 * con los datos al día, el job pregunta a la IA lo cualitativo que falta
 * (`qualitativeStep`). Si quedó una decisión aceptada termina en
 * `qualitative_resolved` y otro job, con corte nuevo, valúa con ella.
 */
export const VALUATION_JOB_RULE_VERSION = "valuation-job-1.3.0";

export const valuationJobRuleVersionSchema = z.enum([
  "valuation-job-1.0.0",
  "valuation-job-1.1.0",
  "valuation-job-1.2.0",
  VALUATION_JOB_RULE_VERSION,
]);

/** Las reglas anteriores al paso de datos (`F6-05`). */
const PRE_DATA_RULES: ReadonlySet<string> = new Set([
  "valuation-job-1.0.0",
  "valuation-job-1.1.0",
]);

/**
 * Un worker caído no bloquea el ticker para siempre. Dos minutos sin latido
 * cubren una lectura local; un job que baja datos late cada 30 segundos.
 */
export const VALUATION_JOB_STALE_AFTER_MS = 120_000;
export const VALUATION_JOB_HEARTBEAT_MS = 30_000;

/**
 * Símbolo normalizado, no una URL ni un CIK. El punto y el guion se conservan:
 * `BRK.B` y `BRK-B` no son el mismo ticker.
 */
export const valuationTickerSchema = z
  .string()
  .trim()
  .transform((value) => normalizeSymbol(value))
  .pipe(z.string().regex(/^[A-Z][A-Z0-9.-]{0,15}$/u));

export const valuationJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
]);

export type ValuationJobStatus = z.infer<typeof valuationJobStatusSchema>;

export const valuationJobIdentitySchema = z.enum([
  "resolved",
  "ambiguous",
  "not_found",
  "conflict",
]);

export type ValuationJobIdentity = z.infer<typeof valuationJobIdentitySchema>;

export const valuationJobGapSchema = z.enum([
  "unresolved_ticker",
  "ambiguous_ticker",
  "identity_conflict",
  "cik_missing",
  "annual_fundamentals",
  "unsupported_method",
  "snapshot_not_assembled",
  "assessment_failed",
  "run_recorded",
  "data_ingested",
  "ingestion_pending",
  "ingestion_failed",
  "point_in_time_audit_failed",
  "qualitative_resolved",
]);

/** Gaps del paso de datos (`F6-05`): siempre registran qué se bajó o auditó. */
const DATA_GAPS: ReadonlySet<string> = new Set([
  "data_ingested",
  "ingestion_pending",
  "ingestion_failed",
  "point_in_time_audit_failed",
]);

export type ValuationJobGap = z.infer<typeof valuationJobGapSchema>;

/** Por qué el snapshot no se armó; sólo acompaña a `snapshot_not_assembled`. */
export const valuationSnapshotGapSchema = z.enum([
  "method_not_derived",
  "security_missing",
  "cost_of_capital_unavailable",
  "normalization_unavailable",
  "revenue_history_insufficient",
  "revenue_history_non_positive",
  "base_margin_unavailable",
  "sales_to_capital_unavailable",
  "tax_rate_unavailable",
  "employee_equity_not_proposed",
  "shares_outstanding_unavailable",
  "market_unavailable",
  "financial_base_unavailable",
  "financial_base_stale",
  "financial_declaration_missing",
  "financial_filing_evidence_missing",
  "growth_revenue_history_unavailable",
  "growth_margin_unavailable",
  "growth_tax_note_missing",
  "growth_tax_jurisdictions_not_reconciled",
  "growth_tax_pool_not_reconciled",
  "reit_property_basis_unavailable",
  "reit_affo_anchor_unavailable",
  "reit_affo_filing_unavailable",
  "reit_affo_reconciliation_missing",
  "reit_affo_unaccepted",
  "reit_nav_inputs_unavailable",
]);

export type ValuationSnapshotGap = z.infer<typeof valuationSnapshotGapSchema>;

export const valuationJobMethodStatusSchema = z.enum([
  "selected",
  "unsupported_method",
]);

/** Métodos cuyo snapshot arma el job desde lo guardado. */
const DERIVED_JOB_METHODS: ReadonlySet<string> = new Set([
  "fcff_base",
  "normalized_fcff",
  "excess_return",
  "fcff_three_stage",
  "revenue_margin_survival",
  // REIT de propiedades desde el XBRL (`F6-22`, ADR 0064).
  "affo_nav",
]);

export const valuationJobMethodSchema = z.enum([
  "fcff_base",
  "fcff_three_stage",
  "revenue_margin_survival",
  "excess_return",
  "affo_nav",
  "normalized_fcff",
  "sotp_nav",
  "apv_scenarios",
]);

export type ValuationJobMethod = z.infer<typeof valuationJobMethodSchema>;

const uuidSchema = z.uuid();

const methodFieldsSchema = z.object({
  methodStatus: valuationJobMethodStatusSchema.nullable(),
  assetProfile: assetProfileSchema.nullable(),
  method: valuationJobMethodSchema.nullable(),
  rigor: rigorLevelSchema.nullable(),
  unsupportedReason: methodSelectionReasonSchema.nullable(),
});

const runFieldsSchema = z.object({
  snapshotGap: valuationSnapshotGapSchema.nullable(),
  /** Verified original 10-K behind an AFFO refusal; older jobs omit it. */
  reitAffoAccessionNumber: z
    .string()
    .regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u)
    .nullable()
    .optional(),
  valuationRunId: uuidSchema.nullable(),
  runStatus: valuationRunStatusSchema.nullable(),
  dataStep: valuationDataStepSchema.nullable(),
  /** Qué le preguntó el job a la IA (`F6-13`); `null` si no llegó a preguntar. */
  qualitativeStep: valuationQualitativeStepSchema.nullable(),
});

export const valuationJobOutcomeSchema = z
  .object({
    identityStatus: valuationJobIdentitySchema.nullable(),
    legalEntityId: uuidSchema.nullable(),
    securityId: uuidSchema.nullable(),
    listingId: uuidSchema.nullable(),
    gap: valuationJobGapSchema,
    ...methodFieldsSchema.shape,
    ...runFieldsSchema.shape,
  })
  .superRefine((outcome, context) => {
    refineOutcome(outcome, context);

    if (
      outcome.gap === "snapshot_not_assembled" &&
      outcome.snapshotGap === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["snapshotGap"],
        message: "snapshot_not_assembled names why the snapshot was not built.",
      });
    }
  });

export type ValuationJobOutcome = z.infer<typeof valuationJobOutcomeSchema>;

export const valuationJobSchema = z
  .object({
    jobId: uuidSchema,
    ticker: valuationTickerSchema,
    status: valuationJobStatusSchema,
    knownAt: utcTimestampSchema,
    ruleVersion: valuationJobRuleVersionSchema,
    identityStatus: valuationJobIdentitySchema.nullable(),
    legalEntityId: uuidSchema.nullable(),
    securityId: uuidSchema.nullable(),
    listingId: uuidSchema.nullable(),
    gap: valuationJobGapSchema.nullable(),
    methodStatus: valuationJobMethodStatusSchema.nullable(),
    assetProfile: assetProfileSchema.nullable(),
    method: valuationJobMethodSchema.nullable(),
    rigor: rigorLevelSchema.nullable(),
    unsupportedReason: methodSelectionReasonSchema.nullable(),
    ...runFieldsSchema.shape,
    /** El job que éste continúa con un corte nuevo; `null` si lo pidió el owner. */
    followsJobId: uuidSchema.nullable(),
    claimToken: uuidSchema.nullable(),
    createdAt: utcTimestampSchema,
    startedAt: utcTimestampSchema.nullable(),
    heartbeatAt: utcTimestampSchema.nullable(),
    finishedAt: utcTimestampSchema.nullable(),
  })
  .superRefine((job, context) => {
    const known = Date.parse(job.knownAt);
    const created = Date.parse(job.createdAt);

    if (known > created) {
      context.addIssue({
        code: "custom",
        path: ["knownAt"],
        message: "The knowledge cutoff cannot be after the job was queued.",
      });
    }

    if (PRE_DATA_RULES.has(job.ruleVersion)) {
      requireAbsent(job.dataStep, "dataStep", context);
      requireAbsent(job.followsJobId, "followsJobId", context);

      if (job.gap !== null && DATA_GAPS.has(job.gap)) {
        context.addIssue({
          code: "custom",
          path: ["gap"],
          message: `${job.gap} only exists from valuation-job-1.2.0.`,
        });
      }
    }

    if (job.ruleVersion !== VALUATION_JOB_RULE_VERSION) {
      requireAbsent(job.qualitativeStep, "qualitativeStep", context);

      if (job.gap === "qualitative_resolved") {
        context.addIssue({
          code: "custom",
          path: ["gap"],
          message: `qualitative_resolved only exists from ${VALUATION_JOB_RULE_VERSION}.`,
        });
      }
    }

    if (job.followsJobId !== null && job.followsJobId === job.jobId) {
      context.addIssue({
        code: "custom",
        path: ["followsJobId"],
        message: "A job does not follow itself.",
      });
    }

    if (
      job.heartbeatAt !== null &&
      (job.startedAt === null ||
        Date.parse(job.heartbeatAt) < Date.parse(job.startedAt))
    ) {
      context.addIssue({
        code: "custom",
        path: ["heartbeatAt"],
        message: "A heartbeat comes at or after the start of the claim.",
      });
    }

    if (job.ruleVersion === "valuation-job-1.0.0") {
      requireAbsent(job.snapshotGap, "snapshotGap", context);
      requireAbsent(job.valuationRunId, "valuationRunId", context);
    } else if (
      job.gap === "snapshot_not_assembled" &&
      job.snapshotGap === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["snapshotGap"],
        message: "snapshot_not_assembled names why the snapshot was not built.",
      });
    }

    if (job.status === "queued") {
      requireAbsent(
        job.reitAffoAccessionNumber ?? null,
        "reitAffoAccessionNumber",
        context,
      );
      requireAbsent(job.startedAt, "startedAt", context);
      requireAbsent(job.heartbeatAt, "heartbeatAt", context);
      requireAbsent(job.finishedAt, "finishedAt", context);
      requireAbsent(job.gap, "gap", context);
      requireAbsent(job.dataStep, "dataStep", context);
      requireAbsent(job.qualitativeStep, "qualitativeStep", context);
      requireAbsent(job.claimToken, "claimToken", context);
      requireAbsent(job.identityStatus, "identityStatus", context);
      requireAbsent(job.legalEntityId, "legalEntityId", context);
      return;
    }

    if (job.startedAt === null || Date.parse(job.startedAt) < created) {
      context.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "A started job needs a start at or after its creation.",
      });
    }

    if (job.status === "running") {
      requireAbsent(
        job.reitAffoAccessionNumber ?? null,
        "reitAffoAccessionNumber",
        context,
      );
      requireAbsent(job.finishedAt, "finishedAt", context);
      requireAbsent(job.gap, "gap", context);
      requireAbsent(job.dataStep, "dataStep", context);
      requireAbsent(job.qualitativeStep, "qualitativeStep", context);
      requirePresent(job.claimToken, "claimToken", context);
      requireAbsent(job.identityStatus, "identityStatus", context);
      requireAbsent(job.legalEntityId, "legalEntityId", context);
      return;
    }

    requireAbsent(job.claimToken, "claimToken", context);

    if (
      job.finishedAt === null ||
      job.startedAt === null ||
      Date.parse(job.finishedAt) < Date.parse(job.startedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "A completed job finishes at or after it started.",
      });
    }

    if (job.gap === null) {
      context.addIssue({
        code: "custom",
        path: ["gap"],
        message: "A completed job names why it stopped.",
      });
      return;
    }

    refineOutcome(job, context);
  });

export type ValuationJob = z.infer<typeof valuationJobSchema>;

type IssueContext = {
  addIssue: (issue: {
    code: "custom";
    path: (string | number)[];
    message: string;
  }) => void;
};

function requireAbsent(
  value: unknown,
  path: string,
  context: IssueContext,
): void {
  if (value !== null) {
    context.addIssue({
      code: "custom",
      path: [path],
      message: `${path} is only set once the job reaches that phase.`,
    });
  }
}

function requirePresent(
  value: unknown,
  path: string,
  context: IssueContext,
): void {
  if (value === null) {
    context.addIssue({
      code: "custom",
      path: [path],
      message: `${path} is required in this phase.`,
    });
  }
}

const IDENTITY_GAPS: Readonly<Record<string, ValuationJobIdentity>> = {
  unresolved_ticker: "not_found",
  ambiguous_ticker: "ambiguous",
  identity_conflict: "conflict",
};

const ASSESSED_GAPS: ReadonlySet<string> = new Set([
  "cik_missing",
  "annual_fundamentals",
  "unsupported_method",
  "snapshot_not_assembled",
  "run_recorded",
  "qualitative_resolved",
  ...DATA_GAPS,
]);

/** Los gaps que pueden registrar qué se le preguntó a la IA. */
const QUALITATIVE_GAPS: ReadonlySet<string> = new Set([
  "qualitative_resolved",
  "snapshot_not_assembled",
  "run_recorded",
]);

/** Cada gap del paso de datos dice lo mismo que su registro. */
function refineDataGap(
  gap: ValuationJobGap,
  dataStep: ValuationDataStep | null,
  context: IssueContext,
): void {
  if (dataStep === null) {
    context.addIssue({
      code: "custom",
      path: ["dataStep"],
      message: `${gap} records what the data step did.`,
    });
    return;
  }

  const block = dataStepBlock(dataStep);
  const consistent =
    gap === "point_in_time_audit_failed"
      ? block === null && dataStep.audit?.status === "failed"
      : gap === "data_ingested"
        ? block === null &&
          dataStepIngested(dataStep) &&
          dataStep.audit?.status === "passed"
        : block === gap && dataStep.audit === null;

  if (!consistent) {
    context.addIssue({
      code: "custom",
      path: ["dataStep"],
      message: `The data step does not support ${gap}.`,
    });
  }
}

function refineOutcome(
  outcome: {
    identityStatus: ValuationJobIdentity | null;
    legalEntityId: string | null;
    securityId: string | null;
    listingId: string | null;
    gap: ValuationJobGap | null;
    methodStatus: ValuationJobOutcome["methodStatus"];
    assetProfile: ValuationJobOutcome["assetProfile"];
    method: ValuationJobOutcome["method"];
    rigor: ValuationJobOutcome["rigor"];
    unsupportedReason: ValuationJobOutcome["unsupportedReason"];
    snapshotGap: ValuationSnapshotGap | null;
    reitAffoAccessionNumber?: string | null;
    valuationRunId: string | null;
    runStatus: ValuationJobOutcome["runStatus"];
    dataStep: ValuationDataStep | null;
    qualitativeStep: ValuationQualitativeStep | null;
  },
  context: IssueContext,
): void {
  const { gap } = outcome;

  if (gap !== null && DATA_GAPS.has(gap)) {
    refineDataGap(gap, outcome.dataStep, context);
  }

  if (
    outcome.qualitativeStep !== null &&
    (gap === null || !QUALITATIVE_GAPS.has(gap))
  ) {
    context.addIssue({
      code: "custom",
      path: ["qualitativeStep"],
      message: "Only a job that reached the snapshot asks the AI.",
    });
  }

  if (
    gap === "qualitative_resolved" &&
    (outcome.qualitativeStep === null ||
      !qualitativeStepAccepted(outcome.qualitativeStep) ||
      outcome.dataStep === null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["qualitativeStep"],
      message:
        "qualitative_resolved records the data step and an accepted decision.",
    });
  }

  if ((outcome.valuationRunId === null) !== (outcome.runStatus === null)) {
    context.addIssue({
      code: "custom",
      path: ["runStatus"],
      message: "A recorded run carries its ID and its status together.",
    });
  }

  if (gap === null) {
    requireAbsent(outcome.snapshotGap, "snapshotGap", context);
    requireAbsent(outcome.valuationRunId, "valuationRunId", context);
    return;
  }

  if ((gap === "run_recorded") !== (outcome.valuationRunId !== null)) {
    context.addIssue({
      code: "custom",
      path: ["valuationRunId"],
      message: "Only run_recorded keeps a valuation run.",
    });
  }

  if (gap !== "snapshot_not_assembled" && outcome.snapshotGap !== null) {
    context.addIssue({
      code: "custom",
      path: ["snapshotGap"],
      message: "Only snapshot_not_assembled names a snapshot gap.",
    });
  }
  if (
    outcome.reitAffoAccessionNumber != null &&
    (outcome.method !== "affo_nav" ||
      gap !== "snapshot_not_assembled" ||
      ![
        "reit_affo_reconciliation_missing",
        "reit_affo_unaccepted",
        "reit_nav_inputs_unavailable",
      ].includes(outcome.snapshotGap ?? ""))
  ) {
    context.addIssue({
      code: "custom",
      path: ["reitAffoAccessionNumber"],
      message: "Only a REIT filing refusal keeps its verified 10-K accession.",
    });
  }

  const expectedIdentity = IDENTITY_GAPS[gap];

  if (
    expectedIdentity !== undefined &&
    outcome.identityStatus !== expectedIdentity
  ) {
    context.addIssue({
      code: "custom",
      path: ["identityStatus"],
      message: `${gap} records its identity status and nothing else.`,
    });
  }

  if (expectedIdentity !== undefined || gap === "assessment_failed") {
    if (outcome.legalEntityId !== null) {
      context.addIssue({
        code: "custom",
        path: ["legalEntityId"],
        message: "An unresolved job does not keep an entity.",
      });
    }
  }

  if (ASSESSED_GAPS.has(gap)) {
    if (
      outcome.identityStatus !== "resolved" ||
      outcome.legalEntityId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["legalEntityId"],
        message: "An assessed job keeps the resolved entity.",
      });
    }
  }

  if (outcome.securityId !== null && outcome.legalEntityId === null) {
    context.addIssue({
      code: "custom",
      path: ["securityId"],
      message: "A security belongs to a resolved entity.",
    });
  }

  if (outcome.listingId !== null && outcome.securityId === null) {
    context.addIssue({
      code: "custom",
      path: ["listingId"],
      message: "A listing belongs to a resolved security.",
    });
  }

  const selected =
    outcome.methodStatus === "selected" &&
    outcome.method !== null &&
    outcome.assetProfile !== null &&
    outcome.rigor !== null &&
    outcome.unsupportedReason === null;
  const refused =
    outcome.methodStatus === "unsupported_method" &&
    outcome.unsupportedReason !== null;

  if (gap === "snapshot_not_assembled" && !selected) {
    context.addIssue({
      code: "custom",
      path: ["methodStatus"],
      message: "A selected method is what snapshot_not_assembled records.",
    });
  }

  // Los métodos que el job sabe derivar: `fcff_base` y, desde `F6-18`, el
  // margen de ciclo de las cíclicas y commodities (ADR 0059).
  if (
    gap === "run_recorded" &&
    (!selected || !DERIVED_JOB_METHODS.has(outcome.method ?? ""))
  ) {
    context.addIssue({
      code: "custom",
      path: ["method"],
      message: "A recorded run values a selected method the job derives.",
    });
  }

  if (gap === "unsupported_method" && !refused) {
    context.addIssue({
      code: "custom",
      path: ["unsupportedReason"],
      message: "unsupported_method names the selector's reason.",
    });
  }

  if (
    gap !== "snapshot_not_assembled" &&
    gap !== "run_recorded" &&
    gap !== "unsupported_method" &&
    gap !== "annual_fundamentals" &&
    outcome.methodStatus !== null
  ) {
    context.addIssue({
      code: "custom",
      path: ["methodStatus"],
      message: "Only an assessment records a method.",
    });
  }

  if (
    (outcome.methodStatus === "selected" && !selected) ||
    (outcome.methodStatus === "unsupported_method" && !refused) ||
    (outcome.methodStatus === null &&
      (outcome.method !== null ||
        outcome.assetProfile !== null ||
        outcome.rigor !== null ||
        outcome.unsupportedReason !== null))
  ) {
    context.addIssue({
      code: "custom",
      path: ["method"],
      message: "Method fields travel together.",
    });
  }
}

const EMPTY_METHOD = {
  methodStatus: null,
  assetProfile: null,
  method: null,
  rigor: null,
  unsupportedReason: null,
} as const;

const EMPTY_RUN = {
  snapshotGap: null,
  reitAffoAccessionNumber: null,
  valuationRunId: null,
  runStatus: null,
  dataStep: null,
  qualitativeStep: null,
} as const;

export function queueValuationJob(input: {
  readonly jobId: string;
  readonly ticker: string;
  readonly knownAt: string;
  readonly createdAt: string;
  readonly followsJobId?: string | null;
}): ValuationJob {
  return valuationJobSchema.parse({
    jobId: input.jobId,
    ticker: input.ticker,
    status: "queued",
    knownAt: input.knownAt,
    ruleVersion: VALUATION_JOB_RULE_VERSION,
    identityStatus: null,
    legalEntityId: null,
    securityId: null,
    listingId: null,
    gap: null,
    ...EMPTY_METHOD,
    ...EMPTY_RUN,
    followsJobId: input.followsJobId ?? null,
    claimToken: null,
    createdAt: input.createdAt,
    startedAt: null,
    heartbeatAt: null,
    finishedAt: null,
  });
}

/** Último signo de vida del reclamo: el latido, o el arranque si no latió. */
export function lastSignOfLife(job: ValuationJob): string | null {
  return job.heartbeatAt ?? job.startedAt;
}

/**
 * Pasa a `running` un job en cola, o uno `running` cuyo arranque ya es viejo.
 * Devuelve `null` si otro worker lo tiene fresco o si ya terminó.
 */
export function claimValuationJob(
  job: ValuationJob,
  input: {
    readonly startedAt: string;
    readonly claimToken: string;
    readonly staleBefore: string;
  },
): ValuationJob | null {
  const alive = lastSignOfLife(job);
  const stale =
    job.status === "running" &&
    alive !== null &&
    Date.parse(alive) < Date.parse(input.staleBefore);
  const queued = job.status === "queued";

  if (!queued && !stale) {
    return null;
  }

  return valuationJobSchema.parse({
    ...job,
    status: "running",
    claimToken: input.claimToken,
    startedAt: input.startedAt,
    heartbeatAt: null,
  });
}

/** Renueva el reclamo sólo con su token. `null` si otro worker lo tomó. */
export function beatValuationJob(
  job: ValuationJob,
  input: { readonly claimToken: string; readonly at: string },
): ValuationJob | null {
  if (job.status !== "running" || job.claimToken !== input.claimToken) {
    return null;
  }

  return valuationJobSchema.parse({ ...job, heartbeatAt: input.at });
}

/** Cierra el job sólo si el token sigue siendo el del reclamo. */
export function finishValuationJob(
  job: ValuationJob,
  input: {
    readonly claimToken: string;
    readonly finishedAt: string;
    readonly outcome: ValuationJobOutcome;
  },
): ValuationJob | null {
  if (job.status !== "running" || job.claimToken !== input.claimToken) {
    return null;
  }

  return valuationJobSchema.parse({
    ...job,
    ...input.outcome,
    ruleVersion: VALUATION_JOB_RULE_VERSION,
    status: "completed",
    claimToken: null,
    finishedAt: input.finishedAt,
  });
}

const IDENTITY_OUTCOME: Readonly<
  Record<"not_found" | "ambiguous" | "conflict", ValuationJobGap>
> = {
  not_found: "unresolved_ticker",
  ambiguous: "ambiguous_ticker",
  conflict: "identity_conflict",
};

export function outcomeForIdentity(
  status: "not_found" | "ambiguous" | "conflict",
): ValuationJobOutcome {
  return valuationJobOutcomeSchema.parse({
    identityStatus: status,
    legalEntityId: null,
    securityId: null,
    listingId: null,
    gap: IDENTITY_OUTCOME[status],
    ...EMPTY_METHOD,
    ...EMPTY_RUN,
  });
}

/**
 * El paso de datos frenó la corrida: bajó algo y otro job la continúa, una
 * descarga quedó pendiente o falló, o la auditoría encontró una falla.
 */
export function outcomeForDataStep(
  subject: {
    readonly legalEntityId: string;
    readonly securityId: string | null;
    readonly listingId: string | null;
  },
  gap:
    | "data_ingested"
    | "ingestion_pending"
    | "ingestion_failed"
    | "point_in_time_audit_failed",
  dataStep: ValuationDataStep,
): ValuationJobOutcome {
  return valuationJobOutcomeSchema.parse({
    identityStatus: "resolved",
    legalEntityId: subject.legalEntityId,
    securityId: subject.securityId,
    listingId: subject.listingId,
    gap,
    ...EMPTY_METHOD,
    ...EMPTY_RUN,
    dataStep,
  });
}

/**
 * La IA dejó una decisión aceptada que este corte no ve: otro job la continúa
 * (`F6-13`).
 */
export function outcomeForQualitativeStep(
  subject: {
    readonly legalEntityId: string;
    readonly securityId: string | null;
    readonly listingId: string | null;
  },
  dataStep: ValuationDataStep,
  qualitativeStep: ValuationQualitativeStep,
): ValuationJobOutcome {
  return valuationJobOutcomeSchema.parse({
    identityStatus: "resolved",
    legalEntityId: subject.legalEntityId,
    securityId: subject.securityId,
    listingId: subject.listingId,
    gap: "qualitative_resolved",
    ...EMPTY_METHOD,
    ...EMPTY_RUN,
    dataStep,
    qualitativeStep,
  });
}

export function outcomeForFailure(): ValuationJobOutcome {
  return valuationJobOutcomeSchema.parse({
    identityStatus: null,
    legalEntityId: null,
    securityId: null,
    listingId: null,
    gap: "assessment_failed",
    ...EMPTY_METHOD,
    ...EMPTY_RUN,
  });
}

export type ValuationAssessmentReading = {
  readonly legalEntityId: string;
  readonly securityId: string | null;
  readonly listingId: string | null;
  readonly cik: string | null;
  readonly hasAnnualFundamentals: boolean;
  readonly methodStatus: "selected" | "unsupported_method";
  readonly assetProfile: ValuationJobOutcome["assetProfile"];
  readonly method: ValuationJobOutcome["method"];
  readonly rigor: ValuationJobOutcome["rigor"];
  readonly unsupportedReason: ValuationJobOutcome["unsupportedReason"];
};

/**
 * Elige el hueco más específico. Sin serie anual no se publica el método como
 * si la evaluación estuviera lista para valuar: `F6-05` tiene que bajarla.
 */
export function outcomeForAssessment(
  reading: ValuationAssessmentReading,
  snapshot:
    | {
        readonly gap: ValuationSnapshotGap;
        readonly reitAffoAccessionNumber?: string | null;
      }
    | {
        readonly valuationRunId: string;
        readonly runStatus: NonNullable<ValuationJobOutcome["runStatus"]>;
      } = { gap: "method_not_derived" },
  dataStep: ValuationDataStep | null = null,
  qualitativeStep: ValuationQualitativeStep | null = null,
): ValuationJobOutcome {
  const subject = {
    identityStatus: "resolved" as const,
    legalEntityId: reading.legalEntityId,
    securityId: reading.securityId,
    listingId: reading.listingId,
  };

  if (reading.cik === null) {
    return valuationJobOutcomeSchema.parse({
      ...subject,
      gap: "cik_missing",
      ...EMPTY_METHOD,
      ...EMPTY_RUN,
    });
  }

  if (!reading.hasAnnualFundamentals) {
    return valuationJobOutcomeSchema.parse({
      ...subject,
      gap: "annual_fundamentals",
      ...methodOf(reading),
      ...EMPTY_RUN,
      dataStep,
    });
  }

  if (reading.methodStatus === "unsupported_method") {
    return valuationJobOutcomeSchema.parse({
      ...subject,
      gap: "unsupported_method",
      ...methodOf(reading),
      ...EMPTY_RUN,
      dataStep,
    });
  }

  if ("valuationRunId" in snapshot) {
    return valuationJobOutcomeSchema.parse({
      ...subject,
      gap: "run_recorded",
      ...methodOf(reading),
      snapshotGap: null,
      valuationRunId: snapshot.valuationRunId,
      runStatus: snapshot.runStatus,
      dataStep,
      qualitativeStep,
    });
  }

  return valuationJobOutcomeSchema.parse({
    ...subject,
    gap: "snapshot_not_assembled",
    ...methodOf(reading),
    ...EMPTY_RUN,
    snapshotGap: snapshot.gap,
    reitAffoAccessionNumber: snapshot.reitAffoAccessionNumber ?? null,
    dataStep,
    qualitativeStep,
  });
}

function methodOf(
  reading: ValuationAssessmentReading,
): Pick<
  ValuationJobOutcome,
  "methodStatus" | "assetProfile" | "method" | "rigor" | "unsupportedReason"
> {
  if (reading.methodStatus === "unsupported_method") {
    return {
      methodStatus: "unsupported_method",
      assetProfile: reading.assetProfile,
      method: null,
      rigor: null,
      unsupportedReason: reading.unsupportedReason,
    };
  }

  return {
    methodStatus: "selected",
    assetProfile: reading.assetProfile,
    method: reading.method,
    rigor: reading.rigor,
    unsupportedReason: null,
  };
}

/** Lo que la acción puede devolver. Códigos, nunca ids internos ni SQL. */
export type ValuationJobView =
  | { readonly state: "idle" }
  | { readonly state: "unavailable" }
  | {
      readonly state: ValuationJobStatus;
      readonly ticker: string;
      readonly knownAt: string;
      readonly gap: ValuationJobGap | null;
      readonly identityStatus: ValuationJobIdentity | null;
      readonly methodStatus: ValuationJobOutcome["methodStatus"];
      readonly assetProfile: ValuationJobOutcome["assetProfile"];
      readonly method: ValuationJobOutcome["method"];
      readonly rigor: ValuationJobOutcome["rigor"];
      readonly unsupportedReason: ValuationJobOutcome["unsupportedReason"];
      readonly snapshotGap: ValuationSnapshotGap | null;
      /** El estado de la corrida registrada; su ID no sale del servidor. */
      readonly runStatus: ValuationJobOutcome["runStatus"];
      readonly ruleVersion: ValuationJob["ruleVersion"];
      /** Qué bajó y auditó el job (`F6-05`): estados y códigos, sin IDs. */
      readonly dataStep: ValuationDataStep | null;
      /** Qué le preguntó el job a la IA (`F6-13`): estados y códigos, sin IDs. */
      readonly qualitativeStep: ValuationQualitativeStep | null;
      /** El job continúa a otro que bajó datos o resolvió algo con la IA. */
      readonly follows: boolean;
    };

export function toValuationJobView(job: ValuationJob): ValuationJobView {
  return {
    state: job.status,
    ticker: job.ticker,
    knownAt: job.knownAt,
    gap: job.gap,
    identityStatus: job.identityStatus,
    methodStatus: job.methodStatus,
    assetProfile: job.assetProfile,
    method: job.method,
    rigor: job.rigor,
    unsupportedReason: job.unsupportedReason,
    snapshotGap: job.snapshotGap,
    runStatus: job.runStatus,
    ruleVersion: job.ruleVersion,
    dataStep: job.dataStep,
    qualitativeStep: job.qualitativeStep,
    follows: job.followsJobId !== null,
  };
}

export function addMilliseconds(instant: string, milliseconds: number): string {
  return new Date(Date.parse(instant) + milliseconds).toISOString();
}
