import { describe, expect, it } from "vitest";

import { listingFeatures } from "./listing-features";

const none = { portalConditions: [], portalLegalFlags: [] } as const;

describe("listing-features-1.0.0", () => {
  it("lee el estado del texto con precedencia a reciclar > a estrenar > bueno", () => {
    expect(
      listingFeatures({
        ...none,
        propertyType: "house",
        texts: [
          "Casa A RECICLAR en excelente ubicación, muy buen estado general",
        ],
      }).condition,
    ).toBe("to_renovate");
    expect(
      listingFeatures({
        ...none,
        propertyType: "apartment",
        texts: ["Departamento a estrenar"],
      }).condition,
    ).toBe("new");
    expect(
      listingFeatures({
        ...none,
        propertyType: "apartment",
        texts: ["Impecable, listo para vivir"],
      }).condition,
    ).toBe("good");
  });

  it("sin señales es unknown, nunca good por defecto", () => {
    expect(
      listingFeatures({
        ...none,
        propertyType: "house",
        texts: ["Casa de tres dormitorios"],
      }).condition,
    ).toBe("unknown");
    expect(
      listingFeatures({ ...none, propertyType: "house", texts: [null] })
        .condition,
    ).toBe("unknown");
  });

  it("suma lo que declara el portal", () => {
    expect(
      listingFeatures({
        propertyType: "house",
        texts: ["Hermosa casa"],
        portalConditions: ["good", "to_renovate"],
        portalLegalFlags: ["credit_eligible"],
      }),
    ).toEqual({ condition: "to_renovate", legalFlags: ["credit_eligible"] });
  });

  it("un terreno o una cochera no tienen estado", () => {
    for (const propertyType of ["land", "parking"] as const) {
      expect(
        listingFeatures({
          propertyType,
          texts: ["Lote a estrenar, excelente estado"],
          portalConditions: ["new"],
          portalLegalFlags: [],
        }).condition,
      ).toBe("unknown");
    }
  });

  it("lee los rasgos legales y respeta la negación", () => {
    expect(
      listingFeatures({
        ...none,
        propertyType: "ph",
        texts: [
          "PH apto crédito, escritura inmediata. Se vende por sucesión, declaratoria de herederos lista.",
        ],
      }).legalFlags,
    ).toEqual(["credit_eligible", "deed", "succession"]);
    expect(
      listingFeatures({
        ...none,
        propertyType: "house",
        texts: ["NO APTO CRÉDITO. Sólo boleto."],
      }).legalFlags,
    ).toEqual(["boleto_only"]);
    expect(
      listingFeatures({
        ...none,
        propertyType: "land",
        texts: ["Lote con derechos posesorios"],
      }).legalFlags,
    ).toEqual(["possession"]);
  });

  it("escriturado gana sobre un boleto mencionado", () => {
    expect(
      listingFeatures({
        ...none,
        propertyType: "house",
        texts: ["Se firma con boleto, escriturada"],
      }).legalFlags,
    ).toEqual(["deed"]);
  });

  it("posesión inmediata no es un derecho posesorio", () => {
    expect(
      listingFeatures({
        ...none,
        propertyType: "house",
        texts: ["Posesión inmediata"],
      }).legalFlags,
    ).toEqual([]);
  });
});
