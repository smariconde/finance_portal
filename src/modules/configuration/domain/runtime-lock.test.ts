import { describe, expect, it, vi } from "vitest";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  isRuntimeLockedError,
  isTradingUnavailableError,
  selectTradingDependency,
} from "@/modules/configuration/domain/runtime-lock";

const PERSONAL = {
  APP_MODE: "personal",
  APP_RUNTIME_ACCESS: "local",
  DATABASE_URL: "postgresql://u:p@127.0.0.1:55432/finance_portal_personal",
} as const;
const TRADING_URL = "postgresql://u:p@127.0.0.1:55432/finance_portal_trading";

describe("selectTradingDependency", () => {
  it("builds the dependency on a personal runtime with its base", () => {
    const create = vi.fn(() => "trading-database");

    expect(
      selectTradingDependency(
        getConfigHealth({ ...PERSONAL, TRADING_DATABASE_URL: TRADING_URL }),
        "trading-database",
        create,
      ),
    ).toBe("trading-database");
    expect(create).toHaveBeenCalledOnce();
  });

  it("refuses a locked runtime before reading the trading config", () => {
    const create = vi.fn();
    let caught: unknown;

    try {
      selectTradingDependency(
        getConfigHealth({ TRADING_DATABASE_URL: TRADING_URL }),
        "trading-database",
        create,
      );
    } catch (error) {
      caught = error;
    }

    expect(isRuntimeLockedError(caught)).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["the analysis base", { TRADING_DATABASE_URL: PERSONAL.DATABASE_URL }],
  ])("refuses a personal runtime whose trading base is %s", (_, extra) => {
    const create = vi.fn();
    let caught: unknown;

    try {
      selectTradingDependency(
        getConfigHealth({ ...PERSONAL, ...extra }),
        "trading-database",
        create,
      );
    } catch (error) {
      caught = error;
    }

    expect(isTradingUnavailableError(caught)).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
});
