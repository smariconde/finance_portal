import { describe, expect, it } from "vitest";

import {
  getConfigHealth,
  servesRealData,
} from "@/modules/configuration/domain/config-health";

const PRIVATE_LOCAL = {
  APP_MODE: "personal",
  APP_RUNTIME_ACCESS: "local",
  DATABASE_URL: "postgres://pooled",
} as const;

describe("getConfigHealth", () => {
  it("locks a runtime that declares nothing", () => {
    const health = getConfigHealth({});

    expect(health.mode).toBe("locked");
    expect(health.access).toBe("public");
    expect(servesRealData(health)).toBe(false);
    expect(health.items).toEqual([
      expect.objectContaining({ id: "core", status: "ready" }),
      expect.objectContaining({ id: "database", status: "disabled" }),
      expect.objectContaining({ id: "liveIntegrations", status: "disabled" }),
    ]);
  });

  it("serves data on a private local runtime with a pooled URL", () => {
    const health = getConfigHealth(PRIVATE_LOCAL);

    expect(health.mode).toBe("personal");
    expect(servesRealData(health)).toBe(true);
    expect(health.items.find((item) => item.id === "core")).toMatchObject({
      status: "ready",
      missingVariables: [],
    });
    expect(health.items.find((item) => item.id === "database")).toMatchObject({
      status: "ready",
      missingVariables: [],
    });
  });

  it("locks personal mode when the pooled database is missing", () => {
    const health = getConfigHealth({
      APP_MODE: "personal",
      APP_RUNTIME_ACCESS: "local",
    });

    // Un personal sin base no es un personal degradado: no sirve nada, así que
    // se traba en vez de prometer datos y devolver vacío.
    expect(health.mode).toBe("locked");
    expect(servesRealData(health)).toBe(false);
    expect(health.items.find((item) => item.id === "core")).toMatchObject({
      status: "degraded",
      missingVariables: ["DATABASE_URL"],
    });
  });

  it("locks an invalid APP_MODE instead of guessing one", () => {
    const health = getConfigHealth({ APP_MODE: "public-live" });

    expect(health.mode).toBe("locked");
    expect(health.items.find((item) => item.id === "core")).toMatchObject({
      status: "degraded",
      missingVariables: ["APP_MODE"],
    });
  });

  it("locks personal mode with no private runtime boundary", () => {
    const health = getConfigHealth({
      APP_MODE: "personal",
      DATABASE_URL: "postgres://pooled",
    });

    expect(health.mode).toBe("locked");
    expect(health.items.find((item) => item.id === "core")).toMatchObject({
      status: "degraded",
      missingVariables: ["APP_RUNTIME_ACCESS"],
    });
    expect(health.items.find((item) => item.id === "database")).toMatchObject({
      status: "disabled",
    });
  });

  it("locks an invalid APP_RUNTIME_ACCESS", () => {
    const health = getConfigHealth({
      APP_MODE: "personal",
      APP_RUNTIME_ACCESS: "private-network",
      DATABASE_URL: "postgres://pooled",
    });

    expect(health.mode).toBe("locked");
    expect(health.access).toBe("public");
    expect(health.items.find((item) => item.id === "core")).toMatchObject({
      status: "degraded",
      missingVariables: ["APP_RUNTIME_ACCESS"],
    });
  });

  it("rejects a local access declaration inside Vercel", () => {
    const health = getConfigHealth({
      ...PRIVATE_LOCAL,
      VERCEL: "1",
      VERCEL_ENV: "preview",
    });

    expect(health.mode).toBe("locked");
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

    expect(health).toMatchObject({ mode: "personal", access: "protected" });
    expect(servesRealData(health)).toBe(true);
  });

  it("locks a Vercel production deployment even when it declares protection", () => {
    const health = getConfigHealth({
      APP_MODE: "personal",
      APP_RUNTIME_ACCESS: "protected",
      DATABASE_URL: "postgres://pooled",
      VERCEL: "1",
      VERCEL_ENV: "production",
    });

    // El repositorio es público y sus datos no. Un deployment de producción no
    // puede probar que es privado, así que no recibe datos.
    expect(health.mode).toBe("locked");
    expect(servesRealData(health)).toBe(false);
    expect(health.items.find((item) => item.id === "core")).toMatchObject({
      status: "degraded",
      missingVariables: ["VERCEL_ENV"],
    });
  });

  it("never exposes configured secret values", () => {
    const secret = "do-not-leak-this-value";
    const health = getConfigHealth({
      APP_MODE: "locked",
      ALPACA_API_SECRET_KEY: secret,
    });

    expect(
      health.items.find((item) => item.id === "liveIntegrations"),
    ).toMatchObject({ status: "degraded" });
    expect(JSON.stringify(health)).not.toContain(secret);
  });
});
