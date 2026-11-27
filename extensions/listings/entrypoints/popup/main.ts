import { browser } from "wxt/browser";

import { isDeclaredEndpointBase } from "../../capture/endpoint-origins";
import type {
  ExportedPage,
  SweepCommand,
  WorkerMessage,
} from "../../capture/messages";
import {
  EMPTY_QUEUE,
  type CaptureSettings,
  type QueueState,
} from "../../capture/queue";
import {
  EMPTY_STATUS,
  buenosAiresDate,
  type CaptureStatus,
} from "../../capture/status";
import { PORTAL_ADAPTERS, adapterFor } from "../../portals/registry";
import { effectiveCap } from "../../sweep/plan";
import { INITIAL_PORTAL_STATE, type PortalSweepState } from "../../sweep/state";
import { runNowButton, sweepSummary } from "../../sweep/summary";

const FAILURE_LABELS: Record<string, string> = {
  not_configured: "Falta la conexión",
  disabled: "Captura apagada en el portal",
  unauthorized: "Token o bypass inválido",
  not_served: "El portal no sirve capturas (modo o token)",
  budget_exhausted: "Tope diario alcanzado",
  server_unavailable: "Portal no disponible",
  network_error: "Sin red",
  response_invalid: "Respuesta inesperada",
  batch_rejected: "Lote rechazado por su forma",
};

const OUTCOME_LABELS: Record<string, string> = {
  new_listing: "Avisos nuevos",
  revision: "Revisiones",
  seen: "Vistos sin cambios",
  out_of_order: "Fuera de orden",
  rejected: "Rechazados",
};

const byId = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

function time(instant: string | null): string {
  if (instant === null) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(instant));
}

function fill(list: HTMLElement, rows: readonly (readonly [string, string])[]) {
  list.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      return [dt, dd];
    }),
  );
}

async function render() {
  const stored = await browser.storage.local.get([
    "queue",
    "status",
    "settings",
  ]);
  const queue = (stored.queue as QueueState | undefined) ?? EMPTY_QUEUE;
  const status = (stored.status as CaptureStatus | undefined) ?? EMPTY_STATUS;
  const settings = stored.settings as CaptureSettings | undefined;

  byId("queued").textContent =
    queue.dropped > 0
      ? `${queue.items.length} (${queue.dropped} descartadas)`
      : String(queue.items.length);
  byId("last-sent").textContent = time(status.lastSentAt);
  const failure = byId("last-failure");
  failure.textContent = status.lastFailure
    ? `${FAILURE_LABELS[status.lastFailure.failure] ?? status.lastFailure.failure} · ${time(status.lastFailure.at)}`
    : "Al día";
  failure.className = status.lastFailure ? "bad" : "ok";

  const today = status.days[buenosAiresDate(new Date().toISOString())] ?? {};
  fill(
    byId("today"),
    Object.entries(today).flatMap(([source, counters]) =>
      counters === undefined
        ? []
        : [
            [
              source,
              `${counters.pages} páginas · ${counters.captures} avisos`,
            ] as const,
            ["  desafíos", String(counters.challenges)] as const,
            [
              "  rechazos",
              String(
                Object.values(counters.rejectedPages).reduce(
                  (a, b) => a + b,
                  0,
                ),
              ),
            ] as const,
          ],
    ),
  );
  fill(
    byId("outcomes"),
    Object.entries(status.outcomes).map(
      ([outcome, count]) =>
        [OUTCOME_LABELS[outcome] ?? outcome, String(count)] as const,
    ),
  );

  if (settings !== undefined) {
    byId<HTMLInputElement>("endpoint").value = settings.endpointBase;
  } else {
    byId<HTMLDetailsElement>("settings-box").open = true;
  }
  await renderSweep();
}

/** Hoy hay un solo portal; el barrido se muestra para el primero. */
const SWEEP_ADAPTER = PORTAL_ADAPTERS[0]!;

async function sweepState(): Promise<PortalSweepState> {
  const key = `sweep:${SWEEP_ADAPTER.sourceId}`;
  const stored = (await browser.storage.local.get(key))[key] as
    PortalSweepState | undefined;
  return { ...INITIAL_PORTAL_STATE, ...stored };
}

async function sendSweep(command: SweepCommand): Promise<void> {
  const message: WorkerMessage = {
    type: "sweep_command",
    source: SWEEP_ADAPTER.sourceId,
    ...command,
  };
  await browser.runtime.sendMessage(message).catch(() => undefined);
  await render();
}

function listRows(
  list: HTMLElement,
  title: string,
  urls: readonly string[],
  remove: (url: string) => SweepCommand,
) {
  const heading = document.createElement("li");
  heading.className = "muted";
  heading.textContent = urls.length === 0 ? `${title}: ninguno` : title;
  list.replaceChildren(
    heading,
    ...urls.map((url) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent =
        new URL(url).pathname.replace("/listings/", "") + new URL(url).search;
      label.title = url;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Quitar";
      button.setAttribute("aria-label", `Quitar ${label.textContent}`);
      button.addEventListener("click", () => void sendSweep(remove(url)));
      item.append(label, button);
      return item;
    }),
  );
}

async function renderSweep() {
  const state = await sweepState();
  const summary = sweepSummary(
    state,
    new Date().toISOString(),
    SWEEP_ADAPTER.sourceId,
    SWEEP_ADAPTER.defaultSearches.length,
  );
  byId("sweep-status").textContent = summary.status;
  fill(byId("sweep-coverage"), summary.coverage);
  byId("sweep-toggle").textContent = state.ownerPaused ? "Reanudar" : "Pausar";
  const runNow = runNowButton(
    state,
    new Date().toISOString(),
    SWEEP_ADAPTER.sourceId,
  );
  const runNowButtonElement = byId<HTMLButtonElement>("sweep-now");
  runNowButtonElement.disabled = !runNow.enabled;
  runNowButtonElement.textContent = runNow.label;
  byId("sweep-reactivate-row").hidden = !state.pausedByChallenges;
  const cap = byId<HTMLInputElement>("sweep-cap");
  if (document.activeElement !== cap)
    cap.value = String(effectiveCap(state.cap));
  listRows(
    byId("sweep-searches"),
    "Búsquedas guardadas",
    state.searches,
    (url) => ({
      command: "remove_search",
      url,
    }),
  );
  listRows(
    byId("sweep-followed"),
    "Avisos seguidos",
    state.followed,
    (url) => ({
      command: "unfollow",
      url,
    }),
  );

  // Lo que se puede hacer con la pestaña abierta: seguir la ficha o guardar
  // el listado como búsqueda.
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const row = byId("sweep-page-row");
  const action = byId<HTMLButtonElement>("sweep-page-action");
  const url = tab?.url ?? "";
  const adapter = adapterFor(url);
  const kind = adapter === null ? null : adapter.pageKindOf(new URL(url));
  row.hidden = adapter?.sourceId !== SWEEP_ADAPTER.sourceId || kind === null;
  action.textContent =
    kind === "listing_detail" ? "Seguir este aviso" : "Guardar esta búsqueda";
  action.onclick = () =>
    void sendSweep(
      kind === "listing_detail"
        ? { command: "follow", url }
        : { command: "save_search", url },
    );
}

byId("sweep-toggle").addEventListener("click", async () => {
  const state = await sweepState();
  await sendSweep({ command: state.ownerPaused ? "resume" : "pause" });
});
byId("sweep-now").addEventListener(
  "click",
  () => void sendSweep({ command: "run_now" }),
);
byId("sweep-reactivate").addEventListener(
  "click",
  () => void sendSweep({ command: "reactivate" }),
);
byId<HTMLInputElement>("sweep-cap").addEventListener("change", (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value))
    void sendSweep({ command: "set_cap", cap: value });
});

byId<HTMLFormElement>("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = byId("settings-result");
  const endpointBase = byId<HTMLInputElement>("endpoint").value.trim();
  const token = byId<HTMLInputElement>("token").value.trim();
  const bypass = byId<HTMLInputElement>("bypass").value.trim();
  if (!isDeclaredEndpointBase(endpointBase)) {
    result.textContent =
      "El portal tiene que ser un origen declarado, terminado en «/».";
    return;
  }
  const previous = (await browser.storage.local.get("settings")).settings as
    CaptureSettings | undefined;
  const settings: CaptureSettings = {
    endpointBase,
    // Un campo vacío conserva el secreto guardado: el popup nunca lo muestra.
    captureToken: token || previous?.captureToken || "",
    vercelBypass: bypass || previous?.vercelBypass || "",
  };
  await browser.storage.local.set({ settings });
  byId<HTMLInputElement>("token").value = "";
  byId<HTMLInputElement>("bypass").value = "";
  result.textContent = "Guardado.";
  await render();
});

byId("flush").addEventListener("click", async () => {
  const message: WorkerMessage = { type: "flush_now" };
  await browser.runtime.sendMessage(message).catch(() => undefined);
  await render();
});

/**
 * Exporta la página abierta tal como la leyó el adapter, para congelarla con
 * `pnpm inmuebles:corpus` (ADR 0089, Decisión 10). El archivo queda en
 * Descargas; el reductor del repositorio borra lo personal antes de versionarlo.
 */
byId("export").addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  let exported: ExportedPage | undefined;
  try {
    exported = (await browser.tabs.sendMessage(tab.id, {
      type: "export_page",
    })) as ExportedPage | undefined;
  } catch {
    exported = undefined;
  }
  if (exported === undefined) {
    byId("last-failure").textContent = "Esta pestaña no es un portal declarado";
    return;
  }
  const blob = new Blob([JSON.stringify(exported)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${exported.source}-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

void render();
