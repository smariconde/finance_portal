import { describe, expect, it } from "vitest";

import {
  failureRateRows,
  fixtureFailureRates,
} from "../infrastructure/fixture-failure-rates";
import { buildXlsx } from "../infrastructure/fixture-xlsx";

import {
  findDamodaranDataset,
  parseDamodaranDataset,
} from "./damodaran-datasets";

const dataset = findDamodaranDataset("damodaran.failure-rates")!;
const parse = (rows = failureRateRows()) =>
  parseDamodaranDataset(dataset, fixtureFailureRates(rows));
describe("failure rate workbook", () => {
  it("reads seven ratings and ten horizons, without the separate age table", () => {
    const result = parse();
    expect(result).toMatchObject({
      ok: true,
      publishedLabel: null,
      rejections: [],
    });
    if (!result.ok) throw new Error(result.code);
    expect(result.rows).toHaveLength(7);
    expect(result.rows[0]).toEqual({
      key: "aaa",
      label: "AAA",
      values: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [
          `year_${i + 1}`,
          String((i + 1) / 1000),
        ]),
      ),
    });
    expect(result.rows.at(-1)?.values.year_10).toBe("0.07");
  });
  it.each([null, "NaN", { n: "-0.1" }, { n: "1.01" }, { n: "0" }])(
    "refuses a missing, nonnumeric, invalid or decreasing cumulative probability: %j",
    (value) => {
      const rows = failureRateRows();
      rows[2]![5] = value;
      expect(parse(rows).ok).toBe(false);
    },
  );
  it("keeps zero and the exact scientific-notation value, without double arithmetic", () => {
    const rows = failureRateRows();
    rows[2]![1] = { n: "0" };
    rows[2]![2] = { n: "2.0000000000000001E-3" };
    const result = parse(rows);
    if (!result.ok) throw new Error(result.code);
    expect(result.rows[0]!.values.year_1).toBe("0");
    expect(result.rows[0]!.values.year_2).toBe("0.0020000000000000001");
  });
  it.each(["title", "horizon", "rating", "extra"])(
    "fails closed when the %s changes",
    (change) => {
      const rows = failureRateRows();
      if (change === "title") rows[0] = ["Age based survival"];
      if (change === "horizon") rows[1]![2] = { n: "3" };
      if (change === "rating") rows[3]![0] = "AAA";
      if (change === "extra") rows[9] = ["D", { n: "1" }];
      expect(parse(rows).ok).toBe(false);
    },
  );
  it("requires the declared workbook and sheet", () => {
    expect(parseDamodaranDataset(dataset, "HTML")).toEqual({
      ok: false,
      code: "workbook_expected",
    });
    expect(
      parseDamodaranDataset(
        dataset,
        buildXlsx([{ name: "Other", rows: failureRateRows() }]),
      ),
    ).toEqual({ ok: false, code: "xlsx_sheet_missing" });
  });
});
