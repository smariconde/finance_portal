import { InfoTip } from "@/app/_components/info-tip";
import { cn } from "@/lib/utils";
import type {
  ArgentinaNews,
  NewsMetric,
  NewsStatus,
} from "@/modules/argentina-dashboard/domain/argentina-news";

import {
  compactMillions,
  points,
  resultWord,
  shortMonth,
  signedAmount,
  signedPoints,
} from "./format";
import { NewsBadge } from "./news-badge";

export { NewsBadge } from "./news-badge";

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

/**
 * Cómo se escribe la cifra de cada métrica (`argentina-news-1.1.0`): la misma
 * que muestra su tarjeta o su bloque. El EMAE, su variación mensual
 * desestacionalizada; el IPC, la inflación del mes; el comercio, el saldo; el
 * fiscal, el resultado primario del mes.
 */
const NEWS_FIGURE: Readonly<Record<NewsMetric, (value: string) => string>> = {
  activity: (value) => signedPoints(value),
  inflation: (value) => points(value),
  remRound: (value) => points(value),
  primaryBalance: (value) =>
    `${resultWord(value) === "déficit" ? "−" : "+"}$ ${compactMillions(value)}`,
  tradeBalance: (value) => `US$ ${signedAmount(value)} M`,
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

/** `2026-10-31` → `oct`; con el año sólo si no es el del período nuevo. */
function periodText(on: string, reference: string): string {
  return on.slice(0, 4) === reference.slice(0, 4)
    ? shortMonth(on).slice(0, 3)
    : shortMonth(on);
}

/** La cifra de un período nuevo y, debajo, la del que había antes. */
function NewPeriodFigure({
  metric,
  mark,
}: {
  readonly metric: NewsMetric;
  readonly mark: Extract<Marked, { status: "new_period" }>;
}) {
  const format = NEWS_FIGURE[metric];
  const previous = mark.previous;
  return (
    <>
      {mark.headline === null ? null : (
        <span className="numeric text-base leading-5 font-semibold text-foreground">
          {format(mark.headline)}
        </span>
      )}
      {previous === null || previous.headline === null ? null : (
        <span className="numeric text-xs text-muted-foreground">
          <span className="sr-only">antes, </span>
          {periodText(previous.on, mark.on)} {format(previous.headline)}
        </span>
      )}
    </>
  );
}

/** El mismo período, antes y después de la revisión. */
function RevisedFigure({
  metric,
  mark,
}: {
  readonly metric: NewsMetric;
  readonly mark: Extract<Marked, { status: "revised" }>;
}) {
  const format = NEWS_FIGURE[metric];
  if (mark.headline === null) return null;
  return (
    <span className="numeric inline-flex flex-wrap items-baseline gap-x-1.5 text-base leading-5 font-semibold text-foreground">
      {mark.previousHeadline === null ? null : (
        <>
          <span className="sr-only">antes </span>
          <s className="text-sm font-normal text-muted-foreground decoration-muted-foreground/70">
            {format(mark.previousHeadline)}
          </s>
          <span
            aria-hidden="true"
            className="text-sm font-normal text-muted-foreground"
          >
            →
          </span>
          <span className="sr-only">, ahora </span>
        </>
      )}
      {format(mark.headline)}
    </span>
  );
}

/**
 * Lo que llegó desde la visita anterior (`argentina-news-1.1.0`, ADR 0079):
 * una fila de ítems, cada uno con su marca, su período, la cifra nueva y la
 * que había —o, revisado, la de antes tachada y la de ahora—, y un vínculo a
 * su bloque. Sin nada marcado no ocupa lugar.
 */
export function NewsStrip({ news }: { readonly news: ArgentinaNews }) {
  const marked = markedMetrics(news);
  if (news.status !== "compared" || marked.length === 0) return null;
  // Lo nuevo primero, después lo revisado.
  const ordered = [
    ...marked.filter(({ mark }) => mark.status === "new_period"),
    ...marked.filter(({ mark }) => mark.status === "revised"),
  ];

  return (
    <section aria-label="Datos nuevos" className="flex flex-col gap-2">
      <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        Desde tu visita del{" "}
        <time dateTime={news.since} className="numeric">
          {sinceText(news.since)}
        </time>
        <InfoTip title="Qué se marca como nuevo">
          <p>
            Un período que no estaba la última vez que abriste la página —IPC,
            EMAE, REM, resultado fiscal o comercio— es nuevo, al lado de la
            cifra que había; el mismo período con otra cifra, revisado, con la
            de antes tachada. El dólar, las reservas, el ITCRM y la soja cambian
            todos los días y no se marcan: si cambian con la página abierta, su
            tarjeta dice «Actualizado».
          </p>
        </InfoTip>
      </p>
      <ul className="flex flex-wrap gap-2">
        {ordered.map(({ metric, mark }) => (
          <li key={metric} className="flex">
            <a
              href={`#${NEWS_BLOCK[metric]}`}
              className="flex min-h-11 flex-col justify-start gap-1 rounded-lg bg-card px-3 py-2 ring-1 ring-foreground/10 transition-[box-shadow] outline-none hover:ring-foreground/25 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
            >
              <span className="flex items-center gap-1.5 text-xs">
                <NewsBadge status={mark.status} />
                <span className="font-medium">{NEWS_NAME[metric]}</span>
                <span className="numeric text-muted-foreground">
                  {shortMonth(mark.on)}
                </span>
              </span>
              {mark.status === "new_period" ? (
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <NewPeriodFigure metric={metric} mark={mark} />
                </span>
              ) : (
                <RevisedFigure metric={metric} mark={mark} />
              )}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
