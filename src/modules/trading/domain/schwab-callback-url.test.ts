import { describe, expect, it } from "vitest";

import {
  forwardedCallbackPath,
  schwabCallbackForm,
} from "@/modules/trading/domain/schwab-callback-url";

describe("schwabCallbackForm", () => {
  it.each([
    [
      "https://finance-portal-flame.vercel.app/cuenta/schwab/callback",
      true,
      "route",
    ],
    ["https://127.0.0.1:3443/cuenta/schwab/callback", false, "route"],
    ["https://127.0.0.1:5000", false, "local_root"],
    ["https://localhost:5000/", false, "local_root"],
  ] as const)("reads %s (Vercel %s) as %s", (value, onVercel, form) => {
    expect(schwabCallbackForm(value, { onVercel })).toBe(form);
  });

  it.each([
    ["the root on Vercel", "https://127.0.0.1:5000", true],
    [
      "the root of a public host",
      "https://finance-portal-flame.vercel.app",
      false,
    ],
    ["plain http", "http://127.0.0.1:5000", false],
    ["another path", "https://127.0.0.1:5000/callback", false],
    ["a query", "https://127.0.0.1:3443/cuenta/schwab/callback?x=1", false],
    ["credentials", "https://u:p@127.0.0.1:5000", false],
    ["no value", undefined, false],
  ] as const)("refuses %s", (_, value, onVercel) => {
    expect(schwabCallbackForm(value, { onVercel })).toBeNull();
  });
});

describe("forwardedCallbackPath", () => {
  it("forwards only code, state and error, re-encoded", () => {
    expect(
      forwardedCallbackPath({
        code: "C0.abc/def+ghi@",
        state: "s".repeat(43),
        session: "unrelated",
      }),
    ).toBe(
      `/cuenta/schwab/callback?code=C0.abc%2Fdef%2Bghi%40&state=${"s".repeat(43)}`,
    );
  });

  it("forwards a cancellation", () => {
    expect(
      forwardedCallbackPath({ error: "access_denied", state: "s".repeat(43) }),
    ).toBe(
      `/cuenta/schwab/callback?state=${"s".repeat(43)}&error=access_denied`,
    );
  });

  it.each([
    ["no state", { code: "C0.code-value" }],
    ["a state alone", { state: "s".repeat(43) }],
    ["a repeated parameter", { code: ["a", "b"], state: "s" }],
    ["an oversized code", { code: "x".repeat(1025), state: "s" }],
  ])("ignores a visit with %s", (_, query) => {
    expect(forwardedCallbackPath(query)).toBeNull();
  });
});
