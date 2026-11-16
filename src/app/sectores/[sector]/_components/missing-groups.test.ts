import { describe, expect, it } from "vitest";

import { groupByReason } from "./missing-groups";

describe("groupByReason", () => {
  it("groups by reason, most frequent first, keeping the input order inside", () => {
    const groups = groupByReason(
      [
        { id: "A", reason: "Sin precio" },
        { id: "B", reason: "Sin ejercicio" },
        { id: "C", reason: "Sin ejercicio" },
        { id: "D", reason: "Sin precio" },
        { id: "E", reason: "Sin ejercicio" },
      ],
      (item) => item.reason,
    );

    expect(groups.map((group) => group.reason)).toEqual([
      "Sin ejercicio",
      "Sin precio",
    ]);
    expect(groups[0]!.items.map((item) => item.id)).toEqual(["B", "C", "E"]);
  });

  it("breaks ties alphabetically so the order does not depend on the database", () => {
    const groups = groupByReason(["zeta", "alfa"], (item) => item);

    expect(groups.map((group) => group.reason)).toEqual(["alfa", "zeta"]);
  });

  it("returns nothing for nothing", () => {
    expect(groupByReason([], () => "x")).toEqual([]);
  });
});
