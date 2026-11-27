import type { ListingCapture } from "../../../src/modules/real-estate/domain/listing-capture";
import { buenosAiresDate } from "../capture/status";
import {
  INITIAL_ROTATION,
  type IndexedListing,
  type PlannedVisit,
  type RotationCursor,
} from "./plan";
import { sweepIsDue } from "./schedule";

/**
 * El estado del barrido de un portal, guardado en `chrome.storage.local`
 * para que un service worker que se duerme, o un Brave que se cierra, retome
 * desde el cursor (`listing-sweep-1.0.0`).
 *
 * Tres frenos independientes, ninguno implica otro:
 *
 * - el owner lo pausa desde el popup (`ownerPaused`);
 * - un desafío lo bloquea **por el día**; dos días seguidos bloqueados lo
 *   pausan hasta que el owner lo reactive (`pausedByChallenges`);
 * - el endpoint dice que la captura está apagada o sin cuota: el barrido de
 *   ese día se detiene (`stopped`), porque capturar sin poder guardar es
 *   visitar de más.
 */
export type SweepRunStatus = "running" | "done" | "blocked" | "stopped";

export type SweepRun = {
  readonly date: string;
  readonly visits: readonly PlannedVisit[];
  /** El cursor: la próxima visita por hacer. */
  readonly next: number;
  readonly status: SweepRunStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly pages: number;
  readonly captures: number;
  /** Páginas que no se leyeron: rechazadas o que no respondieron a tiempo. */
  readonly unread: number;
  readonly stopReason: string | null;
  /**
   * Una pausa larga en curso: antes de la visita `step` no se navega hasta
   * `until`. La despierta una alarma, porque un service worker no sobrevive
   * dormido tanto tiempo.
   */
  readonly pause: { readonly step: number; readonly until: string } | null;
};

export type PortalSweepState = {
  readonly ownerPaused: boolean;
  readonly pausedByChallenges: boolean;
  /** Los días de Buenos Aires con un desafío, los últimos. */
  readonly blockedDays: readonly string[];
  /** El tope guardado; `null` es el declarado. */
  readonly cap: number | null;
  readonly rotation: RotationCursor;
  readonly followed: readonly string[];
  readonly searches: readonly string[];
  readonly index: readonly IndexedListing[];
  readonly run: SweepRun | null;
  /** Las corridas terminadas, la más reciente primero (30 como mucho). */
  readonly history: readonly SweepRun[];
};

export const INITIAL_PORTAL_STATE: PortalSweepState = {
  ownerPaused: false,
  pausedByChallenges: false,
  blockedDays: [],
  cap: null,
  rotation: INITIAL_ROTATION,
  followed: [],
  searches: [],
  index: [],
  run: null,
  history: [],
};

export const MAX_INDEXED_LISTINGS = 5000;
const KEPT_RUNS = 30;
const KEPT_BLOCKED_DAYS = 10;

export type SweepDecision =
  | {
      readonly kind: "idle";
      readonly reason:
        "owner_paused" | "paused_by_challenges" | "not_due" | "finished_today";
    }
  | { readonly kind: "start" }
  | { readonly kind: "resume" };

/**
 * `force` es «Barrer ahora» del popup: no espera la hora sorteada y relanza un
 * día detenido; nunca pasa por encima de una pausa ni de un desafío.
 */
export function decideSweep(
  state: PortalSweepState,
  now: string,
  portal: string,
  options: { readonly force?: boolean } = {},
): SweepDecision {
  if (state.ownerPaused) return { kind: "idle", reason: "owner_paused" };
  if (state.pausedByChallenges)
    return { kind: "idle", reason: "paused_by_challenges" };
  const today = buenosAiresDate(now);
  if (state.run !== null && state.run.date === today) {
    if (state.run.status === "running") return { kind: "resume" };
    // «Barrer ahora» relanza un día que se detuvo por el endpoint o la
    // ventana; un desafío no se fuerza nunca.
    if (options.force && state.run.status === "stopped")
      return { kind: "start" };
    return { kind: "idle", reason: "finished_today" };
  }
  if (!options.force && !sweepIsDue(now, portal))
    return { kind: "idle", reason: "not_due" };
  return { kind: "start" };
}

function archive(state: PortalSweepState): readonly SweepRun[] {
  return state.run === null || state.run.status === "running"
    ? state.history
    : [state.run, ...state.history].slice(0, KEPT_RUNS);
}

export function startRun(
  state: PortalSweepState,
  now: string,
  visits: readonly PlannedVisit[],
): PortalSweepState {
  return {
    ...state,
    history: archive(state),
    run: {
      date: buenosAiresDate(now),
      visits,
      next: 0,
      status: visits.length === 0 ? "done" : "running",
      startedAt: now,
      finishedAt: visits.length === 0 ? now : null,
      pages: 0,
      captures: 0,
      unread: 0,
      stopReason: null,
      pause: null,
    },
  };
}

export type VisitOutcome =
  | { readonly kind: "read"; readonly captures: number }
  | { readonly kind: "unread"; readonly reason: string }
  | { readonly kind: "challenge" };

/** Avanza el cursor con lo que pasó en la visita `run.next`. */
export function recordVisit(
  state: PortalSweepState,
  outcome: VisitOutcome,
  now: string,
  searchCount: number,
  rotationAfterEmpty: (
    cursor: RotationCursor,
    searchCount: number,
  ) => RotationCursor,
): PortalSweepState {
  const run = state.run;
  if (run === null || run.status !== "running") return state;
  const visit = run.visits[run.next];
  if (visit === undefined) return state;

  if (outcome.kind === "challenge") {
    const blockedDays = [...new Set([run.date, ...state.blockedDays])]
      .sort()
      .reverse();
    const yesterday = new Date(
      Date.parse(`${run.date}T12:00:00.000Z`) - 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    return {
      ...state,
      blockedDays: blockedDays.slice(0, KEPT_BLOCKED_DAYS),
      pausedByChallenges:
        state.pausedByChallenges || blockedDays.includes(yesterday),
      run: {
        ...run,
        pages: run.pages + 1,
        status: "blocked",
        finishedAt: now,
        stopReason: "challenge",
      },
    };
  }

  let rotation = state.rotation;
  if (visit.reason === "search_rotation") {
    rotation =
      outcome.kind === "read" && outcome.captures === 0
        ? rotationAfterEmpty(rotation, searchCount)
        : (visit.rotationAfter ?? rotation);
  }
  const next = run.next + 1;
  const finished = next >= run.visits.length;
  return {
    ...state,
    rotation,
    run: {
      ...run,
      next,
      pages: run.pages + 1,
      captures: run.captures + (outcome.kind === "read" ? outcome.captures : 0),
      unread: run.unread + (outcome.kind === "unread" ? 1 : 0),
      status: finished ? "done" : "running",
      finishedAt: finished ? now : null,
      pause: null,
    },
  };
}

/** Deja anotada una pausa larga antes de la visita actual. */
export function pauseRun(
  state: PortalSweepState,
  until: string,
): PortalSweepState {
  if (state.run === null || state.run.status !== "running") return state;
  return {
    ...state,
    run: { ...state.run, pause: { step: state.run.next, until } },
  };
}

/** El endpoint apagado o sin cuota: el barrido de hoy termina acá. */
export function stopRun(
  state: PortalSweepState,
  now: string,
  reason: string,
): PortalSweepState {
  if (state.run === null || state.run.status !== "running") return state;
  return {
    ...state,
    run: {
      ...state.run,
      status: "stopped",
      finishedAt: now,
      stopReason: reason,
    },
  };
}

/** El owner reactiva un portal pausado por desafíos. */
export function reactivate(state: PortalSweepState): PortalSweepState {
  return { ...state, pausedByChallenges: false, blockedDays: [] };
}

/**
 * Lo que la extensión recuerda de cada aviso capturado, para planear las
 * fichas a revisar: la URL, cuándo se leyó su ficha y cuándo se vio por
 * última vez. Lo que excede el tope se descarta empezando por lo visto hace
 * más tiempo.
 */
export function indexCaptures(
  index: readonly IndexedListing[],
  captures: readonly ListingCapture[],
): readonly IndexedListing[] {
  const byUrl = new Map(index.map((listing) => [listing.url, listing]));
  for (const capture of captures) {
    const current = byUrl.get(capture.canonicalUrl);
    const isDetail = capture.pageKind === "listing_detail";
    byUrl.set(capture.canonicalUrl, {
      url: capture.canonicalUrl,
      lastDetailAt: isDetail
        ? capture.capturedAt
        : (current?.lastDetailAt ?? null),
      lastSeenAt:
        current === undefined || capture.capturedAt > current.lastSeenAt
          ? capture.capturedAt
          : current.lastSeenAt,
    });
  }
  return [...byUrl.values()]
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
    .slice(0, MAX_INDEXED_LISTINGS);
}
