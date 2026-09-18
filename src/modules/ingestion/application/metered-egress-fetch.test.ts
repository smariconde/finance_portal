import { describe, expect, it, vi } from "vitest";

import { createInMemorySourceBudgetStore } from "@/modules/ingestion/infrastructure/in-memory-source-budget-store";
import { SourceRequestRefusedError } from "@/modules/ingestion/domain/source-budget";

import {
  checkSourceBudget,
  createMeteredEgressFetch,
} from "./metered-egress-fetch";

const SOURCE_ID = "sec-edgar";
const NOW = "2026-09-18T10:00:00.000Z";

function response() {
  return {
    status: 200,
    body: new Uint8Array(),
    byteLength: 0,
    fetchedAt: NOW,
  };
}

describe("egress medido", () => {
  it("gasta una unidad por llamada y deja pasar mientras haya cuota", async () => {
    const store = createInMemorySourceBudgetStore({ [SOURCE_ID]: 2 });
    const inner = vi.fn(async () => response());
    const fetch = createMeteredEgressFetch(inner, {
      store,
      now: () => NOW,
    });

    await fetch({ sourceId: SOURCE_ID, url: "https://data.sec.gov/a" });
    await fetch({ sourceId: SOURCE_ID, url: "https://data.sec.gov/b" });

    expect(inner).toHaveBeenCalledTimes(2);
    expect(await store.readState(SOURCE_ID, NOW)).toMatchObject({ used: 2 });
  });

  it("no abre ninguna conexión cuando la cuota del día está gastada", async () => {
    const store = createInMemorySourceBudgetStore({ [SOURCE_ID]: 1 });
    const inner = vi.fn(async () => response());
    const fetch = createMeteredEgressFetch(inner, { store, now: () => NOW });

    await fetch({ sourceId: SOURCE_ID, url: "https://data.sec.gov/a" });

    await expect(
      fetch({ sourceId: SOURCE_ID, url: "https://data.sec.gov/b" }),
    ).rejects.toThrow(SourceRequestRefusedError);
    expect(inner).toHaveBeenCalledOnce();
  });

  it("no abre ninguna conexión con la fuente frenada, y el error lleva el código", async () => {
    const store = createInMemorySourceBudgetStore({ [SOURCE_ID]: 10 });
    const inner = vi.fn(async () => response());
    const fetch = createMeteredEgressFetch(inner, { store, now: () => NOW });

    await store.setControl({
      controlId: "11111111-1111-4111-8111-111111111111",
      sourceId: SOURCE_ID,
      status: "disabled",
      dailyRequestLimit: null,
      reason: "sondeo manual en curso",
      actor: "owner",
      now: NOW,
    });

    const error = await fetch({
      sourceId: SOURCE_ID,
      url: "https://data.sec.gov/a",
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(SourceRequestRefusedError);
    expect((error as SourceRequestRefusedError).code).toBe("source_disabled");
    expect((error as SourceRequestRefusedError).resumesAt).toBeNull();
    expect(inner).not.toHaveBeenCalled();
  });

  it("niega una fuente sin presupuesto declarado, aunque esté en la allowlist", async () => {
    const store = createInMemorySourceBudgetStore({});
    const inner = vi.fn(async () => response());
    const fetch = createMeteredEgressFetch(inner, { store, now: () => NOW });

    await expect(
      fetch({ sourceId: SOURCE_ID, url: "https://data.sec.gov/a" }),
    ).rejects.toThrow(/no declared daily request budget/u);
    expect(inner).not.toHaveBeenCalled();
  });

  it("la comprobación previa no gasta cuota", async () => {
    const store = createInMemorySourceBudgetStore({ [SOURCE_ID]: 3 });

    expect(await checkSourceBudget(store, SOURCE_ID, 3, NOW)).toMatchObject({
      status: "allowed",
    });
    expect(await checkSourceBudget(store, SOURCE_ID, 4, NOW)).toMatchObject({
      status: "daily_budget_exhausted",
    });
    expect(await store.readState(SOURCE_ID, NOW)).toMatchObject({ used: 0 });
  });
});
