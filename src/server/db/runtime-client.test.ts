import { describe, expect, it } from "vitest";

import { resolveRuntimeDatabaseUrl } from "./runtime-client";

describe("resolveRuntimeDatabaseUrl", () => {
  it("uses only the pooled runtime URL", () => {
    const environment = Object.defineProperty(
      { DATABASE_URL: "postgres://pooled-runtime" },
      "DATABASE_DIRECT_URL",
      {
        get() {
          throw new Error("direct migration URL was read by runtime code");
        },
      },
    );

    expect(resolveRuntimeDatabaseUrl(environment)).toBe(
      "postgres://pooled-runtime",
    );
  });

  it("fails without exposing configuration values", () => {
    expect(() => resolveRuntimeDatabaseUrl({})).toThrow(
      "DATABASE_URL is required for personal runtime storage.",
    );
  });
});
