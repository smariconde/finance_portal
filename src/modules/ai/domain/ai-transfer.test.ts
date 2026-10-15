import { describe, expect, it } from "vitest";

import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";

import { AiTransferRefusedError, assertAiTransferable } from "./ai-transfer";

describe("assertAiTransferable", () => {
  it("lets SEC evidence travel to a model", () => {
    expect(() =>
      assertAiTransferable(["sec-edgar"], DEMO_SOURCE_REGISTRY),
    ).not.toThrow();
  });

  it("refuses every source whose rights do not cover it, by name", () => {
    // ADR 0033: Damodaran, Yahoo, Comafi y Caja no viajan; una fuente sin fila
    // tampoco.
    try {
      assertAiTransferable(
        [
          "sec-edgar",
          "damodaran-current-data",
          "yahoo-finance",
          "comafi-cedear",
          "caja-valores-cedear",
          "not-registered",
        ],
        DEMO_SOURCE_REGISTRY,
      );
      expect.unreachable("debía negarse");
    } catch (error) {
      expect(error).toBeInstanceOf(AiTransferRefusedError);
      expect((error as AiTransferRefusedError).sourceIds).toEqual([
        "caja-valores-cedear",
        "comafi-cedear",
        "damodaran-current-data",
        "not-registered",
        "yahoo-finance",
      ]);
    }
  });
});
