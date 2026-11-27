"use client";

import { Check, CircleAlert, CircleDashed, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { StatTile } from "@/app/_components/stat-tile";

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
import { shortMonth } from "./format";

const WARNING_TEXT = "text-warning";

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

export type SummaryTileProps = {
  readonly metric: SummaryMetric;
  readonly href: string;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly note?: string;
  readonly date: string;
  readonly change: ReactNode;
  readonly mark: "new_period" | "revised" | null;
  readonly observedQuoteAt?: string;
};

/** A changed figure keeps a blue outline for the current visit. */
export function SummaryTile({
  metric,
  href,
  label,
  value,
  detail,
  note,
  date,
  change,
  mark,
  observedQuoteAt,
}: SummaryTileProps) {
  const group = SUMMARY_FRESHNESS_GROUP[metric];
  const groupFreshness = useGroupFreshness(group);
  const publication = useExpectedPublication(group);
  const freshness = observedQuoteAt === undefined ? groupFreshness : null;
  const verifying = freshness?.state === "verifying";
  const showFreshness =
    freshness?.state !== "verified" || publication?.state !== "pending";
  const [arrived, setArrived] = useState(false);
  const token = `${value}|${date}|${detail}`;
  const previous = useRef(token);
  useEffect(() => {
    if (previous.current === token) return;
    previous.current = token;
    setArrived(true);
  }, [token]);
  const highlighted = mark !== null || arrived;
  const status =
    mark === "new_period"
      ? "Dato nuevo"
      : mark === "revised"
        ? "Dato revisado"
        : arrived
          ? "Dato actualizado"
          : null;

  return (
    <div
      className="relative h-full data-pending:[&_[data-slot=stat-value]]:text-muted-foreground"
      data-pending={verifying ? "" : undefined}
      data-highlighted={highlighted ? "" : undefined}
      aria-busy={verifying || undefined}
    >
      <StatTile
        href={href}
        className={cn(
          "h-full",
          highlighted && "ring-2 ring-info-fill hover:ring-info-fill",
        )}
        size="sm"
        label={label}
        value={value}
        change={change}
        detail={note === undefined ? detail : `${detail} · ${note}`}
        footer={
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>{date}</span>
            {observedQuoteAt === undefined ? null : (
              <span>
                Consulta{" "}
                <time dateTime={observedQuoteAt}>{clock(observedQuoteAt)}</time>
              </span>
            )}
            {showFreshness ? (
              <FreshnessGlyph freshness={freshness} compact />
            ) : null}
            <ExpectedBadge group={group} />
            <span className="sr-only" aria-live="polite">
              {status}
            </span>
          </span>
        }
      />
      {verifying ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-4 top-px h-0.5 overflow-hidden rounded-full bg-muted"
        >
          <span className="block h-full w-1/3 rounded-full bg-muted-foreground/60 motion-safe:animate-[freshness-sweep_1.6s_cubic-bezier(0.22,1,0.36,1)_infinite] motion-reduce:w-full motion-reduce:bg-muted-foreground/30" />
        </span>
      ) : null}
    </div>
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
    case "verified": {
      const checkedAt = freshness.checkedAt;
      const checkTime =
        checkedAt === null
          ? "Fuente consultada"
          : `Fuente consultada el ${new Date(checkedAt).toLocaleDateString(
              "es-AR",
              {
                timeZone: "America/Argentina/Buenos_Aires",
              },
            )} a las ${clock(checkedAt)}`;
      return (
        <span className="inline-flex items-center gap-1" title={checkTime}>
          <Check aria-hidden="true" className="size-3 shrink-0" />
          {compact ? (
            <span className="sr-only">{checkTime}</span>
          ) : checkedAt === null ? (
            "Consultado"
          ) : (
            <>
              Consultado{" "}
              <time dateTime={checkedAt} className="numeric">
                {clock(checkedAt)}
              </time>
            </>
          )}
        </span>
      );
    }
  }
}

/**
 * The end of a block's provenance line: whether its sources were asked
 * (`argentina-freshness-1.0.0`). A manual series says so instead.
 */
export function BlockFreshness({ blockId }: { readonly blockId: string }) {
  const group = BLOCK_FRESHNESS_GROUP[blockId];
  const freshness = useGroupFreshness(group ?? "activity");
  const publication = useExpectedPublication(group ?? "activity");
  if (
    group === undefined ||
    freshness === null ||
    (freshness.state === "verified" && publication?.state === "pending")
  ) {
    return null;
  }
  return (
    <>
      <span aria-hidden="true"> · </span>
      <FreshnessGlyph freshness={freshness} />
    </>
  );
}

/** The block's accessible news state and visible publication status. */
export function BlockPublicationMark({
  blockId,
}: {
  readonly blockId: string;
}) {
  const mark = useBlockMark(blockId);
  const group = BLOCK_FRESHNESS_GROUP[blockId];
  return (
    <>
      {mark === null ? null : (
        <span className="sr-only" data-block-news="">
          {mark === "new_period" ? "Dato nuevo" : "Dato revisado"}
        </span>
      )}
      {group === undefined ? null : <ExpectedBadge group={group} />}
    </>
  );
}

function ExpectedBadge({ group }: { readonly group: FreshnessGroup }) {
  const publication = useExpectedPublication(group);
  if (publication === null) return null;
  const pending = publication.state === "pending";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        pending ? WARNING_TEXT : "text-muted-foreground",
      )}
    >
      <span className="sr-only">{publication.title} </span>
      {pending ? `Falta ${shortMonth(publication.period)}` : "Esperado hoy"}
    </span>
  );
}
