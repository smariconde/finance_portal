import type { NextConfig } from "next";

import { createSecurityHeaders } from "./src/server/security/security-headers";

/**
 * Hosts extra desde los que `next dev` sirve sus chunks y su HMR, por ejemplo
 * la IP de la LAN. Sin esto la página llega sin JS y nada del cliente hidrata.
 * Sólo afecta al servidor de desarrollo; la lista vive en `.env.local` porque
 * una IP de la red del owner no va en un repositorio público.
 */
const allowedDevOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin !== "");

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins,
  cacheComponents: true,
  // La vuelta de Schwab trae el código de autorización y el `state` en el
  // query (ADR 0076). El log de requests de Next imprime la URL entera, así que
  // esas visitas no se registran: el callback deja su propia línea con el
  // `request_id` y el resultado, sin el input.
  logging: {
    incomingRequests: { ignore: [/[?&](code|state|session)=/u] },
  },
  poweredByHeader: false,
  typedRoutes: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: createSecurityHeaders({
          development: process.env.NODE_ENV === "development",
        }),
      },
    ];
  },
};

export default nextConfig;
