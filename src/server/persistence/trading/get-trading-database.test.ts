import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La raíz de composición de trading falla cerrada (`F11-02`, `TM-01`) y nunca
 * pide la base de análisis: la cuenta y el diario tienen que funcionar con esa
 * base caída (gate de la Fase 11, ADR 0076). Los dos clientes se reemplazan por
 * espías porque el driver es perezoso: lo que se prueba es qué base se pidió.
 */
const tradingDatabase = vi.hoisted(() =>
  vi.fn(() => ({ marker: "fake-trading-database" })),
);
const analysisDatabase = vi.hoisted(() => vi.fn());

vi.mock("@/server/db/trading/runtime-client", () => ({
  getTradingDatabase: tradingDatabase,
}));
vi.mock("@/server/db/runtime-client", () => ({
  getRuntimeDatabase: analysisDatabase,
}));

const PERSONAL = {
  APP_MODE: "personal",
  APP_RUNTIME_ACCESS: "local",
  DATABASE_URL: "postgresql://u:p@127.0.0.1:55432/finance_portal_personal",
};
const TRADING_URL = "postgresql://u:p@127.0.0.1:55432/finance_portal_trading";

function applyEnvironment(environment: Record<string, string>) {
  for (const name of [
    "APP_MODE",
    "APP_RUNTIME_ACCESS",
    "DATABASE_URL",
    "TRADING_DATABASE_URL",
    "VERCEL",
    "VERCEL_ENV",
  ]) {
    vi.stubEnv(name, undefined as unknown as string);
  }
  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }
}

async function load() {
  vi.resetModules();
  const { getTradingDatabaseConnection } =
    await import("@/server/persistence/trading/get-trading-database");
  const lock = await import("@/modules/configuration/domain/runtime-lock");
  return { getTradingDatabaseConnection, ...lock };
}

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("getTradingDatabaseConnection", () => {
  beforeEach(() => {
    tradingDatabase.mockClear();
    analysisDatabase.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds only the trading database on a configured personal runtime", async () => {
    applyEnvironment({ ...PERSONAL, TRADING_DATABASE_URL: TRADING_URL });
    const { getTradingDatabaseConnection } = await load();

    expect(getTradingDatabaseConnection()).toEqual({
      marker: "fake-trading-database",
    });
    expect(tradingDatabase).toHaveBeenCalledOnce();
    expect(analysisDatabase).not.toHaveBeenCalled();
  });

  it("refuses a locked runtime without opening anything", async () => {
    applyEnvironment({ TRADING_DATABASE_URL: TRADING_URL });
    const { getTradingDatabaseConnection, isRuntimeLockedError } = await load();

    expect(isRuntimeLockedError(caught(getTradingDatabaseConnection))).toBe(
      true,
    );
    expect(tradingDatabase).not.toHaveBeenCalled();
    expect(analysisDatabase).not.toHaveBeenCalled();
  });

  it.each([
    ["without its variable", PERSONAL],
    [
      "pointed at the analysis base",
      { ...PERSONAL, TRADING_DATABASE_URL: PERSONAL.DATABASE_URL },
    ],
    [
      "on a Vercel preview",
      {
        ...PERSONAL,
        APP_RUNTIME_ACCESS: "protected",
        TRADING_DATABASE_URL: TRADING_URL,
        VERCEL: "1",
        VERCEL_ENV: "preview",
      },
    ],
  ])("refuses a personal runtime %s", async (_, environment) => {
    applyEnvironment(environment);
    const { getTradingDatabaseConnection, isTradingUnavailableError } =
      await load();

    expect(
      isTradingUnavailableError(caught(getTradingDatabaseConnection)),
    ).toBe(true);
    expect(tradingDatabase).not.toHaveBeenCalled();
    expect(analysisDatabase).not.toHaveBeenCalled();
  });
});
