import { describe, expect, it } from "vitest";

import { safeErrorSummary } from "./safe-error";

describe("safeErrorSummary", () => {
  it("logs the type and the driver code, never the message", () => {
    const error = Object.assign(
      new Error("connect to db.example:5432 failed"),
      {
        code: "ECONNREFUSED",
      },
    );
    expect(safeErrorSummary(error)).toBe("Error ECONNREFUSED");
  });

  it("adds the code of the cause", () => {
    const cause = Object.assign(new Error("password authentication failed"), {
      code: "28P01",
    });
    const error = new TypeError("wrapped", { cause });
    expect(safeErrorSummary(error)).toBe("TypeError 28P01");
  });

  it("drops a code that is not a plain token", () => {
    const error = Object.assign(new Error("x"), { code: "host=db secret" });
    expect(safeErrorSummary(error)).toBe("Error");
  });

  it("names a non-error by its type", () => {
    expect(safeErrorSummary("boom")).toBe("string");
  });
});
