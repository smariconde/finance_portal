import { test } from "@playwright/test";

import { expectNoSecretLeaks } from "../support/secrets";

/**
 * Las claves no salen del servidor personal (`F5-02`, `TM-02`).
 *
 * Es el servidor que sí tiene permiso de usarlas: el que lee la configuración,
 * arma el egress y podría, por un descuido, pasarle un valor a un componente.
 * El servidor trabado ya se revisaba; éste no.
 */
test.describe("secretos en el runtime personal", () => {
  test("ningún centinela aparece en el HTML, los headers ni el payload RSC", async ({
    request,
  }) => {
    await expectNoSecretLeaks(request);
  });
});
