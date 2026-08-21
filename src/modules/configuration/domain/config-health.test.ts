import { describe, expect, it } from "vitest";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";

describe("getConfigHealth", () => {
  it("starts safely in demo mode without optional configuration", () => {
    const health = getConfigHealth({});

    expect(health.mode).toBe("demo");
    expect(health.access).toBe("public");
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
    const health = getConfigHealth({
      APP_MODE: "personal",
      APP_RUNTIME_ACCESS: "local",
    });
    const database = health.items.find((item) => item.id === "database");

    expect(database).toMatchObject({
      status: "degraded",
      missingVariables: ["DATABASE_URL"],
    });
  });

  it("keeps persistence disabled until its implementation slice", () => {
    const health = getConfigHealth({
      APP_MODE: "personal",
      APP_RUNTIME_ACCESS: "local",
      DATABASE_URL: "postgres://pooled",
    });

    expect(health.items.find((item) => item.id === "database")).toMatchObject({
      status: "disabled",
      message:
        "La variable está presente, pero la persistencia se habilita recién en F1-02.",
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

  it("falls back to demo when personal mode has no private runtime boundary", () => {
    const health = getConfigHealth({
      APP_MODE: "personal",
      DATABASE_URL: "postgres://pooled",
    });

    expect(health.mode).toBe("demo");
    expect(health.items.find((item) => item.id === "core")).toMatchObject({
      status: "degraded",
      missingVariables: ["APP_RUNTIME_ACCESS"],
    });
    expect(health.items.find((item) => item.id === "database")).toMatchObject({
      status: "disabled",
    });
  });

  it("falls back to demo when APP_RUNTIME_ACCESS is invalid", () => {
    const health = getConfigHealth({
      APP_MODE: "personal",
      APP_RUNTIME_ACCESS: "private-network",
      DATABASE_URL: "postgres://pooled",
    });

    expect(health.mode).toBe("demo");
    expect(health.access).toBe("public");
    expect(health.items.find((item) => item.id === "core")).toMatchObject({
      status: "degraded",
      missingVariables: ["APP_RUNTIME_ACCESS"],
    });
  });

  it("rejects a local access declaration inside Vercel", () => {
    const health = getConfigHealth({
      APP_MODE: "personal",
      APP_RUNTIME_ACCESS: "local",
      DATABASE_URL: "postgres://pooled",
      VERCEL: "1",
      VERCEL_ENV: "preview",
    });

    expect(health.mode).toBe("demo");
    expect(health.items.find((item) => item.id === "core")).toMatchObject({
      status: "degraded",
      missingVariables: ["APP_RUNTIME_ACCESS"],
    });
  });

  it("allows personal mode on a declared protected Vercel preview", () => {
    const health = getConfigHealth({
      APP_MODE: "personal",
      APP_RUNTIME_ACCESS: "protected",
      DATABASE_URL: "postgres://pooled",
      VERCEL: "1",
      VERCEL_ENV: "preview",
    });

    expect(health).toMatchObject({
      mode: "personal",
      access: "protected",
    });
    expect(health.items.find((item) => item.id === "core")).toMatchObject({
      status: "ready",
      missingVariables: [],
    });
  });

  it("forces a Vercel production deployment back to demo", () => {
    const health = getConfigHealth({
      APP_MODE: "personal",
      APP_RUNTIME_ACCESS: "protected",
      DATABASE_URL: "postgres://pooled",
      VERCEL: "1",
      VERCEL_ENV: "production",
    });

    expect(health.mode).toBe("demo");
    expect(health.items.find((item) => item.id === "core")).toMatchObject({
      status: "degraded",
      missingVariables: ["VERCEL_ENV"],
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
