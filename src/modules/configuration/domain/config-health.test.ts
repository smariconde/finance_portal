import { describe, expect, it } from "vitest";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";

describe("getConfigHealth", () => {
  it("starts safely in demo mode without optional configuration", () => {
    const health = getConfigHealth({});

    expect(health.mode).toBe("demo");
    expect(health.items).toEqual([
      expect.objectContaining({ id: "core", status: "ready" }),
      expect.objectContaining({ id: "database", status: "disabled" }),
      expect.objectContaining({
        id: "liveIntegrations",
        status: "disabled",
      }),
    ]);
  });

  it("reports missing database variables in personal mode", () => {
    const health = getConfigHealth({ APP_MODE: "personal" });
    const database = health.items.find((item) => item.id === "database");

    expect(database).toMatchObject({
      status: "degraded",
      missingVariables: ["DATABASE_URL"],
    });
  });

  it("marks the personal runtime database connection as ready", () => {
    const health = getConfigHealth({
      APP_MODE: "personal",
      DATABASE_URL: "postgres://pooled",
    });

    expect(health.items.find((item) => item.id === "database")).toMatchObject({
      status: "ready",
      missingVariables: [],
    });
  });

  it("falls back to demo when APP_MODE is invalid", () => {
    const health = getConfigHealth({ APP_MODE: "public-live" });

    expect(health.mode).toBe("demo");
    expect(health.items.find((item) => item.id === "core")).toMatchObject({
      status: "degraded",
      missingVariables: ["APP_MODE"],
    });
  });

  it("never exposes configured secret values", () => {
    const secret = "do-not-leak-this-value";
    const health = getConfigHealth({
      APP_MODE: "demo",
      ALPACA_API_SECRET_KEY: secret,
    });

    expect(
      health.items.find((item) => item.id === "liveIntegrations"),
    ).toMatchObject({ status: "degraded" });
    expect(JSON.stringify(health)).not.toContain(secret);
  });
});
