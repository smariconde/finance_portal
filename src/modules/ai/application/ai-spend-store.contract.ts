import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  AiSpendReservationRequest,
  DeclaredSpendLimits,
} from "@/modules/ai/domain/ai-spend";

import type { AiSpendStore } from "./ai-spend-store";

/**
 * Contrato del libro de gasto (ADR 0033), escrito una vez y corrido contra los
 * dos almacenes: el doble en memoria en la suite unitaria y PostgreSQL en la de
 * integración.
 *
 * Cada caso usa una fuente y una tarea propias, así que la base de integración
 * no necesita vaciarse entre casos.
 */
export type AiSpendStoreContractHarness = {
  readonly createStore: (limits: DeclaredSpendLimits) => {
    readonly store: AiSpendStore;
    /** Abre un control vigente para la fuente, como `ingestion:sources`. */
    readonly setControl: (control: {
      readonly sourceId: string;
      readonly status: "enabled" | "disabled";
      readonly dailySpendLimitNanoUsd: number | null;
      readonly now: string;
    }) => Promise<void>;
  };
};

export const SPEND_T0 = "2026-10-15T10:00:00.000Z";
/** Mismo día UTC, más tarde. */
export const SPEND_T1 = "2026-10-15T23:59:59.000Z";
/** Día siguiente: el tope diario se repone, el de la tarea no. */
export const SPEND_T2 = "2026-10-16T00:00:00.000Z";

function uniqueSourceId(): string {
  return `fixture-ai-${randomUUID().slice(0, 8)}`;
}

export function describeAiSpendStoreContract(
  label: string,
  harness: AiSpendStoreContractHarness,
): void {
  describe(`ai spend store contract (${label})`, () => {
    function withLimits(perTaskNanoUsd: number, perDayNanoUsd: number) {
      const sourceId = uniqueSourceId();
      const { store, setControl } = harness.createStore({
        [sourceId]: { perTaskNanoUsd, perDayNanoUsd },
      });
      const reservation = (
        overrides: Partial<AiSpendReservationRequest> = {},
      ): AiSpendReservationRequest => ({
        reservationId: randomUUID(),
        sourceId,
        taskRunId: randomUUID(),
        taskVersion: "ai-smoke-1.0.0",
        ladderVersion: "ai-model-ladder-1.0.0",
        rung: 1,
        requestedModel: "fixture/model-a",
        worstCaseNanoUsd: 100,
        now: SPEND_T0,
        ...overrides,
      });

      return { sourceId, store, setControl, reservation };
    }

    const charged = (reservationId: string, chargedNanoUsd: number) => ({
      reservationId,
      status: "charged" as const,
      chargedNanoUsd,
      respondedModel: "fixture/model-a-2026",
      promptTokens: 120,
      completionTokens: 8,
      latencyMs: 900,
      outcome: "accepted" as const,
      now: SPEND_T0,
    });

    it("reserva dentro de los dos topes y devuelve lo comprometido", async () => {
      const { store, reservation } = withLimits(1000, 10_000);
      const taskRunId = randomUUID();

      expect(
        await store.reserve(reservation({ taskRunId, worstCaseNanoUsd: 300 })),
      ).toMatchObject({
        status: "reserved",
        taskSpentNanoUsd: 300,
        daySpentNanoUsd: 300,
      });
      expect(
        await store.reserve(
          reservation({ taskRunId, worstCaseNanoUsd: 700, rung: 2 }),
        ),
      ).toMatchObject({ taskSpentNanoUsd: 1000, daySpentNanoUsd: 1000 });
    });

    it("se niega cuando el peor caso pasaría el tope de la tarea, sin escribir", async () => {
      const { store, reservation } = withLimits(1000, 10_000);
      const taskRunId = randomUUID();

      await store.reserve(reservation({ taskRunId, worstCaseNanoUsd: 900 }));

      expect(
        await store.reserve(reservation({ taskRunId, worstCaseNanoUsd: 101 })),
      ).toEqual({
        status: "task_budget_exhausted",
        limitNanoUsd: 1000,
        spentNanoUsd: 900,
        requestedNanoUsd: 101,
      });
      expect(await store.listTaskAttempts(taskRunId)).toHaveLength(1);
    });

    it("se niega cuando el día no alcanza y se repone al día UTC siguiente", async () => {
      const { sourceId, store, reservation } = withLimits(1000, 1500);

      await store.reserve(reservation({ worstCaseNanoUsd: 1000 }));

      expect(
        await store.reserve(
          reservation({ worstCaseNanoUsd: 600, now: SPEND_T1 }),
        ),
      ).toEqual({
        status: "daily_budget_exhausted",
        limitNanoUsd: 1500,
        spentNanoUsd: 1000,
        requestedNanoUsd: 600,
        resumesAt: SPEND_T2,
      });
      expect(
        await store.reserve(
          reservation({ worstCaseNanoUsd: 600, now: SPEND_T2 }),
        ),
      ).toMatchObject({ status: "reserved", daySpentNanoUsd: 600 });
      expect((await store.readDay(sourceId, SPEND_T0)).countedNanoUsd).toBe(
        1000,
      );
    });

    it("cuenta lo cobrado, cero si no se cobró y el peor caso si no se sabe", async () => {
      const { sourceId, store, reservation } = withLimits(10_000, 10_000);
      const first = reservation({ worstCaseNanoUsd: 1000 });
      const second = reservation({ worstCaseNanoUsd: 1000 });
      const third = reservation({ worstCaseNanoUsd: 1000 });
      const open = reservation({ worstCaseNanoUsd: 50 });

      for (const request of [first, second, third, open]) {
        await store.reserve(request);
      }

      await store.settle(charged(first.reservationId, 37));
      await store.settle({
        ...charged(second.reservationId, 0),
        status: "uncharged",
        chargedNanoUsd: null,
        outcome: "provider_rejected",
      });
      await store.settle({
        ...charged(third.reservationId, 0),
        status: "unsettled",
        chargedNanoUsd: null,
        outcome: "transport_error",
      });

      expect(await store.readDay(sourceId, SPEND_T1)).toMatchObject({
        countedNanoUsd: 37 + 0 + 1000 + 50,
        chargedNanoUsd: 37,
        attempts: 4,
        openReservations: 1,
        effectiveDailyLimitNanoUsd: 10_000,
      });
    });

    it("liquida una reserva una sola vez y rechaza una desconocida", async () => {
      const { store, reservation } = withLimits(10_000, 10_000);
      const request = reservation();

      await store.reserve(request);

      const settled = await store.settle(charged(request.reservationId, 12));

      expect(settled).toMatchObject({
        status: "charged",
        chargedNanoUsd: 12,
        respondedModel: "fixture/model-a-2026",
        outcome: "accepted",
        settledAt: SPEND_T0,
      });
      await expect(
        store.settle(charged(request.reservationId, 99)),
      ).rejects.toThrow(/already settled/);
      await expect(store.settle(charged(randomUUID(), 1))).rejects.toThrow(
        /no spend reservation/,
      );
    });

    it("lista los intentos de una tarea en el orden en que se reservaron", async () => {
      const { store, reservation } = withLimits(10_000, 10_000);
      const taskRunId = randomUUID();

      for (const rung of [1, 2, 3]) {
        await store.reserve(
          reservation({
            taskRunId,
            rung,
            requestedModel: `fixture/model-${rung}`,
            now: `2026-10-15T10:00:0${rung}.000Z`,
          }),
        );
      }

      expect(
        (await store.listTaskAttempts(taskRunId)).map((entry) => [
          entry.rung,
          entry.status,
          entry.day,
        ]),
      ).toEqual([
        [1, "reserved", "2026-10-15"],
        [2, "reserved", "2026-10-15"],
        [3, "reserved", "2026-10-15"],
      ]);
    });

    it("niega una fuente sin tope en dólares declarado", async () => {
      const { store, reservation } = withLimits(10_000, 10_000);

      expect(
        await store.reserve(reservation({ sourceId: uniqueSourceId() })),
      ).toEqual({ status: "spend_undeclared" });
    });

    it("respeta el kill switch y un tope guardado que sólo puede bajar", async () => {
      const { sourceId, store, setControl, reservation } = withLimits(
        10_000,
        10_000,
      );

      await setControl({
        sourceId,
        status: "disabled",
        dailySpendLimitNanoUsd: null,
        now: SPEND_T0,
      });
      expect(await store.reserve(reservation())).toMatchObject({
        status: "source_disabled",
      });

      await setControl({
        sourceId,
        status: "enabled",
        dailySpendLimitNanoUsd: 150,
        now: SPEND_T0,
      });
      expect(
        await store.reserve(reservation({ worstCaseNanoUsd: 151 })),
      ).toMatchObject({ status: "daily_budget_exhausted", limitNanoUsd: 150 });

      // Un control más alto que el declarado no sube nada.
      await setControl({
        sourceId,
        status: "enabled",
        dailySpendLimitNanoUsd: 50_000,
        now: SPEND_T0,
      });
      expect(
        (await store.readDay(sourceId, SPEND_T0)).effectiveDailyLimitNanoUsd,
      ).toBe(10_000);
    });
  });
}
