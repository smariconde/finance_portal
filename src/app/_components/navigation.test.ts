import { describe, expect, it } from "vitest";

import { breadcrumbsFor, isWithin } from "./navigation";

describe("isWithin", () => {
  it("cubre las rutas hijas y no las que sólo empiezan igual", () => {
    expect(isWithin("/plan", "/plan")).toBe(true);
    expect(isWithin("/plan/finviz", "/plan")).toBe(true);
    expect(isWithin("/planilla", "/plan")).toBe(false);
  });

  it("el inicio es sólo la raíz", () => {
    expect(isWithin("/", "/")).toBe(true);
    expect(isWithin("/cuenta", "/")).toBe(false);
  });
});

describe("breadcrumbsFor", () => {
  it("el inicio, el calendario y la configuración no tienen sección", () => {
    expect(breadcrumbsFor("/")).toEqual([{ label: "Inicio", href: null }]);
    expect(breadcrumbsFor("/calendario")).toEqual([
      { label: "Calendario", href: null },
    ]);
    expect(breadcrumbsFor("/configuracion")).toEqual([
      { label: "Configuración", href: null },
    ]);
  });

  it("una página de sección es sección › página, sin vínculo a sí misma", () => {
    expect(breadcrumbsFor("/plan")).toEqual([
      { label: "Trading", href: null },
      { label: "Plan", href: null },
    ]);
    expect(breadcrumbsFor("/argentina/")).toEqual([
      { label: "Análisis", href: null },
      { label: "Argentina", href: null },
    ]);
  });

  it("una ruta hermana vincula a su página", () => {
    expect(breadcrumbsFor("/diario/estadisticas")).toEqual([
      { label: "Trading", href: null },
      { label: "Diario", href: "/diario" },
      { label: "Estadísticas", href: null },
    ]);
    expect(breadcrumbsFor("/plan/finviz")).toEqual([
      { label: "Trading", href: null },
      { label: "Plan", href: "/plan" },
      { label: "Finviz", href: null },
    ]);
  });

  it("nombra los segmentos dinámicos como su página", () => {
    expect(breadcrumbsFor("/valuacion/aapl").at(-1)).toEqual({
      label: "AAPL",
      href: null,
    });
    expect(breadcrumbsFor("/valuacion/referencia").at(-1)?.label).toBe(
      "Corrida de referencia",
    );
    expect(breadcrumbsFor("/diario/12345-678").at(-1)?.label).toBe("Trade");
    expect(breadcrumbsFor("/lecciones/velas").at(-1)?.label).toBe("Lección");
  });

  it("el sector sale de su código y las divergencias cuelgan de él", () => {
    expect(
      breadcrumbsFor("/sectores/information-technology/divergencias"),
    ).toEqual([
      { label: "Análisis", href: null },
      { label: "Matrices", href: "/sectores" },
      {
        label: "Information Technology",
        href: "/sectores/information-technology",
      },
      { label: "Divergencias", href: null },
    ]);
  });

  it("no tropieza con un segmento mal codificado", () => {
    expect(breadcrumbsFor("/valuacion/%E0").at(-1)?.label).toBe("%E0");
  });

  it("una ruta que el mapa no conoce no inventa un lugar", () => {
    expect(breadcrumbsFor("/no-existe")).toEqual([]);
  });
});
