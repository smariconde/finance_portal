import type { NextConfig } from "next";

import { createSecurityHeaders } from "./src/server/security/security-headers";

const nextConfig: NextConfig = {
  agentRules: false,
  cacheComponents: true,
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
