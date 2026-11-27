import { describe, expect, it } from "vitest";

import type { ListingCapture } from "../../../src/modules/real-estate/domain/listing-capture";
import {
  INITIAL_ROTATION,
  MAX_PAGES_PER_PORTAL_PER_DAY,
  MAX_ROTATION_PAGE,
  effectiveCap,
  nextRotation,
  planSweep,
  rotationAfterEmptyPage,
  type IndexedListing,
} from "./plan";
import {
  LONG_PAUSE_MS,
  PAGE_DELAY_MS,
  delayBeforeStep,
  sweepIsDue,
  sweepStartAt,
} from "./schedule";
import {
  INITIAL_PORTAL_STATE,
  MAX_INDEXED_LISTINGS,
  decideSweep,
  indexCaptures,
  reactivate,
  recordVisit,
  startRun,
  stopRun,
  type PortalSweepState,
} from "./state";

const PORTAL = "remax-ar";
const SEARCH =
  "https://www.remax.com.ar/listings/buy?landingPath=x&pageSize=24&sort=-createdAt";
const pageOf = (search: string, page: number) => `${search}&page=${page}`;

describe("listing-sweep-1.0.0 · horario", () => {
  it("sortea una hora por día entre 08:30 y 11:30 de Buenos Aires, siempre la misma", () => {
    const starts = new Set<string>();
    for (let day = 1; day <= 28; day += 1) {
      const date = `2026-12-${String(day).padStart(2, "0")}`;
      const start = sweepStartAt(date, PORTAL);
      expect(sweepStartAt(date, PORTAL)).toBe(start);
      const minutesUtc =
        new Date(start).getUTCHours() * 60 + new Date(start).getUTCMinutes();
      // 08:30–11:30 en Buenos Aires son 11:30–14:30 UTC.
      expect(minutesUtc).toBeGreaterThanOrEqual(11 * 60 + 30);
      expect(minutesUtc).toBeLessThanOrEqual(14 * 60 + 30);
      expect(start.slice(0, 10)).toBe(date);
      starts.add(start.slice(11, 16));
    }
    expect(starts.size).toBeGreaterThan(10);
    expect(sweepStartAt("2026-12-01", "zonaprop")).not.toBe(
      sweepStartAt("2026-12-01", PORTAL),
    );
  });

  it("corresponde barrer desde la hora sorteada hasta el final del día de Buenos Aires", () => {
    const start = sweepStartAt("2026-12-01", PORTAL);
    const before = new Date(Date.parse(start) - 60_000).toISOString();
    expect(sweepIsDue(before, PORTAL)).toBe(false);
    expect(sweepIsDue(start, PORTAL)).toBe(true);
    // 23:59 de Buenos Aires del mismo día.
    expect(sweepIsDue("2026-12-02T02:59:00.000Z", PORTAL)).toBe(true);
    // 00:30 del día siguiente, antes de su propia hora.
    expect(sweepIsDue("2026-12-02T03:30:00.000Z", PORTAL)).toBe(false);
  });

  it("espera 8–15 s entre páginas y una pausa larga cada 5 a 8", () => {
    expect(delayBeforeStep("2026-12-01", PORTAL, 0)).toEqual({
      ms: 0,
      long: false,
    });
    const delays = Array.from({ length: 25 }, (_, step) =>
      delayBeforeStep("2026-12-01", PORTAL, step + 1),
    );
    const longs = delays.filter((delay) => delay.long);
    expect(longs.length).toBeGreaterThanOrEqual(3);
    expect(longs.length).toBeLessThanOrEqual(5);
    for (const delay of delays) {
      const range = delay.long ? LONG_PAUSE_MS : PAGE_DELAY_MS;
      expect(delay.ms).toBeGreaterThanOrEqual(range.min);
      expect(delay.ms).toBeLessThanOrEqual(range.max);
    }
  });
});

const NOW = "2026-12-10T13:00:00.000Z";
const daysAgo = (days: number) =>
  new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
const listing = (
  id: number,
  detailDaysAgo: number | null,
  seenDaysAgo = 0,
): IndexedListing => ({
  url: `https://www.remax.com.ar/listings/aviso-${id}`,
  lastDetailAt: detailDaysAgo === null ? null : daysAgo(detailDaysAgo),
  lastSeenAt: daysAgo(seenDaysAgo),
});

describe("listing-sweep-1.0.0 · plan", () => {
  it("sigue la prioridad y nunca pasa el tope ni repite una URL", () => {
    const index = [
      listing(1, 10),
      listing(2, 30),
      listing(3, 2),
      ...Array.from({ length: 40 }, (_, i) => listing(100 + i, null, i)),
    ];
    const visits = planSweep({
      now: NOW,
      cap: 25,
      followed: [listing(3, 2).url, listing(3, 2).url],
      searches: [SEARCH],
      searchPageUrl: pageOf,
      index,
      rotation: INITIAL_ROTATION,
    });
    expect(visits).toHaveLength(MAX_PAGES_PER_PORTAL_PER_DAY);
    expect(new Set(visits.map((visit) => visit.url)).size).toBe(visits.length);
    expect(
      visits.slice(0, 4).map((visit) => [visit.reason, visit.url]),
    ).toEqual([
      ["followed", listing(3, 2).url],
      ["search_first", pageOf(SEARCH, 0)],
      ["stale_detail", listing(2, 30).url],
      ["stale_detail", listing(1, 10).url],
    ]);
    const rest = visits.slice(4);
    const deep = rest.filter((visit) => visit.reason === "search_rotation");
    expect(deep.map((visit) => visit.url)).toEqual(
      Array.from({ length: 7 }, (_, i) => pageOf(SEARCH, i + 1)),
    );
    expect(rest.filter((visit) => visit.reason === "undetailed")[0].url).toBe(
      listing(100, null, 0).url,
    );
  });

  it("sin fichas pendientes, la rotación ocupa lo que sobra; un tope guardado sólo baja", () => {
    const visits = planSweep({
      now: NOW,
      cap: 6,
      followed: [],
      searches: [SEARCH],
      searchPageUrl: pageOf,
      index: [],
      rotation: { search: 0, page: 4 },
    });
    expect(visits.map((visit) => visit.url)).toEqual([
      pageOf(SEARCH, 0),
      ...[4, 5, 6, 7, 8].map((page) => pageOf(SEARCH, page)),
    ]);
    expect(effectiveCap(null)).toBe(25);
    expect(effectiveCap(40)).toBe(25);
    expect(effectiveCap(10)).toBe(10);
    expect(effectiveCap(0)).toBe(0);
    expect(effectiveCap(-3)).toBe(25);
    expect(
      planSweep({
        now: NOW,
        cap: 0,
        followed: [listing(1, 1).url],
        searches: [SEARCH],
        searchPageUrl: pageOf,
        index: [],
        rotation: INITIAL_ROTATION,
      }),
    ).toEqual([]);
  });

  it("el cursor de rotación avanza, vuelve a la página 1 y pasa a la búsqueda siguiente", () => {
    expect(nextRotation({ search: 0, page: 3 }, 2)).toEqual({
      search: 0,
      page: 4,
    });
    expect(nextRotation({ search: 0, page: MAX_ROTATION_PAGE }, 2)).toEqual({
      search: 1,
      page: 1,
    });
    expect(nextRotation({ search: 1, page: MAX_ROTATION_PAGE }, 2)).toEqual({
      search: 0,
      page: 1,
    });
    expect(rotationAfterEmptyPage({ search: 1, page: 9 }, 2)).toEqual({
      search: 0,
      page: 1,
    });
    expect(nextRotation({ search: 3, page: 1 }, 0)).toEqual(INITIAL_ROTATION);
  });
});

describe("listing-sweep-1.0.0 · estado", () => {
  const due = "2026-12-10T16:00:00.000Z"; // 13:00 en Buenos Aires: siempre pasó la hora.

  function running(visits = 3): PortalSweepState {
    return startRun(
      INITIAL_PORTAL_STATE,
      due,
      Array.from({ length: visits }, (_, i) => ({
        url: pageOf(SEARCH, i + 1),
        reason: "search_rotation" as const,
        rotationAfter: { search: 0, page: i + 2 },
      })),
    );
  }

  it("decide empezar, retomar o esperar", () => {
    expect(decideSweep(INITIAL_PORTAL_STATE, due, PORTAL)).toEqual({
      kind: "start",
    });
    expect(
      decideSweep(INITIAL_PORTAL_STATE, "2026-12-10T03:30:00.000Z", PORTAL),
    ).toEqual({
      kind: "idle",
      reason: "not_due",
    });
    expect(
      decideSweep(INITIAL_PORTAL_STATE, "2026-12-10T03:30:00.000Z", PORTAL, {
        force: true,
      }),
    ).toEqual({ kind: "start" });
    expect(decideSweep(running(), due, PORTAL)).toEqual({ kind: "resume" });
    expect(
      decideSweep({ ...running(), ownerPaused: true }, due, PORTAL),
    ).toEqual({
      kind: "idle",
      reason: "owner_paused",
    });
    const done = stopRun(running(), due, "disabled");
    expect(decideSweep(done, due, PORTAL)).toEqual({
      kind: "idle",
      reason: "finished_today",
    });
    // «Barrer ahora» relanza un día detenido, nunca uno con desafío.
    expect(decideSweep(done, due, PORTAL, { force: true })).toEqual({
      kind: "start",
    });
    const challenged = recordVisit(
      running(),
      { kind: "challenge" },
      due,
      1,
      rotationAfterEmptyPage,
    );
    expect(decideSweep(challenged, due, PORTAL, { force: true })).toEqual({
      kind: "idle",
      reason: "finished_today",
    });
    // Al día siguiente, a su hora, empieza otra vez y archiva la anterior.
    const tomorrow = "2026-12-11T16:00:00.000Z";
    expect(decideSweep(done, tomorrow, PORTAL)).toEqual({ kind: "start" });
    expect(startRun(done, tomorrow, []).history[0].stopReason).toBe("disabled");
  });

  it("avanza el cursor, cuenta y termina; una página profunda vacía rota de búsqueda", () => {
    let state = running(3);
    state = recordVisit(
      state,
      { kind: "read", captures: 24 },
      due,
      1,
      rotationAfterEmptyPage,
    );
    state = recordVisit(
      state,
      { kind: "unread", reason: "timeout" },
      due,
      1,
      rotationAfterEmptyPage,
    );
    expect(state.run).toMatchObject({
      next: 2,
      pages: 2,
      captures: 24,
      unread: 1,
      status: "running",
    });
    expect(state.rotation).toEqual({ search: 0, page: 3 });
    state = recordVisit(
      state,
      { kind: "read", captures: 0 },
      due,
      1,
      rotationAfterEmptyPage,
    );
    expect(state.run).toMatchObject({
      next: 3,
      status: "done",
      finishedAt: due,
    });
    expect(state.rotation).toEqual({ search: 0, page: 1 });
    // Una vez terminado, otra visita no cambia nada.
    expect(
      recordVisit(
        state,
        { kind: "read", captures: 1 },
        due,
        1,
        rotationAfterEmptyPage,
      ),
    ).toBe(state);
  });

  it("un desafío bloquea el día; dos días seguidos pausan hasta reactivar", () => {
    const first = recordVisit(
      running(),
      { kind: "challenge" },
      due,
      1,
      rotationAfterEmptyPage,
    );
    expect(first.run).toMatchObject({
      status: "blocked",
      stopReason: "challenge",
    });
    expect(first.pausedByChallenges).toBe(false);
    expect(decideSweep(first, due, PORTAL)).toEqual({
      kind: "idle",
      reason: "finished_today",
    });

    const nextDay = "2026-12-11T16:00:00.000Z";
    const second = recordVisit(
      startRun(first, nextDay, [
        { url: pageOf(SEARCH, 0), reason: "search_first" },
      ]),
      { kind: "challenge" },
      nextDay,
      1,
      rotationAfterEmptyPage,
    );
    expect(second.pausedByChallenges).toBe(true);
    expect(decideSweep(second, "2026-12-12T16:00:00.000Z", PORTAL)).toEqual({
      kind: "idle",
      reason: "paused_by_challenges",
    });
    const back = reactivate(second);
    expect(back.pausedByChallenges).toBe(false);
    expect(decideSweep(back, "2026-12-12T16:00:00.000Z", PORTAL)).toEqual({
      kind: "start",
    });

    // Dos desafíos con un día limpio en el medio no pausan.
    const gap = recordVisit(
      startRun(first, "2026-12-12T16:00:00.000Z", [
        { url: "x", reason: "search_first" },
      ]),
      { kind: "challenge" },
      "2026-12-12T16:00:00.000Z",
      1,
      rotationAfterEmptyPage,
    );
    expect(gap.pausedByChallenges).toBe(false);
  });

  it("indexa las capturas por URL y recuerda la última ficha", () => {
    const capture = (
      id: number,
      pageKind: ListingCapture["pageKind"],
      at: string,
    ) =>
      ({
        canonicalUrl: `https://www.remax.com.ar/listings/aviso-${id}`,
        pageKind,
        capturedAt: at,
      }) as ListingCapture;
    let index = indexCaptures([], [capture(1, "search_result", daysAgo(5))]);
    expect(index).toEqual([
      {
        url: capture(1, "search_result", NOW).canonicalUrl,
        lastDetailAt: null,
        lastSeenAt: daysAgo(5),
      },
    ]);
    index = indexCaptures(index, [capture(1, "listing_detail", daysAgo(3))]);
    index = indexCaptures(index, [capture(1, "search_result", daysAgo(1))]);
    expect(index[0]).toMatchObject({
      lastDetailAt: daysAgo(3),
      lastSeenAt: daysAgo(1),
    });

    const many = Array.from({ length: MAX_INDEXED_LISTINGS + 2 }, (_, i) =>
      capture(
        i,
        "search_result",
        new Date(Date.parse(NOW) - i * 1000).toISOString(),
      ),
    );
    const capped = indexCaptures([], many);
    expect(capped).toHaveLength(MAX_INDEXED_LISTINGS);
    expect(capped.at(-1)?.url).toBe(
      many[MAX_INDEXED_LISTINGS - 1].canonicalUrl,
    );
  });
});

describe("listing-sweep-1.0.0 · órdenes del popup", () => {
  it("sigue sólo fichas del portal, guarda búsquedas normalizadas y el tope sólo baja", async () => {
    const { applySweepCommand, MAX_FOLLOWED } = await import("./commands");
    const { remaxAdapter } = await import("../portals/remax/remax-adapter");
    let state = INITIAL_PORTAL_STATE;
    state = applySweepCommand(state, remaxAdapter, {
      command: "follow",
      url: "https://www.remax.com.ar/listings/casa-linda/?utm=x",
    });
    state = applySweepCommand(state, remaxAdapter, {
      command: "follow",
      url: "https://www.remax.com.ar/listings/buy",
    });
    state = applySweepCommand(state, remaxAdapter, {
      command: "follow",
      url: "https://evil.example/listings/casa",
    });
    expect(state.followed).toEqual([
      "https://www.remax.com.ar/listings/casa-linda",
    ]);
    for (let i = 0; i < MAX_FOLLOWED + 2; i += 1) {
      state = applySweepCommand(state, remaxAdapter, {
        command: "follow",
        url: `https://www.remax.com.ar/listings/casa-${i}`,
      });
    }
    expect(state.followed).toHaveLength(MAX_FOLLOWED);

    state = applySweepCommand(state, remaxAdapter, {
      command: "save_search",
      url: "https://www.remax.com.ar/listings/buy?page=4&landingPath=x",
    });
    state = applySweepCommand(state, remaxAdapter, {
      command: "save_search",
      url: "https://www.remax.com.ar/listings/buy?landingPath=x",
    });
    state = applySweepCommand(state, remaxAdapter, {
      command: "save_search",
      url: "https://www.remax.com.ar/listings/una-casa",
    });
    expect(state.searches).toEqual([
      "https://www.remax.com.ar/listings/buy?landingPath=x&pageSize=24&sort=-createdAt",
    ]);

    expect(
      applySweepCommand(state, remaxAdapter, { command: "set_cap", cap: 40 })
        .cap,
    ).toBe(25);
    expect(
      applySweepCommand(state, remaxAdapter, { command: "set_cap", cap: 10.7 })
        .cap,
    ).toBe(10);
    expect(
      applySweepCommand(state, remaxAdapter, { command: "set_cap", cap: -1 })
        .cap,
    ).toBe(0);
    expect(
      applySweepCommand(state, remaxAdapter, { command: "pause" }).ownerPaused,
    ).toBe(true);
  });
});

describe("listing-sweep-1.0.0 · resumen del popup", () => {
  it("dice qué pasa hoy y la cobertura", async () => {
    const { sweepSummary } = await import("./summary");
    const before = sweepSummary(
      INITIAL_PORTAL_STATE,
      "2026-12-10T04:00:00.000Z",
      PORTAL,
      1,
    );
    expect(before.status).toMatch(/^Hoy a las \d{2}:\d{2}$/u);
    expect(before.coverage).toContainEqual(["Búsquedas", "0/1 (por defecto)"]);

    const due = "2026-12-10T16:00:00.000Z";
    const state = recordVisit(
      startRun({ ...INITIAL_PORTAL_STATE, index: [listing(1, 9)] }, due, [
        { url: pageOf(SEARCH, 0), reason: "search_first" },
        { url: pageOf(SEARCH, 1), reason: "search_rotation" },
      ]),
      { kind: "read", captures: 24 },
      due,
      1,
      rotationAfterEmptyPage,
    );
    const during = sweepSummary(state, due, PORTAL, 1);
    expect(during.status).toBe("Barriendo 1/2");
    expect(during.coverage).toEqual(
      expect.arrayContaining([
        ["Avisos hoy", "24"],
        ["Búsquedas", "1/1 (por defecto)"],
        ["Ficha más vieja", "9 días · por revisar"],
      ]),
    );
    const blocked = recordVisit(
      state,
      { kind: "challenge" },
      due,
      1,
      rotationAfterEmptyPage,
    );
    expect(sweepSummary(blocked, due, PORTAL, 1).status).toBe(
      "Bloqueado hoy: desafío del portal",
    );
  });
});

describe("listing-sweep-1.0.0 · «Barrer ahora»", () => {
  it("se ofrece sin corrida o con el día detenido; terminado dice el próximo", async () => {
    const { runNowButton } = await import("./summary");
    const due = "2026-12-10T16:00:00.000Z";
    expect(runNowButton(INITIAL_PORTAL_STATE, due, PORTAL)).toEqual({
      enabled: true,
      label: "Barrer ahora",
    });
    const run = startRun(INITIAL_PORTAL_STATE, due, [
      { url: pageOf(SEARCH, 0), reason: "search_first" },
    ]);
    expect(runNowButton(run, due, PORTAL)).toEqual({
      enabled: false,
      label: "Barriendo…",
    });
    expect(
      runNowButton(stopRun(run, due, "disabled"), due, PORTAL).enabled,
    ).toBe(true);
    const done = recordVisit(
      run,
      { kind: "read", captures: 1 },
      due,
      1,
      rotationAfterEmptyPage,
    );
    expect(runNowButton(done, due, PORTAL)).toMatchObject({ enabled: false });
    expect(runNowButton(done, due, PORTAL).label).toMatch(
      /^Próximo: mañana \d{2}:\d{2}$/u,
    );
    expect(
      runNowButton({ ...done, ownerPaused: true }, due, PORTAL).enabled,
    ).toBe(false);
  });
});
