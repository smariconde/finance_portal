import { describe, expect, it } from "vitest";

import { pageWindow } from "./table-pagination-window";

describe("pageWindow", () => {
  it("cuts the rows of a middle page", () => {
    expect(pageWindow(47, 2, 20)).toEqual({
      page: 2,
      pageCount: 3,
      start: 20,
      end: 40,
      total: 47,
    });
  });

  it("ends the last page at the last row", () => {
    expect(pageWindow(47, 3, 20)).toMatchObject({ start: 40, end: 47 });
  });

  it("clamps a page past the end to the last one", () => {
    expect(pageWindow(47, 9, 20)).toMatchObject({ page: 3, start: 40 });
  });

  it("clamps a page below 1 and a non-finite page to the first one", () => {
    expect(pageWindow(47, 0, 20).page).toBe(1);
    expect(pageWindow(47, Number.NaN, 20).page).toBe(1);
  });

  it("keeps one empty page when there are no rows", () => {
    expect(pageWindow(0, 4, 20)).toEqual({
      page: 1,
      pageCount: 1,
      start: 0,
      end: 0,
      total: 0,
    });
  });

  it("fits exactly a full page", () => {
    expect(pageWindow(40, 2, 20)).toMatchObject({ pageCount: 2, end: 40 });
  });

  it("refuses a page size that is not a positive integer", () => {
    expect(() => pageWindow(10, 1, 0)).toThrow(RangeError);
    expect(() => pageWindow(10, 1, 2.5)).toThrow(RangeError);
  });
});
