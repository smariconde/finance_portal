import type { Locator, Page } from "@playwright/test";

/**
 * El contenido de la página, sin los restos del streaming (`F6-40`).
 *
 * Una ruta con `loading.tsx` llega en streaming: React manda lo resuelto en un
 * `<div hidden id="S:…">` al final del `body` y un script lo mueve a su lugar.
 * Hasta que el script corre, ese contenido está dos veces en el DOM, o una vez
 * oculto fuera de `<main>`. `getByRole` ya ignora lo oculto, pero `getByText`
 * no: en CI, con un runner más lento, la ventana alcanzó para que el aviso sin
 * base de `/sectores` y de `/argentina` apareciera dos veces y el modo estricto
 * fallara (PR #158 y #162). Lo que el owner ve está en `<main>`, y ahí se busca.
 */
export function withinMain(page: Page): Locator {
  return page.getByRole("main");
}
