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

  it("allows personal mode on a declared protected Vercel production", () => {
    const health = getConfigHealth({
      APP_MODE: "personal",
      APP_RUNTIME_ACCESS: "protected",
      DATABASE_URL: "postgres://pooled",
      VERCEL: "1",
      VERCEL_ENV: "production",
    });

    // Invertido a propósito por la ADR 0008. Antes producción quedaba trabada
    // aunque declarara protección, así que el único acceso remoto posible era
    // una URL de preview, que cambia con cada deployment. `protected` es una
    // declaración del owner y vale en producción.
    expect(health).toMatchObject({ mode: "personal", access: "protected" });
    expect(servesRealData(health)).toBe(true);
  });

  it("locks a Vercel production deployment that declares no access", () => {
    const health = getConfigHealth({
      APP_MODE: "personal",
      DATABASE_URL: "postgres://pooled",
      VERCEL: "1",
      VERCEL_ENV: "production",
    });

    // Este es el caso que protege al owner de sí mismo y a un tercero que
    // despliegue el repositorio público: sin acceso declarado no hay datos.
    expect(health.mode).toBe("locked");
    expect(servesRealData(health)).toBe(false);
    expect(health.items.find((item) => item.id === "core")).toMatchObject({
      status: "degraded",
      missingVariables: ["APP_RUNTIME_ACCESS"],
    });
  });

  it("allows personal mode on a declared protected host outside Vercel", () => {
    const health = getConfigHealth({
      APP_MODE: "personal",
      APP_RUNTIME_ACCESS: "protected",
      DATABASE_URL: "postgres://pooled",
    });

    // `protected` dejó de estar acoplado a Vercel: nombra la propiedad —la URL
    // está detrás de la protección de la plataforma— y no al proveedor.
    expect(health).toMatchObject({ mode: "personal", access: "protected" });
    expect(servesRealData(health)).toBe(true);
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

  /**
   * `TM-02` no se cierra probando la variable que uno se acordó de probar. Acá
   * cada variable declarada en `.env.example` recibe un valor centinela único y
   * ninguno puede aparecer en la salida, en ningún modo. Si mañana el health
   * empieza a citar un valor para "ayudar a diagnosticar", este test lo nombra.
   */
  describe("no exposición de valores (TM-02)", () => {
    const DECLARED_VARIABLES = [
      "NEXT_PUBLIC_APP_URL",
      "NEXT_PUBLIC_APP_NAME",
      "APP_ENV",
      "LOG_LEVEL",
      "DATABASE_URL",
      "DATABASE_DIRECT_URL",
      "DATABASE_TEST_URL",
      "CRON_SECRET",
      "MARKET_DATA_PROVIDER",
      "ALPACA_API_KEY_ID",
      "ALPACA_API_SECRET_KEY",
      "ALPACA_DATA_FEED",
      "SEC_USER_AGENT",
      "OPENROUTER_API_KEY",
      "OPENROUTER_MODEL_FAST",
      "OPENROUTER_MODEL_REASONING",
      "OPENROUTER_PROVIDER_ALLOWLIST",
      "TAVILY_API_KEY",
      "SENTRY_DSN",
    ] as const;

    function sentinelEnvironment(mode: string, access: string) {
      const environment: Record<string, string> = {
        APP_MODE: mode,
        APP_RUNTIME_ACCESS: access,
      };

      for (const name of DECLARED_VARIABLES) {
        environment[name] = `sentinel-${name.toLowerCase()}-value`;
      }

      return environment;
    }

    it.each([
      ["locked", "public"],
      ["personal", "local"],
      ["personal", "public"],
    ])("no filtra ningún valor con APP_MODE=%s y acceso %s", (mode, access) => {
      const environment = sentinelEnvironment(mode, access);
      const serialized = JSON.stringify(getConfigHealth(environment));

      for (const name of DECLARED_VARIABLES) {
        expect(serialized).not.toContain(environment[name]);
      }
    });

    it("nombra la variable faltante sin citar ninguna presente", () => {
      const health = getConfigHealth({
        APP_MODE: "personal",
        APP_RUNTIME_ACCESS: "local",
        ALPACA_API_SECRET_KEY: "sentinel-alpaca-secret",
      });

      const serialized = JSON.stringify(health);

      // El nombre de lo que falta es accionable; el valor de lo que está nunca
      // lo es.
      expect(serialized).toContain("DATABASE_URL");
      expect(serialized).not.toContain("sentinel-alpaca-secret");
    });
  });
});
