import { describe, expect, it } from "vitest";

import { planMarkers } from "./idea-risk-levels";

const levels = {
  state: "valid" as const,
  stop: "95",
  target: "110",
  chosenRisk: "250",
  autoStop: null,
  targetTwo: "110",
  targetThree: "115",
  riskPerShare: "5",
  chosenValue: "5000",
  chosenPercent: "50",
  chosenRiskPercent: "2.5",
  targetR: "2",
};

describe("niveles del plan sobre el eje", () => {
  it("ordena de menor a mayor precio y marca el TP elegido", () => {
    expect(planMarkers(levels, "100", "one_to_two")).toEqual([
      {
        key: "stop",
        label: "Stop",
        value: "95",
        multiple: "-1",
        chosen: false,
      },
      {
        key: "entry",
        label: "Entrada",
        value: "100",
        multiple: null,
        chosen: false,
      },
      {
        key: "two",
        label: "TP 1:2",
        value: "110",
        multiple: "2",
        chosen: true,
      },
      {
        key: "three",
        label: "TP 1:3",
        value: "115",
        multiple: "3",
        chosen: false,
      },
    ]);
    expect(
      planMarkers(levels, "100", "one_to_three").find((marker) => marker.chosen)
        ?.key,
    ).toBe("three");
  });

  it("el target manual entra como nivel propio con su distancia en R", () => {
    const manual = planMarkers({ ...levels, target: "117.5" }, "100", "manual");
    expect(manual.map((marker) => marker.key)).toEqual([
      "stop",
      "entry",
      "two",
      "three",
      "target",
    ]);
    expect(manual.at(-1)).toMatchObject({
      label: "Target",
      value: "117.5",
      multiple: "2",
      chosen: true,
    });
    expect(manual.filter((marker) => marker.chosen)).toHaveLength(1);
  });

  it("un target manual debajo del TP 1:2 se ordena antes", () => {
    const markers = planMarkers({ ...levels, target: "105" }, "100", "manual");
    expect(markers.map((marker) => marker.value)).toEqual([
      "95",
      "100",
      "105",
      "110",
      "115",
    ]);
  });
});
