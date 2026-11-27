import { defineConfig } from "wxt";

import { CAPTURE_EXTENSION_PUBLIC_KEY } from "../../src/modules/real-estate/domain/capture-request";
import { portalHostPermissions } from "./portals/portal-matches";
import { CAPTURE_ENDPOINT_ORIGINS } from "./capture/endpoint-origins";

/**
 * La extensión de captura de inmuebles (ADR 0089, Decisión 2): MV3, cargada
 * desempaquetada en el perfil dedicado de Brave, nunca en una tienda.
 *
 * - El dominio se importa con rutas relativas: WXT fuerza su propio alias `@`
 *   a esta carpeta, así que `@/` no sería el `src/` del repositorio.
 * - Sin auto-imports: cada archivo importa de `wxt/*` lo que usa, así el
 *   `tsc`, el ESLint y el Vitest del repositorio la cubren sin tipos generados.
 * - Los permisos de host salen del registro de portales y de los orígenes
 *   declarados del endpoint; nada más.
 * - La `key` fija el ID de la extensión, que el endpoint exige como `Origin`.
 */
export default defineConfig({
  imports: false,
  manifest: {
    name: "Portal Financiero · Inmuebles",
    version: "0.1.0",
    description:
      "Captura los avisos inmobiliarios que el owner ve y los envía a su portal.",
    key: CAPTURE_EXTENSION_PUBLIC_KEY,
    permissions: ["storage", "alarms"],
    host_permissions: [...portalHostPermissions(), ...CAPTURE_ENDPOINT_ORIGINS],
    action: { default_title: "Inmuebles" },
  },
});
