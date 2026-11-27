import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * El tema es la única fuente de color (`globals.css`). Este test lo mide como
 * lo haría axe, pero contra **todos** los fondos y en los dos temas, sin
 * depender del estado que la E2E encuentre el día que corre: el 2026-11-27 un
 * `text-amber-700` sobre el `accent` de la celda seleccionada falló recién
 * cuando el cierre temprano fue hoy.
 */
const css = readFileSync("src/app/globals.css", "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing block ${selector}`);
  const end = css.indexOf("}", start);
  const vars: Record<string, string> = {};
  for (const match of css
    .slice(start, end)
    .matchAll(/--([a-z0-9-]+):\s*([^;]+);/gu)) {
    vars[match[1]!] = match[2]!.trim();
  }
  return vars;
}

const light = block(":root");
const darkMedia = block(':root:not([data-theme="light"])');
const darkExplicit = block(':root[data-theme="dark"]');
/** El oscuro hereda del claro lo que no redefine. */
const dark = { ...light, ...darkExplicit };

type Rgb = readonly [number, number, number];

/** OKLCH → sRGB lineal (Björn Ottosson), suficiente para medir contraste. */
function oklchToLinear(l: number, c: number, hue: number): Rgb {
  const h = (hue * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

const toLinear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const toSrgb = (v: number) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;

function linearOf(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/iu.exec(value);
  if (hex) {
    const n = hex[1]!;
    return [0, 2, 4].map((i) =>
      toLinear(parseInt(n.slice(i, i + 2), 16) / 255),
    ) as unknown as Rgb;
  }
  const oklch = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/u.exec(value);
  if (oklch) {
    return oklchToLinear(Number(oklch[1]), Number(oklch[2]), Number(oklch[3]));
  }
  throw new Error(`unmeasurable color ${value}`);
}

/** Un tinte `fill/alpha` sobre un fondo, mezclado en sRGB como el navegador. */
function tint(fill: Rgb, ground: Rgb, alpha: number): Rgb {
  return fill.map((f, i) =>
    toLinear(toSrgb(f) * alpha + toSrgb(ground[i]!) * (1 - alpha)),
  ) as unknown as Rgb;
}

function contrast(a: Rgb, b: Rgb): number {
  const luminance = ([r, g, bl]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

const GROUNDS = [
  "background",
  "card",
  "popover",
  "muted",
  "secondary",
  "accent",
  "sidebar",
  "sidebar-accent",
] as const;
const STATES = ["positive", "negative", "warning", "info"] as const;
const ROLES = ["", "-surface", "-border", "-fill"] as const;
/** El tinte más fuerte que lleva texto encima (zonas de stop y target, calendario). */
const TEXT_TINT = 0.25;

describe("theme tokens", () => {
  it("declares every state role in light, both dark blocks and the Tailwind theme", () => {
    for (const state of STATES) {
      for (const role of ROLES) {
        const name = `${state}${role}`;
        expect(light[name], `light --${name}`).toBeDefined();
        expect(darkMedia[name], `dark media --${name}`).toBeDefined();
        expect(darkExplicit[name], `dark --${name}`).toBeDefined();
        expect(css).toContain(`--color-${name}: var(--${name});`);
      }
    }
  });

  it("keeps the two dark blocks identical", () => {
    expect(darkMedia).toEqual(darkExplicit);
  });

  for (const [theme, vars] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    const color = (name: string) => linearOf(vars[name]!);

    it(`gives every text token 4.5:1 against every ${theme} ground`, () => {
      const failures: string[] = [];
      const texts = ["foreground", "muted-foreground", ...STATES];
      for (const text of texts) {
        for (const ground of GROUNDS) {
          const ratio = contrast(color(text), color(ground));
          if (ratio < 4.5)
            failures.push(`${text} on ${ground}: ${ratio.toFixed(2)}`);
        }
      }
      for (const state of STATES) {
        const ownSurface = contrast(color(state), color(`${state}-surface`));
        if (ownSurface < 4.5)
          failures.push(`${state} on its surface: ${ownSurface.toFixed(2)}`);
        for (const ground of ["background", "card"] as const) {
          const tinted = tint(color(`${state}-fill`), color(ground), TEXT_TINT);
          const ratio = contrast(color(state), tinted);
          if (ratio < 4.5)
            failures.push(
              `${state} on ${state}-fill/${TEXT_TINT * 100} over ${ground}: ${ratio.toFixed(2)}`,
            );
        }
      }
      expect(failures).toEqual([]);
    });

    it(`gives every state fill 3:1 against the ${theme} grounds it sits on`, () => {
      const failures: string[] = [];
      for (const state of STATES) {
        for (const ground of ["background", "card", "muted"] as const) {
          const ratio = contrast(color(`${state}-fill`), color(ground));
          if (ratio < 3)
            failures.push(`${state}-fill on ${ground}: ${ratio.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

const PALETTE =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";
const PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:[a-z-]+:)*(?:text|bg|border|ring|outline|fill|stroke|from|via|to|divide|decoration|shadow|caret|accent)-(?:${PALETTE})-\\d{2,3}(?:/\\d+)?(?![\\w-])|--color-(?:${PALETTE})-\\d{2,3}`,
  "gu",
);

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/u.test(entry) && !/\.test\.tsx?$/u.test(entry)
      ? [path]
      : [];
  });
}

describe("no palette colors outside the theme", () => {
  it("uses only theme tokens: a Tailwind hue in a component skips the contrast check", () => {
    const offenders = sources("src").flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(PALETTE_CLASS)].map(
        (match) => `${path}: ${match[0]}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
