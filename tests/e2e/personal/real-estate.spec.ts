import { expect, test } from "@playwright/test";

import { ROUTES } from "../support/runtime";
import { withinMain } from "../support/streaming";

/**
 * Los avisos inmobiliarios (`F13-02`) sin base: la lista dice que la base no
 * respondió debajo de su título, y un aviso mal escrito es la ruta
 * inexistente sin tocar la base.
 */
test("la lista de avisos dice que la base no respondió", async ({ page }) => {
  await page.goto(ROUTES.realEstate);

  await expect(
    page.getByRole("heading", { level: 1, name: "Inmuebles" }),
  ).toBeVisible();
  await expect(
    withinMain(page).getByText(
      "Avisos no disponibles: la base personal no respondió.",
    ),
  ).toBeVisible();
});

test("un aviso de un portal que no existe es la ruta inexistente", async ({
  page,
}) => {
  await page.goto("/inmuebles/otro-portal.123");

  await expect(
    page.getByRole("heading", { level: 1, name: "Esa ruta no existe" }),
  ).toBeVisible();
});
