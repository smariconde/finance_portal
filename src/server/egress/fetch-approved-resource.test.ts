import { describe, expect, it, vi } from "vitest";

import {
  egressAllowlistEntrySchema,
  EgressBlockedError,
  type EgressAllowlistEntry,
  type EgressRejectionCode,
} from "@/server/egress/egress-policy";
import {
  fetchApprovedResource,
  type FetchApprovedResourceDependencies,
} from "@/server/egress/fetch-approved-resource";
import type {
  EgressHopResponse,
  EgressTransport,
} from "@/server/egress/https-transport";

const ENTRY: EgressAllowlistEntry = egressAllowlistEntrySchema.parse({
  sourceId: "sec-edgar",
  origins: [
    {
      host: "data.sec.gov",
      pathPrefixes: ["/api/xbrl/companyfacts/", "/submissions/"],
    },
    { host: "www.sec.gov", pathPrefixes: ["/files/"] },
  ],
  maxResponseBytes: 1024 * 1024,
  deadlineMs: 30_000,
  maxRedirects: 2,
});

const USER_AGENT = "Portal Financiero owner@example.test";
const APPROVED_URL = "https://data.sec.gov/submissions/CIK0000320193.json";

function ok(body = "{}"): EgressHopResponse {
  return {
    status: 200,
    location: null,
    contentType: "application/json",
    retryAfter: null,
    body: new TextEncoder().encode(body),
  };
}

function redirect(location: string, status = 301): EgressHopResponse {
  return {
    status,
    location,
    contentType: null,
    retryAfter: null,
    body: new Uint8Array(),
  };
}

type Harness = {
  dependencies: FetchApprovedResourceDependencies;
  transport: ReturnType<typeof vi.fn<EgressTransport>>;
  advance: (ms: number) => void;
};

function harness(responses: readonly EgressHopResponse[]): Harness {
  const queue = [...responses];
  const transport = vi.fn<EgressTransport>(async () => {
    const next = queue.shift();

    if (next === undefined) {
      throw new Error("The transport was called more times than expected.");
    }

    return next;
  });

  let elapsed = 0;

  return {
    transport,
    advance: (ms) => {
      elapsed += ms;
    },
    dependencies: {
      transport,
      now: () => "2026-09-05T00:00:00.000Z",
      elapsedMs: () => elapsed,
      findEntry: (sourceId) => (sourceId === ENTRY.sourceId ? ENTRY : null),
    },
  };
}

async function expectBlocked(
  operation: Promise<unknown>,
  code: EgressRejectionCode,
): Promise<void> {
  await expect(operation).rejects.toBeInstanceOf(EgressBlockedError);
  await operation.catch((error: unknown) => {
    expect((error as EgressBlockedError).code).toBe(code);
  });
}

describe("fetchApprovedResource", () => {
  it("fetches an approved resource and reports its provenance", async () => {
    const { dependencies, transport } = harness([ok('{"cik":320193}')]);

    const response = await fetchApprovedResource(
      { sourceId: "sec-edgar", url: APPROVED_URL, userAgent: USER_AGENT },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(response.body)).toBe('{"cik":320193}');
    expect(response.byteLength).toBe(14);
    expect(response.chain).toEqual([APPROVED_URL]);
    expect(response.fetchedAt).toBe("2026-09-05T00:00:00.000Z");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("refuses a source that is not on the allowlist without calling the transport", async () => {
    const { dependencies, transport } = harness([ok()]);

    await expectBlocked(
      fetchApprovedResource(
        {
          sourceId: "alpaca-market-data",
          url: "https://data.alpaca.markets/v2/stocks/AAPL/bars",
          userAgent: USER_AGENT,
        },
        dependencies,
      ),
      "source_not_allowlisted",
    );

    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses a URL outside the allowlist without calling the transport", async () => {
    // El control tiene que cortar antes del socket, no después de la respuesta:
    // una petición emitida ya filtró que este runtime existe.
    const cases: ReadonlyArray<[string, EgressRejectionCode]> = [
      ["http://data.sec.gov/submissions/x.json", "scheme_not_https"],
      ["https://attacker.example/submissions/x.json", "host_not_allowlisted"],
      ["https://data.sec.gov/cgi-bin/browse-edgar", "path_not_allowlisted"],
      ["https://127.0.0.1/submissions/x.json", "host_is_ip_literal"],
    ];

    for (const [url, code] of cases) {
      const { dependencies, transport } = harness([ok()]);

      await expectBlocked(
        fetchApprovedResource(
          { sourceId: "sec-edgar", url, userAgent: USER_AGENT },
          dependencies,
        ),
        code,
      );

      expect(transport).not.toHaveBeenCalled();
    }
  });

  it("requires a user agent, because Fair Access has no anonymous default", async () => {
    const { dependencies, transport } = harness([ok()]);

    await expectBlocked(
      fetchApprovedResource(
        { sourceId: "sec-edgar", url: APPROVED_URL, userAgent: "   " },
        dependencies,
      ),
      "user_agent_missing",
    );

    expect(transport).not.toHaveBeenCalled();
  });

  it("sends the declared identification and asks for no compression", async () => {
    const { dependencies, transport } = harness([ok()]);

    await fetchApprovedResource(
      { sourceId: "sec-edgar", url: APPROVED_URL, userAgent: USER_AGENT },
      dependencies,
    );

    const [hop] = transport.mock.calls[0];

    expect(hop.headers["user-agent"]).toBe(USER_AGENT);
    // El techo de bytes se aplica sobre lo que se recibe; un cuerpo comprimido
    // escondería su tamaño real detrás de la descompresión.
    expect(hop.headers["accept-encoding"]).toBe("identity");
    expect(hop.maxResponseBytes).toBe(ENTRY.maxResponseBytes);
  });

  it("re-authorizes every redirect against the same allowlist", async () => {
    const { dependencies, transport } = harness([
      redirect("https://attacker.example/submissions/x.json"),
      ok(),
    ]);

    await expectBlocked(
      fetchApprovedResource(
        { sourceId: "sec-edgar", url: APPROVED_URL, userAgent: USER_AGENT },
        dependencies,
      ),
      "host_not_allowlisted",
    );

    // La segunda petición nunca se emite: la cadena corta en la autorización.
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect that leaves the allowlisted path on an allowlisted host", async () => {
    const { dependencies } = harness([
      redirect("/cgi-bin/browse-edgar?action=getcompany", 302),
    ]);

    await expectBlocked(
      fetchApprovedResource(
        { sourceId: "sec-edgar", url: APPROVED_URL, userAgent: USER_AGENT },
        dependencies,
      ),
      "path_not_allowlisted",
    );
  });

  it("downgrades a redirect to plain HTTP into a refusal", async () => {
    const { dependencies } = harness([
      redirect("http://data.sec.gov/submissions/x.json", 307),
    ]);

    await expectBlocked(
      fetchApprovedResource(
        { sourceId: "sec-edgar", url: APPROVED_URL, userAgent: USER_AGENT },
        dependencies,
      ),
      "scheme_not_https",
    );
  });

  it("follows an allowlisted redirect and records the chain", async () => {
    const { dependencies, transport } = harness([
      redirect("https://www.sec.gov/files/company_tickers_exchange.json", 301),
      ok('{"fields":[]}'),
    ]);

    const response = await fetchApprovedResource(
      {
        sourceId: "sec-edgar",
        url: "https://data.sec.gov/submissions/CIK0000320193.json",
        userAgent: USER_AGENT,
      },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(response.chain).toEqual([
      "https://data.sec.gov/submissions/CIK0000320193.json",
      "https://www.sec.gov/files/company_tickers_exchange.json",
    ]);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("stops the chain at the declared redirect budget", async () => {
    const { dependencies, transport } = harness([
      redirect("/submissions/1.json"),
      redirect("/submissions/2.json"),
      redirect("/submissions/3.json"),
    ]);

    await expectBlocked(
      fetchApprovedResource(
        { sourceId: "sec-edgar", url: APPROVED_URL, userAgent: USER_AGENT },
        dependencies,
      ),
      "too_many_redirects",
    );

    // Petición original más los dos redirects que autoriza la entrada.
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("refuses a redirect that declares no location", async () => {
    const { dependencies } = harness([
      { ...redirect(""), location: null, status: 302 },
    ]);

    await expectBlocked(
      fetchApprovedResource(
        { sourceId: "sec-edgar", url: APPROVED_URL, userAgent: USER_AGENT },
        dependencies,
      ),
      "redirect_without_location",
    );
  });

  it("spends one budget across the whole chain instead of one per hop", async () => {
    // Un timeout por salto deja que una cadena de redirects multiplique el
    // presupuesto. El deadline se mide sobre la operación completa.
    const { dependencies, transport, advance } = harness([
      redirect("/submissions/1.json"),
      ok(),
    ]);

    transport.mockImplementation(async () => {
      advance(20_000);
      return redirect("/submissions/1.json");
    });

    await expectBlocked(
      fetchApprovedResource(
        { sourceId: "sec-edgar", url: APPROVED_URL, userAgent: USER_AGENT },
        dependencies,
      ),
      "deadline_exceeded",
    );

    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("hands the transport only the budget that is left", async () => {
    const { dependencies, transport, advance } = harness([
      redirect("/submissions/1.json"),
      ok(),
    ]);

    transport.mockImplementationOnce(async () => {
      advance(5_000);
      return redirect("/submissions/1.json");
    });

    await fetchApprovedResource(
      { sourceId: "sec-edgar", url: APPROVED_URL, userAgent: USER_AGENT },
      dependencies,
    );

    expect(transport.mock.calls[0][0].timeoutMs).toBe(30_000);
    expect(transport.mock.calls[1][0].timeoutMs).toBe(25_000);
  });

  it("returns a non-2xx status instead of throwing, so the caller can back off", async () => {
    // `429` y `503` son información de presupuesto, no un fallo del control de
    // egress. Este cliente no reintenta: informa `Retry-After` y deja la
    // decisión al llamador.
    const { dependencies } = harness([
      {
        status: 429,
        location: null,
        contentType: "text/html",
        retryAfter: "600",
        body: new Uint8Array(),
      },
    ]);

    const response = await fetchApprovedResource(
      { sourceId: "sec-edgar", url: APPROVED_URL, userAgent: USER_AGENT },
      dependencies,
    );

    expect(response.status).toBe(429);
    expect(response.retryAfter).toBe("600");
  });

  it("keeps the query out of the error raised for a rejected destination", async () => {
    const { dependencies } = harness([ok()]);
    const operation = fetchApprovedResource(
      {
        sourceId: "sec-edgar",
        url: "https://attacker.example/collect?token=secreto",
        userAgent: USER_AGENT,
      },
      dependencies,
    );

    await operation.catch((error: unknown) => {
      expect((error as EgressBlockedError).message).not.toContain("secreto");
      expect((error as EgressBlockedError).message).not.toContain(
        "attacker.example",
      );
    });
    await expect(operation).rejects.toThrow();
  });
});

/**
 * `POST` con credencial (ADR 0033). La credencial la agrega la puerta, después de
 * autorizar el destino: un adaptador no la ve y no puede mandarla a otro host.
 */
describe("fetchApprovedResource with a POST source", () => {
  const MODEL_ENTRY: EgressAllowlistEntry = egressAllowlistEntrySchema.parse({
    sourceId: "openrouter",
    origins: [
      { host: "openrouter.ai", pathPrefixes: ["/api/v1/chat/completions"] },
    ],
    method: "POST",
    identification: "project",
    credential: {
      variable: "OPENROUTER_API_KEY",
      header: "authorization",
      scheme: "Bearer",
    },
    maxRequestBytes: 4096,
    maxResponseBytes: 64 * 1024,
    deadlineMs: 30_000,
    maxRedirects: 0,
  });
  const MODEL_URL = "https://openrouter.ai/api/v1/chat/completions";
  const SECRET = "sk-or-v1-synthetic-test-credential";
  const BODY = new TextEncoder().encode('{"model":"x"}');

  function postHarness(
    responses: readonly EgressHopResponse[],
    credential: string | undefined = SECRET,
  ) {
    const base = harness(responses);
    const readCredential = vi.fn((variable: string) =>
      variable === "OPENROUTER_API_KEY" ? credential : undefined,
    );

    return {
      ...base,
      readCredential,
      dependencies: {
        ...base.dependencies,
        findEntry: (sourceId: string) =>
          sourceId === MODEL_ENTRY.sourceId ? MODEL_ENTRY : null,
        readCredential,
      },
    };
  }

  it("adds the declared credential and the project identification", async () => {
    const { dependencies, transport } = postHarness([ok('{"id":"1"}')]);

    await fetchApprovedResource(
      {
        sourceId: "openrouter",
        url: MODEL_URL,
        method: "POST",
        body: BODY,
        // Un contacto pasado de largo no llega a una fuente del proyecto.
        userAgent: USER_AGENT,
      },
      dependencies,
    );

    const [hop] = transport.mock.calls[0];

    expect(hop.method).toBe("POST");
    expect(hop.body).toBe(BODY);
    expect(hop.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(hop.headers["content-type"]).toBe("application/json");
    expect(hop.headers["user-agent"]).toBe("portal-financiero/1.0");
    expect(JSON.stringify(hop.headers)).not.toContain("owner@example.test");
  });

  it("does not read the credential for a destination it did not authorize", async () => {
    const { dependencies, transport, readCredential } = postHarness([ok()]);

    await expectBlocked(
      fetchApprovedResource(
        {
          sourceId: "openrouter",
          url: "https://attacker.example/api/v1/chat/completions",
          method: "POST",
          body: BODY,
        },
        dependencies,
      ),
      "host_not_allowlisted",
    );

    expect(readCredential).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses without a credential and names the variable, never a value", async () => {
    const { dependencies, transport } = postHarness([ok()], "  ");

    const operation = fetchApprovedResource(
      { sourceId: "openrouter", url: MODEL_URL, method: "POST", body: BODY },
      dependencies,
    );

    await expectBlocked(operation, "credential_missing");
    await operation.catch((error: unknown) => {
      expect((error as Error).message).toContain("OPENROUTER_API_KEY");
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses a credential that would split the header, without echoing it", async () => {
    const { dependencies, transport } = postHarness(
      [ok()],
      "sk-or-v1-abc\r\nx-injected: 1",
    );

    const operation = fetchApprovedResource(
      { sourceId: "openrouter", url: MODEL_URL, method: "POST", body: BODY },
      dependencies,
    );

    await expectBlocked(operation, "credential_invalid");
    await operation.catch((error: unknown) => {
      expect((error as Error).message).not.toContain("sk-or-v1-abc");
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses a method the source does not declare, in both directions", async () => {
    const post = postHarness([ok()]);

    await expectBlocked(
      fetchApprovedResource(
        { sourceId: "openrouter", url: MODEL_URL },
        post.dependencies,
      ),
      "method_not_allowed",
    );

    const get = harness([ok()]);

    await expectBlocked(
      fetchApprovedResource(
        {
          sourceId: "sec-edgar",
          url: APPROVED_URL,
          userAgent: USER_AGENT,
          method: "POST",
          body: BODY,
        },
        get.dependencies,
      ),
      "method_not_allowed",
    );

    expect(post.transport).not.toHaveBeenCalled();
    expect(get.transport).not.toHaveBeenCalled();
  });

  it("refuses a body over the source's request ceiling, or none at all", async () => {
    const { dependencies, transport } = postHarness([ok()]);

    await expectBlocked(
      fetchApprovedResource(
        {
          sourceId: "openrouter",
          url: MODEL_URL,
          method: "POST",
          body: new Uint8Array(4097),
        },
        dependencies,
      ),
      "request_body_too_large",
    );
    await expectBlocked(
      fetchApprovedResource(
        { sourceId: "openrouter", url: MODEL_URL, method: "POST" },
        dependencies,
      ),
      "request_body_too_large",
    );

    expect(transport).not.toHaveBeenCalled();
  });

  it("never follows a redirect, so neither body nor credential travel on", async () => {
    const { dependencies, transport } = postHarness([redirect(MODEL_URL, 307)]);

    await expectBlocked(
      fetchApprovedResource(
        { sourceId: "openrouter", url: MODEL_URL, method: "POST", body: BODY },
        dependencies,
      ),
      "too_many_redirects",
    );

    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not let an entry declare a POST that follows redirects or sends no body", () => {
    const base = {
      sourceId: "openrouter",
      origins: [{ host: "openrouter.ai", pathPrefixes: ["/api/"] }],
      method: "POST",
      maxRequestBytes: 4096,
      maxResponseBytes: 4096,
      deadlineMs: 30_000,
      maxRedirects: 0,
    };

    expect(egressAllowlistEntrySchema.safeParse(base).success).toBe(true);
    expect(
      egressAllowlistEntrySchema.safeParse({ ...base, maxRedirects: 1 })
        .success,
    ).toBe(false);
    expect(
      egressAllowlistEntrySchema.safeParse({ ...base, maxRequestBytes: 0 })
        .success,
    ).toBe(false);
    expect(
      egressAllowlistEntrySchema.safeParse({
        ...base,
        method: "GET",
        maxRedirects: 0,
      }).success,
    ).toBe(false);
  });
});

/**
 * Credenciales de Schwab (ADR 0076): la app se autentica con Basic desde dos
 * variables y la cuenta con un bearer que entrega un proveedor. En los dos casos
 * la puerta lo agrega después de autorizar el destino.
 */
describe("fetchApprovedResource with Schwab credentials", () => {
  const TOKEN_ENTRY: EgressAllowlistEntry = egressAllowlistEntrySchema.parse({
    sourceId: "schwab-oauth",
    origins: [{ host: "api.schwabapi.com", pathPrefixes: ["/v1/oauth/token"] }],
    method: "POST",
    identification: "project",
    credential: {
      kind: "env_basic",
      userVariable: "SCHWAB_APP_KEY",
      passwordVariable: "SCHWAB_APP_SECRET",
      header: "authorization",
      scheme: "Basic",
    },
    maxRequestBytes: 4096,
    maxResponseBytes: 64 * 1024,
    deadlineMs: 15_000,
    maxRedirects: 0,
  });
  const ACCOUNT_ENTRY: EgressAllowlistEntry = egressAllowlistEntrySchema.parse({
    sourceId: "schwab-trader",
    origins: [
      { host: "api.schwabapi.com", pathPrefixes: ["/trader/v1/accounts"] },
    ],
    identification: "project",
    credential: {
      kind: "provided_bearer",
      provider: "schwab-access-token",
      header: "authorization",
      scheme: "Bearer",
    },
    maxResponseBytes: 64 * 1024,
    deadlineMs: 15_000,
    maxRedirects: 0,
  });
  const APP_KEY = "AppKeySynthetic0123456789abcdef";
  const APP_SECRET = "SecretSynth01234";
  const ACCESS = "I0.synthetic-access-token@";
  const FORM = new TextEncoder().encode(
    "grant_type=refresh_token&refresh_token=r",
  );

  function schwabHarness(
    variables: Record<string, string | undefined> = {
      SCHWAB_APP_KEY: APP_KEY,
      SCHWAB_APP_SECRET: APP_SECRET,
    },
    provided: string | undefined = ACCESS,
  ) {
    const base = harness([ok('{"ok":true}')]);
    const readCredential = vi.fn((variable: string) => variables[variable]);
    const provideCredential = vi.fn(async () => provided);

    return {
      ...base,
      readCredential,
      provideCredential,
      dependencies: {
        ...base.dependencies,
        findEntry: (sourceId: string) =>
          [TOKEN_ENTRY, ACCOUNT_ENTRY].find(
            (entry) => entry.sourceId === sourceId,
          ) ?? null,
        readCredential,
        provideCredential,
      },
    };
  }

  it("authenticates the app with Basic from its two variables", async () => {
    const { dependencies, transport, provideCredential } = schwabHarness();

    await fetchApprovedResource(
      {
        sourceId: "schwab-oauth",
        url: "https://api.schwabapi.com/v1/oauth/token",
        method: "POST",
        body: FORM,
        contentType: "application/x-www-form-urlencoded",
      },
      dependencies,
    );

    const [hop] = transport.mock.calls[0];
    expect(hop.headers.authorization).toBe(
      `Basic ${Buffer.from(`${APP_KEY}:${APP_SECRET}`).toString("base64")}`,
    );
    expect(hop.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(provideCredential).not.toHaveBeenCalled();
  });

  it("names the missing half of the Basic pair, never a value", async () => {
    const { dependencies, transport } = schwabHarness({
      SCHWAB_APP_KEY: APP_KEY,
    });

    const operation = fetchApprovedResource(
      {
        sourceId: "schwab-oauth",
        url: "https://api.schwabapi.com/v1/oauth/token",
        method: "POST",
        body: FORM,
      },
      dependencies,
    );

    await expectBlocked(operation, "credential_missing");
    await operation.catch((error: unknown) => {
      expect((error as Error).message).toContain("SCHWAB_APP_SECRET");
      expect((error as Error).message).not.toContain(APP_KEY);
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("adds the provided bearer only after authorizing the destination", async () => {
    const { dependencies, transport, provideCredential } = schwabHarness();

    await expectBlocked(
      fetchApprovedResource(
        {
          sourceId: "schwab-trader",
          url: "https://api.schwabapi.com/v1/oauth/authorize",
        },
        dependencies,
      ),
      "path_not_allowlisted",
    );
    expect(provideCredential).not.toHaveBeenCalled();

    await fetchApprovedResource(
      {
        sourceId: "schwab-trader",
        url: "https://api.schwabapi.com/trader/v1/accounts/accountNumbers",
      },
      dependencies,
    );

    expect(provideCredential).toHaveBeenCalledWith("schwab-access-token");
    expect(transport.mock.calls[0][0].headers.authorization).toBe(
      `Bearer ${ACCESS}`,
    );
  });

  it("refuses to place an order: a POST to an account source never leaves", async () => {
    const { dependencies, transport, provideCredential } = schwabHarness();

    await expectBlocked(
      fetchApprovedResource(
        {
          sourceId: "schwab-trader",
          url: "https://api.schwabapi.com/trader/v1/accounts/HASH/orders",
          method: "POST",
          body: new TextEncoder().encode("{}"),
        },
        dependencies,
      ),
      "method_not_allowed",
    );
    expect(provideCredential).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses when the provider has no token, naming the provider", async () => {
    // Una cadena vacía es lo que entrega el proveedor sin conexión guardada.
    const { dependencies, transport } = schwabHarness(undefined, "");

    const operation = fetchApprovedResource(
      {
        sourceId: "schwab-trader",
        url: "https://api.schwabapi.com/trader/v1/accounts/accountNumbers",
      },
      dependencies,
    );

    await expectBlocked(operation, "credential_missing");
    await operation.catch((error: unknown) => {
      expect((error as Error).message).toContain("schwab-access-token");
    });
    expect(transport).not.toHaveBeenCalled();
  });
});
