import { describe, expect, it } from "vitest";

import { TRADING_ROUTINE_VERSION } from "@/modules/trading/domain/trading-routine";

import type { TradingRoutineStore } from "./trading-routine-store";

/**
 * Contrato del almacén de la rutina, contra el doble en memoria (unitario) y
 * contra PostgreSQL (integración de trading).
 */
const T0 = "2026-11-14T12:00:00.000Z";
const T1 = "2026-11-14T12:01:00.000Z";
const ITEM_A = "00000000-0000-4000-8000-00000000000a";
const ITEM_B = "00000000-0000-4000-8000-00000000000b";

export function describeTradingRoutineStoreContract(
  label: string,
  createStore: () => TradingRoutineStore,
): void {
  describe(`trading routine store contract (${label})`, () => {
    async function ready() {
      const store = createStore();
      await store.addItem(
        {
          itemId: ITEM_A,
          phase: "pre_open",
          label: "Calendario económico",
          createdAt: T0,
        },
        12,
      );
      await store.addItem(
        {
          itemId: ITEM_B,
          phase: "pre_open",
          label: "Niveles marcados",
          createdAt: T1,
        },
        12,
      );
      return store;
    }

    const save = (
      store: TradingRoutineStore,
      baseRevision: number | null,
      checked: string[],
      note: string,
      recordedAt = T0,
    ) =>
      store.saveRoutine({
        session: "2026-11-16",
        phase: "pre_open",
        baseRevision,
        entry: { checked, note },
        version: TRADING_ROUTINE_VERSION,
        recordedAt,
      });

    it("keeps items in creation order and caps open ones per phase", async () => {
      const store = await ready();
      expect(
        await store.addItem(
          {
            itemId: "00000000-0000-4000-8000-00000000000c",
            phase: "pre_open",
            label: "Uno más",
            createdAt: T1,
          },
          2,
        ),
      ).toBe("limit_reached");
      expect((await store.listItems()).map((item) => item.itemId)).toEqual([
        ITEM_A,
        ITEM_B,
      ]);
    });

    it("retires an item without erasing it", async () => {
      const store = await ready();
      expect(await store.retireItem(ITEM_A, T1)).toBe(true);
      expect(await store.retireItem(ITEM_A, T1)).toBe(false);
      expect((await store.listItems())[0]).toMatchObject({
        itemId: ITEM_A,
        retiredAt: T1,
      });
    });

    it("saves a session as revisions and refuses a stale one", async () => {
      const store = await ready();
      expect(await save(store, null, [ITEM_A], "Sin noticias.")).toMatchObject({
        state: "saved",
        routine: { revision: 1, checked: [ITEM_A], note: "Sin noticias." },
      });
      expect(await save(store, 1, [ITEM_A], "Sin noticias.")).toMatchObject({
        state: "unchanged",
      });
      expect(await save(store, 1, [ITEM_A, ITEM_B], "", T1)).toMatchObject({
        state: "saved",
        routine: { revision: 2 },
      });
      expect(await save(store, 1, [], "otra pestaña")).toMatchObject({
        state: "conflict",
        current: { revision: 2 },
      });
      expect(await store.listRoutines("2026-11-16", "2026-11-16")).toEqual([
        expect.objectContaining({
          revision: 2,
          checked: [ITEM_A, ITEM_B],
          note: "",
        }),
      ]);
      expect(await store.listRoutines("2026-11-17", "2026-11-20")).toEqual([]);
    });
  });
}
