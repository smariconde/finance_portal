import { describe, expect, it } from "vitest";

import { ARGENTINA_BLOCK_GUIDES, ARGENTINA_BLOCK_IDS } from "./block-guides";
import { BLOCK_FRESHNESS_GROUP } from "./surface-freshness";

const guides = Object.entries(ARGENTINA_BLOCK_GUIDES);

function linesOf(
  guide: (typeof ARGENTINA_BLOCK_GUIDES)[keyof typeof ARGENTINA_BLOCK_GUIDES],
) {
  return [
    guide.purpose,
    ...guide.read,
    ...guide.crossWith.map((cross) => cross.text),
    ...guide.caveats,
  ];
}

describe("argentina-block-guides-1.0.0", () => {
  it("has one guide per block of the page, the same blocks the freshness reads", () => {
    expect(Object.keys(ARGENTINA_BLOCK_GUIDES).sort()).toEqual(
      [...ARGENTINA_BLOCK_IDS].sort(),
    );
    expect(Object.keys(BLOCK_FRESHNESS_GROUP).sort()).toEqual(
      [...ARGENTINA_BLOCK_IDS].sort(),
    );
  });

  it("fills every part, in short lines: a guide is never a paragraph", () => {
    for (const [, guide] of guides) {
      expect(guide.read.length).toBeGreaterThanOrEqual(2);
      expect(guide.read.length).toBeLessThanOrEqual(4);
      expect(guide.crossWith.length).toBeGreaterThanOrEqual(2);
      expect(guide.crossWith.length).toBeLessThanOrEqual(3);
      expect(guide.caveats.length).toBeGreaterThanOrEqual(1);
      expect(guide.caveats.length).toBeLessThanOrEqual(2);
      for (const line of linesOf(guide)) {
        expect(line.trim()).toBe(line);
        expect(line.length).toBeGreaterThan(10);
        expect(line.length).toBeLessThanOrEqual(150);
      }
    }
  });

  it("crosses only with other blocks, each once", () => {
    for (const [blockId, guide] of guides) {
      const targets = guide.crossWith.map((cross) => cross.blockId);
      expect(targets).not.toContain(blockId);
      expect(new Set(targets).size).toBe(targets.length);
      for (const target of targets) {
        expect(ARGENTINA_BLOCK_IDS).toContain(target);
      }
    }
  });

  it("describes and teaches to read, never advises or forecasts", () => {
    const advice =
      /\b(conviene|recomend\w*|deber[íi]as?|compr[áa]|vend[ée]|va a (subir|bajar)|se espera que|seguro que)\b/iu;
    for (const [, guide] of guides) {
      for (const line of linesOf(guide)) {
        expect(line).not.toMatch(advice);
      }
    }
  });
});
