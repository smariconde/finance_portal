import { expect, test } from "@playwright/test";

import { SECRET_SENTINELS, SENTINEL_VALUES } from "../support/runtime";

const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };

/**
 * El MCP del owner (ADR 0078) existe en el runtime personal con su token, y
 * cada puerta responde antes de abrir una base. Con el token, la cuota de
 * `portal-mcp` vive en una base que este gate no tiene: la ruta lo dice con
 * `503` y sin detalles.
 */
test("/mcp exige POST, rechaza navegadores y tokens ajenos, y no filtra la base", async ({
  request,
}) => {
  const get = await request.get("/mcp");
  expect(get.status()).toBe(405);
  expect(get.headers()["allow"]).toBe("POST");

  const anonymous = await request.post("/mcp", { data: LIST });
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()["www-authenticate"]).toBe("Bearer");

  const browser = await request.post("/mcp", {
    data: LIST,
    headers: {
      origin: "https://evil.example",
      authorization: `Bearer ${SECRET_SENTINELS.MCP_ACCESS_TOKEN}`,
    },
  });
  expect(browser.status()).toBe(403);

  const owner = await request.post("/mcp", {
    data: LIST,
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${SECRET_SENTINELS.MCP_ACCESS_TOKEN}`,
    },
  });
  expect(owner.status()).toBe(503);
  expect(owner.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/u);

  for (const response of [get, anonymous, browser, owner]) {
    const body = await response.text();
    const headers = JSON.stringify(response.headers());
    for (const sentinel of SENTINEL_VALUES) {
      expect(body).not.toContain(sentinel);
      expect(headers).not.toContain(sentinel);
    }
  }
});
