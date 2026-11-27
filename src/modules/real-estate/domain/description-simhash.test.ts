import { describe, expect, it } from "vitest";

import {
  descriptionSimhash,
  hammingDistance64,
  normalizedWords,
} from "./description-simhash";

const HOUSE =
  "Casa en venta en barrio Pueyrredón, tres dormitorios, patio con parrilla, cochera para dos autos y lavadero. Apta crédito, escritura inmediata.";

describe("description-simhash-1.0.0", () => {
  it("normaliza tildes, mayúsculas y puntuación", () => {
    expect(normalizedWords("Pueyrredón, 3 DORM.")).toEqual([
      "pueyrredon",
      "3",
      "dorm",
    ]);
  });

  it("es determinista y de 64 bits en hex", () => {
    const hash = descriptionSimhash(HOUSE);
    expect(hash).toMatch(/^[0-9a-f]{16}$/u);
    expect(descriptionSimhash(HOUSE)).toBe(hash);
  });

  it("no depende de tildes, mayúsculas ni espacios", () => {
    const variant = HOUSE.toUpperCase()
      .replaceAll("Ó", "O")
      .replaceAll(" ", "   ");
    expect(descriptionSimhash(variant)).toBe(descriptionSimhash(HOUSE));
  });

  it("deja cerca una redacción apenas distinta y lejos otra casa", () => {
    const near = descriptionSimhash(
      `${HOUSE} Consultar por visitas de lunes a viernes.`,
    )!;
    const other = descriptionSimhash(
      "Departamento monoambiente al frente en Nueva Córdoba, balcón, ascensor y amenities con pileta y gimnasio en el último piso del edificio.",
    )!;
    const base = descriptionSimhash(HOUSE)!;
    expect(hammingDistance64(base, near)).toBeLessThan(
      hammingDistance64(base, other),
    );
    expect(hammingDistance64(base, base)).toBe(0);
  });

  it("sin texto o con una sola palabra no hay huella", () => {
    expect(descriptionSimhash(null)).toBeNull();
    expect(descriptionSimhash("")).toBeNull();
    expect(descriptionSimhash("  ¡Oportunidad!  ")).toBeNull();
  });
});
