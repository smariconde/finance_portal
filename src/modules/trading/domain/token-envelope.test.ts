import { describe, expect, it } from "vitest";

import {
  openToken,
  sealToken,
  TokenEnvelopeError,
} from "@/modules/trading/domain/token-envelope";

const KEY = Buffer.alloc(32, 3);
const TOKEN = "I0.b2F1dGgyLmJkYy5zY2h3YWIuY29t.sample-access-token@";

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("token envelope", () => {
  it("round-trips a token and never stores it in clear", () => {
    const envelope = sealToken(KEY, "access", TOKEN);

    expect(envelope.includes(Buffer.from(TOKEN))).toBe(false);
    expect(openToken(KEY, "access", envelope)).toBe(TOKEN);
  });

  it("uses a fresh IV on every seal", () => {
    expect(
      sealToken(KEY, "access", TOKEN).equals(sealToken(KEY, "access", TOKEN)),
    ).toBe(false);
  });

  it.each([
    ["another key", Buffer.alloc(32, 4), "access"],
    ["the other token kind", KEY, "refresh"],
  ] as const)("does not open with %s", (_, key, kind) => {
    const error = caught(() =>
      openToken(key, kind, sealToken(KEY, "access", TOKEN)),
    );
    expect(error).toBeInstanceOf(TokenEnvelopeError);
    expect((error as TokenEnvelopeError).code).toBe("authentication");
    expect(String(error)).not.toContain(TOKEN);
  });

  it("rejects a tampered ciphertext", () => {
    const envelope = sealToken(KEY, "refresh", TOKEN);
    envelope[envelope.length - 1] ^= 1;

    expect(
      (caught(() => openToken(KEY, "refresh", envelope)) as TokenEnvelopeError)
        .code,
    ).toBe("authentication");
  });

  it.each([
    ["an empty envelope", Buffer.alloc(0)],
    ["a header without ciphertext", Buffer.alloc(29, 1)],
    ["an unknown format", Buffer.concat([Buffer.from([2]), Buffer.alloc(40)])],
  ])("rejects %s by format", (_, envelope) => {
    expect(
      (caught(() => openToken(KEY, "access", envelope)) as TokenEnvelopeError)
        .code,
    ).toBe("format");
  });
});
