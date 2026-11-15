import { describe, expect, it } from "vitest";

import {
  citationsOf,
  defineGlossary,
  glossaryEntryOf,
  type GlossaryEntry,
} from "./glossary";
import { TRADING_GLOSSARY } from "./trading-glossary";

const source = { key: "a-2000", citation: "Autor, A. (2000). Libro." };
const entry: GlossaryEntry = {
  key: "term",
  term: "Term",
  es: "término",
  definition: "Una definición.",
  formula: null,
  why: "Importa.",
  sources: ["a-2000"],
};

describe("glossary-1.0.0", () => {
  it("defines a glossary and reads an entry with its citations", () => {
    const glossary = defineGlossary("x-1.0.0", [source], [entry]);
    expect(glossaryEntryOf(glossary, "term")).toEqual(entry);
    expect(citationsOf(glossary, entry)).toEqual([source]);
    expect(() => glossaryEntryOf(glossary, "missing")).toThrow();
  });

  it("refuses a repeated key, an unknown source and markup", () => {
    expect(() => defineGlossary("x", [source], [entry, entry])).toThrow(
      /repeated/u,
    );
    expect(() => defineGlossary("x", [source, source], [])).toThrow(
      /repeated/u,
    );
    expect(() =>
      defineGlossary("x", [source], [{ ...entry, sources: ["b-1999"] }]),
    ).toThrow(/cites/u);
    expect(() =>
      defineGlossary("x", [source], [{ ...entry, definition: "<b>x</b>" }]),
    ).toThrow();
    expect(() =>
      defineGlossary("x", [source], [{ ...entry, why: " espacio" }]),
    ).toThrow();
    expect(() =>
      defineGlossary("x", [source], [{ ...entry, key: "Mal_Clave" }]),
    ).toThrow();
  });

  it("cites at least one source for every trading term", () => {
    expect(TRADING_GLOSSARY.entries.size).toBeGreaterThanOrEqual(30);
    for (const item of TRADING_GLOSSARY.entries.values()) {
      expect(citationsOf(TRADING_GLOSSARY, item).length, item.key).toBe(
        item.sources.length,
      );
    }
  });
});
