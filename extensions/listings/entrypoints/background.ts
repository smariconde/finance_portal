import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import type { RealEstatePortal } from "../../../src/modules/real-estate/domain/listing-capture";
import type { SweepCommandMessage, WorkerMessage } from "../capture/messages";
import {
  EMPTY_QUEUE,
  enqueue,
  nextBatch,
  sendBatch,
  settle,
  type CaptureSettings,
  type QueueState,
  type SendFailure,
} from "../capture/queue";
import {
  EMPTY_STATUS,
  countFailure,
  countOutcomes,
  countPage,
  type CaptureStatus,
} from "../capture/status";
import { PORTAL_ADAPTERS } from "../portals/registry";
import { applySweepCommand } from "../sweep/commands";
import { sweepTick } from "../sweep/runner";
import {
  INITIAL_PORTAL_STATE,
  indexCaptures,
  type PortalSweepState,
  type VisitOutcome,
} from "../sweep/state";

/**
 * El service worker: el único que envía (ADR 0089, «Envío») y el que barre
 * (`listing-sweep-1.0.0`). Encola lo que leen los content scripts, envía en
 * lotes y reintenta cada cinco minutos; cada quince revisa si toca barrer.
 * Todo el estado vive en `chrome.storage.local`, porque un service worker MV3
 * se duerme y se despierta sin memoria.
 */
const FLUSH_ALARM = "flush-captures";
const FLUSH_PERIOD_MINUTES = 5;
const SWEEP_CHECK_ALARM = "sweep-check";
const SWEEP_CHECK_PERIOD_MINUTES = 15;
const SWEEP_WAKE_ALARM = "sweep-wake";
/** Lotes por vaciado: lo que dos listados y unas fichas producen de una vez. */
const MAX_BATCHES_PER_FLUSH = 10;
/** Lo que espera una página del barrido antes de darla por no leída. */
const VISIT_TIMEOUT_MS = 30_000;
/** Fallas del endpoint que cortan el barrido del día: guardar no va a andar. */
const STOPPING_FAILURES: ReadonlySet<SendFailure> = new Set([
  "disabled",
  "budget_exhausted",
  "unauthorized",
  "not_served",
]);

export default defineBackground(() => {
  void browser.alarms.create(FLUSH_ALARM, {
    periodInMinutes: FLUSH_PERIOD_MINUTES,
  });
  void browser.alarms.create(SWEEP_CHECK_ALARM, {
    periodInMinutes: SWEEP_CHECK_PERIOD_MINUTES,
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === FLUSH_ALARM) void serialized(flush);
    if (alarm.name === SWEEP_CHECK_ALARM || alarm.name === SWEEP_WAKE_ALARM)
      void sweepAll();
  });
  browser.runtime.onStartup.addListener(() => void sweepAll());

  browser.tabs.onRemoved.addListener((tabId) => {
    void sweepTabReady.then(async () => {
      if (tabId !== sweepTabId) return;
      await rememberSweepTab(null);
      // El owner cerró la pestaña del barrido: hoy no se insiste.
      windowClosedAt = new Date().toISOString();
      resolveWaiter({ kind: "unread", reason: "window_closed" });
    });
  });

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    // Sólo nuestros content scripts y el popup hablan con el worker.
    if (sender.id !== browser.runtime.id) return;
    const typed = message as WorkerMessage;
    const fromSweepTab =
      sender.tab?.id !== undefined && sender.tab.id === sweepTabId;
    if (typed?.type === "page_read") {
      if (fromSweepTab) resolveWaiter(outcomeOf(typed.reading));
      void serialized(async () => {
        await recordPage(typed);
        await flush();
      });
    } else if (typed?.type === "challenge_seen") {
      if (fromSweepTab) resolveWaiter({ kind: "challenge" });
      void serialized(() =>
        updateStatus((status) =>
          countPage(status, typed.source, new Date().toISOString(), {
            kind: "challenge",
          }),
        ),
      );
    } else if (typed?.type === "flush_now") {
      return serialized(flush).then(() => true);
    } else if (typed?.type === "sweep_command") {
      return handleSweepCommand(typed).then(() => true);
    }
    return undefined;
  });

  void sweepAll();
});

/** Un solo escritor a la vez sobre el storage: los mensajes llegan en ráfaga. */
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

async function readQueue(): Promise<QueueState> {
  const { queue } = await browser.storage.local.get("queue");
  return (queue as QueueState | undefined) ?? EMPTY_QUEUE;
}

async function readStatus(): Promise<CaptureStatus> {
  const { status } = await browser.storage.local.get("status");
  return (status as CaptureStatus | undefined) ?? EMPTY_STATUS;
}

async function readSettings(): Promise<CaptureSettings | null> {
  const { settings } = await browser.storage.local.get("settings");
  return (settings as CaptureSettings | undefined) ?? null;
}

async function updateStatus(
  change: (status: CaptureStatus) => CaptureStatus,
): Promise<void> {
  await browser.storage.local.set({ status: change(await readStatus()) });
}

async function recordPage(
  message: Extract<WorkerMessage, { type: "page_read" }>,
) {
  const now = new Date().toISOString();
  const reading = message.reading;
  if (reading.kind === "not_a_listing_page") return;
  if (reading.kind === "rejected") {
    await updateStatus((status) =>
      countPage(status, message.source, now, {
        kind: "rejected",
        reason: reading.reason,
      }),
    );
    return;
  }
  const queue = enqueue(
    await readQueue(),
    reading.captures.map((capture) => ({
      adapterVersion: message.adapterVersion,
      capture,
    })),
  );
  await browser.storage.local.set({ queue });
  await updateStatus((status) =>
    countPage(status, message.source, now, {
      kind: "captured",
      captures: reading.captures.length,
      skipped: reading.skipped,
    }),
  );
  await updateSweepState(message.source, (state) => ({
    ...state,
    index: indexCaptures(state.index, reading.captures),
  }));
}

async function flush(): Promise<void> {
  const settings = await readSettings();
  for (let round = 0; round < MAX_BATCHES_PER_FLUSH; round += 1) {
    const queue = await readQueue();
    const batch = nextBatch(queue);
    if (batch.length === 0) return;
    const result = await sendBatch(
      (input, init) => fetch(input, init),
      settings,
      batch,
    );
    const now = new Date().toISOString();
    if (result.kind === "failed") {
      await updateStatus((status) => countFailure(status, result.failure, now));
      return;
    }
    // Aceptado, o rechazado por su forma: en los dos casos reenviarlo no sirve.
    await browser.storage.local.set({ queue: settle(queue, batch) });
    await updateStatus((status) =>
      result.kind === "settled"
        ? countOutcomes(status, result.outcomes, now)
        : countFailure(status, "batch_rejected", now),
    );
  }
}

// ── Barrido ────────────────────────────────────────────────────────────────

const sweepKey = (portal: RealEstatePortal) => `sweep:${portal}`;

/** Un solo escritor a la vez sobre el estado del barrido. */
let sweepChain: Promise<unknown> = Promise.resolve();
function updateSweepState(
  portal: RealEstatePortal,
  change: (state: PortalSweepState) => PortalSweepState,
): Promise<PortalSweepState> {
  const run = sweepChain.then(async () => {
    const key = sweepKey(portal);
    const stored = (await browser.storage.local.get(key))[key] as
      PortalSweepState | undefined;
    const next = change({ ...INITIAL_PORTAL_STATE, ...stored });
    await browser.storage.local.set({ [key]: next });
    return next;
  });
  sweepChain = run.catch(() => undefined);
  return run;
}

async function handleSweepCommand(message: SweepCommandMessage): Promise<void> {
  const adapter = PORTAL_ADAPTERS.find(
    (candidate) => candidate.sourceId === message.source,
  );
  if (adapter === undefined) return;
  await updateSweepState(message.source, (state) =>
    applySweepCommand(state, adapter, message),
  );
  if (message.command === "run_now") void sweepPortal(message.source, true);
  if (message.command === "resume" || message.command === "reactivate")
    void sweepAll();
}

/**
 * La pestaña del barrido. Se guarda en `storage.session` porque un service
 * worker que se duerme en una pausa larga se despierta sin memoria: sin eso,
 * cada página abría otra pestaña (o, antes, otra ventana).
 */
const SWEEP_TAB_KEY = "sweepTab";
let sweepTabId: number | null = null;
let windowClosedAt: string | null = null;
let waiter: {
  readonly id: number;
  readonly resolve: (outcome: VisitOutcome) => void;
} | null = null;
let waiterSequence = 0;
const ticking = new Set<RealEstatePortal>();

const sweepTabReady = browser.storage.session
  .get(SWEEP_TAB_KEY)
  .then((stored) => {
    const id = stored[SWEEP_TAB_KEY];
    sweepTabId = typeof id === "number" ? id : null;
  })
  .catch(() => undefined);

async function rememberSweepTab(id: number | null) {
  sweepTabId = id;
  await browser.storage.session.set({ [SWEEP_TAB_KEY]: id });
}

function resolveWaiter(outcome: VisitOutcome, id?: number) {
  if (waiter === null || (id !== undefined && waiter.id !== id)) return;
  const { resolve } = waiter;
  waiter = null;
  resolve(outcome);
}

function outcomeOf(
  reading: Extract<WorkerMessage, { type: "page_read" }>["reading"],
): VisitOutcome {
  if (reading.kind === "captures")
    return { kind: "read", captures: reading.captures.length };
  return {
    kind: "unread",
    reason: reading.kind === "rejected" ? reading.reason : "not_a_listing_page",
  };
}

/** La pestaña del barrido si sigue abierta. */
async function liveSweepTab(): Promise<number | null> {
  await sweepTabReady;
  if (sweepTabId === null) return null;
  try {
    await browser.tabs.get(sweepTabId);
    return sweepTabId;
  } catch {
    await rememberSweepTab(null);
    return null;
  }
}

/**
 * Navega la pestaña del barrido y espera la lectura del content script de esa
 * pestaña; las pestañas del owner nunca resuelven la espera.
 *
 * Es una pestaña **en segundo plano** en una ventana del perfil, no una
 * ventana propia: en Hyprland (Omarchy) no hay ventanas minimizadas y una
 * ventana nueva entra en el mosaico del escritorio. Sólo si el perfil no tiene
 * ninguna ventana abierta se crea una, sin foco.
 */
async function visit(url: string): Promise<VisitOutcome> {
  const id = (waiterSequence += 1);
  const loaded = new Promise<VisitOutcome>((resolve) => {
    waiter = { id, resolve };
    setTimeout(
      () => resolveWaiter({ kind: "unread", reason: "timeout" }, id),
      VISIT_TIMEOUT_MS,
    );
  });
  try {
    const tabId = await liveSweepTab();
    if (tabId !== null) {
      await browser.tabs.update(tabId, { url, active: false });
    } else {
      const windows = await browser.windows.getAll({ windowTypes: ["normal"] });
      const target =
        windows.find((candidate) => candidate.focused) ?? windows[0] ?? null;
      if (target?.id !== undefined) {
        const tab = await browser.tabs.create({
          windowId: target.id,
          url,
          active: false,
          index: 0,
        });
        await rememberSweepTab(tab.id ?? null);
      } else {
        const created = await browser.windows.create({ url, focused: false });
        const [tab] =
          created?.id === undefined
            ? []
            : await browser.tabs.query({ windowId: created.id });
        await rememberSweepTab(tab?.id ?? null);
      }
    }
  } catch {
    await rememberSweepTab(null);
    resolveWaiter({ kind: "unread", reason: "navigation_failed" }, id);
  }
  return loaded;
}

/** Al terminar, la pestaña del barrido se cierra (y con ella la ventana que haya creado). */
async function closeSweepTab() {
  const tabId = await liveSweepTab();
  await rememberSweepTab(null);
  if (tabId === null) return;
  try {
    await browser.tabs.remove(tabId);
  } catch {
    // Ya estaba cerrada.
  }
}

async function sweepPortal(portal: RealEstatePortal, force = false) {
  const adapter = PORTAL_ADAPTERS.find(
    (candidate) => candidate.sourceId === portal,
  );
  if (adapter === undefined || ticking.has(portal)) return;
  ticking.add(portal);
  try {
    await sweepTick(
      adapter,
      {
        now: () => new Date().toISOString(),
        loadState: (key) => updateSweepState(key, (state) => state),
        // El barrido es dueño de su corrida y su cursor; el índice, los
        // seguidos, las búsquedas y la pausa del owner se conservan.
        saveState: async (key, next) => {
          await updateSweepState(key, (current) => ({
            ...current,
            run: next.run,
            rotation: next.rotation,
            blockedDays: next.blockedDays,
            pausedByChallenges: next.pausedByChallenges,
            history: next.history,
          }));
        },
        visit,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        wakeAt: async (instant) => {
          await browser.alarms.create(SWEEP_WAKE_ALARM, {
            when: Date.parse(instant),
          });
        },
        externalStop: async (since) => {
          if (windowClosedAt !== null && windowClosedAt >= since)
            return "window_closed";
          const failure = (await readStatus()).lastFailure;
          if (
            failure !== null &&
            failure.at >= since &&
            failure.failure !== "batch_rejected" &&
            STOPPING_FAILURES.has(failure.failure)
          )
            return failure.failure;
          return null;
        },
        finish: closeSweepTab,
      },
      { force },
    );
  } finally {
    ticking.delete(portal);
  }
}

async function sweepAll() {
  // En serie: una pestaña, un portal a la vez.
  for (const adapter of PORTAL_ADAPTERS) await sweepPortal(adapter.sourceId);
}
