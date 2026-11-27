import type { SweepCommand } from "../capture/messages";
import type { PortalAdapter } from "../portals/types";
import { MAX_PAGES_PER_PORTAL_PER_DAY } from "./plan";
import { reactivate, type PortalSweepState } from "./state";

/** Seguidos y búsquedas tienen tope: un día barre 25 páginas como mucho. */
export const MAX_FOLLOWED = 20;
export const MAX_SEARCHES = 10;

/**
 * Aplica una orden del popup al estado del barrido de un portal. Puro: una URL
 * que no es de ese portal, o que no es una ficha o un listado según el
 * adapter, no entra.
 */
export function applySweepCommand(
  state: PortalSweepState,
  adapter: PortalAdapter,
  command: SweepCommand,
): PortalSweepState {
  switch (command.command) {
    case "pause":
      return { ...state, ownerPaused: true };
    case "resume":
      return { ...state, ownerPaused: false };
    case "reactivate":
      return reactivate(state);
    case "run_now":
      return state;
    case "set_cap":
      return {
        ...state,
        cap:
          command.cap === null
            ? null
            : Math.max(
                0,
                Math.min(Math.trunc(command.cap), MAX_PAGES_PER_PORTAL_PER_DAY),
              ),
      };
    case "follow": {
      if (!URL.canParse(command.url)) return state;
      const url = new URL(command.url);
      if (adapter.pageKindOf(url) !== "listing_detail") return state;
      const canonical = `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
      if (state.followed.includes(canonical)) return state;
      return {
        ...state,
        followed: [...state.followed, canonical].slice(-MAX_FOLLOWED),
      };
    }
    case "unfollow":
      return {
        ...state,
        followed: state.followed.filter((url) => url !== command.url),
      };
    case "save_search": {
      const search = adapter.normalizeSearch(command.url);
      if (search === null || state.searches.includes(search)) return state;
      return {
        ...state,
        searches: [...state.searches, search].slice(-MAX_SEARCHES),
      };
    }
    case "remove_search":
      return {
        ...state,
        searches: state.searches.filter((url) => url !== command.url),
      };
  }
}
