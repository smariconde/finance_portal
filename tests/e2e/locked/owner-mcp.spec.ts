import { expect, test } from "@playwright/test";

import { SECRET_SENTINELS } from "../support/runtime";

test("/mcp no existe en un runtime trabado, aun con el token", async ({
  request,
}) => {
  const response = await request.post("/mcp", {
    data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${SECRET_SENTINELS.MCP_ACCESS_TOKEN}`,
    },
  });

  expect(response.status()).toBe(404);
  expect(response.headers()["cache-control"]).toContain("no-store");
});
