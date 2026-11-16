import { describe, expect, it } from "vitest";

import { FINVIZ_SCREENER_CATALOG_VERSION } from "@/modules/finviz-screener/domain/finviz-screener-catalog";
import {
  FINVIZ_STRATEGY_VERSION,
  type FinvizStrategyFields,
} from "@/modules/finviz-screener/domain/finviz-screener-strategy";

import type { FinvizStrategyStore } from "./finviz-strategy-store";

/**
 * Contrato del almacén de estrategias, contra el doble en memoria (unitario) y
 * contra PostgreSQL (integración de trading).
 */
const T0 = "2026-11-16T12:00:00.000Z";
const T1 = "2026-11-16T12:01:00.000Z";
const T2 = "2026-11-16T12:02:00.000Z";
const A = "8a6b2f4e-1c3d-4e5f-9a7b-0c1d2e3f4a5b";
const B = "1f2e3d4c-5b6a-4978-8a6b-5c4d3e2f1a0b";

const semis: FinvizStrategyFields = {
  name: "Semis baratos",
  view: "111",
  signal: "ta_newhigh",
  filters: "industry_semiconductors,fa_pe_u20",
};

export function describeFinvizStrategyStoreContract(
  label: string,
  createStore: () => Promise<FinvizStrategyStore> | FinvizStrategyStore,
): void {
  describe(`finviz strategy store contract (${label})`, () => {
    const save = (
      store: FinvizStrategyStore,
      strategyId: string,
      baseRevision: number | null,
      fields: FinvizStrategyFields,
      recordedAt = T0,
    ) =>
      store.save({
        strategyId,
        baseRevision,
        fields,
        version: FINVIZ_STRATEGY_VERSION,
        catalogVersion: FINVIZ_SCREENER_CATALOG_VERSION,
        recordedAt,
      });

    it("has nothing until the owner saves", async () => {
      expect(await (await createStore()).listActive()).toEqual([]);
    });

    it("saves revisions and lists the current ones by name", async () => {
      const store = await createStore();
      expect(await save(store, A, null, semis)).toMatchObject({
        state: "saved",
        strategy: { strategyId: A, revision: 1, ...semis, recordedAt: T0 },
      });
      await save(store, B, null, {
        name: "Breakouts",
        view: "211",
        signal: null,
        filters: "",
      });
      expect(
        await save(store, A, 1, { ...semis, filters: "fa_pe_u20" }, T1),
      ).toMatchObject({ state: "saved", strategy: { revision: 2 } });
      const listed = await store.listActive();
      expect(
        listed.map((strategy) => [strategy.name, strategy.revision]),
      ).toEqual([
        ["Breakouts", 1],
        ["Semis baratos", 2],
      ]);
      expect(listed[1]).toEqual({
        strategyId: A,
        revision: 2,
        version: FINVIZ_STRATEGY_VERSION,
        catalogVersion: FINVIZ_SCREENER_CATALOG_VERSION,
        ...semis,
        filters: "fa_pe_u20",
        recordedAt: T1,
      });
    });

    it("does not write the same strategy twice", async () => {
      const store = await createStore();
      await save(store, A, null, semis);
      expect(await save(store, A, 1, { ...semis }, T1)).toMatchObject({
        state: "unchanged",
        strategy: { revision: 1, recordedAt: T0 },
      });
    });

    it("refuses a stale revision and a name already in use", async () => {
      const store = await createStore();
      await save(store, A, null, semis);
      expect(await save(store, A, null, semis)).toEqual({ state: "conflict" });
      expect(await save(store, A, 2, semis)).toEqual({ state: "conflict" });
      expect(
        await save(store, B, null, { ...semis, name: "SEMIS Baratos" }),
      ).toEqual({ state: "name_taken" });
    });

    it("archives as a revision and frees the name", async () => {
      const store = await createStore();
      await save(store, A, null, semis);
      expect(
        await store.archive({ strategyId: A, baseRevision: 2, recordedAt: T1 }),
      ).toBe("conflict");
      expect(
        await store.archive({ strategyId: A, baseRevision: 1, recordedAt: T1 }),
      ).toBe("archived");
      expect(await store.listActive()).toEqual([]);
      expect(await save(store, A, 2, semis, T2)).toEqual({ state: "conflict" });
      expect(await save(store, B, null, semis, T2)).toMatchObject({
        state: "saved",
      });
    });
  });
}
