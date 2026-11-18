import { Suspense } from "react";
import {
  Calculator,
  DatabaseZap,
  History,
  Info,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DataUnavailableNotice } from "@/app/_components/data-unavailable-notice";
import { CompanyMark } from "@/app/_components/company-mark";
import { FinvizProfileLink } from "@/app/_components/finviz-profile-link";
import { Fold } from "@/app/_components/fold";
import { InfoTip } from "@/app/_components/info-tip";
import { BasePeriodFact } from "./_components/base-period";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import { StatTile } from "@/app/_components/stat-tile";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { displayCompanyName } from "@/modules/companies/domain/display-company-name";
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
  formatCompactAmount,
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
import { methodCopy } from "../_components/method-copy";
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
import { CompanyProfile } from "./_components/company-profile";
import {
  ForwardPeSection,
  ForwardPeSkeleton,
} from "./_components/forward-pe-section";
import { PeerContext } from "./_components/peer-context";
import { PriceRequirements } from "./_components/price-requirements";
import { ValueWalkthrough } from "./_components/value-walkthrough";
import { VerdictPanel } from "./_components/verdict-panel";
import { QualitativeDecisions } from "./_components/qualitative-decisions";
import { RigorPanel } from "./_components/rigor-panel";
import { ResultIndex, type ResultSection } from "./_components/result-index";

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
  const named = title !== ticker;
  const name = named ? displayCompanyName(title) : ticker;

  return (
    <PageContainer>
      <PageHeader
        id="result-title"
        title={name}
        leading={
          <CompanyMark
            ticker={ticker}
            name={named ? name : null}
            logoUrl={requestCompanyLogoUrl(ticker)}
            size="lg"
          />
        }
        lead={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {named ? (
              <span className="font-mono text-sm text-muted-foreground">
                {ticker}
              </span>
            ) : null}
            <FinvizProfileLink ticker={ticker} />
          </span>
        }
        actions={<ValuationRunner ticker={ticker} hasRun={hasRun} />}
      />
      {children}
    </PageContainer>
  );
}

/** Las secciones de la página, en el orden en que se leen. */
const SECTIONS = [
  { id: "veredicto", label: "Precio y valor" },
  { id: "exigencias", label: "Qué exige" },
  { id: "pares", label: "Pares" },
  { id: "ficha", label: "Ficha" },
  { id: "historia", label: "Trayectoria" },
  { id: "valor", label: "Por qué vale eso" },
  { id: "escenarios", label: "Escenarios" },
  { id: "cedear", label: "CEDEAR" },
  { id: "auditoria", label: "Auditoría" },
  { id: "historial", label: "Historial" },
] as const satisfies readonly ResultSection[];

/** Las de un banco o una aseguradora: sin exigencias, pares ni escenarios. */
const FINANCIAL_SECTIONS = [
  { id: "veredicto", label: "Precio y valor" },
  { id: "ficha", label: "Ficha" },
  { id: "historia", label: "Trayectoria" },
  { id: "valor", label: "Por qué vale eso" },
  { id: "cedear", label: "CEDEAR" },
  { id: "auditoria", label: "Auditoría" },
  { id: "historial", label: "Historial" },
] as const satisfies readonly ResultSection[];

/**
 * Un grupo de la página con su ancla; el título lo pone cada tarjeta. El
 * margen deja el título debajo del header y del índice pegados.
 */
function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="flex scroll-mt-28 flex-col gap-6">
      {children}
    </div>
  );
}

/** La línea de datos debajo del título: fecha, método y lo que la califica. */
function RunFacts({
  asOf,
  method,
  children,
}: {
  asOf: string;
  method: string;
  children?: ReactNode;
}) {
  return (
    <dl className="-mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">Valuada al</dt>
        <dd>
          <time className="numeric" dateTime={asOf}>
            {formatCalendarDate(asOf)}
          </time>
        </dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">Método</dt>
        <dd>{methodCopy(method)}</dd>
      </div>
      {children}
    </dl>
  );
}

/** El aviso de revisión: los controles por nombre, una vez cada uno. */
function ReviewAlert({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return null;

  return (
    <Alert>
      <Info aria-hidden="true" />
      <AlertTitle>La corrida quedó marcada para revisión</AlertTitle>
      <AlertDescription>
        {labels.length} control{labels.length === 1 ? "" : "es"} en revisión:{" "}
        {labels.join(", ")}. El valor se calculó igual; el detalle está en la
        auditoría.
      </AlertDescription>
    </Alert>
  );
}

/** Lo que hace «Valuar», en tres pasos con su ícono. */
const VALUATION_STEPS: readonly {
  icon: LucideIcon;
  title: string;
  detail: string;
}[] = [
  {
    icon: DatabaseZap,
    title: "Datos",
    detail: "Baja de la SEC lo que falte y el cierre del día",
  },
  {
    icon: ShieldCheck,
    title: "Auditoría",
    detail: "Audita la empresa y pide a la IA lo cualitativo que falte",
  },
  {
    icon: Calculator,
    title: "Valor",
    detail: "Valúa al corte de hoy o dice qué faltó",
  },
];

function ValuationSteps() {
  return (
    <ol
      aria-label="Qué hace Valuar"
      className="grid max-w-3xl gap-2 sm:grid-cols-3"
    >
      {VALUATION_STEPS.map((step, index) => {
        const Icon = step.icon;

        return (
          <li
            key={step.title}
            className="flex items-start gap-3 rounded-lg bg-muted/50 p-3"
          >
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-primary ring-1 ring-foreground/10"
            >
              <Icon className="size-4" />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                <span className="numeric text-muted-foreground">
                  {index + 1}.
                </span>{" "}
                {step.title}
              </span>
              <span className="text-xs text-muted-foreground">
                {step.detail}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
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
      <section className="flex flex-col gap-4">
        <p className="max-w-prose text-sm">{message}</p>
        {reitAffoRefusal ? (
          <p className="max-w-prose text-sm text-muted-foreground">
            {
              "Volver a valuar el mismo 10-K repetirá esta negativa mientras no haya una conciliación AFFO compatible con la receta del modelo."
            }{" "}
            El NAV también requiere NOI forward y una tasa de capitalización
            comparable.
            {reading.state === "no_run" &&
            reading.latest.reitAffoAccessionNumber !== null ? (
              <> Presentación SEC: {reading.latest.reitAffoAccessionNumber}.</>
            ) : null}
          </p>
        ) : (
          <ValuationSteps />
        )}
      </section>
    </PageFrame>
  );
}

/** Un monto grande en un tile: la cifra en palabras y la moneda aparte. */
function compactTile(value: string, currency: string) {
  const text = formatCompactAmount(value);
  const space = text.indexOf(" ");

  return space < 0
    ? { value: text, unit: currency }
    : {
        value: text.slice(0, space),
        unit: `${text.slice(space + 1)} ${currency}`,
      };
}

const FINANCIAL_COMPARISON_COPY = {
  missing_close: "sin cierre ese día",
  currency_mismatch: "el cierre está en otra moneda",
  split_after_share_basis: "split entre acciones y cierre",
  non_positive_value: "valor no positivo",
  non_positive_close: "cierre no positivo",
} as const;

/** Los controles de un banco o una aseguradora, en palabras. */
function financialCheckCopy(check: { id: string }): string {
  return check.id === "financial_country_risk_basis"
    ? "El riesgo país por domicilio es una aproximación"
    : check.id === "financial_model_experimental"
      ? "Método de patrimonio financiero experimental"
      : checkLabel(check.id);
}

/**
 * Banco o aseguradora (`F6-20`, ADR 0061): la misma lectura que una corrida
 * FCFF —precio y valor arriba, el aviso de revisión, el índice— con lo que
 * esta corrida tiene: patrimonio y ROE, costo del equity y su proyección.
 */
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
  const failedChecks =
    run.result?.checks.filter((check) => check.status === "failed") ?? [];
  const reviewLabels = [
    ...new Set(
      failedChecks
        .filter((check) => check.mode === "require_review")
        .map(financialCheckCopy),
    ),
  ];
  const knownAt =
    run.provenance.knowledge.knownAt ?? run.provenance.knowledge.effectiveAt;
  const bookEquity =
    run.input.commonBookEquity === null
      ? null
      : compactTile(run.input.commonBookEquity.value, run.currency);
  const equityAsOf = run.input.commonBookEquity?.asOf;

  return (
    <PageFrame
      ticker={reading.ticker}
      title={reading.subject?.legalName ?? reading.ticker}
      hasRun
    >
      <RunFacts asOf={run.asOf} method={run.method}>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Perfil</dt>
          <dd>{run.assetProfile === "bank" ? "Banco" : "Aseguradora"}</dd>
        </div>
      </RunFacts>

      {reading.newerGap === null ? null : (
        <NewerGapAlert gap={reading.newerGap} />
      )}
      {run.status === "rejected" ? (
        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>La corrida fue rechazada</AlertTitle>
          <AlertDescription>
            {run.failure?.message ?? "Sin motivo registrado."}
          </AlertDescription>
        </Alert>
      ) : (
        <ReviewAlert labels={reviewLabels} />
      )}

      <ResultIndex sections={FINANCIAL_SECTIONS} />

      <Anchor id="veredicto">
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-1">
              <CardTitle as="h2">Precio contra valor</CardTitle>
              <InfoTip title="Cómo leer esta comparación">
                <p>
                  El cierre guardado del día de la valuación al lado del valor
                  por acción del modelo: patrimonio común más el valor presente
                  de lo que gana sobre su costo de equity. Es una lectura para
                  aprender, no una recomendación.
                </p>
                <p>
                  El modelo de bancos y aseguradoras es experimental: toda
                  corrida queda en revisión.
                </p>
              </InfoTip>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <StatTile
                variant="inset"
                size="lg"
                label="Valor del modelo"
                value={
                  base === undefined ? "—" : formatAmount(base.valuePerShare)
                }
                unit={base === undefined ? undefined : run.currency}
                detail={base === undefined ? "corrida rechazada" : "por acción"}
              />
              <StatTile
                variant="inset"
                size="lg"
                label="Precio"
                value={
                  market.close === null ? "—" : formatAmount(market.close.close)
                }
                unit={market.close?.currency}
                detail={
                  market.close === null ? (
                    "sin cierre guardado"
                  ) : (
                    <>
                      Cierre del{" "}
                      <time dateTime={market.close.marketDate}>
                        {formatCalendarDate(market.close.marketDate)}
                      </time>
                    </>
                  )
                }
              />
              <StatTile
                variant="inset"
                size="sm"
                label="Price / value"
                value={
                  market.priceToValue === null
                    ? "—"
                    : `${formatAmount(market.priceToValue, { scale: 2 })}×`
                }
                detail={
                  market.reason === null
                    ? undefined
                    : FINANCIAL_COMPARISON_COPY[market.reason]
                }
              />
              <StatTile
                variant="inset"
                size="sm"
                label="Rigor"
                value={RIGOR_COPY[run.result?.rigor ?? "screening"]}
                detail="Modelo experimental"
              />
            </div>
          </CardContent>
        </Card>
      </Anchor>

      <Anchor id="ficha">
        <CompanyProfile profile={reading.profile} />
        <Suspense fallback={<ForwardPeSkeleton />}>
          <ForwardPeSection
            ticker={reading.ticker}
            subject={run.subject}
            trailingMedian={null}
          />
        </Suspense>
      </Anchor>

      <Anchor id="historia">
        <CompanyHistory
          trajectory={reading.trajectory}
          knownAt={knownAt}
          focus="financial"
        />
      </Anchor>

      <Anchor id="valor">
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-1">
              <CardTitle as="h2">Por qué vale eso</CardTitle>
              <InfoTip title="Exceso de retorno">
                <p>
                  El patrimonio común gana su ROE sobre el costo del equity
                  durante diez años; ROE y beta convergen por regla y en el
                  terminal el retorno iguala al costo.
                </p>
              </InfoTip>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <StatTile
                variant="inset"
                size="sm"
                label="Common book equity"
                value={bookEquity?.value ?? "Falta"}
                unit={bookEquity?.unit}
              />
              <StatTile
                variant="inset"
                size="sm"
                label="ROE"
                value={
                  run.input.derivedFinancial === undefined
                    ? "Falta"
                    : formatPercent(run.input.derivedFinancial.roe)
                }
                detail="derivado del 10-K"
              />
              <StatTile
                variant="inset"
                size="sm"
                label="Cost of equity"
                value={
                  first === undefined ? "—" : formatPercent(first.costOfEquity)
                }
                detail="año 1"
              />
              <StatTile
                variant="inset"
                size="sm"
                label="Payout"
                value={formatPercent(run.input.assumptions.periods[0]!.payout)}
                detail="distribución reportada"
              />
            </div>
            {base === undefined ? null : (
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                {(
                  [
                    ["Patrimonio inicial", base.bookEquity, ""],
                    [
                      "Valor presente de retornos excedentes",
                      base.presentValueOfExcessReturns,
                      "+",
                    ],
                    ["Opciones de empleados", base.employeeOptionValue, "−"],
                  ] as const
                ).map(([label, value, sign]) => (
                  <div
                    key={label}
                    className="flex items-baseline justify-between gap-2 border-b py-1.5 sm:flex-col sm:items-start sm:border-b-0"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="numeric font-medium whitespace-nowrap">
                      {sign === "" ? null : (
                        <span className="text-muted-foreground">{sign} </span>
                      )}
                      {formatCompactAmount(value)} {run.currency}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {base === undefined ? null : (
              <Fold summary="Proyección del patrimonio año por año">
                <Table containerLabel="Proyección del patrimonio, tabla desplazable">
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
                            run.input.assumptions.periods[
                              period.periodIndex - 1
                            ]!.roe,
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
                <p className="mt-2 text-xs text-muted-foreground">
                  Cifras en {run.currency}.
                </p>
              </Fold>
            )}
          </CardContent>
        </Card>
      </Anchor>

      <Anchor id="cedear">
        <CedearAccess cedear={reading.cedear} />
      </Anchor>

      <section
        id="auditoria"
        aria-labelledby="audit-title"
        className="flex scroll-mt-28 flex-col gap-2"
      >
        <h2 id="audit-title" className="text-lg font-semibold">
          Auditoría de la corrida
        </h2>
        <div className="border-t">
          <AuditGroup
            id="auditoria-fuentes"
            title="Fuentes y costo del equity"
            summary="De dónde sale el patrimonio y cada parámetro de la tasa."
          >
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Patrimonio común</dt>
                <dd>
                  {run.input.commonBookEquity?.sourceId === "sec-edgar"
                    ? "SEC"
                    : "sin fuente"}
                  {" · "}
                  {equityAsOf === undefined ? (
                    "sin fecha"
                  ) : (
                    <time className="numeric" dateTime={equityAsOf}>
                      {formatCalendarDate(equityAsOf)}
                    </time>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Risk-free</dt>
                <dd className="numeric">
                  {risk.riskFree === null
                    ? "faltante"
                    : formatPercent(risk.riskFree.value)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">ERP</dt>
                <dd className="numeric">
                  {risk.matureErp === null
                    ? "faltante"
                    : formatPercent(risk.matureErp.value)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">CRP por domicilio</dt>
                <dd className="numeric">
                  {risk.countryRiskPremium === null
                    ? "faltante"
                    : formatPercent(risk.countryRiskPremium.value)}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Utilidad común, patrimonio anterior y distribución salen de tablas
              conciliadas del mismo 10-K; las releases de Damodaran se leen al
              corte{" "}
              <time dateTime={knownAt}>{formatUtcTimestamp(knownAt)}</time>.
            </p>
          </AuditGroup>
          <AuditGroup
            id="auditoria-revisiones"
            title="Revisiones del 10-K"
            summary="Capital regulatorio, calidad de activos y cambios del patrimonio."
          >
            <dl className="space-y-3 text-sm">
              {(
                [
                  [
                    "Capital regulatorio",
                    run.input.financialReview.regulatoryCapital,
                  ],
                  [
                    "Calidad de activos",
                    run.input.financialReview.assetQuality,
                  ],
                  [
                    "Cambios del patrimonio",
                    run.input.financialReview.cleanSurplus,
                  ],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="font-medium">{label}</dt>
                  <dd className="text-muted-foreground">
                    {value ?? "Sin revisión"}
                  </dd>
                </div>
              ))}
            </dl>
          </AuditGroup>
          <AuditGroup
            id="auditoria-controles"
            title="Controles"
            summary={
              failedChecks.length === 0
                ? "Todos los controles pasaron."
                : `${failedChecks.length} control${failedChecks.length === 1 ? "" : "es"} sin pasar.`
            }
            defaultOpen={run.status === "rejected"}
          >
            {failedChecks.length === 0 && run.failure === null ? (
              <p className="text-sm text-muted-foreground">
                Todos los controles pasaron.
              </p>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {failedChecks.map((check) => (
                  <li key={check.id}>{financialCheckCopy(check)}</li>
                ))}
                {run.failure === null ? null : <li>{run.failure.message}</li>}
              </ul>
            )}
          </AuditGroup>
        </div>
      </section>

      <Anchor id="historial">
        <ValuationHistory view={history} />
      </Anchor>

      <p className="text-sm text-muted-foreground">
        Lectura educativa de un modelo, no una recomendación ni un precio
        objetivo.
      </p>
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
      <RunFacts asOf={run.asOf} method={run.method}>
        <BasePeriodFact input={run.input} />
      </RunFacts>

      {reading.newerGap === null ? null : (
        <NewerGapAlert gap={reading.newerGap} />
      )}

      <ReviewAlert labels={reviewLabels} />

      <ResultIndex
        sections={SECTIONS.filter(
          (section) =>
            section.id !== "escenarios" ||
            scenarios !== null ||
            sensitivity !== null,
        )}
      />

      <Anchor id="veredicto">
        <VerdictPanel
          run={run}
          verdict={verdict}
          market={reading.market}
          attribution={attributionOf(PRICES_SOURCE_ID)}
          rigorLabel={RIGOR_COPY[run.input.assessment.rigor.level]}
        />
      </Anchor>

      <Anchor id="exigencias">
        <PriceRequirements run={run} market={reading.market} />
      </Anchor>

      <Anchor id="pares">
        <PeerContext context={reading.peers} />
      </Anchor>

      <Anchor id="ficha">
        <CompanyProfile profile={reading.profile} peBand={reading.peBand} />
        <Suspense fallback={<ForwardPeSkeleton />}>
          <ForwardPeSection
            ticker={reading.ticker}
            subject={run.subject}
            trailingMedian={reading.peBand?.median ?? null}
          />
        </Suspense>
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
        className="flex scroll-mt-28 flex-col gap-2"
      >
        <h2 id="audit-title" className="text-lg font-semibold">
          Auditoría de la corrida
        </h2>

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

      <p className="flex items-center gap-0.5 text-sm text-muted-foreground">
        Lectura educativa de un modelo, no una recomendación ni un precio
        objetivo.
        <InfoTip title="Límites de esta superficie">
          <p>
            El precio se lee de la serie guardada, al día de la valuación. Abrir
            esta página no recalcula la corrida, no baja datos y no llama a la
            IA.
          </p>
          <p>
            «Volver a valuar» baja el cierre del día si falta, audita la
            empresa, pide a la IA lo cualitativo que falte, lee lo guardado al
            corte de hoy y registra otra corrida si algo cambió.
          </p>
          <p>
            Los supuestos no son editables: salen de una regla versionada, y
            cambiarla produce otra corrida.
          </p>
          <p>
            El CCL implícito combina cierres diarios del CEDEAR y la acción, que
            pueden no ser simultáneos; sin ambos del día de la corrida, el valor
            en pesos queda sin calcular.
          </p>
        </InfoTip>
      </p>
    </PageFrame>
  );
}
