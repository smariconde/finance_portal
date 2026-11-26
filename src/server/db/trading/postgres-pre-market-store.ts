import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type {
  PreMarketStore,
  StoredIdea,
} from "@/modules/trading/application/pre-market-store";
import {
  ideaLevels,
  PRE_MARKET_PLAN_VERSION,
  STOP_LOSS_CALC_VERSION,
} from "@/modules/trading/domain/pre-market-plan";
import { tradeKeyOf } from "@/modules/trading/domain/trade-annotation";
import { tradingSessionOf } from "@/modules/trading/domain/trading-session";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type IdeaRow = typeof schema.preMarketIdeas.$inferSelect;
const key = (value: string) => Buffer.from(value, "hex");
const hex = (value: Buffer) => Buffer.from(value).toString("hex");
const canonical = (value: string | null): string | null =>
  value?.replace(/\.0+$/u, "").replace(/(\.[0-9]*?)0+$/u, "$1") ?? null;

function toStored(row: IdeaRow): StoredIdea {
  return {
    ideaId: row.ideaId,
    revisionId: row.revisionId,
    accountKey: hex(row.accountKey),
    revision: row.revision,
    version: row.version,
    formulaVersion: row.formulaVersion,
    symbol: row.symbol,
    setupCode: row.setupCode,
    book: row.book === "day" ? "day" : "swing",
    entry: canonical(row.entry)!,
    quantity: canonical(row.quantity)!,
    manualStop: canonical(row.manualStop),
    manualTarget: canonical(row.manualTarget),
    stopMode: row.stopMode as StoredIdea["stopMode"],
    targetMode: row.targetMode as StoredIdea["targetMode"],
    liquidationValue: canonical(row.liquidationValue)!,
    riskPercent: canonical(row.riskPercent)!,
    notes: row.notes,
    status: row.status as StoredIdea["status"],
    recordedAt: row.recordedAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

class Conflict extends Error {}

/** El plan ligado es la última revisión activa que ya existía al abrir el
 * trade. La fecha del link es posterior, pero no refecha la decisión. */
function eligible(
  revisions: readonly IdeaRow[],
  trade: {
    readonly symbol: string;
    readonly openedAt: string;
    readonly status: string;
    readonly direction: string;
    readonly currency: string;
    readonly assetType: string;
  },
): IdeaRow | null {
  if (
    trade.status === "opened_before_history" ||
    trade.direction !== "long" ||
    trade.currency !== "USD" ||
    !["EQUITY", "COLLECTIVE_INVESTMENT"].includes(trade.assetType)
  )
    return null;
  const row = revisions.find(
    (candidate) => candidate.recordedAt.getTime() < Date.parse(trade.openedAt),
  );
  if (
    row === undefined ||
    row.status !== "active" ||
    row.symbol !== trade.symbol
  )
    return null;
  return row;
}

export function createPostgresPreMarketStore(
  database: Database,
): PreMarketStore {
  const ideas = schema.preMarketIdeas;
  const links = schema.preMarketTradeLinks;
  const revisionsOf = async (accountKey: string, ideaId: string) =>
    database
      .select()
      .from(ideas)
      .where(
        and(eq(ideas.accountKey, key(accountKey)), eq(ideas.ideaId, ideaId)),
      )
      .orderBy(desc(ideas.recordedAt), desc(ideas.revision));

  const readLink = async (accountKey: string, tradeKey: string) => {
    const [row] = await database
      .select()
      .from(links)
      .where(
        and(
          eq(links.accountKey, key(accountKey)),
          eq(links.tradeKey, tradeKey),
        ),
      )
      .limit(1);
    if (row === undefined) return null;
    const [plan] = await database
      .select()
      .from(ideas)
      .where(eq(ideas.revisionId, row.planRevisionId))
      .limit(1);
    if (
      plan === undefined ||
      hex(plan.accountKey) !== accountKey ||
      plan.ideaId !== row.ideaId
    )
      throw new Error("Pre-market link has no matching plan.");
    return {
      link: {
        ideaId: row.ideaId,
        tradeKey: row.tradeKey,
        planRevisionId: row.planRevisionId,
        openedAt: row.openedAt.toISOString(),
        linkedAt: row.linkedAt.toISOString(),
      },
      idea: toStored(plan),
    };
  };

  const link = async (
    accountKey: string,
    ideaId: string,
    trade: Parameters<PreMarketStore["link"]>[2],
    now: string,
  ): Promise<"linked" | "ineligible" | "conflict"> => {
    if (trade.accountKey !== accountKey) return "ineligible";
    const plan = eligible(await revisionsOf(accountKey, ideaId), trade);
    if (plan === null) return "ineligible";
    if (ideaLevels({ ...toStored(plan) }).state !== "valid")
      return "ineligible";
    try {
      const inserted = await database
        .insert(links)
        .values({
          linkId: randomUUID(),
          accountKey: key(accountKey),
          ideaId,
          planRevisionId: plan.revisionId,
          tradeKey: tradeKeyOf(trade),
          openedAt: new Date(trade.openedAt),
          linkedAt: new Date(now),
        })
        .onConflictDoNothing()
        .returning({ linkId: links.linkId });
      return inserted.length === 0 ? "conflict" : "linked";
    } catch (error) {
      if (isUniqueViolation(error)) return "conflict";
      throw error;
    }
  };

  return {
    async listCurrent(accountKey) {
      const rows = await database
        .select()
        .from(ideas)
        .where(
          and(
            eq(ideas.accountKey, key(accountKey)),
            isNull(ideas.supersededAt),
          ),
        )
        .orderBy(asc(ideas.symbol), asc(ideas.recordedAt));
      return rows.map(toStored);
    },
    async listRevisions(accountKey, ideaId) {
      return (await revisionsOf(accountKey, ideaId)).map(toStored);
    },
    async listLinks(accountKey) {
      const rows = await database
        .select({ link: links, idea: ideas })
        .from(links)
        .innerJoin(ideas, eq(links.planRevisionId, ideas.revisionId))
        .where(
          and(
            eq(links.accountKey, key(accountKey)),
            eq(ideas.accountKey, key(accountKey)),
          ),
        );
      return new Map(
        rows.map(({ link: row, idea }) => [
          row.tradeKey,
          {
            link: {
              ideaId: row.ideaId,
              tradeKey: row.tradeKey,
              planRevisionId: row.planRevisionId,
              openedAt: row.openedAt.toISOString(),
              linkedAt: row.linkedAt.toISOString(),
            },
            idea: toStored(idea),
          },
        ]),
      );
    },
    readLink,
    async save(input) {
      try {
        return await database.transaction(async (transaction) => {
          const [current] = await transaction
            .select()
            .from(ideas)
            .where(
              and(
                eq(ideas.accountKey, key(input.accountKey)),
                eq(ideas.ideaId, input.ideaId),
                isNull(ideas.supersededAt),
              ),
            )
            .for("update")
            .limit(1);
          if ((current?.revision ?? null) !== input.baseRevision)
            throw new Conflict();
          const recordedAt = new Date(input.recordedAt);
          if (current !== undefined) {
            const prior = toStored(current);
            if (
              (
                [
                  "symbol",
                  "setupCode",
                  "book",
                  "entry",
                  "quantity",
                  "manualStop",
                  "manualTarget",
                  "stopMode",
                  "targetMode",
                  "notes",
                  "status",
                ] as const
              ).every((field) => input.fields[field] === prior[field]) &&
              input.liquidationValue === prior.liquidationValue &&
              input.riskPercent === prior.riskPercent
            )
              return { state: "unchanged" as const, idea: prior };
            await transaction
              .update(ideas)
              .set({
                supersededAt:
                  recordedAt < current.recordedAt
                    ? current.recordedAt
                    : recordedAt,
              })
              .where(eq(ideas.revisionId, current.revisionId));
          }
          const [row] = await transaction
            .insert(ideas)
            .values({
              revisionId: randomUUID(),
              ideaId: input.ideaId,
              accountKey: key(input.accountKey),
              revision: (current?.revision ?? 0) + 1,
              version: PRE_MARKET_PLAN_VERSION,
              formulaVersion: STOP_LOSS_CALC_VERSION,
              ...input.fields,
              liquidationValue: input.liquidationValue,
              riskPercent: input.riskPercent,
              recordedAt,
            })
            .returning();
          return { state: "saved" as const, idea: toStored(row!) };
        });
      } catch (error) {
        if (error instanceof Conflict || isUniqueViolation(error))
          return { state: "conflict" as const };
        throw error;
      }
    },
    link,
    async reconcile(accountKey, trades, now) {
      const [all, linked] = await Promise.all([
        database
          .select()
          .from(ideas)
          .where(eq(ideas.accountKey, key(accountKey)))
          .orderBy(desc(ideas.recordedAt), desc(ideas.revision)),
        database
          .select()
          .from(links)
          .where(eq(links.accountKey, key(accountKey))),
      ]);
      const groups = new Map<string, IdeaRow[]>();
      for (const row of all)
        groups.set(row.ideaId, [...(groups.get(row.ideaId) ?? []), row]);
      const usedIdeas = new Set(linked.map((row) => row.ideaId));
      const usedTrades = new Set(linked.map((row) => row.tradeKey));
      let count = 0;
      for (const trade of [...trades].sort((a, b) =>
        a.openedAt.localeCompare(b.openedAt),
      )) {
        if (usedTrades.has(tradeKeyOf(trade))) continue;
        const candidates = [...groups.entries()].flatMap(([ideaId, rows]) => {
          if (usedIdeas.has(ideaId)) return [];
          const row = eligible(rows, trade);
          if (
            row === null ||
            tradingSessionOf(row.recordedAt.toISOString()) !==
              trade.openedSession
          )
            return [];
          return [ideaId];
        });
        if (candidates.length !== 1) continue;
        const ideaId = candidates[0]!;
        if ((await link(accountKey, ideaId, trade, now)) === "linked") {
          usedIdeas.add(ideaId);
          usedTrades.add(tradeKeyOf(trade));
          count += 1;
        }
      }
      return count;
    },
  };
}
