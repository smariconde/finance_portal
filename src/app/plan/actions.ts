"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { servesSchwabConnection } from "@/modules/configuration/domain/config-health";
import {
  readLiveAccount,
  readLiveQuotes,
} from "@/modules/trading/application/live-account-service";
import {
  ideaFormSchema,
  ideaIdSchema,
  ideaLevels,
  type IdeaFields,
} from "@/modules/trading/domain/pre-market-plan";
import {
  issueQuoteScope,
  QUOTE_SCOPE_MAX_SYMBOLS,
} from "@/modules/trading/domain/quote-scope";
import { riskPerTradeOf } from "@/modules/trading/domain/trading-rules";
import {
  tradeKeyFromRef,
  tradeKeyOf,
  tradeRefSchema,
} from "@/modules/trading/domain/trade-annotation";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getPreMarketStore } from "@/server/persistence/trading/get-pre-market-store";
import { getSchwabTransactionStore } from "@/server/persistence/trading/get-schwab-transaction-store";
import { getTradingRiskSettingsStore } from "@/server/persistence/trading/get-trading-risk-settings-store";
import { getLiveAccountDependencies } from "@/server/trading/live-account";
import { settingsOf } from "@/server/trading/risk";
import { withTradingDeadline } from "@/server/trading/deadline";
import { safeErrorSummary } from "@/server/trading/safe-error";
import { loadJournalState } from "@/server/trading/transactions";

export type SaveIdeaActionResult =
  | {
      readonly state: "saved" | "unchanged";
      readonly ideaId: string;
      readonly revision: number;
    }
  | { readonly state: "invalid"; readonly field: string }
  | {
      readonly state:
        "conflict" | "no_account" | "account_unavailable" | "unavailable";
    };

/** El servidor observa capital y reglas al guardar; el cliente sólo declara
 * precios y cantidad. No acepta cuenta, capital ni un ticker para cotizar. */
export async function savePreMarketIdea(
  input: unknown,
): Promise<SaveIdeaActionResult> {
  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return { state: "unavailable" };
  const request = ideaFormSchema.safeParse(input);
  if (!request.success)
    return {
      state: "invalid",
      field: request.error.issues[0]?.path.join(".") ?? "",
    };
  try {
    const state = await loadJournalState();
    if (state.account === null) return { state: "no_account" };
    const { ideaId, baseRevision, ...fields } = request.data;
    if (
      fields.setupCode !== null &&
      !state.setups.some((setup) => setup.code === fields.setupCode)
    )
      return { state: "invalid", field: "setupCode" };
    const currentIdeas = await getPreMarketStore().listCurrent(
      state.account.accountKey,
    );
    const activeSymbols = new Set(
      currentIdeas
        .filter((idea) => idea.status === "active" && idea.ideaId !== ideaId)
        .map((idea) => idea.symbol),
    );
    if (fields.status === "active") activeSymbols.add(fields.symbol);
    if (activeSymbols.size > QUOTE_SCOPE_MAX_SYMBOLS)
      return { state: "invalid", field: "watchlist_limit" };
    const [live, storedRules] = await Promise.all([
      readLiveAccount(getLiveAccountDependencies()),
      getTradingRiskSettingsStore().readCurrent(),
    ]);
    if (live.state !== "read") return { state: "account_unavailable" };
    if (live.account.lastFour !== state.account.lastFour)
      return { state: "account_unavailable" };
    const rules = settingsOf(storedRules);
    // El riesgo por trade del tipo de la idea, el mismo que mostró el editor:
    // con el del swing, una idea day guardaba otro stop automático.
    const basis = {
      liquidationValue: live.balances.liquidationValue,
      riskPercent: riskPerTradeOf(rules, fields.book),
    };
    const levels = ideaLevels({ ...(fields as IdeaFields), ...basis });
    if (levels.state === "invalid")
      return { state: "invalid", field: levels.reason };
    const saved = await getPreMarketStore().save({
      accountKey: state.account.accountKey,
      ideaId: ideaId ?? randomUUID(),
      baseRevision,
      fields: fields as IdeaFields,
      ...basis,
      recordedAt: new Date().toISOString(),
    });
    if (saved.state === "conflict") return { state: "conflict" };
    revalidatePath("/plan");
    return {
      state: saved.state,
      ideaId: saved.idea.ideaId,
      revision: saved.idea.revision,
    };
  } catch (error) {
    console.error("pre-market idea save failed", safeErrorSummary(error));
    return { state: "unavailable" };
  }
}

/** La watchlist vigente decide los símbolos. Un alcance firmado de 10 minutos
 * cruza la misma puerta medida que usa Cuenta; el cliente no envía tickers. */
export async function readPlanQuotes(input: unknown) {
  const health = await getRequestConfigHealth();
  if (
    !servesSchwabConnection(health) ||
    !z.object({}).strict().safeParse(input).success
  )
    return { state: "unavailable" as const };
  try {
    return await withTradingDeadline("readPlanQuotes", () => planQuotes());
  } catch (error) {
    console.error("pre-market quotes failed", safeErrorSummary(error));
    return { state: "unavailable" as const };
  }
}

/** La cuenta sale de la lista de cuentas, no del diario entero: cotizar no
 * necesita trades ni anotaciones. */
async function planQuotes() {
  const [account] = await getSchwabTransactionStore().listAccounts();
  if (account === undefined) return { state: "unavailable" as const };
  const symbols = [
    ...new Set(
      (await getPreMarketStore().listCurrent(account.accountKey))
        .filter((idea) => idea.status === "active")
        .map((idea) => idea.symbol),
    ),
  ];
  if (symbols.length > QUOTE_SCOPE_MAX_SYMBOLS)
    return { state: "limit_reached" as const };
  const dependencies = getLiveAccountDependencies();
  const scope = issueQuoteScope(
    dependencies.quoteScopeKey,
    symbols,
    dependencies.now(),
  );
  return await readLiveQuotes(dependencies, scope);
}

const linkRequest = z
  .object({ ideaId: ideaIdSchema, tradeRef: tradeRefSchema })
  .strict();

/** Para un match ambiguo, el owner puede elegir una idea. El vínculo exige el
 * trade real de su cuenta y la revisión del plan anterior a su primera entrada. */
export async function linkPreMarketIdea(
  input: unknown,
): Promise<"linked" | "ineligible" | "conflict" | "unavailable"> {
  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return "unavailable";
  const request = linkRequest.safeParse(input);
  if (!request.success) return "ineligible";
  try {
    const state = await loadJournalState();
    const key = tradeKeyFromRef(request.data.tradeRef);
    const trade = state.trades.find(
      (candidate) => tradeKeyOf(candidate) === key,
    );
    if (state.account === null || trade === undefined) return "ineligible";
    const result = await getPreMarketStore().link(
      state.account.accountKey,
      request.data.ideaId,
      trade,
      new Date().toISOString(),
    );
    if (result === "linked") {
      revalidatePath(`/diario/${request.data.tradeRef}`);
      revalidatePath("/plan");
    }
    return result;
  } catch (error) {
    console.error("pre-market link failed", safeErrorSummary(error));
    return "unavailable";
  }
}
