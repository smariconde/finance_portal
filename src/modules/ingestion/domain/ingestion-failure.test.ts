import { describe, expect, it } from "vitest";

import {
  MAX_FAILURE_MESSAGE_LENGTH,
  redactFailureMessage,
  toSafeIngestionFailure,
} from "./ingestion-failure";

describe("redactFailureMessage", () => {
  it("removes credentials embedded in a connection string", () => {
    const redacted = redactFailureMessage(
      "connect ECONNREFUSED postgres://portal:s3cr3t@db.internal:5432/finance",
    );

    expect(redacted).not.toContain("s3cr3t");
    expect(redacted).toContain("postgres://[redacted]@");
  });

  it("removes sensitive key/value pairs", () => {
    const redacted = redactFailureMessage(
      "request failed api_key=PK12345 authorization: Bearer abc",
    );

    expect(redacted).not.toContain("PK12345");
    expect(redacted).toContain("api_key=[redacted]");
  });

  it("removes long opaque literals that look like keys", () => {
    const redacted = redactFailureMessage(
      "unexpected token AKIAIOSFODNN7EXAMPLEKEYVALUE1234 in response",
    );

    expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLEKEYVALUE1234");
    expect(redacted).toContain("[redacted]");
  });

  it("collapses whitespace and truncates long messages", () => {
    const redacted = redactFailureMessage(
      `line one\n   line two ${"x ".repeat(300)}`,
    );

    expect(redacted.length).toBeLessThanOrEqual(MAX_FAILURE_MESSAGE_LENGTH);
    expect(redacted).not.toContain("\n");
  });

  it("keeps a usable message when the input is empty", () => {
    expect(redactFailureMessage("   ")).toBe("Error sin mensaje utilizable.");
  });
});

describe("toSafeIngestionFailure", () => {
  it("never carries the stack or the original cause", () => {
    const cause = new Error("boom at token=ZZZZ");
    const failure = toSafeIngestionFailure("provider_error", cause);

    expect(failure).toStrictEqual({
      code: "provider_error",
      message: "boom at token=[redacted]",
      retryable: true,
    });
  });

  it("marks non transport failures as non retryable", () => {
    expect(
      toSafeIngestionFailure("rights_not_approved", "sin derechos").retryable,
    ).toBe(false);
    expect(toSafeIngestionFailure("unknown_error", {}).retryable).toBe(false);
  });

  it("accepts a non error cause without leaking its shape", () => {
    expect(toSafeIngestionFailure("unknown_error", { secret: "abc" })).toEqual({
      code: "unknown_error",
      message: "Error sin mensaje utilizable.",
      retryable: false,
    });
  });
});
