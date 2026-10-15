import { expect, type APIRequestContext } from "@playwright/test";

import { LEAK_SURFACES, SENTINEL_VALUES } from "./runtime";

/**
 * Ningún centinela sale por ninguna ruta (`F5-02`, `TM-02`).
 *
 * Se pide cada ruta dos veces: como documento y como navegación RSC, que es lo
 * que el router del cliente baja al moverse. Un valor que llegara a un Client
 * Component viajaría en el segundo aunque no se viera en el primero.
 */
export async function expectNoSecretLeaks(request: APIRequestContext) {
  for (const route of LEAK_SURFACES) {
    for (const variant of ["document", "rsc"] as const) {
      const response = await request.get(route, {
        headers: variant === "rsc" ? { RSC: "1" } : {},
        maxRedirects: 0,
      });
      const body = await response.text();
      const headers = JSON.stringify(response.headers());

      if (
        variant === "rsc" &&
        response.status() === 200 &&
        !route.endsWith("/export")
      ) {
        // Si esto no es un payload RSC, la segunda vuelta no probó nada.
        expect(response.headers()["content-type"], route).toContain(
          "text/x-component",
        );
      }

      for (const sentinel of SENTINEL_VALUES) {
        expect(
          body,
          `${route} (${variant}) filtró un centinela en el body`,
        ).not.toContain(sentinel);
        expect(
          headers,
          `${route} (${variant}) filtró un centinela en un header`,
        ).not.toContain(sentinel);
      }
    }
  }
}
