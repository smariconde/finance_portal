import type { IdeaLevels } from "@/modules/trading/domain/pre-market-plan";

/**
 * Los niveles que se dibujan sobre el eje de precio de una idea (`F11-12`):
 * stop, entrada, los dos TP que salen del stop elegido y, si el target es
 * manual, el target. Van de menor a mayor precio porque la leyenda se lee así y
 * dos niveles cercanos nunca se pisan en el dibujo. El que se eligió se marca:
 * un TP de referencia no es una decisión.
 */

export type PlanMarker = {
  readonly key: "stop" | "entry" | "two" | "three" | "target";
  readonly label: string;
  readonly value: string;
  /** El múltiplo de `R` desde la entrada; la entrada no lleva. */
  readonly multiple: string | null;
  readonly chosen: boolean;
};

export function planMarkers(
  levels: Extract<IdeaLevels, { readonly state: "valid" }>,
  entry: string,
  targetMode: "manual" | "one_to_two" | "one_to_three",
): PlanMarker[] {
  const markers: PlanMarker[] = [
    {
      key: "stop",
      label: "Stop",
      value: levels.stop,
      multiple: "-1",
      chosen: false,
    },
    {
      key: "entry",
      label: "Entrada",
      value: entry,
      multiple: null,
      chosen: false,
    },
    {
      key: "two",
      label: "TP 1:2",
      value: levels.targetTwo,
      multiple: "2",
      chosen: targetMode === "one_to_two",
    },
    {
      key: "three",
      label: "TP 1:3",
      value: levels.targetThree,
      multiple: "3",
      chosen: targetMode === "one_to_three",
    },
  ];
  if (targetMode === "manual")
    markers.push({
      key: "target",
      label: "Target",
      value: levels.target,
      multiple: levels.targetR,
      chosen: true,
    });
  return markers.sort(
    (left, right) => Number(left.value) - Number(right.value),
  );
}
