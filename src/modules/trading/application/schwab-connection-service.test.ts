import { describe, expect, it, vi } from "vitest";

import {
  completeSchwabConnection,
  provideSchwabAccessToken,
  readSchwabConnectionStatus,
  startSchwabConnection,
  type SchwabConnectionDependencies,
  type SchwabTokenResponse,
} from "@/modules/trading/application/schwab-connection-service";
import { hashOAuthState } from "@/modules/trading/domain/oauth-state";
import { openToken, sealToken } from "@/modules/trading/domain/token-envelope";
import { createInMemorySchwabConnectionStore } from "@/modules/trading/infrastructure/in-memory-schwab-connection-store";

const KEY = Buffer.alloc(32, 5);
const APP_KEY = "AppKeySynthetic0123456789abcdef";
const CALLBACK = "https://127.0.0.1:3443/cuenta/schwab/callback";
const T0 = "2026-11-13T15:00:00.000Z";
const ACCESS = "I0.synthetic-access-0001@";
const REFRESH = "synthetic-refresh-0001";
const CODE = "C0.synthetic-authorization-code@";

function tokenBody(access = ACCESS, refresh = REFRESH): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      expires_in: 1800,
      token_type: "Bearer",
      scope: "api",
      refresh_token: refresh,
      access_token: access,
      id_token: "eyJ.synthetic",
    }),
  );
}

function setup(
  options: {
    now?: string;
    blockedBy?: string[];
    responses?: (SchwabTokenResponse | Error)[];
  } = {},
) {
  const store = createInMemorySchwabConnectionStore();
  let now = options.now ?? T0;
  const queue = [...(options.responses ?? [])];
  const requestToken = vi.fn(async (form: Uint8Array) => {
    void form;
    const next = queue.shift();
    if (next === undefined) throw new Error("no scripted response");
    if (next instanceof Error) throw next;
    return next;
  });
  let ids = 0;
  const dependencies: SchwabConnectionDependencies = {
    store,
    tokenKey: KEY,
    requestToken,
    rightsBlockedBy: () => options.blockedBy ?? [],
    now: () => now,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  };

  return {
    store,
    requestToken,
    dependencies,
    setNow(value: string) {
      now = value;
    },
    formOf(call: number) {
      return new TextDecoder().decode(requestToken.mock.calls[call]![0]);
    },
  };
}

async function started(harness: ReturnType<typeof setup>) {
  const start = await startSchwabConnection(harness.dependencies, {
    appKey: APP_KEY,
    callbackUrl: CALLBACK,
  });
  if (start.outcome !== "redirect") throw new Error("expected a redirect");
  return start;
}

function callback(
  state: string,
  overrides: Partial<Parameters<typeof completeSchwabConnection>[2]> = {},
) {
  return {
    code: CODE,
    error: null,
    state,
    cookieState: state,
    requestId: "req-test",
    ...overrides,
  };
}

describe("startSchwabConnection", () => {
  it("issues a single-use state and points the owner at Schwab", async () => {
    const harness = setup();
    const start = await started(harness);
    const url = new URL(start.authorizeUrl);

    expect(url.searchParams.get("state")).toBe(start.state);
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK);
    expect(start.expiresAt).toBe("2026-11-13T15:10:00.000Z");
    expect(
      await harness.store.consumeState(hashOAuthState(start.state)!, T0),
    ).toBe(true);
  });

  it("does not start while the Schwab rights are pending", async () => {
    const harness = setup({
      blockedBy: ["approval_status:rights_review_pending"],
    });

    expect(
      await startSchwabConnection(harness.dependencies, {
        appKey: APP_KEY,
        callbackUrl: CALLBACK,
      }),
    ).toEqual({
      outcome: "rights_blocked",
      blockedBy: ["approval_status:rights_review_pending"],
    });
  });
});

describe("completeSchwabConnection", () => {
  it("exchanges the code and stores both tokens sealed", async () => {
    const harness = setup({ responses: [{ status: 200, body: tokenBody() }] });
    const start = await started(harness);

    expect(
      await completeSchwabConnection(
        harness.dependencies,
        { callbackUrl: CALLBACK },
        callback(start.state),
      ),
    ).toBe("connected");

    expect(harness.formOf(0)).toContain("grant_type=authorization_code");
    expect(harness.formOf(0)).toContain(
      `redirect_uri=${encodeURIComponent(CALLBACK)}`,
    );

    const stored = (await harness.store.readConnection())!;
    expect(stored.accessEnvelope.includes(Buffer.from(ACCESS))).toBe(false);
    expect(stored.refreshEnvelope.includes(Buffer.from(REFRESH))).toBe(false);
    expect(openToken(KEY, "access", stored.accessEnvelope)).toBe(ACCESS);
    expect(openToken(KEY, "refresh", stored.refreshEnvelope)).toBe(REFRESH);
    expect(stored).toMatchObject({
      accessExpiresAt: "2026-11-13T15:30:00.000Z",
      authorizedAt: T0,
      refreshExpiresAt: "2026-11-20T15:00:00.000Z",
    });
    expect(harness.store.events.map((event) => event.code)).toEqual([
      "connected",
    ]);
  });

  it.each([
    ["a cookie that does not match", { cookieState: "x".repeat(43) }],
    ["no cookie", { cookieState: null }],
    ["a malformed state", { state: "short", cookieState: "short" }],
  ])("rejects %s before any exchange", async (_, overrides) => {
    const harness = setup();
    const start = await started(harness);

    expect(
      await completeSchwabConnection(
        harness.dependencies,
        { callbackUrl: CALLBACK },
        callback(start.state, overrides),
      ),
    ).toBe("state_invalid");
    expect(harness.requestToken).not.toHaveBeenCalled();
  });

  it("uses a state once: a replayed callback is rejected", async () => {
    const harness = setup({ responses: [{ status: 200, body: tokenBody() }] });
    const start = await started(harness);
    const input = callback(start.state);

    await completeSchwabConnection(
      harness.dependencies,
      { callbackUrl: CALLBACK },
      input,
    );
    expect(
      await completeSchwabConnection(
        harness.dependencies,
        { callbackUrl: CALLBACK },
        input,
      ),
    ).toBe("state_invalid");
    expect(harness.requestToken).toHaveBeenCalledOnce();
  });

  it("rejects a state after its ten minutes", async () => {
    const harness = setup();
    const start = await started(harness);
    harness.setNow("2026-11-13T15:10:00.000Z");

    expect(
      await completeSchwabConnection(
        harness.dependencies,
        { callbackUrl: CALLBACK },
        callback(start.state),
      ),
    ).toBe("state_invalid");
  });

  it("consumes the state when the owner cancels at Schwab", async () => {
    const harness = setup();
    const start = await started(harness);

    expect(
      await completeSchwabConnection(
        harness.dependencies,
        { callbackUrl: CALLBACK },
        callback(start.state, { code: null, error: "access_denied" }),
      ),
    ).toBe("denied");
    expect(
      await harness.store.consumeState(hashOAuthState(start.state)!, T0),
    ).toBe(false);
  });

  it("rejects a malformed code without calling Schwab", async () => {
    const harness = setup();
    const start = await started(harness);

    expect(
      await completeSchwabConnection(
        harness.dependencies,
        { callbackUrl: CALLBACK },
        callback(start.state, { code: "bad code" }),
      ),
    ).toBe("code_invalid");
    expect(harness.requestToken).not.toHaveBeenCalled();
  });

  it.each([
    ["an HTTP error", { status: 401, body: new Uint8Array() }, "http_401"],
    [
      "an unexpected body",
      { status: 200, body: new TextEncoder().encode('{"access_token":1}') },
      "token_unexpected_shape",
    ],
    [
      "a door refusal",
      Object.assign(new Error("blocked"), { code: "credential_missing" }),
      "egress_credential_missing",
    ],
  ])(
    "records %s as a closed code and stores nothing",
    async (_, response, code) => {
      const harness = setup({ responses: [response] });
      const start = await started(harness);

      expect(
        await completeSchwabConnection(
          harness.dependencies,
          { callbackUrl: CALLBACK },
          callback(start.state),
        ),
      ).toBe("exchange_failed");
      expect(await harness.store.readConnection()).toBeNull();
      expect(harness.store.events.at(-1)).toMatchObject({
        kind: "exchange_failed",
        code,
        requestId: "req-test",
      });
    },
  );

  it("never writes a token, code or state into the log", async () => {
    const harness = setup({ responses: [{ status: 200, body: tokenBody() }] });
    const start = await started(harness);
    await completeSchwabConnection(
      harness.dependencies,
      { callbackUrl: CALLBACK },
      callback(start.state),
    );

    const log = JSON.stringify(harness.store.events);
    for (const secret of [ACCESS, REFRESH, CODE, start.state]) {
      expect(log).not.toContain(secret);
    }
  });
});

describe("provideSchwabAccessToken", () => {
  async function connected(
    responses: (SchwabTokenResponse | Error)[] = [],
    blockedBy: string[] = [],
  ) {
    const harness = setup({ responses, blockedBy });
    await harness.store.saveConnection({
      accessEnvelope: sealToken(KEY, "access", ACCESS),
      accessExpiresAt: "2026-11-13T15:30:00.000Z",
      refreshEnvelope: sealToken(KEY, "refresh", REFRESH),
      authorizedAt: T0,
      refreshExpiresAt: "2026-11-20T15:00:00.000Z",
      envelopeVersion: "schwab-token-envelope-1.0.0",
      updatedAt: T0,
    });
    return harness;
  }

  it("has nothing to give without a connection", async () => {
    expect(
      await provideSchwabAccessToken(setup().dependencies),
    ).toBeUndefined();
  });

  it("returns the stored access token while it is fresh, without calling Schwab", async () => {
    const harness = await connected();
    harness.setNow("2026-11-13T15:28:00.000Z");

    expect(await provideSchwabAccessToken(harness.dependencies)).toBe(ACCESS);
    expect(harness.requestToken).not.toHaveBeenCalled();
  });

  it("renews in its last minute and keeps the login's expiry", async () => {
    const harness = await connected([
      {
        status: 200,
        body: tokenBody("I0.synthetic-access-0002@", "synthetic-refresh-0002"),
      },
    ]);
    harness.setNow("2026-11-13T15:29:30.000Z");

    expect(await provideSchwabAccessToken(harness.dependencies)).toBe(
      "I0.synthetic-access-0002@",
    );
    expect(harness.formOf(0)).toBe(
      `grant_type=refresh_token&refresh_token=${REFRESH}`,
    );

    const stored = (await harness.store.readConnection())!;
    expect(stored).toMatchObject({
      accessExpiresAt: "2026-11-13T15:59:30.000Z",
      authorizedAt: T0,
      refreshExpiresAt: "2026-11-20T15:00:00.000Z",
    });
    expect(openToken(KEY, "refresh", stored.refreshEnvelope)).toBe(
      "synthetic-refresh-0002",
    );
  });

  it("renews once for two concurrent requests", async () => {
    const harness = await connected([
      { status: 200, body: tokenBody("I0.synthetic-access-0002@") },
    ]);
    harness.setNow("2026-11-13T15:31:00.000Z");

    const tokens = await Promise.all([
      provideSchwabAccessToken(harness.dependencies),
      provideSchwabAccessToken(harness.dependencies),
    ]);

    expect(tokens).toEqual([
      "I0.synthetic-access-0002@",
      "I0.synthetic-access-0002@",
    ]);
    expect(harness.requestToken).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "Schwab rejects the refresh",
      [{ status: 400, body: new Uint8Array() }],
      "http_400",
    ],
    [
      "the transport fails",
      [Object.assign(new Error("x"), { code: "transport_error" })],
      "egress_transport_error",
    ],
  ])("gives nothing when %s, and logs it", async (_, responses, code) => {
    const harness = await connected(responses);
    harness.setNow("2026-11-13T15:31:00.000Z");

    expect(
      await provideSchwabAccessToken(harness.dependencies),
    ).toBeUndefined();
    expect(harness.store.events.at(-1)).toMatchObject({
      kind: "refresh_failed",
      code,
    });
  });

  it("does not try to renew after the weekly login expired", async () => {
    const harness = await connected();
    harness.setNow("2026-11-20T15:00:00.000Z");

    expect(
      await provideSchwabAccessToken(harness.dependencies),
    ).toBeUndefined();
    expect(harness.requestToken).not.toHaveBeenCalled();
  });

  it("does not renew while the rights are pending", async () => {
    const harness = await connected(
      [],
      ["approval_status:rights_review_pending"],
    );
    harness.setNow("2026-11-13T15:31:00.000Z");

    expect(
      await provideSchwabAccessToken(harness.dependencies),
    ).toBeUndefined();
    expect(harness.requestToken).not.toHaveBeenCalled();
  });

  it("refuses an envelope sealed under another key", async () => {
    const harness = await connected();
    harness.setNow("2026-11-13T15:10:00.000Z");

    expect(
      await provideSchwabAccessToken({
        ...harness.dependencies,
        tokenKey: Buffer.alloc(32, 6),
      }),
    ).toBeUndefined();
    expect(harness.store.events.at(-1)).toMatchObject({
      kind: "refresh_failed",
      code: "envelope_authentication",
    });
  });
});

describe("readSchwabConnectionStatus", () => {
  it("reads the weekly expiry from the stored login", async () => {
    const harness = setup({ responses: [{ status: 200, body: tokenBody() }] });
    expect(await readSchwabConnectionStatus(harness.dependencies)).toEqual({
      status: "not_connected",
    });

    const start = await started(harness);
    await completeSchwabConnection(
      harness.dependencies,
      { callbackUrl: CALLBACK },
      callback(start.state),
    );
    harness.setNow("2026-11-19T16:00:00.000Z");

    expect(await readSchwabConnectionStatus(harness.dependencies)).toEqual({
      status: "expiring",
      connectedAt: T0,
      refreshExpiresAt: "2026-11-20T15:00:00.000Z",
      warnFrom: "2026-11-19T15:00:00.000Z",
    });
  });
});
