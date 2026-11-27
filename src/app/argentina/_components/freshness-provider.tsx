"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import {
  groupFreshness,
  mergeSourceFreshness,
  newlySettledSources,
  type FreshnessGroup,
  type GroupFreshness,
  type SourceFreshness,
} from "@/modules/argentina-dashboard/domain/surface-freshness";

import type { ExpectedPublications } from "@/modules/market-calendar/domain/expected-argentina-publications";

import { refreshArgentinaData, type ArgentinaRefreshResult } from "../actions";

type RunningStatus = Extract<ArgentinaRefreshResult, { state: "running" }>;
type BlockedStatus = Extract<ArgentinaRefreshResult, { state: "blocked" }>;
type FreshStatus = Extract<ArgentinaRefreshResult, { state: "fresh" }>;

/** The refresh round as the status line shows it. */
export type RoundView =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "running"; readonly status: RunningStatus }
  | { readonly kind: "blocked"; readonly status: BlockedStatus }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "done";
      readonly status: FreshStatus;
      /** When the round ended, on this device's clock. */
      readonly at: string;
    };

/** A mark of «what arrived since the previous visit» (ADR 0079). */
export type NewsMarkStatus = "new_period" | "revised";

type FreshnessContextValue = {
  readonly round: RoundView;
  /** Sources merged from the render and the live round; `null` if unknown. */
  readonly sources: readonly SourceFreshness[] | null;
  /** The sources this round asked for, in plan order. */
  readonly involved: readonly string[];
  /** Failures the render saw from an earlier round. */
  readonly renderedFailures: readonly string[];
  readonly blockMarks: Readonly<Record<string, NewsMarkStatus>>;
  readonly expected: ExpectedPublications;
  readonly retry: (retryFailures: boolean) => void;
};

const FreshnessContext = createContext<FreshnessContextValue | null>(null);

const POLL_MS = 2_000;
const MAX_WAIT_POLL_MS = 30_000;
/** A page re-read in flight is not asked again before this. */
const MIN_PROGRESSIVE_REFRESH_MS = 3_000;

function pollDelay(status: RunningStatus): number {
  if (status.waitingUntil === null) return POLL_MS;
  const remaining = Date.parse(status.waitingUntil) - Date.now();
  return Math.min(Math.max(remaining, POLL_MS), MAX_WAIT_POLL_MS);
}

/** What the live round says once it cannot ask anymore: nothing is pending. */
function withoutPending(
  sources: readonly SourceFreshness[],
): readonly SourceFreshness[] {
  return sources.map((source) =>
    source.state === "pending" ? { ...source, state: "failed" } : source,
  );
}

/**
 * Follows the refresh of `/argentina` (`F9-12`, ADR 0070) and shares what
 * every source is doing with the tiles and blocks (`argentina-freshness-1.0.0`,
 * `F9-22`). The page keeps showing what is stored, but a figure whose source
 * is still being asked says so; when a source finishes, the page is read
 * again right away, so its figures arrive without waiting for the slowest
 * source.
 */
export function ArgentinaFreshnessProvider({
  readAt,
  rendered,
  needsRefresh,
  failedSources,
  blockMarks,
  expected,
  children,
}: {
  /** The page's cutoff: it changes every time the server reads it again. */
  readonly readAt: string;
  /** Each source as the server saw it when drawing; `null` if unread. */
  readonly rendered: readonly SourceFreshness[] | null;
  readonly needsRefresh: boolean;
  readonly failedSources: readonly string[];
  readonly blockMarks: Readonly<Record<string, NewsMarkStatus>>;
  readonly expected: ExpectedPublications;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [round, setRound] = useState<RoundView>(
    needsRefresh ? { kind: "checking" } : { kind: "idle" },
  );
  // What the round reported, and the cutoff it was settled at: once the page
  // is read again after the round ended, the render is the truth again.
  const [live, setLive] = useState<{
    readonly sources: readonly SourceFreshness[];
    readonly settledAtReadAt: string | null;
  } | null>(null);
  const [involved, setInvolved] = useState<readonly string[]>(() =>
    (rendered ?? [])
      .filter((source) => source.state === "pending")
      .map((source) => source.sourceId),
  );

  const generation = useRef(0);
  const sawRunning = useRef(false);
  const lastRefresh = useRef(0);
  const latestReadAt = useRef(readAt);
  const lastSources = useRef<readonly SourceFreshness[]>(rendered ?? []);
  const openedNeedingRefresh = useRef(needsRefresh);

  useEffect(() => {
    latestReadAt.current = readAt;
  }, [readAt]);

  const reread = useCallback(
    (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastRefresh.current < MIN_PROGRESSIVE_REFRESH_MS) {
        return;
      }
      lastRefresh.current = now;
      startTransition(() => router.refresh());
    },
    [router],
  );

  const run = useCallback(
    (retryFailures: boolean) => {
      // Each run invalidates the previous one: an unmount or a retry never
      // leaves two loops polling at once.
      const mine = ++generation.current;
      const alive = () => generation.current === mine;

      const report = (sources: readonly SourceFreshness[], ended: boolean) => {
        const settled = newlySettledSources(lastSources.current, sources);
        lastSources.current = sources;
        setInvolved((previous) => {
          const next = new Set(previous);
          for (const source of sources) {
            if (source.state === "pending") next.add(source.sourceId);
          }
          return next.size === previous.length
            ? previous
            : sources
                .map((source) => source.sourceId)
                .filter((sourceId) => next.has(sourceId));
        });
        setLive({
          sources,
          settledAtReadAt: ended ? latestReadAt.current : null,
        });
        return settled;
      };

      void (async () => {
        let ask = retryFailures;
        while (alive()) {
          let result: ArgentinaRefreshResult;
          try {
            result = await refreshArgentinaData({ retryFailures: ask });
          } catch {
            result = { state: "unavailable" };
          }
          ask = false;
          if (!alive()) return;

          if (result.state === "running") {
            sawRunning.current = true;
            const settled = report(result.freshness, false);
            setRound({ kind: "running", status: result });
            // A source finished: its figures can be read now.
            if (settled.length > 0) reread(false);
            await new Promise((resolve) =>
              setTimeout(resolve, pollDelay(result)),
            );
            continue;
          }

          if (result.state === "unavailable") {
            report(withoutPending(lastSources.current), true);
            setRound({ kind: "unavailable" });
            return;
          }

          report(result.freshness, true);
          setRound(
            result.state === "fresh"
              ? {
                  kind: "done",
                  status: result,
                  at: new Date().toISOString(),
                }
              : { kind: "blocked", status: result },
          );
          if (sawRunning.current) reread(true);
          return;
        }
      })();
    },
    [reread],
  );

  const retry = useCallback(
    (retryFailures: boolean) => {
      setRound({ kind: "checking" });
      run(retryFailures);
    },
    [run],
  );

  // Asks when the page opens. A later re-read of the page —which may say
  // there is nothing left to ask— never starts another round nor stops this
  // one: only a retry or leaving does.
  useEffect(() => {
    if (openedNeedingRefresh.current) run(false);
    return () => {
      generation.current += 1;
    };
  }, [run]);

  const sources = useMemo(() => {
    if (rendered === null) return null;
    const current =
      live !== null &&
      (live.settledAtReadAt === null || live.settledAtReadAt === readAt)
        ? live.sources
        : null;
    return mergeSourceFreshness(rendered, current);
  }, [rendered, live, readAt]);

  const value = useMemo<FreshnessContextValue>(
    () => ({
      round,
      sources,
      involved,
      renderedFailures: failedSources,
      blockMarks,
      expected,
      retry,
    }),
    [round, sources, involved, failedSources, blockMarks, expected, retry],
  );

  return (
    <FreshnessContext.Provider value={value}>
      {children}
    </FreshnessContext.Provider>
  );
}

function useFreshnessContext(): FreshnessContextValue {
  const context = useContext(FreshnessContext);
  if (context === null) {
    throw new Error("ArgentinaFreshnessProvider is missing");
  }
  return context;
}

export function useRefreshRound() {
  return useFreshnessContext();
}

/**
 * The state of one group, or `null` when the page cannot tell —the readiness
 * read failed, or the block is drawn outside the provider—.
 */
export function useGroupFreshness(
  group: FreshnessGroup,
): GroupFreshness | null {
  const sources = useContext(FreshnessContext)?.sources ?? null;
  return useMemo(
    () => (sources === null ? null : groupFreshness(group, sources)),
    [group, sources],
  );
}

export function useBlockMark(blockId: string): NewsMarkStatus | null {
  return useContext(FreshnessContext)?.blockMarks[blockId] ?? null;
}

export function useExpectedPublication(group: FreshnessGroup): string | null {
  return useContext(FreshnessContext)?.expected[group] ?? null;
}
