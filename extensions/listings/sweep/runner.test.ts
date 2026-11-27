import { describe, expect, it } from "vitest";

import { remaxAdapter } from "../portals/remax/remax-adapter";
import { sweepTick, type SweepDependencies } from "./runner";
import {
  INITIAL_PORTAL_STATE,
  type PortalSweepState,
  type VisitOutcome,
} from "./state";

/** Un reloj que avanza con cada espera y un navegador de mentira. */
function harness(options: {
  readonly start: string;
  readonly state?: Partial<PortalSweepState>;
  readonly outcomes?: (url: string, index: number) => VisitOutcome;
  readonly stopAfter?: number;
}) {
  let clock = Date.parse(options.start);
  let state: PortalSweepState = { ...INITIAL_PORTAL_STATE, ...options.state };
  const visited: string[] = [];
  const wakes: string[] = [];
  let finished = 0;
  const deps: SweepDependencies = {
    now: () => new Date(clock).toISOString(),
    loadState: async () => state,
    saveState: async (_portal, next) => {
      state = next;
    },
    visit: async (url) => {
      visited.push(url);
      clock += 3_000;
      return (
        options.outcomes?.(url, visited.length - 1) ?? {
          kind: "read",
          captures: 24,
        }
      );
    },
    sleep: async (ms) => {
      clock += ms;
    },
    wakeAt: async (instant) => {
      wakes.push(instant);
    },
    externalStop: async () =>
      options.stopAfter !== undefined && visited.length >= options.stopAfter
        ? "disabled"
        : null,
    finish: async () => {
      finished += 1;
    },
  };
  return {
    deps,
    visited,
    wakes,
    state: () => state,
    finished: () => finished,
    advanceTo: (instant: string) => {
      clock = Date.parse(instant);
    },
  };
}

const DAY = "2026-12-10T16:00:00.000Z"; // 13:00 en Buenos Aires: la hora ya pasó.

describe("listing-sweep-1.0.0 · runner", () => {
  it("antes de la hora no hace nada", async () => {
    const h = harness({ start: "2026-12-10T04:00:00.000Z" });
    expect(await sweepTick(remaxAdapter, h.deps)).toEqual({
      kind: "idle",
      reason: "not_due",
    });
    expect(h.visited).toEqual([]);
  });

  it("recorre la búsqueda por defecto con pausas largas y termina en el tope", async () => {
    const h = harness({ start: DAY });
    let result = await sweepTick(remaxAdapter, h.deps);
    let rounds = 0;
    while (result.kind === "paused_until" && rounds < 10) {
      rounds += 1;
      // La alarma despierta al worker a la hora pedida.
      h.advanceTo(result.until);
      result = await sweepTick(remaxAdapter, h.deps);
    }
    expect(result).toEqual({ kind: "ended", status: "done" });
    expect(h.visited).toHaveLength(25);
    expect(h.visited[0]).toBe(
      remaxAdapter.searchPageUrl(remaxAdapter.defaultSearches[0], 0),
    );
    expect(new Set(h.visited).size).toBe(25);
    expect(h.wakes.length).toBe(rounds);
    expect(rounds).toBeGreaterThanOrEqual(3);
    expect(h.state().run).toMatchObject({
      pages: 25,
      captures: 600,
      status: "done",
    });
    expect(h.state().rotation.page).toBe(25);
    expect(h.finished()).toBe(1);
    // El mismo día ya no vuelve a barrer.
    expect(await sweepTick(remaxAdapter, h.deps)).toEqual({
      kind: "idle",
      reason: "finished_today",
    });
  });

  it("un worker que muere en una pausa retoma desde el cursor sin repetir", async () => {
    const h = harness({ start: DAY });
    const first = await sweepTick(remaxAdapter, h.deps);
    expect(first.kind).toBe("paused_until");
    const seen = [...h.visited];
    // Despierta antes de tiempo (otra alarma): vuelve a dormir sin navegar.
    expect((await sweepTick(remaxAdapter, h.deps)).kind).toBe("paused_until");
    expect(h.visited).toEqual(seen);
    if (first.kind !== "paused_until") return;
    h.advanceTo(first.until);
    await sweepTick(remaxAdapter, h.deps);
    expect(h.visited.slice(0, seen.length)).toEqual(seen);
    expect(new Set(h.visited).size).toBe(h.visited.length);
  });

  it("un desafío detiene el portal por el día", async () => {
    const h = harness({
      start: DAY,
      outcomes: (_url, index) =>
        index === 1 ? { kind: "challenge" } : { kind: "read", captures: 24 },
    });
    expect(await sweepTick(remaxAdapter, h.deps)).toEqual({
      kind: "ended",
      status: "blocked",
    });
    expect(h.visited).toHaveLength(2);
    expect(h.state().blockedDays).toEqual(["2026-12-10"]);
  });

  it("el endpoint apagado detiene el barrido del día", async () => {
    const h = harness({ start: DAY, stopAfter: 2 });
    expect(await sweepTick(remaxAdapter, h.deps)).toEqual({
      kind: "ended",
      status: "stopped",
    });
    expect(h.visited).toHaveLength(2);
    expect(h.state().run?.stopReason).toBe("disabled");
  });

  it("pausado por el owner no navega; si lo pausa a mitad de camino, frena", async () => {
    const paused = harness({ start: DAY, state: { ownerPaused: true } });
    expect(await sweepTick(remaxAdapter, paused.deps)).toEqual({
      kind: "idle",
      reason: "owner_paused",
    });

    const h = harness({ start: DAY });
    const original = h.deps.visit;
    let calls = 0;
    const deps: SweepDependencies = {
      ...h.deps,
      visit: async (url) => {
        calls += 1;
        const outcome = await original(url);
        if (calls === 2)
          await h.deps.saveState("remax-ar", {
            ...h.state(),
            ownerPaused: true,
          });
        return outcome;
      },
    };
    expect(await sweepTick(remaxAdapter, deps)).toEqual({
      kind: "ended",
      status: "stopped",
    });
    expect(h.state().run?.stopReason).toBe("owner_paused");
    expect(h.visited).toHaveLength(2);
  });

  it("primero los seguidos y las búsquedas guardadas, no la de por defecto", async () => {
    const followed = "https://www.remax.com.ar/listings/casa-seguida";
    const search = remaxAdapter.normalizeSearch(
      "https://www.remax.com.ar/listings/buy?landingPath=otra-zona",
    )!;
    const h = harness({
      start: DAY,
      state: { followed: [followed], searches: [search], cap: 3 },
    });
    await sweepTick(remaxAdapter, h.deps);
    expect(h.visited).toEqual([
      followed,
      remaxAdapter.searchPageUrl(search, 0),
      remaxAdapter.searchPageUrl(search, 1),
    ]);
  });
});
