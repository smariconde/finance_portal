import { describe, expect, it } from "vitest";

import {
  companyLogoFit,
  companyHue,
  companyLogoAssetUrl,
  companyInitials,
  companyLogoPublishableKey,
  companyLogoUrl,
} from "./company-logo";

const KEY = "pk_AbCdEf123456";

describe("companyLogoAssetUrl", () => {
  it("shares one local resource across tables and charts without a provider key", () => {
    expect(companyLogoAssetUrl(" ko ")).toBe("/api/company-logos/KO");
    expect(companyLogoAssetUrl("BRK.B")).toBe("/api/company-logos/BRK.B");
    expect(companyLogoAssetUrl("../KO")).toBeNull();
    expect(companyLogoAssetUrl("KO?token=bad")).toBeNull();
  });
});

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

  it("only exposes a valid publishable key to dynamic client lists", () => {
    expect(companyLogoPublishableKey(` ${KEY} `)).toBe(KEY);
    expect(companyLogoPublishableKey("sk_secretvalue1234")).toBeNull();
    expect(companyLogoPublishableKey(undefined)).toBeNull();
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

describe("companyLogoFit", () => {
  it("cubre el círculo con una placa opaca hasta las esquinas", () => {
    expect(companyLogoFit([255, 255, 250, 255])).toBe("cover");
  });

  it("achica un dibujo que deja alguna esquina transparente", () => {
    expect(companyLogoFit([0, 0, 0, 0])).toBe("inset");
    expect(companyLogoFit([255, 255, 255, 249])).toBe("inset");
  });

  it("no recorta sin las cuatro lecturas", () => {
    expect(companyLogoFit([])).toBe("inset");
    expect(companyLogoFit([255, 255, 255])).toBe("inset");
    expect(companyLogoFit([255, 255, 255, Number.NaN])).toBe("inset");
  });
});
