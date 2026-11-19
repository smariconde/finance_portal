import { randomUUID } from "node:crypto";

import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { GlossaryTerm } from "@/app/_components/glossary-term";
import { InfoTip } from "@/app/_components/info-tip";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { servesTradingData } from "@/modules/configuration/domain/config-health";
import {
  citationsOf,
  glossaryEntryOf,
  type GlossarySource,
} from "@/modules/education/domain/glossary";
import {
  TECHNICAL_LESSONS_VERSION,
  lessonChartRows,
  lessonOf,
} from "@/modules/education/domain/technical-lessons";
import { TRADING_GLOSSARY } from "@/modules/education/domain/trading-glossary";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { readSetupHistory } from "@/server/trading/setup-history";
import { safeErrorSummary } from "@/server/trading/safe-error";

import { LessonChart } from "../_components/lesson-chart";
import {
  SetupHistoryCard,
  type SetupHistoryState,
} from "../_components/setup-history";
import { SizingExampleCard } from "../_components/sizing-example";

/** Ver [ADR 0005](../../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

type PageProps = { readonly params: Promise<{ lesson: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const lesson = lessonOf((await params).lesson);
  return {
    title: `${lesson?.title ?? "Lección"} | Lecciones | Portal Financiero`,
    description: lesson?.idea ?? "Lección de análisis técnico.",
  };
}

export default async function LessonPage({ params }: PageProps) {
  const lesson = lessonOf((await params).lesson);
  if (lesson === null) notFound();

  // El contenido es estático y se sirve en cualquier modo; el historial es
  // dato del owner y sólo sale de la base de trading en el runtime personal.
  const health = await getRequestConfigHealth();
  let history: SetupHistoryState = { state: "off" };
  if (lesson.setupCode !== null && servesTradingData(health)) {
    const reference = randomUUID();
    try {
      history = {
        state: "read",
        history: await readSetupHistory(lesson.setupCode),
      };
    } catch (error) {
      console.error(
        "setup history read failed",
        reference,
        safeErrorSummary(error),
      );
      history = { state: "unavailable", reference };
    }
  }

  const terms = lesson.terms.map((key) => {
    const entry = glossaryEntryOf(TRADING_GLOSSARY, key);
    return { entry, citations: citationsOf(TRADING_GLOSSARY, entry) };
  });
  const sources = [
    ...new Map(
      terms
        .flatMap((term) => term.citations)
        .map((source): [string, GlossarySource] => [source.key, source]),
    ).values(),
  ];
  const related = lesson.related
    .map((slug) => lessonOf(slug))
    .filter((item) => item !== null);

  return (
    <PageContainer>
      <PageHeader
        id="leccion-title"
        title={lesson.title}
        lead={
          <span className="flex flex-wrap items-center gap-2">
            {lesson.es}
            <Badge variant="outline">
              {lesson.kind === "setup" ? "Setup" : "Concepto"}
            </Badge>
          </span>
        }
      >
        <p className="max-w-[65ch] text-base">{lesson.idea}</p>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle as="h2">El patrón</CardTitle>
        </CardHeader>
        <CardContent>
          <LessonChart
            title={lesson.title}
            timeframe={lesson.chart.timeframe}
            rows={lessonChartRows(lesson)}
            overlays={lesson.chart.overlays}
            panels={lesson.chart.panels}
            levels={lesson.chart.levels}
            marks={lesson.chart.marks}
            zones={lesson.chart.zones}
            rules={lesson.rules}
          />
        </CardContent>
      </Card>

      {lesson.sizing === undefined ? null : (
        <SizingExampleCard example={lesson.sizing} />
      )}

      {lesson.setupCode === null ? null : (
        <SetupHistoryCard label={lesson.title} reading={history} />
      )}

      <section aria-labelledby="terminos-title" className="flex flex-col gap-2">
        <h2 id="terminos-title" className="text-sm font-medium">
          Términos
        </h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {terms.map(({ entry, citations }) => (
            <li key={entry.key}>
              <GlossaryTerm entry={entry} citations={citations} />
            </li>
          ))}
        </ul>
      </section>

      <details className="group rounded-xl ring-1 ring-foreground/10 open:bg-card">
        <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-medium outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50">
          Errores comunes
          <span className="numeric ml-2 text-muted-foreground">
            {lesson.mistakes.length}
          </span>
        </summary>
        <ul className="flex list-disc flex-col gap-1.5 px-4 pb-4 pl-9 text-sm">
          {lesson.mistakes.map((mistake) => (
            <li key={mistake}>{mistake}</li>
          ))}
        </ul>
      </details>

      {related.length === 0 ? null : (
        <nav aria-label="Lecciones relacionadas">
          <ul className="flex flex-wrap gap-2">
            {related.map((item) => (
              <li key={item.slug}>
                <Link
                  href={`/lecciones/${item.slug}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {item.title}
                  <ArrowRight
                    className="size-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <footer className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <InfoTip title="Fuentes" label="Fuentes">
          <ul className="flex flex-col gap-1.5">
            {sources.map((source) => (
              <li key={source.key}>{source.citation}</li>
            ))}
          </ul>
          <p className="text-xs">{TECHNICAL_LESSONS_VERSION}</p>
        </InfoTip>
      </footer>
    </PageContainer>
  );
}
