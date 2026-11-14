import { describe, expect, it } from "vitest";

import {
  EMPTY_ANNOTATION,
  TRADE_ANNOTATION_VERSION,
  type TradeAnnotation,
} from "@/modules/trading/domain/trade-annotation";

import type { TradeAnnotationStore } from "./trade-annotation-store";

/**
 * Contrato del almacén de anotaciones del diario, contra el doble en memoria
 * (unitario) y contra PostgreSQL (integración de trading).
 */
const ACCOUNT = "b".repeat(64);
const TRADE = "schwab:3001:41";
const T0 = "2026-11-14T15:00:00.000Z";
const T1 = "2026-11-14T15:01:00.000Z";
const T2 = "2026-11-14T15:02:00.000Z";

function annotation(overrides: Partial<TradeAnnotation> = {}): TradeAnnotation {
  return {
    ...EMPTY_ANNOTATION,
    setupCode: "breakout",
    plan: { entry: "10.5", stop: "9.75", target: "12", quantity: "100" },
    adherence: { entry: "kept", stop: "broken", target: null, size: "kept" },
    emotion: "fomo",
    notes: "Entré tarde.\n<script>alert(1)</script> & «comillas»",
    ...overrides,
  };
}

export type TradeAnnotationStoreHarness = {
  readonly store: TradeAnnotationStore;
  readonly recordAccount: (accountKey: string) => Promise<void>;
};

export function describeTradeAnnotationStoreContract(
  label: string,
  createHarness: () => TradeAnnotationStoreHarness,
): void {
  describe(`trade annotation store contract (${label})`, () => {
    async function ready() {
      const harness = createHarness();
      await harness.recordAccount(ACCOUNT);
      return harness.store;
    }

    const save = (
      store: TradeAnnotationStore,
      baseRevision: number | null,
      value: TradeAnnotation,
      recordedAt: string,
    ) =>
      store.saveAnnotation({
        accountKey: ACCOUNT,
        tradeKey: TRADE,
        baseRevision,
        annotation: value,
        version: TRADE_ANNOTATION_VERSION,
        recordedAt,
      });

    it("stores an annotation exactly as written, notes included", async () => {
      const store = await ready();
      const result = await save(store, null, annotation(), T0);
      expect(result).toMatchObject({
        state: "saved",
        annotation: { revision: 1, recordedAt: T0, ...annotation() },
      });
      expect(await store.listCurrentAnnotations(ACCOUNT)).toEqual([
        expect.objectContaining({ tradeKey: TRADE, ...annotation() }),
      ]);
    });

    it("appends a revision and keeps the one it replaces", async () => {
      const store = await ready();
      await save(store, null, annotation(), T0);
      const second = await save(
        store,
        1,
        annotation({ plan: { ...annotation().plan, stop: "9.5" } }),
        T1,
      );
      expect(second).toMatchObject({
        state: "saved",
        annotation: { revision: 2 },
      });

      const current = await store.listCurrentAnnotations(ACCOUNT);
      expect(current).toHaveLength(1);
      expect(current[0]!.plan.stop).toBe("9.5");
      const revisions = await store.listAnnotationRevisions(ACCOUNT, TRADE);
      expect(
        revisions.map((stored) => [stored.revision, stored.plan.stop]),
      ).toEqual([
        [2, "9.5"],
        [1, "9.75"],
      ]);
    });

    it("writes nothing when the annotation did not change", async () => {
      const store = await ready();
      await save(store, null, annotation(), T0);
      expect(await save(store, 1, annotation(), T1)).toMatchObject({
        state: "unchanged",
        annotation: { revision: 1, recordedAt: T0 },
      });
      expect(await store.listAnnotationRevisions(ACCOUNT, TRADE)).toHaveLength(
        1,
      );
    });

    it("refuses a save made over another revision", async () => {
      const store = await ready();
      await save(store, null, annotation(), T0);
      await save(store, 1, annotation({ review: "reviewed" }), T1);

      expect(
        await save(store, 1, annotation({ notes: "otra pestaña" }), T2),
      ).toMatchObject({ state: "conflict", current: { revision: 2 } });
      expect(await save(store, null, annotation(), T2)).toMatchObject({
        state: "conflict",
      });
      expect(await store.listAnnotationRevisions(ACCOUNT, TRADE)).toHaveLength(
        2,
      );
    });

    it("keeps nulls as nulls", async () => {
      const store = await ready();
      await save(store, null, EMPTY_ANNOTATION, T0);
      const [stored] = await store.listCurrentAnnotations(ACCOUNT);
      expect(stored).toMatchObject(EMPTY_ANNOTATION);
    });

    it("creates own setups once and up to the limit", async () => {
      const store = await ready();
      expect(
        await store.createOwnSetup(
          { code: "own-flag", label: "Flag", createdAt: T0 },
          2,
        ),
      ).toBe("created");
      expect(
        await store.createOwnSetup(
          { code: "own-flag", label: "Flag", createdAt: T1 },
          2,
        ),
      ).toBe("exists");
      await store.createOwnSetup(
        { code: "own-wedge", label: "Wedge", createdAt: T1 },
        2,
      );
      expect(
        await store.createOwnSetup(
          { code: "own-cup", label: "Cup", createdAt: T2 },
          2,
        ),
      ).toBe("limit_reached");
      expect(await store.listOwnSetups()).toEqual([
        { code: "own-flag", label: "Flag", createdAt: T0 },
        { code: "own-wedge", label: "Wedge", createdAt: T1 },
      ]);
    });
  });
}
