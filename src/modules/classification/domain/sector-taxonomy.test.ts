import { describe, expect, it } from "vitest";

import {
  assertSectorCodesAreValid,
  listSectorCodes,
  resolveSectorLabel,
  SP500_SECTOR_TAXONOMY_ID,
} from "./sector-taxonomy";

describe("sector taxonomy", () => {
  it("is not named after GICS, because it is not GICS", () => {
    // El nombre es la decisión del punto 2 de la ADR 0025: llamarla `gics`
    // afirmaría una procedencia que nadie verificó contra S&P.
    expect(SP500_SECTOR_TAXONOMY_ID).toBe("sp500-wikipedia-gics-sector");
    expect(SP500_SECTOR_TAXONOMY_ID).not.toBe("gics");
  });

  it("declares the eleven sectors and no more", () => {
    expect(listSectorCodes()).toHaveLength(11);
    assertSectorCodesAreValid();
  });

  it("resolves a label to its code", () => {
    expect(resolveSectorLabel("Information Technology")).toEqual({
      ok: true,
      code: "information-technology",
      label: "Information Technology",
    });
  });

  it("treats spacing and case as the same answer written differently", () => {
    expect(resolveSectorLabel("  health   care ")).toEqual({
      ok: true,
      code: "health-care",
      label: "Health Care",
    });
  });

  it("names an unknown label instead of bucketing it", () => {
    // Un cajón «Otros» convertiría «no sé» en un grupo que la matriz dibujaría
    // como si fuera un sector.
    expect(resolveSectorLabel("Semiconductors")).toEqual({
      ok: false,
      code: "sector_label_unknown",
    });
  });

  it("names an absent sector separately from an unknown one", () => {
    expect(resolveSectorLabel(null)).toEqual({
      ok: false,
      code: "sector_absent_in_source",
    });
    expect(resolveSectorLabel("   ")).toEqual({
      ok: false,
      code: "sector_absent_in_source",
    });
  });

  it("does not leak the received value in the rejection", () => {
    const rejection = resolveSectorLabel("Some Unexpected Value");

    expect(JSON.stringify(rejection)).not.toContain("Unexpected");
  });
});
