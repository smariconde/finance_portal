import {
  sourceControlChangeSchema,
  sourceUsageWindowSchema,
  type SourceBudgetStore,
  type SourceDailyUsage,
} from "@/modules/ingestion/application/source-budget-store";
import {
  budgetDayOf,
  declaredDailyBudget,
  nextBudgetDayStart,
  resolveEffectiveDailyLimit,
  sourceControlSchema,
  SOURCE_DAILY_REQUEST_BUDGETS,
  type DeclaredDailyBudgets,
  type SourceBudgetState,
  type SourceControl,
  type SourceRequestVerdict,
} from "@/modules/ingestion/domain/source-budget";

type DayUsage = {
  requests: number;
  firstRequestAt: string;
  lastRequestAt: string;
};

/**
 * Doble en memoria del presupuesto por fuente. Sostiene las mismas invariantes
 * que el almacén personal —un solo control vigente por fuente, contador por día
 * UTC, consumo al intentar— para que el contrato compartido corra igual sobre
 * los dos. No es un modo de runtime: ninguna raíz de composición lo construye.
 */
export function createInMemorySourceBudgetStore(
  budgets: DeclaredDailyBudgets = SOURCE_DAILY_REQUEST_BUDGETS,
): SourceBudgetStore {
  const controls: SourceControl[] = [];
  const usage = new Map<string, Map<string, DayUsage>>();

  function currentControl(sourceId: string): SourceControl | null {
    return (
      controls.find(
        (control) =>
          control.sourceId === sourceId && control.supersededAt === null,
      ) ?? null
    );
  }

  function usedOn(sourceId: string, day: string): number {
    return usage.get(sourceId)?.get(day)?.requests ?? 0;
  }

  function stateOf(sourceId: string, now: string): SourceBudgetState {
    const control = currentControl(sourceId);
    const day = budgetDayOf(now);

    return {
      sourceId,
      day,
      used: usedOn(sourceId, day),
      declaredLimit: declaredDailyBudget(sourceId, budgets),
      effectiveLimit: resolveEffectiveDailyLimit(sourceId, control, budgets),
      control,
    };
  }

  return {
    storage: "in-memory-fixture",
    async readState(sourceId, now) {
      return stateOf(sourceId, now);
    },
    async consume(sourceId, now): Promise<SourceRequestVerdict> {
      const control = currentControl(sourceId);

      if (control?.status === "disabled") {
        return { status: "source_disabled", reason: control.reason };
      }

      const limit = resolveEffectiveDailyLimit(sourceId, control, budgets);

      if (limit === null) {
        return { status: "budget_undeclared" };
      }

      const day = budgetDayOf(now);
      const used = usedOn(sourceId, day);

      if (used >= limit) {
        return {
          status: "daily_budget_exhausted",
          limit,
          used,
          resumesAt: nextBudgetDayStart(now),
        };
      }

      const days = usage.get(sourceId) ?? new Map<string, DayUsage>();
      const entry = days.get(day);

      days.set(day, {
        requests: used + 1,
        firstRequestAt: entry?.firstRequestAt ?? now,
        lastRequestAt: now,
      });
      usage.set(sourceId, days);

      return { status: "allowed", used: used + 1, remaining: limit - used - 1 };
    },
    async setControl(change) {
      const parsed = sourceControlChangeSchema.parse(change);
      const open = currentControl(parsed.sourceId);

      if (open !== null) {
        controls[controls.indexOf(open)] = sourceControlSchema.parse({
          ...open,
          supersededAt: parsed.now,
        });
      }

      const control = sourceControlSchema.parse({
        controlId: parsed.controlId,
        sourceId: parsed.sourceId,
        status: parsed.status,
        dailyRequestLimit: parsed.dailyRequestLimit,
        reason: parsed.reason,
        actor: parsed.actor,
        recordedAt: parsed.now,
        supersededAt: null,
      });

      controls.push(control);

      return control;
    },
    async listControls() {
      return controls
        .filter((control) => control.supersededAt === null)
        .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    },
    async listControlHistory(sourceId, limit = 20) {
      return controls
        .filter((control) => control.sourceId === sourceId)
        .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
        .slice(0, Math.min(Math.max(limit, 1), 200));
    },
    async listUsage(window) {
      const parsed = sourceUsageWindowSchema.parse(window);

      return [...(usage.get(parsed.sourceId)?.entries() ?? [])]
        .filter(([day]) => day >= parsed.fromDay && day <= parsed.toDay)
        .map(([day, entry]): SourceDailyUsage => ({
          sourceId: parsed.sourceId,
          day,
          requests: entry.requests,
          firstRequestAt: entry.firstRequestAt,
          lastRequestAt: entry.lastRequestAt,
        }))
        .sort((left, right) => right.day.localeCompare(left.day))
        .slice(0, parsed.limit);
    },
  };
}
