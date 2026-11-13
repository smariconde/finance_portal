import { describe, expect, it } from "vitest";

import {
  createOAuthState,
  hashOAuthState,
} from "@/modules/trading/domain/oauth-state";

describe("oauth state", () => {
  it("emits 32 random bytes in base64url and stores only its hash", () => {
    const issued = createOAuthState(Buffer.alloc(32, 9));

    expect(issued.state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(issued.hash.byteLength).toBe(32);
    expect(issued.hash.toString("hex")).not.toContain(
      Buffer.from(issued.state).toString("hex"),
    );
    expect(hashOAuthState(issued.state)?.equals(issued.hash)).toBe(true);
  });

  it("differs on every connection", () => {
    expect(createOAuthState().state).not.toBe(createOAuthState().state);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["too short", "abc"],
    ["padded base64", `${"A".repeat(42)}=`],
    ["with a space", `${"A".repeat(42)} `],
  ])("refuses a %s state before any lookup", (_, value) => {
    expect(hashOAuthState(value)).toBeNull();
  });

  it("refuses fewer than 32 random bytes", () => {
    expect(() => createOAuthState(Buffer.alloc(16))).toThrow("32 random bytes");
  });
});
