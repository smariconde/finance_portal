import { describe, expect, it } from "vitest";

import { storedTextEs } from "./stored-text";

describe("storedTextEs", () => {
  it("translates a stored thesis by exact body", () => {
    expect(
      storedTextEs(
        "Growth at the weakest measured rate and no excess returns after year 10.",
      ),
    ).toBe(
      "Crecimiento a la tasa más baja medida en su historia y sin retornos extraordinarios después del año 10.",
    );
  });

  it("keeps the rule version that wrote the text at the end", () => {
    expect(
      storedTextEs(
        "derived-assumptions-2.0.0: no recipe separates non-operating assets; valued at zero and named.",
      ),
    ).toBe(
      "Ninguna receta separa activos no operativos; se valúan en cero y se dice. (derived-assumptions-2.0.0)",
    );
  });

  it("carries variable parts into the translation", () => {
    expect(
      storedTextEs(
        "zero-debt-evidence-1.0.0: no borrowing or scheduled debt maturity in the last 5 fiscal years, and interest is absent or within the top rating band; valued at zero and named.",
      ),
    ).toContain("en los últimos 5 ejercicios");
  });

  it("shows an unknown text as it was stored", () => {
    expect(storedTextEs("rule-1.0.0: something new.")).toBe(
      "rule-1.0.0: something new.",
    );
    expect(storedTextEs("Importe reportado por la fuente.")).toBe(
      "Importe reportado por la fuente.",
    );
  });
});
