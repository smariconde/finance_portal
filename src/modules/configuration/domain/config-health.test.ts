import { describe, expect, it } from "vitest";

import {
  getConfigHealth,
  servesRealData,
  servesSchwabConnection,
  servesTradingData,
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
      expect.objectContaining({
        id: "trading",
        status: "disabled",
        missingVariables: [],
      }),
      expect.objectContaining({
        id: "schwab",
        status: "disabled",
        missingVariables: [],
      }),
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
   * La base de trading (`F11-02`, ADR 0076) no entra en la definición de
   * `personal`: su ausencia no traba nada ni enciende «requiere atención».
   */
  describe("base de trading", () => {
    const LOCAL_ANALYSIS =
      "postgresql://u:p@127.0.0.1:55432/finance_portal_personal";
    const LOCAL_TRADING =
      "postgresql://u:p@127.0.0.1:55432/finance_portal_trading";

    function tradingItem(environment: Record<string, string>) {
      return getConfigHealth(environment).items.find(
        (item) => item.id === "trading",
      );
    }

    it("serves trading data with its own pooled base", () => {
      const health = getConfigHealth({
        ...PRIVATE_LOCAL,
        DATABASE_URL: LOCAL_ANALYSIS,
        TRADING_DATABASE_URL: LOCAL_TRADING,
      });

      expect(servesTradingData(health)).toBe(true);
      expect(health.items.find((item) => item.id === "trading")).toMatchObject({
        status: "ready",
        missingVariables: [],
      });
    });

    it("names the missing variable without degrading the portal", () => {
      const health = getConfigHealth(PRIVATE_LOCAL);

      expect(health.mode).toBe("personal");
      expect(servesRealData(health)).toBe(true);
      expect(servesTradingData(health)).toBe(false);
      expect(health.items.find((item) => item.id === "trading")).toMatchObject({
        status: "disabled",
        missingVariables: ["TRADING_DATABASE_URL"],
      });
      expect(health.items.some((item) => item.status === "degraded")).toBe(
        false,
      );
    });

    it("does not ask a locked runtime for the trading base", () => {
      // El aviso de runtime trabado junta los faltantes de todos los ítems: si
      // la de trading figurara, cada página trabada la pediría.
      expect(tradingItem({})).toMatchObject({
        status: "disabled",
        missingVariables: [],
      });
      expect(
        servesTradingData(
          getConfigHealth({ TRADING_DATABASE_URL: LOCAL_TRADING }),
        ),
      ).toBe(false);
    });

    it("refuses the analysis base as the trading base", () => {
      const health = getConfigHealth({
        ...PRIVATE_LOCAL,
        DATABASE_URL: LOCAL_ANALYSIS,
        TRADING_DATABASE_URL:
          "postgresql://other:role@127.0.0.1:55432/finance_portal_personal?sslmode=disable",
      });

      expect(servesTradingData(health)).toBe(false);
      expect(health.items.find((item) => item.id === "trading")).toMatchObject({
        status: "degraded",
        missingVariables: ["TRADING_DATABASE_URL"],
      });
    });

    it("refuses a value that is not a PostgreSQL url", () => {
      expect(
        tradingItem({ ...PRIVATE_LOCAL, TRADING_DATABASE_URL: "trading" }),
      ).toMatchObject({ status: "degraded" });
    });

    it("ignores the trading base on a Vercel preview (TM-14)", () => {
      const preview = {
        APP_MODE: "personal",
        APP_RUNTIME_ACCESS: "protected",
        DATABASE_URL: LOCAL_ANALYSIS,
        VERCEL: "1",
        VERCEL_ENV: "preview",
      };

      expect(
        servesTradingData(
          getConfigHealth({ ...preview, TRADING_DATABASE_URL: LOCAL_TRADING }),
        ),
      ).toBe(false);
      expect(
        tradingItem({ ...preview, TRADING_DATABASE_URL: LOCAL_TRADING }),
      ).toMatchObject({ status: "degraded" });
      expect(tradingItem(preview)).toMatchObject({
        status: "disabled",
        missingVariables: [],
      });
    });
  });

  /**
   * La conexión con Schwab (`F11-03`, ADR 0076): necesita la base de trading y
   * cuatro variables, y tampoco traba ni degrada el portal si faltan.
   */
  describe("conexión Schwab", () => {
    const READY = {
      ...PRIVATE_LOCAL,
      DATABASE_URL: "postgresql://u:p@127.0.0.1:55432/finance_portal_personal",
      TRADING_DATABASE_URL:
        "postgresql://u:p@127.0.0.1:55432/finance_portal_trading",
      SCHWAB_APP_KEY: "AppKeySynthetic0123456789abcdef",
      SCHWAB_APP_SECRET: "SecretSynth01234",
      SCHWAB_CALLBACK_URL: "https://127.0.0.1:3443/cuenta/schwab/callback",
      TRADING_SECRET_KEY: Buffer.alloc(32, 1).toString("base64"),
    };

    function schwabItem(environment: Record<string, string>) {
      return getConfigHealth(environment).items.find(
        (item) => item.id === "schwab",
      );
    }

    it("serves the connection with all four variables and the trading base", () => {
      expect(servesSchwabConnection(getConfigHealth(READY))).toBe(true);
      expect(schwabItem(READY)).toMatchObject({
        status: "ready",
        missingVariables: [],
      });
    });

    it("names what is missing without degrading the portal", () => {
      const rest: Record<string, string> = { ...READY };
      delete rest.SCHWAB_APP_SECRET;
      delete rest.TRADING_SECRET_KEY;
      const health = getConfigHealth(rest);

      expect(servesSchwabConnection(health)).toBe(false);
      expect(schwabItem(rest)).toMatchObject({
        status: "disabled",
        missingVariables: ["SCHWAB_APP_SECRET", "TRADING_SECRET_KEY"],
      });
      expect(health.items.some((item) => item.status === "degraded")).toBe(
        false,
      );
    });

    it("waits for the trading base before asking for Schwab", () => {
      const rest: Record<string, string> = { ...READY };
      delete rest.TRADING_DATABASE_URL;
      expect(schwabItem(rest)).toMatchObject({
        status: "disabled",
        missingVariables: [],
      });
    });

    it.each([
      [
        "an http callback",
        { SCHWAB_CALLBACK_URL: "http://127.0.0.1:3443/cuenta/schwab/callback" },
        "SCHWAB_CALLBACK_URL",
      ],
      [
        "another callback path",
        { SCHWAB_CALLBACK_URL: "https://127.0.0.1:5000/callback" },
        "SCHWAB_CALLBACK_URL",
      ],
      [
        "a short module key",
        { TRADING_SECRET_KEY: Buffer.alloc(16).toString("base64") },
        "TRADING_SECRET_KEY",
      ],
      [
        "an app key with symbols",
        { SCHWAB_APP_KEY: "key:with:colons-0123456789" },
        "SCHWAB_APP_KEY",
      ],
    ])("degrades %s", (_, override, variable) => {
      const environment = { ...READY, ...override };
      expect(servesSchwabConnection(getConfigHealth(environment))).toBe(false);
      expect(schwabItem(environment)).toMatchObject({
        status: "degraded",
        missingVariables: [variable],
      });
    });

    it("accepts the Flask's root callback only outside Vercel", () => {
      const local = { ...READY, SCHWAB_CALLBACK_URL: "https://127.0.0.1:5000" };
      expect(servesSchwabConnection(getConfigHealth(local))).toBe(true);

      const production = {
        ...local,
        APP_RUNTIME_ACCESS: "protected",
        VERCEL: "1",
        VERCEL_ENV: "production",
      };
      expect(schwabItem(production)).toMatchObject({
        status: "degraded",
        missingVariables: ["SCHWAB_CALLBACK_URL"],
      });
    });

    it("ignores Schwab credentials on a Vercel preview (TM-14)", () => {
      const environment = {
        ...READY,
        APP_RUNTIME_ACCESS: "protected",
        VERCEL: "1",
        VERCEL_ENV: "preview",
      };
      expect(servesSchwabConnection(getConfigHealth(environment))).toBe(false);
      expect(schwabItem(environment)).toMatchObject({ status: "degraded" });
    });

    it("does not ask a locked runtime for Schwab", () => {
      expect(schwabItem({ ...READY, APP_MODE: "locked" })).toMatchObject({
        status: "disabled",
        missingVariables: [],
      });
    });
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
      "TRADING_DATABASE_URL",
      "TRADING_DATABASE_DIRECT_URL",
      "TRADING_DATABASE_TEST_URL",
      "TRADING_SECRET_KEY",
      "SCHWAB_APP_KEY",
      "SCHWAB_APP_SECRET",
      "SCHWAB_CALLBACK_URL",
      "CRON_SECRET",
      "MARKET_DATA_PROVIDER",
      "ALPACA_API_KEY_ID",
      "ALPACA_API_SECRET_KEY",
      "ALPACA_DATA_FEED",
      "SEC_USER_AGENT",
      "OPENROUTER_API_KEY",
      "TAVILY_API_KEY",
      "INDEC_API_TOKEN",
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
