import { describe, expect, it } from "vitest";

import {
  formatClock,
  formatQuantity,
  liveFailureCopy,
} from "./live-account-copy";

describe("liveFailureCopy", () => {
  it("names the known codes", () => {
    expect(liveFailureCopy("not_connected").title).toBe(
      "Sin acceso a la cuenta",
    );
    expect(liveFailureCopy("account_type_not_measured").title).toBe(
      "Cuenta de margen sin medir",
    );
  });

  it("groups quarantines and door failures", () => {
    expect(liveFailureCopy("order_schema_changed").title).toBe(
      "Schwab cambió el formato",
    );
    expect(liveFailureCopy("egress_deadline_exceeded").title).toBe(
      "Schwab no respondió",
    );
    expect(liveFailureCopy("http_500").title).toBe("No se pudo leer la cuenta");
  });
});

describe("formatQuantity", () => {
  it("keeps fractional shares up to four decimals", () => {
    expect(formatQuantity("10")).toBe("10");
    expect(formatQuantity("0.5")).toBe("0,5");
    expect(formatQuantity("1234.123456")).toBe("1.234,1235");
  });
});

describe("formatClock", () => {
  it("reads as a 24-hour clock in Buenos Aires", () => {
    expect(formatClock("2026-11-14T02:17:00.000Z")).toBe("23:17:00");
  });
});
