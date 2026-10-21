import { History, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DataUnavailableNotice } from "@/app/_components/data-unavailable-notice";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import type { ValuationHistoryView } from "@/modules/valuation/application/read-valuation-history";
import type {
  ValuationResultNewerGap,
  ValuationResultReading,
} from "@/modules/valuation/application/read-valuation-result";
import {
  formatCalendarDate,
  formatUtcTimestamp,
} from "@/modules/valuation/domain/display-format";
import { valuationTickerSchema } from "@/modules/valuation/domain/valuation-job";
import {
  collectDeclaredAbsences,
  collectReportedFacts,
  FRESHNESS_POLICY_VERSION,
  annotateSensitivity,
  readScenarios,
} from "@/modules/valuation/domain/valuation-report";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import {
  readValuationHistoryForRequest,
  readValuationResultForRequest,
} from "@/server/jobs/valuation-job";

import {
  GAP_COPY,
  RIGOR_COPY,
  SNAPSHOT_GAP_COPY,
} from "../_components/job-copy";
import { AssumptionsTables } from "../_components/run/assumptions-tables";
import {
  EvidenceKindMark,
  type EvidenceKind,
} from "../_components/run/data-marks";
import { EquityBridgeTable } from "../_components/run/equity-bridge-table";
import { EvidenceTable } from "../_components/run/evidence-table";
import { checkLabel } from "../_components/run/labels";
import { RunChecks } from "../_components/run/run-checks";
import { RunHeadline } from "../_components/run/run-headline";
import { ScenariosTable } from "../_components/run/scenarios-table";
import { SensitivityMatrix } from "../_components/run/sensitivity-matrix";
import { ValuationHistory } from "../_components/valuation-history";
import { CedearAccess } from "./_components/cedear-access";
import { CostOfCapitalTable } from "./_components/cost-of-capital-table";
import { DerivationSummary } from "./_components/derivation-summary";
import { QualitativeDecisions } from "./_components/qualitative-decisions";
import { RigorPanel } from "./_components/rigor-panel";

/** Ver [ADR 0005](../../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

type PageProps = {
  readonly params: Promise<{ ticker: string }>;
};

const DAMODARAN_SOURCE_ID = "damodaran-current-data";

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { ticker } = await params;
  const parsed = valuationTickerSchema.safeParse(ticker);

  return {
    // Un segmento inválido no se repite en el título (`TM-12`).
    title: `${parsed.success ? parsed.data : "Ticker"}: valuación | Portal Financiero`,
    description:
      "Valor por acción de la última corrida registrada, con su nivel de rigor, sus fuentes y los supuestos distinguidos de los hechos.",
  };
}

/** Qué distingue cada marca, en el orden en que aparecen en la página. */
const DATA_KINDS: readonly { kind: EvidenceKind; meaning: string }[] = [
  {
    kind: "reported_fact",
    meaning: "lo publicó la SEC; dice cuándo fue conocible",
  },
  {
    kind: "reference_data",
    meaning:
      "lo publicó un tercero —Damodaran, un emisor de CEDEAR— y se fecha al leerlo",
  },
  {
    kind: "derived_by_rule",
    meaning: "lo calculó una regla versionada desde lo anterior",
  },
  {
    kind: "ai_proposal",
    meaning: "lo transcribió o eligió la IA y una policy lo verificó",
  },
  {
    kind: "owner_declaration",
    meaning: "lo decidió el owner, con fecha y motivo",
  },
  {
    kind: "declared_absent",
    meaning: "no existe o no se reportó, y se dice por qué",
  },
];

function NewerGapAlert({ gap }: { gap: ValuationResultNewerGap }) {
  return (
    <Alert>
      <History aria-hidden="true" />
      <AlertTitle>El pedido más reciente no registró una corrida</AlertTitle>
      <AlertDescription>
        El del{" "}
        <time dateTime={gap.knownAt}>{formatUtcTimestamp(gap.knownAt)}</time>{" "}
        terminó así: {gap.gap === null ? "sin resultado." : GAP_COPY[gap.gap]}
        {gap.snapshotGap === null
          ? null
          : ` Motivo: ${SNAPSHOT_GAP_COPY[gap.snapshotGap]}.`}{" "}
        Esta página muestra la última corrida que sí se registró.
      </AlertDescription>
    </Alert>
  );
}

function PageFrame({
  ticker,
  title,
  children,
}: {
  ticker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <section className="flex flex-col gap-3" aria-labelledby="result-title">
          <Link
            href="/valuacion"
            className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Corrida por ticker
          </Link>
          <h1
            id="result-title"
            className="max-w-4xl text-2xl font-semibold tracking-tight text-balance md:text-3xl"
          >
            {title}
          </h1>
          {title === ticker ? null : (
            <p className="font-mono text-sm text-muted-foreground">{ticker}</p>
          )}
        </section>
        {children}
      </div>
    </div>
  );
}

function WithoutRun({
  reading,
}: {
  reading: Exclude<ValuationResultReading, { state: "run" }>;
}) {
  let message: string;

  if (reading.state === "not_requested") {
    message = `Todavía no hay corridas terminadas de ${reading.ticker}.`;
  } else if (reading.state === "unsupported_run") {
    message =
      "La última corrida registrada usa un motor que no es FCFF, y esta página sólo lee corridas FCFF.";
  } else {
    const gap = reading.latest.gap;
    const snapshotGap = reading.latest.snapshotGap;

    message = `Ningún pedido registró una corrida. El último terminó así: ${
      gap === null ? "sin resultado." : GAP_COPY[gap]
    }${snapshotGap === null ? "" : ` Motivo: ${SNAPSHOT_GAP_COPY[snapshotGap]}.`}`;
  }

  return (
    <PageFrame ticker={reading.ticker} title={reading.ticker}>
      <section className="flex max-w-prose flex-col gap-3">
        <p className="text-sm" role="status">
          {message}
        </p>
        <p className="text-sm text-muted-foreground">
          Sin corrida no hay valor por acción, y esta página no lo estima.{" "}
          <Link
            className="text-foreground underline underline-offset-4"
            href="/valuacion"
          >
            Encolar el ticker
          </Link>{" "}
          evalúa otra vez lo guardado.
        </p>
      </section>
    </PageFrame>
  );
}

/**
 * Resultado de una valuación sobre una empresa real (`F6-03`).
 *
 * Lee la última corrida registrada del ticker y la muestra con la misma
 * cadena de evidencia que la corrida de referencia, más lo que sólo tiene una
 * empresa real: rigor y método, decisiones cualitativas con su base, costo de
 * capital por release y la regla que derivó los supuestos.
 *
 * El render sólo lee: no encola, no recalcula la corrida, no sale a la red y
 * no llama al modelo. Refrescar es volver a encolar en `/valuacion`
 * ([ADR 0047](../../../../docs/architecture/adr/0047-valuation-run-history.md)).
 * No compara el valor con el precio de mercado: es una decisión del owner del
 * 2026-10-21, y no hay recomendación ni precio objetivo.
 */
export default async function ValuationResultPage({ params }: PageProps) {
  const health = await getRequestConfigHealth();

  if (!servesRealData(health)) {
    return (
      <RuntimeLockedNotice
        health={health}
        surface="El resultado de la valuación"
      />
    );
  }

  const { ticker: segment } = await params;
  const parsed = valuationTickerSchema.safeParse(segment);

  if (!parsed.success) {
    notFound();
  }

  // Una sola URL por ticker: `aapl` lleva a `AAPL`.
  if (parsed.data !== segment) {
    redirect(`/valuacion/${encodeURIComponent(parsed.data)}`);
  }

  let reading: ValuationResultReading;
  let history: ValuationHistoryView;

  try {
    [reading, history] = await Promise.all([
      readValuationResultForRequest(parsed.data),
      readValuationHistoryForRequest(parsed.data),
    ]);
  } catch (error) {
    // Sólo el tipo: el mensaje puede traer host, puerto o SQL (`TM-02`).
    console.error(
      "valuation result read failed",
      error instanceof Error ? error.name : typeof error,
    );

    return <DataUnavailableNotice surface="El resultado de la valuación" />;
  }

  if (reading.state !== "run") {
    return <WithoutRun reading={reading} />;
  }

  const { run, subject } = reading;
  const scenarios = readScenarios(run);
  const sensitivity = annotateSensitivity(run);
  // Un escenario que pide revisión deja la corrida en revisión: el aviso los
  // cuenta igual que a los de la base.
  const reviewChecks = [
    ...(run.result?.checks ?? []),
    ...(run.result?.scenarios?.bear.checks ?? []),
    ...(run.result?.scenarios?.bull.checks ?? []),
  ].filter(
    (check) => check.mode === "require_review" && check.status === "failed",
  );
  const damodaran =
    DEMO_SOURCE_REGISTRY.find((entry) => entry.sourceId === DAMODARAN_SOURCE_ID)
      ?.attribution ?? null;

  return (
    <PageFrame
      ticker={reading.ticker}
      title={subject?.legalName ?? reading.ticker}
    >
      <dl className="-mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Valuada al</dt>
          <dd>
            <time className="numeric" dateTime={run.asOf}>
              {formatCalendarDate(run.asOf)}
            </time>
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Rigor</dt>
          <dd>
            <a className="underline underline-offset-4" href="#rigor-title">
              {RIGOR_COPY[run.input.assessment.rigor.level]}
            </a>
          </dd>
        </div>
        {subject?.mic == null ? null : (
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Listing</dt>
            <dd className="font-mono">{subject.mic}</dd>
          </div>
        )}
        {subject?.cik == null ? null : (
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">CIK</dt>
            <dd className="numeric">{subject.cik}</dd>
          </div>
        )}
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Corrida registrada</dt>
          <dd>
            <time className="numeric" dateTime={run.recordedAt}>
              {formatUtcTimestamp(run.recordedAt)}
            </time>
          </dd>
        </div>
      </dl>

      {reading.newerGap === null ? null : (
        <NewerGapAlert gap={reading.newerGap} />
      )}

      {reviewChecks.length === 0 ? null : (
        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>La corrida quedó marcada para revisión</AlertTitle>
          <AlertDescription>
            {reviewChecks.length} control
            {reviewChecks.length === 1 ? "" : "es"} en modo revisión no pasó (
            {reviewChecks.map((check) => checkLabel(check.id)).join(", ")}). El
            valor se calculó igual, pero no debe leerse como cerrado hasta
            resolverlos; el detalle está en los controles.
          </AlertDescription>
        </Alert>
      )}

      <RunHeadline run={run} />

      <RigorPanel run={run} />

      <CedearAccess cedear={reading.cedear} />

      <section
        aria-labelledby="data-kinds-title"
        className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4"
      >
        <h2 id="data-kinds-title" className="text-base font-medium">
          Cómo leer el origen de cada dato
        </h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {DATA_KINDS.map((entry) => (
            <div key={entry.kind} className="flex flex-col items-start gap-1">
              <dt>
                <EvidenceKindMark kind={entry.kind} />
              </dt>
              <dd className="text-sm text-muted-foreground">{entry.meaning}</dd>
            </div>
          ))}
        </dl>
      </section>

      <EvidenceTable
        facts={collectReportedFacts(run)}
        absences={collectDeclaredAbsences(run)}
        policyVersion={FRESHNESS_POLICY_VERSION}
      />

      <QualitativeDecisions run={run} />

      <CostOfCapitalTable run={run} attribution={damodaran} />

      <DerivationSummary run={run} />

      <AssumptionsTables
        run={run}
        assumptionsKind={
          run.input.derivedAssumptions === undefined
            ? "assumption"
            : "derived_by_rule"
        }
      />

      <EquityBridgeTable run={run} />

      {scenarios === null ? null : (
        <ScenariosTable reading={scenarios} currency={run.currency} />
      )}

      {sensitivity === null ? null : (
        <SensitivityMatrix sensitivity={sensitivity} />
      )}

      <RunChecks run={run} />

      <ValuationHistory view={history} />

      <section
        className="rounded-xl border bg-muted/30 p-4"
        aria-labelledby="limits-title"
      >
        <h2 id="limits-title" className="text-base font-medium">
          Límites de esta superficie
        </h2>
        <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <li>
            Es una lectura educativa de un modelo, no una recomendación ni un
            precio objetivo. No se compara con el precio de mercado.
          </li>
          <li>
            Abrir esta página no recalcula la corrida, no baja datos y no llama
            al modelo. Para refrescar, se vuelve a encolar el ticker.
          </li>
          <li>
            Los supuestos no son editables: salen de una regla versionada, y
            cambiarla produce otra corrida.
          </li>
          <li>
            El precio del CEDEAR en BYMA, su valor en pesos y la descarga de
            fundamentals que falten son slices posteriores.
          </li>
        </ul>
      </section>
    </PageFrame>
  );
}
