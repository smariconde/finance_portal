import { randomUUID } from "node:crypto";

import { ArrowRight, DatabaseZap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { termShort } from "@/app/_components/financial-terms";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { servesTradingData } from "@/modules/configuration/domain/config-health";
import { TECHNICAL_LESSONS } from "@/modules/education/domain/technical-lessons";
import { formatPercent } from "@/modules/valuation/domain/display-format";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import {
  readSetupSummaries,
  type SetupSummary,
} from "@/server/trading/setup-history";
import { safeErrorSummary } from "@/server/trading/safe-error";

import { RValue } from "../diario/_components/pnl-values";

export const metadata: Metadata = {
  title: "Lecciones | Portal Financiero",
  description:
    "Lecciones de análisis técnico: cada setup atado a su etiqueta del diario.",
};

/** Ver [ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

type Summaries =
  | {
      readonly state: "read";
      readonly bySetup: Readonly<Record<string, SetupSummary>>;
    }
  | { readonly state: "unavailable"; readonly reference: string }
  | { readonly state: "off" };

function LessonLink({
  slug,
  title,
  es,
}: {
  readonly slug: string;
  readonly title: string;
  readonly es: string;
}) {
  return (
    <Link
      href={`/lecciones/${slug}`}
      className="group inline-flex min-h-6 flex-col rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="font-medium group-hover:underline">{title}</span>
      <span className="text-xs text-muted-foreground">{es}</span>
    </Link>
  );
}

export default async function LessonsPage() {
  const health = await getRequestConfigHealth();
  let summaries: Summaries = { state: "off" };
  if (servesTradingData(health)) {
    const reference = randomUUID();
    try {
      summaries = {
        state: "read",
        bySetup: (await readSetupSummaries()).bySetup,
      };
    } catch (error) {
      console.error(
        "setup summaries read failed",
        reference,
        safeErrorSummary(error),
      );
      summaries = { state: "unavailable", reference };
    }
  }

  const setups = TECHNICAL_LESSONS.filter((lesson) => lesson.kind === "setup");
  const concepts = TECHNICAL_LESSONS.filter(
    (lesson) => lesson.kind === "concept",
  );
  const withStats = summaries.state === "read";

  return (
    <PageContainer>
      <PageHeader id="lecciones-title" title="Lecciones" />

      <section aria-labelledby="setups-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="setups-title" className="text-lg font-semibold">
            Setups
          </h2>
          {summaries.state === "unavailable" ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <DatabaseZap className="size-4" aria-hidden="true" />
              Base de trading no disponible
              <code className="font-mono">{summaries.reference}</code>
            </span>
          ) : null}
        </div>
        <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Setup</TableHead>
                <TableHead className="hidden md:table-cell">Idea</TableHead>
                {withStats ? (
                  <>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">
                      {termShort("winRate")}
                    </TableHead>
                    <TableHead className="text-right">
                      {termShort("expectancy")} R
                    </TableHead>
                  </>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {setups.map((lesson) => {
                const summary =
                  summaries.state === "read"
                    ? (summaries.bySetup[lesson.setupCode!] ?? null)
                    : null;
                const stats = summary?.stats ?? null;
                return (
                  <TableRow key={lesson.slug}>
                    <TableCell className="align-top">
                      <LessonLink
                        slug={lesson.slug}
                        title={lesson.title}
                        es={lesson.es}
                      />
                    </TableCell>
                    <TableCell className="hidden max-w-[48ch] align-top text-sm whitespace-normal text-muted-foreground md:table-cell">
                      {lesson.idea}
                    </TableCell>
                    {withStats ? (
                      <>
                        <TableCell className="numeric text-right align-top">
                          {summary?.tagged ?? 0}
                          {stats?.smallSample ? (
                            <Badge variant="outline" className="ml-2">
                              n &lt; 5
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="numeric text-right align-top">
                          {stats === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            formatPercent(stats.winRate, { scale: 0 })
                          )}
                        </TableCell>
                        <TableCell className="text-right align-top">
                          <RValue r={stats?.expectancyR ?? null} />
                        </TableCell>
                      </>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <section
        aria-labelledby="conceptos-title"
        className="flex flex-col gap-3"
      >
        <h2 id="conceptos-title" className="text-lg font-semibold">
          Conceptos
        </h2>
        <ul className="grid gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 sm:grid-cols-2">
          {concepts.map((lesson) => (
            <li key={lesson.slug} className="bg-card sm:last:odd:col-span-2">
              <Link
                href={`/lecciones/${lesson.slug}`}
                className="group flex h-full items-start justify-between gap-3 px-4 py-3 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">
                    {lesson.title}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {lesson.es}
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {lesson.idea}
                  </span>
                </span>
                <ArrowRight
                  className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}
