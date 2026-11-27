"use client";

import { Check, CircleAlert, CircleDashed, RefreshCw } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import {
  BLOCK_FRESHNESS_GROUP,
  SUMMARY_FRESHNESS_GROUP,
  type GroupFreshness,
  type FreshnessGroup,
} from "@/modules/argentina-dashboard/domain/surface-freshness";
import type { SummaryMetric } from "@/modules/argentina-dashboard/domain/summary-change";

import {
  useBlockMark,
  useExpectedPublication,
  useGroupFreshness,
} from "./freshness-provider";
import { NewsBadge } from "./news-badge";

/** How long a figure that just changed stays tinted. */
const ARRIVAL_MS = 2_400;

const WARNING_TEXT = "text-amber-700 dark:text-amber-400";

/**
 * Always in Buenos Aires: the server draws these marks first and the browser
 * takes them over, so both must write the same hour whatever their zone.
 */
function clock(instant: string): string {
  return new Date(instant).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

function listOf(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`;
}

type TileState = {
  readonly freshness: GroupFreshness | null;
  readonly group: FreshnessGroup;
  /** When the figure changed with the page open, on this device's clock. */
  readonly arrivedAt: string | null;
};

const TileContext = createContext<TileState>({
  freshness: null,
  group: "activity",
  arrivedAt: null,
});

/**
 * A summary tile that knows how current its figure is (`F9-22`). While a
 * source it reads is being asked, the figure turns muted and a thin line runs
 * along the tile's top edge: it is the stored one, and may change. When the
 * page is read again with another figure, the tile is tinted once and keeps
 * «Actualizado» for the rest of the visit, so a daily figure that moved is
 * seen without being marked as news forever.
 */
export function TileShell({
  metric,
  token,
  children,
}: {
  readonly metric: SummaryMetric;
  /** What the tile shows; a different token is a different figure. */
  readonly token: string;
  readonly children: ReactNode;
}) {
  const group = SUMMARY_FRESHNESS_GROUP[metric];
  const freshness = useGroupFreshness(group);
  const [arrival, setArrival] = useState<{
    readonly at: string;
    readonly key: number;
  } | null>(null);
  const [tinted, setTinted] = useState(false);
  const previous = useRef(token);

  useEffect(() => {
    if (previous.current === token) return;
    previous.current = token;
    setArrival((current) => ({
      at: new Date().toISOString(),
      key: (current?.key ?? 0) + 1,
    }));
    setTinted(true);
    const timer = setTimeout(() => setTinted(false), ARRIVAL_MS);
    return () => clearTimeout(timer);
  }, [token]);

  const verifying = freshness?.state === "verifying";

  return (
    <TileContext.Provider
      value={{ freshness, group, arrivedAt: arrival?.at ?? null }}
    >
      <div
        className="relative h-full data-pending:[&_[data-slot=stat-value]]:text-muted-foreground"
        data-pending={verifying ? "" : undefined}
        aria-busy={verifying || undefined}
      >
        {children}
        {verifying ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-4 top-px h-0.5 overflow-hidden rounded-full bg-muted"
          >
            <span className="block h-full w-1/3 rounded-full bg-muted-foreground/60 motion-safe:animate-[freshness-sweep_1.6s_cubic-bezier(0.22,1,0.36,1)_infinite] motion-reduce:w-full motion-reduce:bg-muted-foreground/30" />
          </span>
        ) : null}
        {tinted ? (
          <span
            key={arrival?.key}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-xl bg-blue-500/12 motion-safe:animate-[freshness-arrive_2.4s_cubic-bezier(0.16,1,0.3,1)_forwards] motion-reduce:bg-blue-500/8 dark:bg-blue-400/14"
          />
        ) : null}
      </div>
    </TileContext.Provider>
  );
}

/**
 * The foot of a tile: the figure's date, how current it is in an icon and at
 * most one word, and its mark. «Nuevo» or «Revisado» (since the previous
 * visit) wins over «Actualizado» (since the page opened).
 */
export function TileStatus({
  date,
  mark,
}: {
  readonly date: string;
  readonly mark: "new_period" | "revised" | null;
}) {
  const { freshness, group, arrivedAt } = useContext(TileContext);
  const badge = mark ?? (arrivedAt === null ? null : "arrived");

  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span>{date}</span>
      <FreshnessGlyph freshness={freshness} compact />
      <ExpectedBadge group={group} />
      {badge === null ? null : (
        <span className="inline-flex items-center gap-1">
          <NewsBadge status={badge} />
          {badge === "arrived" && arrivedAt !== null ? (
            <span className="sr-only">a las {clock(arrivedAt)}</span>
          ) : null}
        </span>
      )}
    </span>
  );
}

/**
 * The state as a glyph and, when it is not the quiet one, a word. `compact`
 * is the tile's foot: verified says only ✓, with its time for a reader.
 */
function FreshnessGlyph({
  freshness,
  compact = false,
}: {
  readonly freshness: GroupFreshness | null;
  readonly compact?: boolean;
}) {
  if (freshness === null) return null;
  switch (freshness.state) {
    case "verifying":
      return (
        <span className="inline-flex items-center gap-1">
          <RefreshCw
            aria-hidden="true"
            className="size-3 shrink-0 motion-safe:animate-spin"
          />
          {compact ? "buscando" : "Buscando datos nuevos"}
          <span className="sr-only">
            {` en ${listOf(freshness.sources)}; la cifra es la última guardada`}
          </span>
        </span>
      );
    case "unverified":
      return (
        <span className={cn("inline-flex items-center gap-1", WARNING_TEXT)}>
          <CircleAlert aria-hidden="true" className="size-3 shrink-0" />
          {compact ? "sin verificar" : "Sin verificar"}
          <span className="sr-only">
            {`: no se pudo consultar ${listOf(freshness.sources)}; la cifra es la última guardada`}
          </span>
        </span>
      );
    case "manual":
      return (
        <span className="inline-flex items-center gap-1">
          <CircleDashed aria-hidden="true" className="size-3 shrink-0" />
          Carga manual
          <span className="sr-only">
            : la página no la busca sola; se actualiza con un comando
          </span>
        </span>
      );
    case "verified":
      return (
        <span className="inline-flex items-center gap-1">
          <Check aria-hidden="true" className="size-3 shrink-0" />
          {compact ? (
            <span className="sr-only">
              {freshness.checkedAt === null
                ? "verificada"
                : `verificada a las ${clock(freshness.checkedAt)}`}
            </span>
          ) : freshness.checkedAt === null ? (
            "Verificado"
          ) : (
            <>
              Verificado{" "}
              <time dateTime={freshness.checkedAt} className="numeric">
                {clock(freshness.checkedAt)}
              </time>
            </>
          )}
        </span>
      );
  }
}

/**
 * The end of a block's provenance line: whether its sources were asked
 * (`argentina-freshness-1.0.0`). A manual series says so instead.
 */
export function BlockFreshness({ blockId }: { readonly blockId: string }) {
  const group = BLOCK_FRESHNESS_GROUP[blockId];
  const freshness = useGroupFreshness(group ?? "activity");
  if (group === undefined || freshness === null) return null;
  return (
    <>
      <span aria-hidden="true"> · </span>
      <FreshnessGlyph freshness={freshness} />
    </>
  );
}

/** «Nuevo» or «Revisado» next to a block's title (ADR 0079). */
export function BlockNewsBadge({ blockId }: { readonly blockId: string }) {
  const mark = useBlockMark(blockId);
  const group = BLOCK_FRESHNESS_GROUP[blockId];
  return (
    <>
      {mark === null ? null : <NewsBadge status={mark} />}
      {group === undefined ? null : <ExpectedBadge group={group} />}
    </>
  );
}

function ExpectedBadge({ group }: { readonly group: FreshnessGroup }) {
  const publication = useExpectedPublication(group);
  return publication === null ? null : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
      <span className="sr-only">{publication} </span>Esperado hoy
    </span>
  );
}
