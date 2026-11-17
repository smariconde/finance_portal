import { CircleDot } from "lucide-react";

import { InfoTip } from "@/app/_components/info-tip";
import { cn } from "@/lib/utils";
import type {
  ArgentinaNews,
  NewsMetric,
  NewsStatus,
} from "@/modules/argentina-dashboard/domain/argentina-news";

import { shortMonth } from "./format";

/**
 * Lo que llegó desde la visita anterior (`argentina-news-1.0.0`, ADR 0079).
 * «Nuevo» lleva el azul de información del sistema —el bermellón es de
 * acción—, y siempre con su palabra: el color nunca va solo.
 */
const NEW_TONE =
  "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300";

/** El bloque de la página que muestra cada métrica. */
export const NEWS_BLOCK: Readonly<Record<NewsMetric, string>> = {
  activity: "actividad",
  inflation: "monetario",
  remRound: "rem-inflacion",
  primaryBalance: "fiscal",
  tradeBalance: "externo",
};

const NEWS_NAME: Readonly<Record<NewsMetric, string>> = {
  activity: "EMAE",
  inflation: "IPC",
  remRound: "REM",
  primaryBalance: "Fiscal",
  tradeBalance: "Comercio",
};

type Marked = Extract<NewsStatus, { status: "new_period" | "revised" }>;

export function markedMetrics(
  news: ArgentinaNews,
): readonly { readonly metric: NewsMetric; readonly mark: Marked }[] {
  if (news.status !== "compared") return [];
  return (Object.keys(NEWS_BLOCK) as NewsMetric[]).flatMap((metric) => {
    const mark = news.metrics[metric];
    return mark.status === "unchanged" ? [] : [{ metric, mark }];
  });
}

/** Los bloques con algo nuevo o revisado, para el índice. */
export function markedBlocks(
  news: ArgentinaNews,
): Readonly<Record<string, Marked["status"]>> {
  return Object.fromEntries(
    markedMetrics(news).map(({ metric, mark }) => [
      NEWS_BLOCK[metric],
      mark.status,
    ]),
  );
}

export function NewsBadge({
  status,
  className,
}: {
  readonly status: Marked["status"];
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-4xl border px-1.5 text-xs leading-none font-medium whitespace-nowrap",
        status === "new_period"
          ? NEW_TONE
          : "border-border bg-background text-muted-foreground",
        className,
      )}
    >
      {status === "new_period" ? (
        <CircleDot aria-hidden="true" className="size-3" />
      ) : null}
      {status === "new_period" ? "Nuevo" : "Revisado"}
    </span>
  );
}

/** El punto del índice de bloques: el texto lo lleva el lector de pantalla. */
export function NewsDot({ status }: { readonly status: Marked["status"] }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          status === "new_period"
            ? "bg-blue-600 dark:bg-blue-400"
            : "bg-muted-foreground",
        )}
      />
      <span className="sr-only">
        {status === "new_period" ? ", nuevo" : ", revisado"}
      </span>
    </>
  );
}

function sinceText(since: string): string {
  return new Date(since).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

/**
 * Una línea: qué llegó desde la visita anterior, agrupado en «Nuevo» y
 * «Revisado», cada métrica un vínculo a su bloque. Sin nada marcado no ocupa
 * lugar.
 */
export function NewsStrip({ news }: { readonly news: ArgentinaNews }) {
  const marked = markedMetrics(news);
  if (news.status !== "compared" || marked.length === 0) return null;
  const groups = (["new_period", "revised"] as const)
    .map((status) => ({
      status,
      items: marked.filter(({ mark }) => mark.status === status),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <section
      aria-label="Datos nuevos"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
    >
      {groups.map((group) => (
        <div
          key={group.status}
          className="flex flex-wrap items-center gap-x-2 gap-y-1"
        >
          <NewsBadge status={group.status} />
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {group.items.map(({ metric, mark }) => (
              <li key={metric}>
                <a
                  href={`#${NEWS_BLOCK[metric]}`}
                  className="inline-flex items-baseline gap-1 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="font-medium">{NEWS_NAME[metric]}</span>
                  <span className="numeric text-muted-foreground">
                    {shortMonth(mark.on).slice(0, 3)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        desde tu visita del{" "}
        <time dateTime={news.since} className="numeric">
          {sinceText(news.since)}
        </time>
        <InfoTip title="Qué se marca como nuevo">
          <p>
            Un período que no estaba la última vez que abriste la página —IPC,
            EMAE, REM, resultado fiscal o comercio— es nuevo; el mismo período
            con otra cifra, revisado. El dólar, las reservas, el ITCRM y la soja
            cambian todos los días y no se marcan.
          </p>
        </InfoTip>
      </span>
    </section>
  );
}
