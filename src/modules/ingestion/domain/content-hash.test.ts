import { describe, expect, it } from "vitest";

import {
  canonicalize,
  CanonicalSerializationError,
  computeContentHash,
} from "./content-hash";

describe("canonicalize", () => {
  it("produces the same text regardless of key insertion order", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalize({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("preserves array order because it carries meaning", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("omits undefined properties instead of emitting null", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("normalizes negative zero so the hash does not depend on its sign", () => {
    expect(canonicalize({ value: -0 })).toBe(canonicalize({ value: 0 }));
  });

  it("rejects non finite numbers instead of coercing them", () => {
    expect(() => canonicalize({ value: Number.NaN })).toThrow(
      CanonicalSerializationError,
    );
    expect(() => canonicalize({ value: Number.POSITIVE_INFINITY })).toThrow(
      CanonicalSerializationError,
    );
  });

  it("rejects values without a stable representation", () => {
    expect(() => canonicalize({ value: BigInt(10) })).toThrow(
      CanonicalSerializationError,
    );
    expect(() => canonicalize({ at: new Date(0) })).toThrow(
      CanonicalSerializationError,
    );
    expect(() => canonicalize([undefined])).toThrow(
      CanonicalSerializationError,
    );
  });

  it("reports the failing path", () => {
    expect(() => canonicalize({ outer: [{ inner: Number.NaN }] })).toThrow(
      /path: \$\.outer\[0\]\.inner/u,
    );
  });
});

describe("computeContentHash", () => {
  it("is deterministic across equivalent objects", () => {
    expect(computeContentHash({ a: 1, b: [true, null] })).toBe(
      computeContentHash({ b: [true, null], a: 1 }),
    );
  });

  it("changes when any relevant field changes", () => {
    expect(
      computeContentHash({ parserVersion: "1.0.0", value: "10" }),
    ).not.toBe(computeContentHash({ parserVersion: "1.0.1", value: "10" }));
  });

  it("returns a lowercase sha256 digest", () => {
    expect(computeContentHash({})).toMatch(/^[a-f0-9]{64}$/u);
  });
});
