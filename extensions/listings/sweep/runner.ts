import type { RealEstatePortal } from "../../../src/modules/real-estate/domain/listing-capture";
import type { PortalAdapter } from "../portals/types";
import { effectiveCap, planSweep, rotationAfterEmptyPage } from "./plan";
import { delayBeforeStep } from "./schedule";
import {
  decideSweep,
  pauseRun,
  recordVisit,
  startRun,
  stopRun,
  type PortalSweepState,
  type VisitOutcome,
} from "./state";

/**
 * Un paso del barrido de un portal (`listing-sweep-1.0.0`). Lo llama el
 * service worker al despertar —una alarma periódica, la alarma de una pausa
 * larga o el arranque de Brave— y hace lo que corresponde hasta que termina,
 * se bloquea, se detiene o llega una pausa larga, que deja anotada con su
 * alarma. El estado se guarda después de **cada** visita, así un worker que
 * muere a mitad de camino retoma desde el cursor.
 *
 * Todo lo que toca el navegador entra por `SweepDependencies`: los tests lo
 * corren con dobles.
 */
export type SweepDependencies = {
  readonly now: () => string;
  readonly loadState: (portal: RealEstatePortal) => Promise<PortalSweepState>;
  readonly saveState: (
    portal: RealEstatePortal,
    state: PortalSweepState,
  ) => Promise<void>;
  /** Navega la pestaña del barrido (la crea en su ventana si hace falta) y espera la lectura. */
  readonly visit: (url: string) => Promise<VisitOutcome>;
  /** Espera corta dentro del worker (8–15 s). */
  readonly sleep: (ms: number) => Promise<void>;
  /** Pide que el worker despierte en ese instante (pausa larga). */
  readonly wakeAt: (instant: string) => Promise<void>;
  /**
   * Por qué hay que cortar desde `since`, o `null`: el endpoint apagado o sin
   * cuota, o la ventana del barrido que cerró el owner.
   */
  readonly externalStop: (since: string) => Promise<string | null>;
  /** Cierra la ventana del barrido cuando no queda nada por hacer. */
  readonly finish: () => Promise<void>;
};

export type SweepTickResult =
  | { readonly kind: "idle"; readonly reason: string }
  | { readonly kind: "paused_until"; readonly until: string }
  | { readonly kind: "ended"; readonly status: string };

export async function sweepTick(
  adapter: PortalAdapter,
  deps: SweepDependencies,
  options: { readonly force?: boolean } = {},
): Promise<SweepTickResult> {
  const portal = adapter.sourceId;
  let state = await deps.loadState(portal);
  const decision = decideSweep(state, deps.now(), portal, options);
  if (decision.kind === "idle")
    return { kind: "idle", reason: decision.reason };

  if (decision.kind === "start") {
    const searches =
      state.searches.length > 0 ? state.searches : adapter.defaultSearches;
    state = startRun(
      state,
      deps.now(),
      planSweep({
        now: deps.now(),
        cap: effectiveCap(state.cap),
        followed: state.followed,
        searches,
        searchPageUrl: adapter.searchPageUrl,
        index: state.index,
        rotation: state.rotation,
      }),
    );
    await deps.saveState(portal, state);
  }

  const searchCount = (
    state.searches.length > 0 ? state.searches : adapter.defaultSearches
  ).length;

  while (state.run !== null && state.run.status === "running") {
    const run = state.run;
    const stop = await deps.externalStop(run.startedAt);
    if (stop !== null) {
      state = stopRun(state, deps.now(), stop);
      await deps.saveState(portal, state);
      break;
    }

    const pauseServed =
      run.pause !== null &&
      run.pause.step === run.next &&
      Date.parse(deps.now()) >= Date.parse(run.pause.until);
    if (run.pause !== null && run.pause.step === run.next && !pauseServed) {
      await deps.wakeAt(run.pause.until);
      return { kind: "paused_until", until: run.pause.until };
    }
    if (!pauseServed) {
      const delay = delayBeforeStep(run.date, portal, run.next);
      if (delay.long) {
        const until = new Date(Date.parse(deps.now()) + delay.ms).toISOString();
        state = pauseRun(state, until);
        await deps.saveState(portal, state);
        await deps.wakeAt(until);
        return { kind: "paused_until", until };
      }
      if (delay.ms > 0) await deps.sleep(delay.ms);
    }

    const visit = run.visits[run.next];
    const outcome = await deps.visit(visit.url);
    // Se relee: mientras la página cargaba, la captura actualizó el índice.
    const fresh = await deps.loadState(portal);
    state = recordVisit(
      { ...fresh, run: state.run, rotation: state.rotation },
      outcome,
      deps.now(),
      searchCount,
      rotationAfterEmptyPage,
    );
    await deps.saveState(portal, state);
    if (fresh.ownerPaused && state.run?.status === "running") {
      state = stopRun(state, deps.now(), "owner_paused");
      await deps.saveState(portal, state);
    }
  }

  await deps.finish();
  return { kind: "ended", status: state.run?.status ?? "none" };
}
