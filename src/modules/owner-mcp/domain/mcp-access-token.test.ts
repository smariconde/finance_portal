import { describe, expect, it } from "vitest";

import { bearerMatches, parseMcpAccessToken } from "./mcp-access-token";

const TOKEN = Buffer.alloc(32, 9).toString("base64url");

describe("parseMcpAccessToken", () => {
  it("acepta 32 bytes o más en base64url canónico", () => {
    expect(parseMcpAccessToken(TOKEN)).toMatchObject({ ok: true });
    expect(
      parseMcpAccessToken(Buffer.alloc(48, 1).toString("base64url")),
    ).toMatchObject({ ok: true });
  });

  it("distingue la falta de un valor inválido", () => {
    expect(parseMcpAccessToken(undefined)).toEqual({
      ok: false,
      problem: "missing",
    });
    expect(parseMcpAccessToken("  ")).toEqual({
      ok: false,
      problem: "missing",
    });
    for (const value of [
      Buffer.alloc(31, 1).toString("base64url"),
      Buffer.alloc(32, 1).toString("base64"),
      `${TOKEN}=`,
      "correct horse battery staple correct horse battery",
    ]) {
      expect(parseMcpAccessToken(value)).toEqual({
        ok: false,
        problem: "invalid",
      });
    }
  });
});

describe("bearerMatches", () => {
  const resolution = parseMcpAccessToken(TOKEN);
  if (!resolution.ok) throw new Error("fixture token must parse");
  const digest = resolution.digest;

  it("compara el token del header Bearer", () => {
    expect(bearerMatches(`Bearer ${TOKEN}`, digest)).toBe(true);
  });

  it("rechaza otro token, otro esquema o la falta del header", () => {
    expect(bearerMatches(`Bearer ${TOKEN.slice(1)}x`, digest)).toBe(false);
    expect(bearerMatches(`Basic ${TOKEN}`, digest)).toBe(false);
    expect(bearerMatches(TOKEN, digest)).toBe(false);
    expect(bearerMatches(`Bearer  ${TOKEN}`, digest)).toBe(false);
    expect(bearerMatches(null, digest)).toBe(false);
    expect(bearerMatches("", digest)).toBe(false);
  });
});
