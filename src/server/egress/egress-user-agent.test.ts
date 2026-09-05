import { describe, expect, it } from "vitest";

import { resolveEgressUserAgent } from "@/server/egress/egress-user-agent";

describe("resolveEgressUserAgent", () => {
  it("accepts a declaration that carries a name and a contact", () => {
    expect(
      resolveEgressUserAgent("Portal Financiero owner@example.test"),
    ).toEqual({
      ok: true,
      userAgent: "Portal Financiero owner@example.test",
    });
  });

  it("refuses an absent declaration instead of inventing a default", () => {
    // Un default del repositorio haría que toda instancia se presentara igual,
    // que es justo lo que la Fair Access de la SEC pide evitar.
    expect(resolveEgressUserAgent(undefined).ok).toBe(false);
    expect(resolveEgressUserAgent("   ").ok).toBe(false);
    expect(resolveEgressUserAgent(undefined)).toEqual({
      ok: false,
      problem: "missing",
    });
  });

  it("refuses a declaration with no reachable contact", () => {
    expect(resolveEgressUserAgent("Portal Financiero 1.0")).toEqual({
      ok: false,
      problem: "no_contact",
    });
  });

  it("refuses a header injection through the user agent", () => {
    // El valor va crudo a un header: un CR/LF partiría el request en dos y
    // dejaría inyectar headers propios contra la fuente.
    for (const raw of [
      "Portal owner@example.test\r\nX-Injected: 1",
      "Portal owner@example.test\nHost: attacker.example",
      "Portal owner@example.test\u0000",
      "Portal owner@example.test\u007fHost: attacker.example",
    ]) {
      expect(resolveEgressUserAgent(raw)).toEqual({
        ok: false,
        problem: "not_printable_ascii",
      });
    }
  });

  it("trims surrounding whitespace rather than rejecting it", () => {
    // Un espacio de más es un descuido de configuración, no un ataque: se
    // normaliza. Lo que se rechaza es el carácter que cambia la forma del
    // request, y lo que sale a la red es el valor ya normalizado.
    expect(resolveEgressUserAgent("  Portal owner@example.test  ")).toEqual({
      ok: true,
      userAgent: "Portal owner@example.test",
    });
  });

  it("refuses a declaration that is too short or too long to be responsible", () => {
    expect(resolveEgressUserAgent("a@b.co").ok).toBe(false);
    expect(
      resolveEgressUserAgent(`${"x".repeat(200)} owner@example.test`).ok,
    ).toBe(false);
  });

  it("never echoes the rejected value", () => {
    const resolution = resolveEgressUserAgent("secreto-del-owner");

    expect(JSON.stringify(resolution)).not.toContain("secreto");
  });
});
