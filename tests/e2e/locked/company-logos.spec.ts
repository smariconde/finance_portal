import { expect, test } from "@playwright/test";

test("el logo se niega directamente en runtime trabado", async ({
  request,
}) => {
  const response = await request.get("/api/company-logos/KO");
  expect(response.status()).toBe(404);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.text()).toBe("");
});
