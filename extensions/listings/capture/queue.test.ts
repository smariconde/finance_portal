import { describe, expect, it, vi } from "vitest";

import { CAPTURE_REQUEST_VERSION } from "../../../src/modules/real-estate/domain/capture-request";
import type { ListingCapture } from "../../../src/modules/real-estate/domain/listing-capture";

import { isDeclaredEndpointBase } from "./endpoint-origins";
import {
  EMPTY_QUEUE,
  MAX_QUEUED_CAPTURES,
  enqueue,
  nextBatch,
  sendBatch,
  settle,
  type QueuedCapture,
} from "./queue";

function capture(
  id: number,
  overrides: Partial<ListingCapture> = {},
): QueuedCapture {
  return {
    adapterVersion: "remax-ng-state-1.0.0",
    capture: {
      source: "remax-ar",
      externalId: `id-${id}`,
      canonicalUrl: `https://www.remax.com.ar/listings/aviso-${id}`,
      pageKind: "search_result",
      parseBasis: "embedded_state",
      operation: "sale",
      propertyType: "house",
      priceAmount: "100000",
      priceStatus: "published",
      priceCurrency: "USD",
      expensesAmount: null,
      expensesCurrency: null,
      coveredAreaM2: null,
      totalAreaM2: null,
      landAreaM2: null,
      rooms: null,
      bedrooms: null,
      bathrooms: null,
      parkingSpaces: null,
      ageYears: null,
      floor: null,
      amenities: [],
      condition: "unknown",
      legalFlags: [],
      addressDeclared: null,
      neighborhood: null,
      latitude: null,
      longitude: null,
      agency: null,
      publishedAt: null,
      descriptionSimhash: null,
      photoDhashes: [],
      photoCount: 0,
      capturedAt: "2026-11-27T20:00:00.000Z",
      ...overrides,
    },
  };
}

const SETTINGS = {
  endpointBase: "https://finance-portal-flame.vercel.app/",
  captureToken: "token-de-prueba",
  vercelBypass: "bypass-de-prueba",
};

function respond(status: number, body?: unknown) {
  return vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      }),
  );
}

describe("listing-capture-queue-1.0.0", () => {
  it("una misma ficha vista dos veces queda una sola vez, la última", () => {
    const first = capture(1, { priceAmount: "100000" });
    const second = capture(1, { priceAmount: "95000" });
    const state = enqueue(enqueue(EMPTY_QUEUE, [first, capture(2)]), [second]);
    expect(state.items.map((item) => item.capture.priceAmount)).toEqual([
      "100000",
      "95000",
    ]);
    expect(state.items.map((item) => item.capture.externalId)).toEqual([
      "id-2",
      "id-1",
    ]);
  });

  it("con la cola llena descarta lo más viejo y lo cuenta", () => {
    const many = Array.from({ length: MAX_QUEUED_CAPTURES + 3 }, (_, index) =>
      capture(index),
    );
    const state = enqueue(EMPTY_QUEUE, many);
    expect(state.items).toHaveLength(MAX_QUEUED_CAPTURES);
    expect(state.dropped).toBe(3);
    expect(state.items[0].capture.externalId).toBe("id-3");
  });

  it("arma lotes de hasta 50 de una misma versión de adapter", () => {
    const items = [
      ...Array.from({ length: 60 }, (_, index) => capture(index)),
      { ...capture(99), adapterVersion: "remax-ng-state-2.0.0" },
    ];
    const state = enqueue(EMPTY_QUEUE, items);
    const batch = nextBatch(state);
    expect(batch).toHaveLength(50);
    const rest = settle(state, batch);
    expect(nextBatch(rest)).toHaveLength(10);
    expect(nextBatch(settle(rest, nextBatch(rest)))[0].adapterVersion).toBe(
      "remax-ng-state-2.0.0",
    );
  });

  it("envía con los dos secretos y sin cookies", async () => {
    const fetchFn = respond(200, {
      contract: CAPTURE_REQUEST_VERSION,
      results: [{ outcome: "new_listing" }, { outcome: "seen" }],
    });
    const result = await sendBatch(fetchFn, SETTINGS, [capture(1), capture(2)]);
    expect(result).toEqual({
      kind: "settled",
      outcomes: { new_listing: 1, seen: 1 },
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://finance-portal-flame.vercel.app/api/inmuebles/captura",
    );
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      headers: {
        Authorization: "Bearer token-de-prueba",
        "x-vercel-protection-bypass": "bypass-de-prueba",
      },
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      contract: CAPTURE_REQUEST_VERSION,
      adapterVersion: "remax-ng-state-1.0.0",
    });
  });

  it("sin configurar no sale nada", async () => {
    const fetchFn = respond(200);
    for (const settings of [
      null,
      { ...SETTINGS, captureToken: "" },
      { ...SETTINGS, endpointBase: "https://evil.example/" },
    ]) {
      expect(await sendBatch(fetchFn, settings, [capture(1)])).toEqual({
        kind: "failed",
        failure: "not_configured",
      });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("nombra cada respuesta que no es un éxito", async () => {
    const cases: [number, unknown][] = [
      [401, { kind: "failed", failure: "unauthorized" }],
      [403, { kind: "failed", failure: "unauthorized" }],
      [404, { kind: "failed", failure: "not_served" }],
      [429, { kind: "failed", failure: "budget_exhausted" }],
      [503, { kind: "failed", failure: "server_unavailable" }],
      [400, { kind: "batch_rejected", status: 400 }],
      [302, { kind: "failed", failure: "response_invalid" }],
    ];
    for (const [status, expected] of cases) {
      expect(await sendBatch(respond(status), SETTINGS, [capture(1)])).toEqual(
        expected,
      );
    }
    const throwing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await sendBatch(throwing, SETTINGS, [capture(1)])).toEqual({
      kind: "failed",
      failure: "network_error",
    });
    const short = respond(200, {
      contract: CAPTURE_REQUEST_VERSION,
      results: [],
    });
    expect(await sendBatch(short, SETTINGS, [capture(1)])).toEqual({
      kind: "failed",
      failure: "response_invalid",
    });
  });

  it("sólo acepta orígenes declarados como base", () => {
    expect(
      isDeclaredEndpointBase("https://finance-portal-flame.vercel.app/"),
    ).toBe(true);
    expect(isDeclaredEndpointBase("http://127.0.0.1:3000/")).toBe(true);
    expect(isDeclaredEndpointBase("http://localhost:3120/")).toBe(true);
    expect(
      isDeclaredEndpointBase("http://finance-portal-flame.vercel.app/"),
    ).toBe(false);
    expect(
      isDeclaredEndpointBase("https://finance-portal-flame.vercel.app/x"),
    ).toBe(false);
    expect(
      isDeclaredEndpointBase("https://u:p@finance-portal-flame.vercel.app/"),
    ).toBe(false);
    expect(isDeclaredEndpointBase("https://otro.vercel.app/")).toBe(false);
  });
});
