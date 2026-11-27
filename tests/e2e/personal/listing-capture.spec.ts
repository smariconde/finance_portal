import { expect, test } from "@playwright/test";

import {
  CAPTURE_EXTENSION_ORIGIN,
  CAPTURE_REQUEST_VERSION,
} from "../../../src/modules/real-estate/domain/capture-request";
import { SECRET_SENTINELS, SENTINEL_VALUES } from "../support/runtime";

const BODY = {
  contract: CAPTURE_REQUEST_VERSION,
  adapterVersion: "remax-ng-state-1.0.0",
  captures: [{}],
};

/**
 * La captura de inmuebles (ADR 0089) existe en el runtime personal con su
 * token, y cada puerta responde antes de abrir una base. Con origen y token
 * correctos, la cuota vive en una base que este gate no tiene: `503` sin
 * detalles.
 */
test("la captura exige POST, el origen de la extensión y su token, y no filtra la base", async ({
  request,
}) => {
  const path = "/api/inmuebles/captura";
  const auth = { authorization: `Bearer ${SECRET_SENTINELS.CAPTURE_TOKEN}` };

  const get = await request.get(path);
  expect(get.status()).toBe(405);
  expect(get.headers()["allow"]).toBe("POST");

  const page = await request.post(path, {
    data: BODY,
    headers: { origin: "https://evil.example", ...auth },
  });
  expect(page.status()).toBe(403);

  const anonymous = await request.post(path, {
    data: BODY,
    headers: { origin: CAPTURE_EXTENSION_ORIGIN },
  });
  expect(anonymous.status()).toBe(401);

  const mcpToken = await request.post(path, {
    data: BODY,
    headers: {
      origin: CAPTURE_EXTENSION_ORIGIN,
      authorization: `Bearer ${SECRET_SENTINELS.MCP_ACCESS_TOKEN}`,
    },
  });
  expect(mcpToken.status()).toBe(401);

  const extension = await request.post(path, {
    data: BODY,
    headers: { origin: CAPTURE_EXTENSION_ORIGIN, ...auth },
  });
  expect(extension.status()).toBe(503);
  expect(extension.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/u);

  for (const response of [get, page, anonymous, mcpToken, extension]) {
    const body = await response.text();
    const headers = JSON.stringify(response.headers());
    for (const sentinel of SENTINEL_VALUES) {
      expect(body).not.toContain(sentinel);
      expect(headers).not.toContain(sentinel);
    }
  }
});
