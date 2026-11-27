import { buenosAiresDate } from "../capture/status";
import { STALE_DETAIL_DAYS } from "./plan";
import { sweepStartAt } from "./schedule";
import type { PortalSweepState } from "./state";

/**
 * Lo que el popup dice del barrido de un portal: una línea de estado y la
 * cobertura (`listing-sweep-1.0.0`): páginas y avisos de hoy, búsquedas
 * cubiertas, seguidos y la ficha más vieja sin revisar.
 */
const STOP_REASONS: Readonly<Record<string, string>> = {
  challenge: "desafío del portal",
  disabled: "captura apagada en el portal",
  budget_exhausted: "tope diario del portal",
  unauthorized: "token o bypass inválido",
  not_served: "el portal no recibe capturas",
  window_closed: "se cerró la ventana",
  owner_paused: "pausado",
};

function clock(instant: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

export type SweepSummary = {
  readonly status: string;
  readonly coverage: readonly (readonly [string, string])[];
};

export function sweepSummary(
  state: PortalSweepState,
  now: string,
  portal: string,
  defaultSearchCount: number,
): SweepSummary {
  const today = buenosAiresDate(now);
  const run = state.run?.date === today ? state.run : null;

  let status: string;
  if (state.pausedByChallenges) status = "Pausado: desafíos dos días seguidos";
  else if (state.ownerPaused) status = "Pausado por el owner";
  else if (run === null) {
    const start = sweepStartAt(today, portal);
    status =
      Date.parse(now) < Date.parse(start)
        ? `Hoy a las ${clock(start)}`
        : "Empieza en minutos";
  } else if (run.status === "running")
    status =
      run.pause === null
        ? `Barriendo ${run.next}/${run.visits.length}`
        : `Pausa hasta ${clock(run.pause.until)} · ${run.next}/${run.visits.length}`;
  else if (run.status === "done")
    status = `Terminado ${clock(run.finishedAt ?? now)}`;
  else
    status = `${run.status === "blocked" ? "Bloqueado hoy" : "Detenido"}: ${
      STOP_REASONS[run.stopReason ?? ""] ?? run.stopReason ?? "—"
    }`;

  const searchCount =
    state.searches.length > 0 ? state.searches.length : defaultSearchCount;
  const searchesCovered =
    run === null
      ? 0
      : run.visits
          .slice(0, run.next)
          .filter((visit) => visit.reason === "search_first").length;
  const detailed = state.index
    .filter((listing) => listing.lastDetailAt !== null)
    .map((listing) => Date.parse(listing.lastDetailAt!));
  const oldestDays =
    detailed.length === 0
      ? null
      : Math.floor((Date.parse(now) - Math.min(...detailed)) / 86_400_000);

  return {
    status,
    coverage: [
      [
        "Páginas hoy",
        run === null ? "0" : `${run.pages} · ${run.unread} sin leer`,
      ],
      ["Avisos hoy", run === null ? "0" : String(run.captures)],
      [
        "Búsquedas",
        `${searchesCovered}/${searchCount}${state.searches.length === 0 ? " (por defecto)" : ""}`,
      ],
      ["Seguidos", String(state.followed.length)],
      [
        "Ficha más vieja",
        oldestDays === null
          ? "—"
          : `${oldestDays} días${oldestDays > STALE_DETAIL_DAYS ? " · por revisar" : ""}`,
      ],
      ["Avisos conocidos", String(state.index.length)],
    ],
  };
}

/**
 * Si «Barrer ahora» puede hacer algo hoy, y qué dice el botón. Un día
 * terminado o bloqueado ya gastó su tope: el botón lo dice en vez de no hacer
 * nada.
 */
export function runNowButton(
  state: PortalSweepState,
  now: string,
  portal: string,
): { readonly enabled: boolean; readonly label: string } {
  if (state.ownerPaused || state.pausedByChallenges)
    return { enabled: false, label: "Barrer ahora" };
  const today = buenosAiresDate(now);
  const run = state.run?.date === today ? state.run : null;
  if (run === null || run.status === "stopped")
    return { enabled: true, label: "Barrer ahora" };
  if (run.status === "running") return { enabled: false, label: "Barriendo…" };
  const tomorrow = new Date(Date.parse(`${today}T12:00:00.000Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    enabled: false,
    label: `Próximo: mañana ${clock(sweepStartAt(tomorrow, portal))}`,
  };
}
