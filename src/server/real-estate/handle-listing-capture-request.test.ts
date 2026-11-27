import { describe, expect, it, vi } from "vitest";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import type { SourceRequestVerdict } from "@/modules/ingestion/domain/source-budget";
import { parseMcpAccessToken } from "@/modules/owner-mcp/domain/mcp-access-token";
import {
  CAPTURE_EXTENSION_ORIGIN,
  CAPTURE_REQUEST_VERSION,
} from "@/modules/real-estate/domain/capture-request";
import { createInMemoryListingStore } from "@/modules/real-estate/infrastructure/in-memory-listing-store";
import { PRICE_CUTS_TWICE } from "@/modules/real-estate/infrastructure/synthetic-listings";

import {
  LISTING_CAPTURE_SOURCE_ID,
  handleListingCaptureRequest,
  type ListingCaptureRequestDependencies,
} from "./handle-listing-capture-request";

const TOKEN = Buffer.alloc(32, 11).toString("base64url");
const DIGEST = (() => {
  const parsed = parseMcpAccessToken(TOKEN);
  if (!parsed.ok) throw new Error("fixture token must parse");
  return parsed.digest;
})();
const PERSONAL = getConfigHealth({
  APP_MODE: "personal",
  APP_RUNTIME_ACCESS: "local",
  DATABASE_URL: "postgres://pooled",
  CAPTURE_TOKEN: TOKEN,
});

const [FIRST, SECOND] = PRICE_CUTS_TWICE.captures;

function dependencies(
  overrides: Partial<ListingCaptureRequestDependencies> = {},
) {
  const logs: unknown[] = [];
  const store = createInMemoryListingStore();
  const storeFactory = vi.fn(() => store);
  const consume = vi.fn(async (): Promise<SourceRequestVerdict> => ({
    status: "allowed",
    used: 1,
    remaining: 299,
  }));
  const deps: ListingCaptureRequestDependencies = {
    health: PERSONAL,
    tokenDigest: DIGEST,
    budget: { consume },
    store: storeFactory,
    requestId: "req-1",
    clock: () => "2026-11-27T21:00:00.000Z",
    log: (entry) => logs.push(entry),
    ...overrides,
  };
  return { deps, logs, store, storeFactory, consume };
}

function post(
  body: unknown,
  headers: Record<string, string> = {},
  method = "POST",
): Request {
  return new Request(
    "https://finance-portal-flame.vercel.app/api/inmuebles/captura",
    {
      method,
      headers: {
        origin: CAPTURE_EXTENSION_ORIGIN,
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
        ...headers,
      },
      body:
        method === "POST"
          ? typeof body === "string"
            ? body
            : JSON.stringify(body)
          : undefined,
    },
  );
}

const batch = (captures: unknown[]) => ({
  contract: CAPTURE_REQUEST_VERSION,
  adapterVersion: "remax-ng-state-1.0.0",
  captures,
});

describe("POST /api/inmuebles/captura", () => {
  it("aplica un lote y nombra cada resultado, idempotente al reenviar", async () => {
    const { deps, store, consume } = dependencies();
    const response = await handleListingCaptureRequest(
      post(batch([FIRST, SECOND])),
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(await response.json()).toEqual({
      contract: CAPTURE_REQUEST_VERSION,
      results: [{ outcome: "new_listing" }, { outcome: "revision" }],
    });
    expect(consume).toHaveBeenCalledWith(
      LISTING_CAPTURE_SOURCE_ID,
      "2026-11-27T21:00:00.000Z",
    );

    const again = await handleListingCaptureRequest(
      post(batch([SECOND])),
      deps,
    );
    expect(await again.json()).toMatchObject({
      results: [{ outcome: "out_of_order" }],
    });
    expect(store.snapshot()[0].revisions).toHaveLength(2);
  });

  it("una captura rota no frena a las demás y nombra el campo, no el valor", async () => {
    const { deps } = dependencies();
    const broken = {
      ...FIRST,
      priceAmount: "0",
      addressDeclared: "Tel 351 555 0000",
    };
    const response = await handleListingCaptureRequest(
      post(batch([broken, SECOND])),
      deps,
    );
    const body = await response.json();
    expect(body.results[0].outcome).toBe("rejected");
    expect(body.results[0].issues.join(" ")).toContain("priceAmount");
    expect(JSON.stringify(body)).not.toContain("351");
    expect(body.results[1].outcome).toBe("new_listing");
  });

  it("sin modo personal o sin token la ruta no existe y no abre la base", async () => {
    for (const overrides of [
      { tokenDigest: null },
      { health: getConfigHealth({ CAPTURE_TOKEN: TOKEN }) },
      {
        health: getConfigHealth({
          APP_MODE: "personal",
          APP_RUNTIME_ACCESS: "local",
          DATABASE_URL: "postgres://pooled",
        }),
      },
    ]) {
      const { deps, storeFactory, consume } = dependencies(overrides);
      const response = await handleListingCaptureRequest(
        post(batch([FIRST])),
        deps,
      );
      expect(response.status).toBe(404);
      expect(storeFactory).not.toHaveBeenCalled();
      expect(consume).not.toHaveBeenCalled();
    }
  });

  it("exige el Origin exacto de la extensión", async () => {
    for (const origin of [
      "https://evil.example",
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "",
    ]) {
      const { deps, storeFactory } = dependencies();
      const request = post(batch([FIRST]), origin === "" ? {} : { origin });
      if (origin === "") request.headers.delete("origin");
      const response = await handleListingCaptureRequest(request, deps);
      expect(response.status).toBe(403);
      expect(storeFactory).not.toHaveBeenCalled();
    }
  });

  it("sin el token correcto responde 401", async () => {
    for (const authorization of ["", "Bearer otro-token", `Basic ${TOKEN}`]) {
      const { deps, consume } = dependencies();
      const response = await handleListingCaptureRequest(
        post(batch([FIRST]), { authorization }),
        deps,
      );
      expect(response.status).toBe(401);
      expect(consume).not.toHaveBeenCalled();
    }
  });

  it("rechaza otro método, otro tipo, un cuerpo enorme y un pedido mal formado", async () => {
    const { deps } = dependencies();
    expect(
      (await handleListingCaptureRequest(post(null, {}, "GET"), deps)).status,
    ).toBe(405);
    expect(
      (
        await handleListingCaptureRequest(
          post(batch([FIRST]), { "content-type": "text/plain" }),
          deps,
        )
      ).status,
    ).toBe(415);
    expect(
      (await handleListingCaptureRequest(post("x".repeat(300 * 1024)), deps))
        .status,
    ).toBe(413);
    expect((await handleListingCaptureRequest(post("{no"), deps)).status).toBe(
      400,
    );
    for (const body of [
      { ...batch([FIRST]), extra: true },
      batch([]),
      batch(Array.from({ length: 51 }, () => FIRST)),
      { ...batch([FIRST]), contract: "otro-1.0.0" },
    ]) {
      expect((await handleListingCaptureRequest(post(body), deps)).status).toBe(
        400,
      );
    }
  });

  it("respeta el tope diario y el kill switch", async () => {
    const exhausted = dependencies({
      budget: {
        consume: async () => ({
          status: "daily_budget_exhausted",
          limit: 300,
          used: 300,
          resumesAt: "2026-11-28T00:00:00.000Z",
        }),
      },
    });
    const limited = await handleListingCaptureRequest(
      post(batch([FIRST])),
      exhausted.deps,
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("10800");
    expect(exhausted.storeFactory).not.toHaveBeenCalled();

    const disabled = dependencies({
      budget: {
        consume: async () => ({ status: "source_disabled", reason: "owner" }),
      },
    });
    expect(
      (await handleListingCaptureRequest(post(batch([FIRST])), disabled.deps))
        .status,
    ).toBe(503);
  });

  it("si la base falla a mitad del lote responde 503 sin detalles", async () => {
    const { deps } = dependencies({
      store: () => ({
        applyCapture: async () => {
          throw new Error("connect ECONNREFUSED 10.0.0.1:5432");
        },
        readListing: async () => null,
        listRecent: async () => [],
      }),
    });
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const response = await handleListingCaptureRequest(
      post(batch([FIRST])),
      deps,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("5432");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("5432");
    errors.mockRestore();
  });
});
