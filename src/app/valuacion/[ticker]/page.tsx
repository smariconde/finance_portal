import { History, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DataUnavailableNotice } from "@/app/_components/data-unavailable-notice";
import { CompanyMark } from "@/app/_components/company-mark";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import type { ValuationHistoryView } from "@/modules/valuation/application/read-valuation-history";
import type {
  ValuationResultNewerGap,
  ValuationResultReading,
} from "@/modules/valuation/application/read-valuation-result";
import {
  formatAmount,
  formatCalendarDate,
  formatPercent,
  formatUtcTimestamp,
} from "@/modules/valuation/domain/display-format";
import { valuationTickerSchema } from "@/modules/valuation/domain/valuation-job";
import { valuationVerdict } from "@/modules/valuation/domain/valuation-verdict";
import {
  collectDeclaredAbsences,
  collectReportedFacts,
  FRESHNESS_POLICY_VERSION,
  annotateSensitivity,
  readScenarios,
} from "@/modules/valuation/domain/valuation-report";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { requestCompanyLogoUrl } from "@/server/config/company-logo";
import {
  readValuationHistoryForRequest,
  readValuationResultForRequest,
} from "@/server/jobs/valuation-job";

import {
  describeDataStep,
  describeJobGap,
  describeQualitativeStep,
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
import { ValuationRunner } from "../_components/valuation-runner";
import { CedearAccess } from "./_components/cedear-access";
import { CostOfCapitalTable } from "./_components/cost-of-capital-table";
import { DerivationSummary } from "./_components/derivation-summary";
import { GrowthDerivation } from "./_components/growth-derivation";
import { AuditGroup } from "./_components/audit-group";
import { CompanyHistory } from "./_components/company-history";
import { PeerContext } from "./_components/peer-context";
import { PriceRequirements } from "./_components/price-requirements";
import { ValueWalkthrough } from "./_components/value-walkthrough";
import { VerdictPanel } from "./_components/verdict-panel";
import { QualitativeDecisions } from "./_components/qualitative-decisions";
import { RigorPanel } from "./_components/rigor-panel";

/** Ver [ADR 0005](../../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

type PageProps = {
  readonly params: Promise<{ ticker: string }>;
};

const DAMODARAN_SOURCE_ID = "damodaran-current-data";
const PRICES_SOURCE_ID = "yahoo-finance";

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
        terminó así:{" "}
        {describeJobGap(gap.gap, gap.assetProfile, gap.unsupportedReason)}
        {gap.snapshotGap === null
          ? null
          : ` Motivo: ${SNAPSHOT_GAP_COPY[gap.snapshotGap]}.`}
        {describeDataStep(gap.dataStep) === null
          ? null
          : ` ${describeDataStep(gap.dataStep)}`}
        {describeQualitativeStep(gap.qualitativeStep) === null
          ? null
          : ` ${describeQualitativeStep(gap.qualitativeStep)}`}{" "}
        Esta página muestra la última corrida que sí se registró.
      </AlertDescription>
    </Alert>
  );
}

function PageFrame({
  ticker,
  title,
  hasRun,
  children,
}: {
  ticker: string;
  title: string;
  hasRun: boolean;
  children: ReactNode;
}) {
  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <section
          className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
          aria-labelledby="result-title"
        >
          <div className="flex min-w-0 flex-col gap-3">
            <Link
              href="/valuacion"
              className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Valuación por ticker
            </Link>
            <div className="flex min-w-0 items-center gap-4">
              <CompanyMark
                ticker={ticker}
                name={title === ticker ? null : title}
                logoUrl={requestCompanyLogoUrl(ticker)}
                size="lg"
              />
              <div className="flex min-w-0 flex-col gap-1">
                <h1
                  id="result-title"
                  className="max-w-4xl text-2xl font-semibold tracking-tight text-balance md:text-3xl"
                >
                  {title}
                </h1>
                {title === ticker ? null : (
                  <p className="font-mono text-sm text-muted-foreground">
                    {ticker}
                  </p>
                )}
              </div>
            </div>
          </div>
          <ValuationRunner ticker={ticker} hasRun={hasRun} />
        </section>
        {children}
      </div>
    </div>
  );
}

/** Las secciones de la página, en el orden en que se leen. */
const SECTIONS = [
  { id: "veredicto", label: "Precio contra valor" },
  { id: "exigencias", label: "Qué tendría que pasar" },
  { id: "pares", label: "Frente a sus pares" },
  { id: "historia", label: "Cómo viene la empresa" },
  { id: "valor", label: "Por qué vale eso" },
  { id: "escenarios", label: "Escenarios" },
  { id: "cedear", label: "CEDEAR" },
  { id: "auditoria", label: "Auditoría" },
  { id: "historial", label: "Historial" },
] as const;

/** El método en palabras; el código queda en la auditoría. */
const METHOD_COPY: Record<string, string> = {
  fcff_base: "Flujo de caja descontado",
  normalized_fcff: "Flujo de caja con margen de ciclo",
};

function SectionNav() {
  return (
    <nav aria-label="Secciones del resultado" className="-mt-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-2 border-b pb-3 text-sm">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              href={`#${section.id}`}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Un grupo de la página con su ancla; el título lo pone cada tarjeta. */
function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="flex scroll-mt-20 flex-col gap-6">
      {children}
    </div>
  );
}

function WithoutRun({
  reading,
}: {
  reading: Exclude<ValuationResultReading, { state: "run" | "financial_run" }>;
}) {
  let message: string;
  const reitAffoRefusal =
    reading.state === "no_run" &&
    reading.latest.snapshotGap === "reit_affo_reconciliation_missing";

  if (reading.state === "not_requested") {
    message = `Todavía no hay corridas terminadas de ${reading.ticker}.`;
  } else if (reading.state === "unsupported_run") {
    message =
      "La última corrida registrada usa un motor que no es FCFF, y esta página sólo lee corridas FCFF.";
  } else {
    const gap = reading.latest.gap;
    const snapshotGap = reading.latest.snapshotGap;
    const data = describeDataStep(reading.latest.dataStep);
    const qualitative = describeQualitativeStep(reading.latest.qualitativeStep);

    message = `Ningún pedido registró una corrida. El último terminó así: ${describeJobGap(
      gap,
      reading.latest.assetProfile,
      reading.latest.unsupportedReason,
    )}${snapshotGap === null ? "" : ` Motivo: ${SNAPSHOT_GAP_COPY[snapshotGap]}.`}${data === null ? "" : ` ${data}`}${qualitative === null ? "" : ` ${qualitative}`}`;
  }

  return (
    <PageFrame ticker={reading.ticker} title={reading.ticker} hasRun={false}>
      <section className="flex max-w-prose flex-col gap-3">
        <p className="text-sm">{message}</p>
        <p className="text-sm text-muted-foreground">
          {reitAffoRefusal ? (
            <>
              {
                "Volver a valuar el mismo 10-K repetirá esta negativa mientras no haya una conciliación AFFO compatible con la receta del modelo."
              }{" "}
              El NAV también requiere NOI forward y una tasa de capitalización
              comparable.
              {reading.state === "no_run" &&
              reading.latest.reitAffoAccessionNumber !== null ? (
                <>
                  {" "}
                  Presentación SEC: {reading.latest.reitAffoAccessionNumber}.
                </>
              ) : null}
            </>
          ) : (
            <>
              Sin corrida no hay valor por acción, y esta página no lo estima.
              Valuar baja lo que falte de la SEC y el cierre del día, audita la
              empresa, pide a la IA lo cualitativo que falte y evalúa al corte
              de hoy: si alcanza, la página se completa sola; si no, dice qué
              falta.
            </>
          )}
        </p>
      </section>
    </PageFrame>
  );
}

function FinancialRunView({
  reading,
  history,
}: {
  reading: Extract<ValuationResultReading, { state: "financial_run" }>;
  history: ValuationHistoryView;
}) {
  const { run, market } = reading;
  const base = run.result?.base;
  const first = base?.periods[0];
  const risk = run.input.risk;
  const reviewChecks =
    run.result?.checks.filter(
      (check) => check.mode === "require_review" && check.status === "failed",
    ) ?? [];
  return (
    <PageFrame
      ticker={reading.ticker}
      title={reading.subject?.legalName ?? reading.ticker}
      hasRun
    >
      <p className="-mt-3 text-sm text-muted-foreground">
        Exceso de retorno sobre patrimonio común ·{" "}
        {run.assetProfile === "bank" ? "Banco" : "Aseguradora"} ·{" "}
        <time dateTime={run.asOf}>{formatCalendarDate(run.asOf)}</time> · Modelo
        experimental
      </p>
      {reading.newerGap === null ? null : (
        <NewerGapAlert gap={reading.newerGap} />
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Value per share</CardTitle>
            <CardDescription>
              Equity común dividido por acciones y unidades
            </CardDescription>
          </CardHeader>
          <CardContent className="numeric text-3xl font-semibold">
            {base === undefined
              ? "Sin valor"
              : `${run.currency} ${formatAmount(base.valuePerShare)}`}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Precio al corte</CardTitle>
            <CardDescription>
              Último cierre guardado de la misma security
            </CardDescription>
          </CardHeader>
          <CardContent className="numeric text-3xl font-semibold">
            {market.close === null
              ? "Sin cierre"
              : `${market.close.currency} ${formatAmount(market.close.close)}`}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              {market.priceToValue === null ? "Estado" : "Price / value"}
            </CardTitle>
            <CardDescription>
              {market.priceToValue === null
                ? "Resultado del motor y controles"
                : "Cierre ÷ valor por acción; misma fecha, moneda y base"}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-lg font-medium">
            {market.priceToValue === null ? (
              run.status === "rejected" ? (
                "Rechazada"
              ) : (
                "Requiere revisión"
              )
            ) : (
              <span className="numeric text-3xl font-semibold">
                {formatAmount(market.priceToValue)}×
              </span>
            )}
            <p className="mt-1 text-sm font-normal text-muted-foreground">
              {run.status === "rejected"
                ? run.failure?.code
                : `${reviewChecks.length} controles piden revisión`}
            </p>
          </CardContent>
        </Card>
      </div>
      {!market.comparable && market.reason !== null ? (
        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>Precio y valor no comparables</AlertTitle>
          <AlertDescription>
            {market.reason === "missing_close"
              ? "Falta el cierre de la fecha de valuación."
              : market.reason === "currency_mismatch"
                ? "El cierre usa otra moneda."
                : market.reason === "split_after_share_basis"
                  ? "Hubo un split entre la fecha de las acciones y el cierre."
                  : "El precio o el valor no es positivo."}
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Por qué vale eso</CardTitle>
          <CardDescription>
            El patrimonio común observado gana sobre su costo de equity durante
            la transición; en el terminal converge a ese costo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Common book equity</dt>
              <dd className="numeric font-medium">
                {run.input.commonBookEquity === null
                  ? "Falta"
                  : `${run.currency} ${formatAmount(run.input.commonBookEquity.value)}`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Derived ROE</dt>
              <dd className="numeric font-medium">
                {run.input.derivedFinancial === undefined
                  ? "Falta"
                  : formatPercent(run.input.derivedFinancial.roe)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Cost of equity, year 1</dt>
              <dd className="numeric font-medium">
                {first === undefined
                  ? "Sin cálculo"
                  : formatPercent(first.costOfEquity)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Distribución reportada</dt>
              <dd className="numeric font-medium">
                {formatPercent(run.input.assumptions.periods[0]!.payout)}
              </dd>
            </div>
          </dl>
          {base === undefined ? null : (
            <p className="mt-4 text-sm text-muted-foreground">
              Patrimonio inicial {run.currency} {formatAmount(base.bookEquity)}{" "}
              + valor presente de retornos excedentes {run.currency}{" "}
              {formatAmount(base.presentValueOfExcessReturns)}. Opciones de
              empleados: {run.currency} {formatAmount(base.employeeOptionValue)}
              .
            </p>
          )}
        </CardContent>
      </Card>
      {base === undefined ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Proyección de patrimonio</CardTitle>
            <CardDescription>
              Diez años explícitos; ROE y beta convergen por regla. Cifras en{" "}
              {run.currency}.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Año</TableHead>
                  <TableHead scope="col" className="text-right">
                    ROE
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Cost of equity
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Ending book equity
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Excess return
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {base.periods.map((period) => (
                  <TableRow key={period.periodIndex}>
                    <TableCell>{period.periodIndex}</TableCell>
                    <TableCell className="numeric text-right">
                      {formatPercent(
                        run.input.assumptions.periods[period.periodIndex - 1]!
                          .roe,
                      )}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {formatPercent(period.costOfEquity)}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {formatAmount(period.endingBookEquity)}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {formatAmount(period.excessReturn)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <CedearAccess cedear={reading.cedear} />
      <Card>
        <CardHeader>
          <CardTitle>Auditoría</CardTitle>
          <CardDescription>
            Hechos, fecha y controles de esta corrida.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            Patrimonio común (
            {run.input.commonBookEquity?.sourceId === "sec-edgar"
              ? "SEC"
              : "sin fuente"}
            ):{" "}
            <time dateTime={run.input.commonBookEquity?.asOf}>
              {run.input.commonBookEquity?.asOf ?? "sin fecha"}
            </time>
            ; utilidad común, patrimonio anterior y distribución provienen de
            tablas conciliadas del mismo 10-K. Los diagnósticos anteriores son
            automáticos; las releases de Damodaran se leen al corte{" "}
            <time
              dateTime={
                run.provenance.knowledge.knownAt ??
                run.provenance.knowledge.effectiveAt
              }
            >
              {formatUtcTimestamp(
                run.provenance.knowledge.knownAt ??
                  run.provenance.knowledge.effectiveAt,
              )}
            </time>
            .
          </p>
          <p>
            Libre de riesgo{" "}
            {risk.riskFree === null
              ? "faltante"
              : formatPercent(risk.riskFree.value)}{" "}
            · ERP{" "}
            {risk.matureErp === null
              ? "faltante"
              : formatPercent(risk.matureErp.value)}{" "}
            · CRP por domicilio{" "}
            {risk.countryRiskPremium === null
              ? "faltante"
              : formatPercent(risk.countryRiskPremium.value)}
            .
          </p>
          <dl className="space-y-3">
            <div>
              <dt className="font-medium">Capital regulatorio · 10-K</dt>
              <dd>
                {run.input.financialReview.regulatoryCapital ?? "Sin revisión"}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Calidad de activos · 10-K</dt>
              <dd>
                {run.input.financialReview.assetQuality ?? "Sin revisión"}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Cambios del patrimonio · 10-K</dt>
              <dd>
                {run.input.financialReview.cleanSurplus ?? "Sin revisión"}
              </dd>
            </div>
          </dl>
          {reviewChecks.length > 0 || run.failure !== null ? (
            <ul className="list-disc space-y-1 pl-5">
              {run.result?.checks
                .filter((check) => check.status === "failed")
                .map((check) => (
                  <li key={check.id}>
                    {check.id === "financial_country_risk_basis"
                      ? "El riesgo país por domicilio es una aproximación explícita."
                      : check.id === "financial_model_experimental"
                        ? "Este método de patrimonio financiero es experimental y requiere revisión."
                        : check.message}
                  </li>
                )) ?? <li>{run.failure?.message}</li>}
            </ul>
          ) : null}
        </CardContent>
      </Card>
      <ValuationHistory view={history} />
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
 * Desde `F6-09` lo compara con el cierre guardado al `as_of` de la corrida y
 * muestra lo que ese precio exige de cada supuesto (ADR 0048). No hay
 * recomendación ni precio objetivo.
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

  if (reading.state === "financial_run") {
    return <FinancialRunView reading={reading} history={history} />;
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
  // Base, bear y bull repiten el mismo control: se nombra una vez.
  const reviewLabels = [
    ...new Set(reviewChecks.map((check) => checkLabel(check.id))),
  ];
  const attributionOf = (sourceId: string) =>
    DEMO_SOURCE_REGISTRY.find((entry) => entry.sourceId === sourceId)
      ?.attribution ?? null;
  const damodaran = attributionOf(DAMODARAN_SOURCE_ID);

  const verdict = valuationVerdict({
    comparison: reading.market.comparison,
    scenarios: run.result?.scenarios ?? null,
  });

  return (
    <PageFrame
      ticker={reading.ticker}
      title={subject?.legalName ?? reading.ticker}
      hasRun
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
          <dt className="text-muted-foreground">Método</dt>
          <dd>{METHOD_COPY[run.method] ?? run.method}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Rigor</dt>
          <dd>
            <a className="underline underline-offset-4" href="#auditoria-rigor">
              {RIGOR_COPY[run.input.assessment.rigor.level]}
            </a>
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
            {reviewLabels.length} control
            {reviewLabels.length === 1 ? "" : "es"} en modo revisión no pasó (
            {reviewLabels.join(", ")}). El valor se calculó igual, pero no debe
            leerse como cerrado hasta resolverlos; el detalle está en la
            auditoría.
          </AlertDescription>
        </Alert>
      )}

      <SectionNav />

      <Anchor id="veredicto">
        <VerdictPanel
          run={run}
          verdict={verdict}
          market={reading.market}
          attribution={attributionOf(PRICES_SOURCE_ID)}
        />
      </Anchor>

      <Anchor id="exigencias">
        <PriceRequirements run={run} market={reading.market} />
      </Anchor>

      <Anchor id="pares">
        <PeerContext context={reading.peers} />
      </Anchor>

      <Anchor id="historia">
        <CompanyHistory
          trajectory={reading.trajectory}
          knownAt={
            run.provenance.knowledge.knownAt ??
            run.provenance.knowledge.effectiveAt
          }
        />
      </Anchor>

      <Anchor id="valor">
        <ValueWalkthrough run={run} />
      </Anchor>

      <Anchor id="escenarios">
        {scenarios === null ? null : (
          <ScenariosTable reading={scenarios} currency={run.currency} />
        )}

        {sensitivity === null ? null : (
          <SensitivityMatrix sensitivity={sensitivity} />
        )}
      </Anchor>

      <Anchor id="cedear">
        <CedearAccess cedear={reading.cedear} />
      </Anchor>

      <section
        id="auditoria"
        aria-labelledby="audit-title"
        className="flex scroll-mt-20 flex-col gap-2"
      >
        <div className="flex flex-col gap-1">
          <h2 id="audit-title" className="text-lg font-semibold">
            Auditoría de la corrida
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Todo lo que hace defendible el número: cada supuesto, cada hecho con
            su documento, los controles del motor y el contrato que impide mirar
            el futuro. Abrí lo que quieras verificar.
          </p>
        </div>

        <div className="border-t">
          <AuditGroup
            id="auditoria-corrida"
            title="Resultado y contrato de la corrida"
            summary="Valor exacto, corte de conocimiento, hashes para reproducirla e identidad del listing."
            defaultOpen={run.result === null}
          >
            <RunHeadline run={run} />
            <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
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
          </AuditGroup>

          <AuditGroup
            id="auditoria-supuestos"
            title="De dónde salen los supuestos"
            summary="La regla que los derivó, las ventas que congeló y el libro de ajustes del último ejercicio."
          >
            {run.input.revenueMargin?.derivedFrom === undefined ? (
              <DerivationSummary run={run} />
            ) : (
              <GrowthDerivation run={run} />
            )}
          </AuditGroup>

          <AuditGroup
            id="auditoria-proyeccion"
            title="Supuestos y proyección año por año"
            summary="Crecimiento, margen, impuestos y tasa de cada año, y el flujo descontado completo."
          >
            <AssumptionsTables
              run={run}
              assumptionsKind={
                run.input.derivedAssumptions === undefined &&
                run.input.revenueMargin?.derivedFrom === undefined
                  ? "assumption"
                  : "derived_by_rule"
              }
            />
          </AuditGroup>

          <AuditGroup
            id="auditoria-costo-capital"
            title="Costo de capital"
            summary="Cada parámetro de Damodaran con su release y fecha, y cómo se armó la tasa."
          >
            <CostOfCapitalTable run={run} attribution={damodaran} />
          </AuditGroup>

          <AuditGroup
            id="auditoria-cualitativas"
            title="Decisiones cualitativas"
            summary="Industria, mix geográfico y opciones de empleados: quién decidió y con qué evidencia."
          >
            <QualitativeDecisions run={run} />
          </AuditGroup>

          <AuditGroup
            id="auditoria-puente"
            title="Puente de valor"
            summary="De lo que valen las operaciones al patrimonio, con el estado de cada reclamo."
          >
            <EquityBridgeTable run={run} />
          </AuditGroup>

          <AuditGroup
            id="auditoria-rigor"
            title="Rigor y método"
            summary="Por qué se eligió este método y qué impidió un nivel de rigor más alto."
          >
            <RigorPanel run={run} />
          </AuditGroup>

          <AuditGroup
            id="auditoria-evidencia"
            title="Evidencia y origen de cada dato"
            summary="Cada hecho con su documento, fecha de disponibilidad y antigüedad, y lo que se declaró ausente."
          >
            <section
              aria-labelledby="data-kinds-title"
              className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4"
            >
              <h3 id="data-kinds-title" className="text-base font-medium">
                Cómo leer el origen de cada dato
              </h3>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {DATA_KINDS.map((entry) => (
                  <div
                    key={entry.kind}
                    className="flex flex-col items-start gap-1"
                  >
                    <dt>
                      <EvidenceKindMark kind={entry.kind} />
                    </dt>
                    <dd className="text-sm text-muted-foreground">
                      {entry.meaning}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            <EvidenceTable
              facts={collectReportedFacts(run)}
              absences={collectDeclaredAbsences(run)}
              policyVersion={FRESHNESS_POLICY_VERSION}
            />
          </AuditGroup>

          <AuditGroup
            id="auditoria-controles"
            title="Fórmulas y controles"
            summary="Las fórmulas en orden de cálculo y cada control que el motor ejecutó."
          >
            <RunChecks run={run} />
          </AuditGroup>
        </div>
      </section>

      <Anchor id="historial">
        <ValuationHistory view={history} />
      </Anchor>

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
            precio objetivo. El precio se lee de la serie guardada, al día de la
            valuación.
          </li>
          <li>
            Abrir esta página no recalcula la corrida, no baja datos y no llama
            a la IA. «Volver a valuar» baja el cierre del día si falta, audita
            la empresa, pide a la IA lo cualitativo que falte, lee lo guardado
            al corte de hoy y registra otra corrida si algo cambió.
          </li>
          <li>
            Los supuestos no son editables: salen de una regla versionada, y
            cambiarla produce otra corrida.
          </li>
          <li>
            El CCL implícito combina cierres diarios del CEDEAR y la acción, que
            pueden no ser simultáneos. Sin ambos cierres comparables del día de
            la corrida, el valor en pesos queda sin calcular.
          </li>
        </ul>
      </section>
    </PageFrame>
  );
}
