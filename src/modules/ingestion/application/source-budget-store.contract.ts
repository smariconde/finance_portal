import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { DeclaredDailyBudgets } from "@/modules/ingestion/domain/source-budget";

import type { SourceBudgetStore } from "./source-budget-store";

/**
 * Contrato del almacén del presupuesto (ADR 0020), escrito una vez y corrido
 * contra los dos: el doble en memoria en la suite unitaria y PostgreSQL en la de
 * integración. Un comportamiento probado sobre uno solo deja al otro divergir sin
 * que nada falle.
 *
 * Cada caso usa una fuente propia, así que la base de integración no necesita
 * vaciarse entre casos: contador y control son por fuente y nada se cruza.
 */
export type SourceBudgetStoreContractHarness = {
  /** Construye un almacén con esa tabla de topes declarados. */
  readonly createStore: (budgets: DeclaredDailyBudgets) => SourceBudgetStore;
};

export const BUDGET_T0 = "2026-09-18T10:00:00.000Z";
/** Mismo día UTC que `BUDGET_T0`, más tarde. */
export const BUDGET_T1 = "2026-09-18T23:59:59.000Z";
/** Día siguiente: el contador se repone. */
export const BUDGET_T2 = "2026-09-19T00:00:00.000Z";

export function uniqueBudgetSourceId(): string {
  return `fixture-budget-${randomUUID().slice(0, 8)}`;
}

export function describeSourceBudgetStoreContract(
  label: string,
  harness: SourceBudgetStoreContractHarness,
): void {
  describe(`source budget store contract (${label})`, () => {
    function withBudget(limit: number) {
      const sourceId = uniqueBudgetSourceId();

      return {
        sourceId,
        store: harness.createStore({ [sourceId]: limit }),
      };
    }

    describe("presupuesto diario", () => {
      it("gasta hasta el tope y después se niega, sin reponerse dentro del día", async () => {
        const { sourceId, store } = withBudget(2);

        expect(await store.consume(sourceId, BUDGET_T0)).toMatchObject({
          status: "allowed",
          used: 1,
          remaining: 1,
        });
        expect(await store.consume(sourceId, BUDGET_T0)).toMatchObject({
          status: "allowed",
          used: 2,
          remaining: 0,
        });
        expect(await store.consume(sourceId, BUDGET_T1)).toMatchObject({
          status: "daily_budget_exhausted",
          limit: 2,
          used: 2,
          resumesAt: "2026-09-19T00:00:00.000Z",
        });
      });

      it("se repone al cambiar el día UTC", async () => {
        const { sourceId, store } = withBudget(1);

        await store.consume(sourceId, BUDGET_T0);

        expect(await store.consume(sourceId, BUDGET_T1)).toMatchObject({
          status: "daily_budget_exhausted",
        });
        expect(await store.consume(sourceId, BUDGET_T2)).toMatchObject({
          status: "allowed",
          used: 1,
        });
      });

      it("niega una fuente sin presupuesto declarado, sin contar nada", async () => {
        const store = harness.createStore({});
        const sourceId = uniqueBudgetSourceId();

        expect(await store.consume(sourceId, BUDGET_T0)).toEqual({
          status: "budget_undeclared",
        });
        expect(await store.readState(sourceId, BUDGET_T0)).toMatchObject({
          used: 0,
          declaredLimit: null,
          effectiveLimit: null,
        });
      });

      it("registra el consumo del día con sus dos instantes", async () => {
        const { sourceId, store } = withBudget(5);

        await store.consume(sourceId, BUDGET_T0);
        await store.consume(sourceId, BUDGET_T1);
        await store.consume(sourceId, BUDGET_T2);

        expect(
          await store.listUsage({
            sourceId,
            fromDay: "2026-09-18",
            toDay: "2026-09-19",
          }),
        ).toEqual([
          {
            sourceId,
            day: "2026-09-19",
            requests: 1,
            firstRequestAt: BUDGET_T2,
            lastRequestAt: BUDGET_T2,
          },
          {
            sourceId,
            day: "2026-09-18",
            requests: 2,
            firstRequestAt: BUDGET_T0,
            lastRequestAt: BUDGET_T1,
          },
        ]);
      });
    });

    describe("kill switch", () => {
      it("niega toda llamada mientras la fuente está deshabilitada, sin gastar cuota", async () => {
        const { sourceId, store } = withBudget(5);

        await store.consume(sourceId, BUDGET_T0);
        await store.setControl({
          controlId: randomUUID(),
          sourceId,
          status: "disabled",
          dailyRequestLimit: null,
          reason: "sondeo manual en curso",
          actor: "owner",
          now: BUDGET_T0,
        });

        expect(await store.consume(sourceId, BUDGET_T0)).toEqual({
          status: "source_disabled",
          reason: "sondeo manual en curso",
        });
        // Una negativa no consume: lo que se gastó sigue siendo la primera.
        expect(await store.readState(sourceId, BUDGET_T0)).toMatchObject({
          used: 1,
          effectiveLimit: 0,
        });
      });

      it("vuelve a habilitar conservando el consumo del día", async () => {
        const { sourceId, store } = withBudget(3);

        await store.consume(sourceId, BUDGET_T0);
        await store.setControl({
          controlId: randomUUID(),
          sourceId,
          status: "disabled",
          dailyRequestLimit: null,
          reason: "freno preventivo",
          actor: "owner",
          now: BUDGET_T0,
        });
        await store.setControl({
          controlId: randomUUID(),
          sourceId,
          status: "enabled",
          dailyRequestLimit: null,
          reason: "resuelto",
          actor: "owner",
          now: BUDGET_T1,
        });

        expect(await store.consume(sourceId, BUDGET_T1)).toMatchObject({
          status: "allowed",
          used: 2,
          remaining: 1,
        });
      });
    });

    describe("tope operativo", () => {
      it("baja el declarado, y nunca lo sube", async () => {
        const { sourceId, store } = withBudget(10);

        await store.setControl({
          controlId: randomUUID(),
          sourceId,
          status: "enabled",
          dailyRequestLimit: 1,
          reason: "bajar por hoy",
          actor: "owner",
          now: BUDGET_T0,
        });

        expect(await store.readState(sourceId, BUDGET_T0)).toMatchObject({
          declaredLimit: 10,
          effectiveLimit: 1,
        });
        await store.consume(sourceId, BUDGET_T0);
        expect(await store.consume(sourceId, BUDGET_T0)).toMatchObject({
          status: "daily_budget_exhausted",
          limit: 1,
        });

        await store.setControl({
          controlId: randomUUID(),
          sourceId,
          status: "enabled",
          dailyRequestLimit: 10_000,
          reason: "intento de subirlo",
          actor: "owner",
          now: BUDGET_T1,
        });

        // El tope declarado en código es el techo: la fila sólo puede bajarlo.
        expect(await store.readState(sourceId, BUDGET_T1)).toMatchObject({
          declaredLimit: 10,
          effectiveLimit: 10,
        });
      });

      it("un tope de cero frena sin ser un kill switch", async () => {
        const { sourceId, store } = withBudget(10);

        await store.setControl({
          controlId: randomUUID(),
          sourceId,
          status: "enabled",
          dailyRequestLimit: 0,
          reason: "sin llamadas por hoy",
          actor: "owner",
          now: BUDGET_T0,
        });

        expect(await store.consume(sourceId, BUDGET_T0)).toMatchObject({
          status: "daily_budget_exhausted",
          limit: 0,
          used: 0,
        });
      });
    });

    describe("historia del control", () => {
      it("deja un solo control vigente y conserva los anteriores cerrados", async () => {
        const { sourceId, store } = withBudget(5);

        await store.setControl({
          controlId: randomUUID(),
          sourceId,
          status: "disabled",
          dailyRequestLimit: null,
          reason: "primero",
          actor: "owner",
          now: BUDGET_T0,
        });
        await store.setControl({
          controlId: randomUUID(),
          sourceId,
          status: "enabled",
          dailyRequestLimit: 2,
          reason: "segundo",
          actor: "owner",
          now: BUDGET_T1,
        });

        const history = await store.listControlHistory(sourceId);

        expect(history.map((control) => control.reason)).toEqual([
          "segundo",
          "primero",
        ]);
        expect(history[0]!.supersededAt).toBeNull();
        expect(history[1]!.supersededAt).toBe(BUDGET_T1);
        expect(
          (await store.listControls()).filter(
            (control) => control.sourceId === sourceId,
          ),
        ).toHaveLength(1);
      });
    });
  });
}
