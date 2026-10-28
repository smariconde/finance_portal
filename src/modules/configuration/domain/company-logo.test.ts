import { describe, expect, it } from "vitest";

import { companyHue, companyInitials, companyLogoUrl } from "./company-logo";

const KEY = "pk_AbCdEf123456";

describe("companyLogoUrl", () => {
  it("builds the ticker URL with the declared parameters", () => {
    const url = new URL(companyLogoUrl("aapl", KEY)!);

    expect(url.origin).toBe("https://img.logo.dev");
    expect(url.pathname).toBe("/ticker/AAPL");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      token: KEY,
      size: "64",
      format: "png",
      retina: "true",
      fallback: "404",
    });
  });

  it("keeps share-class tickers intact", () => {
    expect(companyLogoUrl("BRK.B", KEY)).toContain("/ticker/BRK.B?");
  });

  it("returns null without a publishable key", () => {
    expect(companyLogoUrl("AAPL", undefined)).toBeNull();
    expect(companyLogoUrl("AAPL", "")).toBeNull();
    expect(companyLogoUrl("AAPL", "   ")).toBeNull();
  });

  it("never puts a secret key in a URL the browser will see", () => {
    expect(companyLogoUrl("AAPL", "sk_secretvalue1234")).toBeNull();
    expect(companyLogoUrl("AAPL", "pk_short")).toBeNull();
  });

  it("rejects a ticker that could escape the path", () => {
    expect(companyLogoUrl("../AAPL", KEY)).toBeNull();
    expect(companyLogoUrl("AAPL?x=1", KEY)).toBeNull();
    expect(companyLogoUrl("", KEY)).toBeNull();
  });
});

describe("companyInitials", () => {
  it("takes one letter from each of the first two meaningful words", () => {
    expect(companyInitials("Exxon Mobil Corp", "XOM")).toBe("EM");
    expect(companyInitials("JPMorgan Chase & Co.", "JPM")).toBe("JC");
  });

  it("uses two letters of a single meaningful word", () => {
    expect(companyInitials("Apple Inc.", "AAPL")).toBe("AP");
    expect(companyInitials("The Coca-Cola Company", "KO")).toBe("CC");
  });

  it("falls back to the ticker without a name", () => {
    expect(companyInitials(null, "msft")).toBe("MS");
    expect(companyInitials("Inc.", "V")).toBe("V");
  });
});

describe("companyHue", () => {
  it("is stable per ticker and within the color wheel", () => {
    expect(companyHue("AAPL")).toBe(companyHue("aapl"));
    expect(companyHue("AAPL")).not.toBe(companyHue("MSFT"));
    expect(companyHue("AAPL")).toBeGreaterThanOrEqual(0);
    expect(companyHue("AAPL")).toBeLessThan(360);
  });
});
