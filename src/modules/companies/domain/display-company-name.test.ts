import { describe, expect, it } from "vitest";

import { displayCompanyName } from "./display-company-name";

describe("displayCompanyName", () => {
  it("lleva un nombre en mayúsculas a mayúscula inicial", () => {
    expect(displayCompanyName("JPMORGAN CHASE & CO")).toBe(
      "Jpmorgan Chase & Co.",
    );
    expect(displayCompanyName("ABBOTT LABORATORIES")).toBe(
      "Abbott Laboratories",
    );
    expect(displayCompanyName("ADVANCED MICRO DEVICES INC")).toBe(
      "Advanced Micro Devices Inc.",
    );
  });

  it("deja como vino un nombre que ya trae minúsculas", () => {
    expect(displayCompanyName("Apple Inc.")).toBe("Apple Inc.");
    expect(displayCompanyName("eBay Inc.")).toBe("eBay Inc.");
  });

  it("conserva siglas, dígitos y símbolos", () => {
    expect(displayCompanyName("3M CO")).toBe("3M Co.");
    expect(displayCompanyName("AT&T INC.")).toBe("AT&T Inc.");
    expect(displayCompanyName("SMITH A O CORP")).toBe("Smith A O Corp.");
    expect(displayCompanyName("CVS HEALTH CORP")).toBe("CVS Health Corp.");
  });

  it("escribe los conectores en minúscula salvo al principio", () => {
    expect(displayCompanyName("BANK OF AMERICA CORP /DE/")).toBe(
      "Bank of America Corp. /DE/",
    );
    expect(displayCompanyName("THE TRAVELERS COMPANIES, INC.")).toBe(
      "The Travelers Companies, Inc.",
    );
  });

  it("respeta guiones y apóstrofos", () => {
    expect(displayCompanyName("COCA-COLA CO")).toBe("Coca-Cola Co.");
    expect(displayCompanyName("MCDONALD'S CORP")).toBe("Mcdonald's Corp.");
    expect(displayCompanyName("O'REILLY AUTOMOTIVE INC")).toBe(
      "O'Reilly Automotive Inc.",
    );
  });

  it("no inventa un nombre vacío", () => {
    expect(displayCompanyName("  ")).toBe("");
  });
});
