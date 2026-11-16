"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { servesTradingData } from "@/modules/configuration/domain/config-health";
import { FINVIZ_SCREENER_CATALOG_VERSION } from "@/modules/finviz-screener/domain/finviz-screener-catalog";
import {
  FINVIZ_STRATEGY_VERSION,
  finvizStrategyFormSchema,
  finvizStrategyIdSchema,
  strategyFieldsOf,
} from "@/modules/finviz-screener/domain/finviz-screener-strategy";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getFinvizStrategyStore } from "@/server/persistence/trading/get-finviz-strategy-store";
import { safeErrorSummary } from "@/server/trading/safe-error";

export type SaveFinvizStrategyActionResult =
  | {
      readonly state: "saved" | "unchanged";
      readonly strategyId: string;
      readonly revision: number;
    }
  | { readonly state: "invalid"; readonly field: string }
  | { readonly state: "conflict" | "name_taken" | "unavailable" };

/** El cliente manda nombre y selección, nunca una URL: el link se arma con el
 * catálogo y el servidor no habla con Finviz (ADR 0016, `TM-08`). */
export async function saveFinvizStrategy(
  input: unknown,
): Promise<SaveFinvizStrategyActionResult> {
  const health = await getRequestConfigHealth();
  if (!servesTradingData(health)) return { state: "unavailable" };
  const request = finvizStrategyFormSchema.safeParse(input);
  if (!request.success)
    return {
      state: "invalid",
      field: request.error.issues[0]?.path.join(".") ?? "",
    };
  try {
    const saved = await getFinvizStrategyStore().save({
      strategyId: request.data.strategyId ?? randomUUID(),
      baseRevision: request.data.baseRevision,
      fields: strategyFieldsOf(request.data),
      version: FINVIZ_STRATEGY_VERSION,
      catalogVersion: FINVIZ_SCREENER_CATALOG_VERSION,
      recordedAt: new Date().toISOString(),
    });
    if (!("strategy" in saved)) return { state: saved.state };
    revalidatePath("/plan/finviz");
    return {
      state: saved.state,
      strategyId: saved.strategy.strategyId,
      revision: saved.strategy.revision,
    };
  } catch (error) {
    console.error("finviz strategy save failed", safeErrorSummary(error));
    return { state: "unavailable" };
  }
}

const archiveRequest = z
  .object({
    strategyId: finvizStrategyIdSchema,
    baseRevision: z.number().int().min(1),
  })
  .strict();

export async function archiveFinvizStrategy(
  input: unknown,
): Promise<"archived" | "conflict" | "invalid" | "unavailable"> {
  const health = await getRequestConfigHealth();
  if (!servesTradingData(health)) return "unavailable";
  const request = archiveRequest.safeParse(input);
  if (!request.success) return "invalid";
  try {
    const result = await getFinvizStrategyStore().archive({
      ...request.data,
      recordedAt: new Date().toISOString(),
    });
    if (result === "archived") revalidatePath("/plan/finviz");
    return result;
  } catch (error) {
    console.error("finviz strategy archive failed", safeErrorSummary(error));
    return "unavailable";
  }
}
