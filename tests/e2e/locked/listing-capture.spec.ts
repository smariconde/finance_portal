import { expect, test } from "@playwright/test";

import { CAPTURE_EXTENSION_ORIGIN } from "../../../src/modules/real-estate/domain/capture-request";
import { SECRET_SENTINELS } from "../support/runtime";

test("la captura de inmuebles no existe en un runtime trabado, aun con el token", async ({
  request,
}) => {
  const response = await request.post("/api/inmuebles/captura", {
    data: { contract: "listing-capture-request-1.0.0" },
    headers: {
      origin: CAPTURE_EXTENSION_ORIGIN,
      authorization: `Bearer ${SECRET_SENTINELS.CAPTURE_TOKEN}`,
    },
  });

  expect(response.status()).toBe(404);
  expect(response.headers()["cache-control"]).toContain("no-store");
});
