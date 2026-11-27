import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import type { WorkerMessage } from "../capture/messages";
import {
  EMPTY_QUEUE,
  enqueue,
  nextBatch,
  sendBatch,
  settle,
  type CaptureSettings,
  type QueueState,
} from "../capture/queue";
import {
  EMPTY_STATUS,
  countFailure,
  countOutcomes,
  countPage,
  type CaptureStatus,
} from "../capture/status";

/**
 * El service worker: el único que envía (ADR 0089, «Envío»). Encola lo que
 * leen los content scripts, envía en lotes y reintenta cada cinco minutos con
 * `chrome.alarms` si el endpoint no respondió. Todo el estado vive en
 * `chrome.storage.local`, porque un service worker MV3 se duerme y se despierta
 * sin memoria.
 */
const FLUSH_ALARM = "flush-captures";
const FLUSH_PERIOD_MINUTES = 5;
/** Lotes por vaciado: lo que dos listados y unas fichas producen de una vez. */
const MAX_BATCHES_PER_FLUSH = 10;

export default defineBackground(() => {
  void browser.alarms.create(FLUSH_ALARM, {
    periodInMinutes: FLUSH_PERIOD_MINUTES,
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === FLUSH_ALARM) void serialized(flush);
  });

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    // Sólo nuestros content scripts y el popup hablan con el worker.
    if (sender.id !== browser.runtime.id) return;
    const typed = message as WorkerMessage;
    if (typed?.type === "page_read") {
      void serialized(async () => {
        await recordPage(typed);
        await flush();
      });
    } else if (typed?.type === "challenge_seen") {
      void serialized(() =>
        updateStatus((status) =>
          countPage(status, typed.source, new Date().toISOString(), {
            kind: "challenge",
          }),
        ),
      );
    } else if (typed?.type === "flush_now") {
      return serialized(flush).then(() => true);
    }
    return undefined;
  });
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
