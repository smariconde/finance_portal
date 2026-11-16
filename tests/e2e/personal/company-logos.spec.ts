import { expect, test } from "@playwright/test";

test("el endpoint no acepta destinos arbitrarios ni filtra errores de la base", async ({
  request,
}) => {
  const invalid = await request.get(
    "/api/company-logos/KO?url=https://example.invalid/logo",
  );
  expect(invalid.status()).toBe(400);
  const unavailable = await request.get("/api/company-logos/KO");
  expect(unavailable.status()).toBe(503);
  expect(unavailable.headers()["cache-control"]).toContain("no-store");
  expect(await unavailable.text()).toBe("");
});
