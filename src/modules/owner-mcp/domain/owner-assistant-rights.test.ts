import { describe, expect, it } from "vitest";

import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";

import { gate, withheldSources } from "./owner-assistant-rights";

function withRight(sourceId: string, ownerAssistant: string) {
  return DEMO_SOURCE_REGISTRY.map((entry) =>
    entry.sourceId === sourceId
      ? {
          ...entry,
          rights: { ...entry.rights, ownerAssistant },
        }
      : entry,
  ) as typeof DEMO_SOURCE_REGISTRY;
}

describe("ownerAssistant", () => {
  it("el owner lo aceptó para todas las fuentes registradas (ADR 0078) salvo el riesgo país (ADR 0080)", () => {
    expect(
      DEMO_SOURCE_REGISTRY.filter(
        (entry) => entry.rights.ownerAssistant !== "owner_accepted",
      ).map((entry) => [entry.sourceId, entry.rights.ownerAssistant]),
    ).toEqual([["ambito-riesgo-pais", "restricted"]]);
  });

  it("no abre las tareas IA del portal: aiTransfer sigue por su cuenta", () => {
    expect(
      DEMO_SOURCE_REGISTRY.find((entry) => entry.sourceId === "yahoo-finance")
        ?.rights.aiTransfer,
    ).toBe("restricted");
  });

  it("retiene una fuente restringida, desconocida o sin fila, con su motivo", () => {
    expect(
      withheldSources(
        ["yahoo-finance", "sec-edgar", "nowhere-source"],
        withRight("yahoo-finance", "restricted"),
      ),
    ).toEqual([
      { sourceId: "nowhere-source", reason: "source_unregistered" },
      {
        sourceId: "yahoo-finance",
        reason: "rights.ownerAssistant:restricted",
      },
    ]);
    expect(
      withheldSources(["sec-edgar"], withRight("sec-edgar", "unknown")),
    ).toEqual([
      { sourceId: "sec-edgar", reason: "rights.ownerAssistant:unknown" },
    ]);
  });

  it("una sección retenida no se calcula ni sale vacía", () => {
    let built = false;
    const section = gate(
      ["yahoo-finance"],
      withRight("yahoo-finance", "restricted"),
      () => {
        built = true;
        return { price: "1" };
      },
    );

    expect(built).toBe(false);
    expect(section).toEqual({
      withheld: [
        {
          sourceId: "yahoo-finance",
          reason: "rights.ownerAssistant:restricted",
        },
      ],
    });
    expect(gate(["sec-edgar"], DEMO_SOURCE_REGISTRY, () => ({ a: 1 }))).toEqual(
      { withheld: null, a: 1 },
    );
  });
});
