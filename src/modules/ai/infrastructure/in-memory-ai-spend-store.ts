import {
  AiSpendSettlementError,
  type AiSpendStore,
} from "@/modules/ai/application/ai-spend-store";
import {
  admitAiSpend,
  aiSpendReservationRequestSchema,
  aiSpendSettlementSchema,
  AI_SPEND_LIMITS,
  countedNanoUsd,
  declaredSpendLimits,
  resolveEffectiveDailySpendLimit,
  type AiSpendEntry,
  type DeclaredSpendLimits,
} from "@/modules/ai/domain/ai-spend";
import {
  budgetDayOf,
  nextBudgetDayStart,
  type SourceControl,
} from "@/modules/ingestion/domain/source-budget";

/**
 * Doble en memoria del libro de gasto. Sostiene las mismas reglas que el
 * almacén personal —reserva atómica contra los dos topes, liquidación única,
 * día UTC— para que el contrato compartido corra igual sobre los dos. No es un
 * modo de runtime: ninguna raíz de composición lo construye.
 */
export function createInMemoryAiSpendStore(
  options: {
    readonly limits?: DeclaredSpendLimits;
    /** El control vigente de la fuente; el runtime lo lee de PostgreSQL. */
    readonly readControl?: (sourceId: string) => SourceControl | null;
  } = {},
): AiSpendStore {
  const limits = options.limits ?? AI_SPEND_LIMITS;
  const readControl = options.readControl ?? (() => null);
  const entries: AiSpendEntry[] = [];

  const counted = (predicate: (entry: AiSpendEntry) => boolean) =>
    entries
      .filter(predicate)
      .reduce((total, entry) => total + countedNanoUsd(entry), 0);

  return {
    storage: "in-memory-fixture",
    async reserve(request) {
      const parsed = aiSpendReservationRequestSchema.parse(request);
      const day = budgetDayOf(parsed.now);
      const taskSpentNanoUsd = counted(
        (entry) => entry.taskRunId === parsed.taskRunId,
      );
      const daySpentNanoUsd = counted(
        (entry) => entry.sourceId === parsed.sourceId && entry.day === day,
      );
      const refusal = admitAiSpend({
        limits: declaredSpendLimits(parsed.sourceId, limits),
        control: readControl(parsed.sourceId),
        taskSpentNanoUsd,
        daySpentNanoUsd,
        worstCaseNanoUsd: parsed.worstCaseNanoUsd,
        resumesAt: nextBudgetDayStart(parsed.now),
      });

      if (refusal !== null) {
        return refusal;
      }

      if (
        entries.some((entry) => entry.reservationId === parsed.reservationId)
      ) {
        throw new Error(`Reservation ${parsed.reservationId} already exists.`);
      }

      entries.push({
        reservationId: parsed.reservationId,
        sourceId: parsed.sourceId,
        taskRunId: parsed.taskRunId,
        purpose: parsed.purpose,
        taskVersion: parsed.taskVersion,
        ladderVersion: parsed.ladderVersion,
        rung: parsed.rung,
        requestedModel: parsed.requestedModel,
        respondedModel: null,
        day,
        status: "reserved",
        reservedNanoUsd: parsed.worstCaseNanoUsd,
        chargedNanoUsd: null,
        promptTokens: null,
        completionTokens: null,
        latencyMs: null,
        outcome: null,
        reservedAt: parsed.now,
        settledAt: null,
      });

      return {
        status: "reserved",
        reservationId: parsed.reservationId,
        taskSpentNanoUsd: taskSpentNanoUsd + parsed.worstCaseNanoUsd,
        daySpentNanoUsd: daySpentNanoUsd + parsed.worstCaseNanoUsd,
      };
    },
    async settle(settlement) {
      const parsed = aiSpendSettlementSchema.parse(settlement);
      const index = entries.findIndex(
        (entry) => entry.reservationId === parsed.reservationId,
      );

      if (index === -1) {
        throw new AiSpendSettlementError(parsed.reservationId, "unknown");
      }

      const current = entries[index]!;

      if (current.status !== "reserved") {
        throw new AiSpendSettlementError(
          parsed.reservationId,
          "already_settled",
        );
      }

      if (Date.parse(parsed.now) < Date.parse(current.reservedAt)) {
        throw new RangeError("A settlement cannot precede its reservation.");
      }

      const settled: AiSpendEntry = {
        ...current,
        status: parsed.status,
        chargedNanoUsd: parsed.chargedNanoUsd,
        respondedModel: parsed.respondedModel,
        promptTokens: parsed.promptTokens,
        completionTokens: parsed.completionTokens,
        latencyMs: parsed.latencyMs,
        outcome: parsed.outcome,
        settledAt: parsed.now,
      };

      entries[index] = settled;

      return settled;
    },
    async readDay(sourceId, now) {
      const day = budgetDayOf(now);
      const declared = declaredSpendLimits(sourceId, limits);
      const ofDay = entries.filter(
        (entry) => entry.sourceId === sourceId && entry.day === day,
      );

      return {
        sourceId,
        day,
        declared,
        effectiveDailyLimitNanoUsd:
          declared === null
            ? null
            : resolveEffectiveDailySpendLimit(declared, readControl(sourceId)),
        countedNanoUsd: ofDay.reduce(
          (total, entry) => total + countedNanoUsd(entry),
          0,
        ),
        chargedNanoUsd: ofDay.reduce(
          (total, entry) =>
            total +
            (entry.status === "charged" ? (entry.chargedNanoUsd ?? 0) : 0),
          0,
        ),
        attempts: ofDay.length,
        openReservations: ofDay.filter((entry) => entry.status === "reserved")
          .length,
      };
    },
    async listTaskAttempts(taskRunId) {
      return entries
        .filter((entry) => entry.taskRunId === taskRunId)
        .sort(
          (left, right) =>
            left.reservedAt.localeCompare(right.reservedAt) ||
            left.rung - right.rung,
        );
    },
  };
}
