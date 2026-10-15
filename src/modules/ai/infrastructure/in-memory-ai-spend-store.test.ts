import { randomUUID } from "node:crypto";

import { describeAiSpendStoreContract } from "@/modules/ai/application/ai-spend-store.contract";
import {
  sourceControlSchema,
  type SourceControl,
} from "@/modules/ingestion/domain/source-budget";

import { createInMemoryAiSpendStore } from "./in-memory-ai-spend-store";

describeAiSpendStoreContract("in-memory", {
  createStore: (limits) => {
    const controls = new Map<string, SourceControl>();

    return {
      store: createInMemoryAiSpendStore({
        limits,
        readControl: (sourceId) => controls.get(sourceId) ?? null,
      }),
      setControl: async (control) => {
        controls.set(
          control.sourceId,
          sourceControlSchema.parse({
            controlId: randomUUID(),
            sourceId: control.sourceId,
            status: control.status,
            dailyRequestLimit: null,
            dailySpendLimitNanoUsd: control.dailySpendLimitNanoUsd,
            reason: "contract case",
            actor: "test",
            recordedAt: control.now,
            supersededAt: null,
          }),
        );
      },
    };
  },
});
