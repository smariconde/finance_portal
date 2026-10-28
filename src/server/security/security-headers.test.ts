import { describe, expect, it } from "vitest";

import { createSecurityHeaders } from "@/server/security/security-headers";

describe("createSecurityHeaders", () => {
  it("sets the base browser protections on every environment", () => {
    const headers = Object.fromEntries(
      createSecurityHeaders().map(({ key, value }) => [key, value]),
    );

    expect(headers["Content-Security-Policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });

  it("allows eval only for the Next.js development runtime", () => {
    const productionCsp = createSecurityHeaders().find(
      ({ key }) => key === "Content-Security-Policy",
    )?.value;
    const developmentCsp = createSecurityHeaders({ development: true }).find(
      ({ key }) => key === "Content-Security-Policy",
    )?.value;

    expect(productionCsp).not.toContain("'unsafe-eval'");
    expect(developmentCsp).toContain("'unsafe-eval'");
  });

  it("opens the logo host for images only (ADR 0062)", () => {
    const directives = Object.fromEntries(
      (
        createSecurityHeaders().find(
          ({ key }) => key === "Content-Security-Policy",
        )?.value ?? ""
      )
        .split("; ")
        .map((directive) => {
          const [name, ...sources] = directive.split(" ");
          return [name, sources];
        }),
    );

    expect(directives["img-src"]).toEqual([
      "'self'",
      "data:",
      "https://img.logo.dev",
    ]);
    for (const name of ["default-src", "script-src", "connect-src"]) {
      expect(directives[name]?.join(" ")).not.toContain("logo.dev");
    }
  });
});
