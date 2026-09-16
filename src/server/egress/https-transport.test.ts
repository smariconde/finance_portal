import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());

vi.mock("node:https", () => ({
  default: {
    request,
    Agent: class {
      destroy() {}
    },
  },
}));

import {
  CONNECT_ATTEMPT_TIMEOUT_MS,
  createHttpsTransport,
} from "./https-transport";

/**
 * El transporte real no se ejercita en la suite unitaria (sin red). Lo que se fija
 * acá es qué opciones le llegan a `https.request`: el `lookup` guardado y la
 * espera por dirección que evita el `ETIMEDOUT` prematuro de *happy eyeballs*.
 */
describe("createHttpsTransport", () => {
  beforeEach(() => {
    request.mockReset();
    request.mockImplementation(() => {
      const clientRequest = Object.assign(new EventEmitter(), {
        setTimeout: vi.fn(),
        destroy: vi.fn(),
        end: vi.fn(() => {
          queueMicrotask(() =>
            clientRequest.emit(
              "error",
              Object.assign(new Error(""), { code: "ETIMEDOUT" }),
            ),
          );
        }),
      });

      return clientRequest;
    });
  });

  it("conecta con el lookup guardado y cinco segundos por dirección", async () => {
    const transport = createHttpsTransport(async () => [
      { address: "192.0.2.1", family: 4 },
    ]);

    await expect(
      transport({
        url: new URL("https://data.sec.gov/submissions/CIK0000320193.json"),
        headers: {},
        maxResponseBytes: 10,
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ code: "transport_error" });

    expect(CONNECT_ATTEMPT_TIMEOUT_MS).toBe(5000);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]![1]).toMatchObject({
      method: "GET",
      lookup: expect.any(Function),
      autoSelectFamilyAttemptTimeout: 5000,
      minVersion: "TLSv1.2",
    });
  });

  it("nombra el código de un corte sin mensaje", async () => {
    const transport = createHttpsTransport(async () => [
      { address: "192.0.2.1", family: 4 },
    ]);

    await expect(
      transport({
        url: new URL(
          "https://data.sec.gov/api/xbrl/companyfacts/CIK0000004281.json",
        ),
        headers: {},
        maxResponseBytes: 10,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/transport_error.*ETIMEDOUT/u);
  });
});
