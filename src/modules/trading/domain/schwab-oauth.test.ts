import { describe, expect, it } from "vitest";

import {
  accessNeedsRefresh,
  authorizationCodeForm,
  buildSchwabAuthorizeUrl,
  parseAuthorizationCode,
  parseSchwabTokenResponse,
  refreshExpiresAtFrom,
  refreshTokenForm,
  SchwabTokenResponseError,
} from "@/modules/trading/domain/schwab-oauth";

const RECEIVED_AT = "2026-11-13T15:00:00.000Z";
const TOKEN_BODY = {
  expires_in: 1800,
  token_type: "Bearer",
  scope: "api",
  refresh_token: "refresh-token-value-0001",
  access_token: "I0.access-token-value-0001@",
  id_token: "eyJ.id.token",
};

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function rejection(run: () => unknown): SchwabTokenResponseError {
  try {
    run();
  } catch (error) {
    return error as SchwabTokenResponseError;
  }
  throw new Error("expected a rejection");
}

describe("buildSchwabAuthorizeUrl", () => {
  it("asks for a code with the registered callback and the state", () => {
    const url = new URL(
      buildSchwabAuthorizeUrl({
        appKey: "A".repeat(32),
        callbackUrl: "https://127.0.0.1:3443/cuenta/schwab/callback",
        state: "s".repeat(43),
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(
      "https://api.schwabapi.com/v1/oauth/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "A".repeat(32),
      redirect_uri: "https://127.0.0.1:3443/cuenta/schwab/callback",
      response_type: "code",
      state: "s".repeat(43),
    });
  });

  it("refuses an app key that is not one", () => {
    expect(() =>
      buildSchwabAuthorizeUrl({
        appKey: "key with spaces",
        callbackUrl: "https://x/cb",
        state: "s",
      }),
    ).toThrow();
  });
});

describe("token forms", () => {
  it("exchanges the code for the same callback", () => {
    expect(
      new TextDecoder().decode(
        authorizationCodeForm({
          code: "C0.code/with+chars@",
          callbackUrl: "https://127.0.0.1:3443/cuenta/schwab/callback",
        }),
      ),
    ).toBe(
      "grant_type=authorization_code&code=C0.code%2Fwith%2Bchars%40&redirect_uri=https%3A%2F%2F127.0.0.1%3A3443%2Fcuenta%2Fschwab%2Fcallback",
    );
  });

  it("renews with the refresh token", () => {
    expect(new TextDecoder().decode(refreshTokenForm("r-token"))).toBe(
      "grant_type=refresh_token&refresh_token=r-token",
    );
  });

  it.each([
    [null, null],
    ["short", null],
    ["C0.valid-code-value@", "C0.valid-code-value@"],
    ["has space inside", null],
  ])("reads the callback code %s", (value, expected) => {
    expect(parseAuthorizationCode(value)).toBe(expected);
  });
});

describe("parseSchwabTokenResponse", () => {
  it("reads the grant and dates the access expiry from reception", () => {
    expect(parseSchwabTokenResponse(encode(TOKEN_BODY), RECEIVED_AT)).toEqual({
      accessToken: TOKEN_BODY.access_token,
      refreshToken: TOKEN_BODY.refresh_token,
      accessExpiresAt: "2026-11-13T15:30:00.000Z",
    });
  });

  it("accepts a renewal without id_token", () => {
    const renewal: Record<string, unknown> = { ...TOKEN_BODY };
    delete renewal.id_token;
    expect(
      parseSchwabTokenResponse(encode(renewal), RECEIVED_AT).accessToken,
    ).toBe(TOKEN_BODY.access_token);
  });

  it("rejects an unknown field by name, never by value", () => {
    const error = rejection(() =>
      parseSchwabTokenResponse(
        encode({ ...TOKEN_BODY, account_hint: "secret-hint" }),
        RECEIVED_AT,
      ),
    );

    expect(error.code).toBe("unexpected_shape");
    expect(error.message).toContain("account_hint");
    expect(error.message).not.toContain("secret-hint");
    expect(error.message).not.toContain(TOKEN_BODY.access_token);
  });

  it.each([
    ["another token type", { ...TOKEN_BODY, token_type: "MAC" }],
    ["a missing refresh token", { ...TOKEN_BODY, refresh_token: undefined }],
    ["a zero lifetime", { ...TOKEN_BODY, expires_in: 0 }],
    ["a fractional lifetime", { ...TOKEN_BODY, expires_in: 1800.5 }],
    ["a token with a newline", { ...TOKEN_BODY, access_token: "abc\ndefghij" }],
  ])("rejects %s", (_, body) => {
    expect(
      rejection(() => parseSchwabTokenResponse(encode(body), RECEIVED_AT)).code,
    ).toBe("unexpected_shape");
  });

  it("rejects a body that is not JSON", () => {
    expect(
      rejection(() =>
        parseSchwabTokenResponse(
          new TextEncoder().encode("<html>"),
          RECEIVED_AT,
        ),
      ).code,
    ).toBe("not_json");
  });
});

describe("token lifetimes", () => {
  it("fixes the refresh expiry seven days after authorization", () => {
    expect(refreshExpiresAtFrom(RECEIVED_AT)).toBe("2026-11-20T15:00:00.000Z");
  });

  it("renews the access token within its last minute, inclusive of expiry", () => {
    const expiresAt = "2026-11-13T15:30:00.000Z";
    expect(accessNeedsRefresh(expiresAt, "2026-11-13T15:28:59.999Z")).toBe(
      false,
    );
    expect(accessNeedsRefresh(expiresAt, "2026-11-13T15:29:00.001Z")).toBe(
      true,
    );
    expect(accessNeedsRefresh(expiresAt, "2026-11-13T15:31:00.000Z")).toBe(
      true,
    );
  });
});
