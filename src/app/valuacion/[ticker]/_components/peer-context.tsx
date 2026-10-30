import Link from "next/link";

import { CompanyMark } from "@/app/_components/company-mark";
import { EvidenceKindMark } from "@/app/valuacion/_components/run/data-marks";
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
import { listSectors } from "@/modules/classification/domain/sector-taxonomy";
import {
  formatAmount,
  formatCalendarDate,
  formatPercent,
} from "@/modules/valuation/domain/display-format";
import type {
  PeerContext as PeerContextReading,
  PeerEntry,
  PeerMetric,
  PeerMetricKey,
  PeerMetricNullReason,
  PeerRelative,
  PeerSummary,
} from "@/modules/valuation/domain/peer-context";
import { requestCompanyLogoUrl } from "@/server/config/company-logo";

import { InfoTip } from "@/app/_components/info-tip";

export const PEER_NULL_COPY: Record<PeerMetricNullReason, string> = {
  no_value_per_share: "sin valor por acción",
  no_close_at_as_of: "sin cierre ese día",
  currency_mismatch: "otra moneda",
  non_positive_close: "cierre no positivo",
  non_positive_value: "valor no positivo",
  split_after_share_basis: "split entre acciones y cierre",
  net_income_not_reported: "ganancia neta no publicada",
  non_positive_net_income: "ganancia cero o negativa",
  ebit_unavailable: "sin EBIT ajustado",
  non_positive_ebit: "EBIT cero o negativo",
  bridge_claim_missing: "deuda o caja sin resolver",
  non_positive_enterprise_value: "EV cero o negativo",
};

const METRICS: readonly {
  key: PeerMetricKey;
  label: string;
  definition: string;
}[] = [
  {
    key: "priceToValue",
    label: "Price / value",
    definition:
      "El cierre del día de la corrida sobre el valor por acción del modelo. 1× es «paga lo que el modelo calcula»; 1,5× es «paga la mitad más».",
  },
  {
    key: "priceToEarnings",
    label: "P/E",
    definition:
      "Capitalización sobre la ganancia neta reportada del año base de cada corrida.",
  },
  {
    key: "enterpriseValueToEbit",
    label: "Adjusted EV/EBIT",
    definition:
      "Capitalización más deuda, arrendamientos y minoritarios, menos caja, sobre el EBIT ajustado de cada corrida. No cambia con cuánto se financia con deuda.",
  },
];

const METHOD_COPY: Record<PeerEntry["method"], string> = {
  fcff_base: "Flujo de caja descontado",
  normalized_fcff: "Margen de ciclo",
  fcff_three_stage: "Flujo de caja en tres etapas",
  revenue_margin_survival: "Ventas, margen y supervivencia",
};

const STATUS_COPY: Record<PeerEntry["status"], string> = {
  computed: "Calculada",
  requires_review: "En revisión",
  rejected: "Rechazada",
};

function sectorLabel(code: string): string {
  return listSectors().find((sector) => sector.code === code)?.label ?? code;
}

function multiple(value: string): string {
  return `${formatAmount(value, { scale: 2 })}×`;
}

function MetricCell({ metric }: { metric: PeerMetric }) {
  return metric.status === "value" ? (
    <span className="numeric">{multiple(metric.value)}</span>
  ) : (
    <span className="text-muted-foreground">
      {PEER_NULL_COPY[metric.reason]}
    </span>
  );
}

function SummaryCell({ summary }: { summary: PeerSummary }) {
  if (summary.status === "insufficient") {
    return (
      <span className="text-muted-foreground">
        Pares insuficientes{" "}
        <span className="numeric">
          (n = {summary.n} de {summary.minimum})
        </span>
      </span>
    );
  }

  return (
    <span className="flex flex-col">
      <span className="numeric">{multiple(summary.value)}</span>
      <span className="numeric text-xs text-muted-foreground">
        n = {summary.n}
        {summary.underReview === 0
          ? ""
          : `, ${summary.underReview} en revisión`}
      </span>
    </span>
  );
}

function signedPercent(value: string): string {
  const text = formatPercent(value, { scale: 0 });
  return text.startsWith("-") || /^0 %$/u.test(text) ? text : `+${text}`;
}

function RelativeCell({ relative }: { relative: PeerRelative }) {
  if (relative.status === "null") {
    return <span className="text-muted-foreground">—</span>;
  }

  return <span className="numeric">{signedPercent(relative.value)}</span>;
}

/** Los motivos de lo que no entró a una mediana, en una línea. */
function exclusions(summary: PeerSummary): string | null {
  const entries = Object.entries(summary.excluded) as [
    PeerMetricNullReason,
    number,
  ][];

  return entries.length === 0
    ? null
    : entries
        .map(([reason, count]) => `${count} ${PEER_NULL_COPY[reason]}`)
        .join(", ");
}

/** La lectura del modelo: si el mercado paga más o menos que el modelo. */
function modelSentence(summary: PeerSummary): string {
  if (summary.status === "insufficient") {
    return `Pares insuficientes: ${summary.n} de ${summary.minimum} empresas valuadas en la ventana.`;
  }

  return `Todo lo valuado (n = ${summary.n}): mediana de precio sobre valor ${multiple(summary.value)}.`;
}

function companySentence(
  company: PeerMetric,
  relative: PeerRelative,
  label: string,
): string | null {
  if (company.status === "null" || relative.status === "null") return null;

  const text = signedPercent(relative.value);

  return `Esta empresa cotiza a ${multiple(company.value)} su valor: ${text} frente a la mediana de ${label}.`;
}

export function PeerContext({ context }: { context: PeerContextReading }) {
  const { sector } = context;
  const label =
    sector.status === "classified" ? sectorLabel(sector.code) : null;
  const companyLine =
    sector.status === "classified" && label !== null
      ? companySentence(
          context.company.priceToValue,
          sector.companyVsSector.priceToValue,
          label,
        )
      : null;
  const sectorVsModel =
    context.sectorVsModel.status === "value" && label !== null
      ? `La mediana de ${label} queda ${signedPercent(context.sectorVsModel.value)} frente a la de todo lo valuado.`
      : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-0.5">
          <CardTitle as="h2">Frente a lo demás que se valuó</CardTitle>
          <EvidenceKindMark kind="derived_by_rule" className="ml-1.5" />
          <InfoTip title="Cómo se lee">
            <p>
              Separa lo que es del modelo, lo que es del sector y lo que es de
              la empresa; no es una señal de compra o venta.
            </p>
            <p>
              Si la mediana de todo lo valuado supera 1×, el modelo tiende a dar
              valores debajo de lo que paga el mercado: esa diferencia es del
              modelo, no de una empresa. La comparación crece a medida que se
              valúan más tickers.
            </p>
            <p>
              Mediana exacta con {context.minimum} pares como mínimo; cada una
              con el cierre del día de su propia corrida. Regla{" "}
              <code className="font-mono">{context.version}</code>.
            </p>
          </InfoTip>
        </div>
        <CardDescription>
          Valuadas del{" "}
          <time dateTime={context.windowFrom}>
            {formatCalendarDate(context.windowFrom)}
          </time>{" "}
          al{" "}
          <time dateTime={context.asOf}>
            {formatCalendarDate(context.asOf)}
          </time>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex max-w-prose flex-col gap-2 text-sm">
          <p>{modelSentence(context.model)}</p>
          {sector.status === "unclassified" ? (
            <p className="text-muted-foreground">
              La empresa no tiene sector al corte de la corrida (
              {sector.reason === "never_classified"
                ? "nunca se clasificó"
                : "su clasificación no estaba vigente"}
              ), así que no hay comparación por sector.
            </p>
          ) : null}
          {sectorVsModel === null ? null : <p>{sectorVsModel}</p>}
          {companyLine === null ? null : <p>{companyLine}</p>}
        </div>

        {sector.status !== "classified" || label === null ? null : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <caption className="sr-only">
                  La empresa frente a la mediana de {label} y de todo lo valuado
                </caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Cifra</TableHead>
                    <TableHead scope="col" className="text-right">
                      Esta empresa
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Mediana de{" "}
                      <Link
                        className="underline underline-offset-4"
                        href={`/sectores/${sector.code}`}
                      >
                        {label}
                      </Link>
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Frente al sector
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Todo lo valuado
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {METRICS.map(({ key, label: metricLabel, definition }) => {
                    const excluded = exclusions(sector.summaries[key]);

                    return (
                      <TableRow key={key}>
                        <TableHead scope="row" className="font-normal">
                          <span className="flex flex-col">
                            <span className="flex items-center gap-0.5">
                              {metricLabel}
                              <InfoTip title={metricLabel}>
                                <p>{definition}</p>
                              </InfoTip>
                            </span>
                            {excluded === null ? null : (
                              <span className="text-xs text-muted-foreground">
                                Sin dato en el sector: {excluded}
                              </span>
                            )}
                          </span>
                        </TableHead>
                        <TableCell className="text-right">
                          <MetricCell metric={context.company[key]} />
                        </TableCell>
                        <TableCell className="text-right">
                          <SummaryCell summary={sector.summaries[key]} />
                        </TableCell>
                        <TableCell className="text-right">
                          <RelativeCell
                            relative={sector.companyVsSector[key]}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {key === "priceToValue" ? (
                            <SummaryCell summary={context.model} />
                          ) : (
                            <span className="text-muted-foreground">
                              sólo precio sobre valor
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {sector.peers.length === 0 ? null : (
              <details className="group">
                <summary className="w-fit cursor-pointer text-sm text-primary underline-offset-4 hover:underline">
                  Los {sector.peers.length}{" "}
                  {sector.peers.length === 1 ? "par" : "pares"} de {label}
                </summary>
                <div className="mt-3 overflow-x-auto">
                  <Table>
                    <caption className="sr-only">
                      Empresas de {label} valuadas en la ventana
                    </caption>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">Empresa</TableHead>
                        <TableHead scope="col">Método</TableHead>
                        <TableHead scope="col">Estado</TableHead>
                        <TableHead scope="col">Valuada al</TableHead>
                        {METRICS.map(({ key, label: metricLabel }) => (
                          <TableHead
                            key={key}
                            scope="col"
                            className="text-right"
                          >
                            {metricLabel}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sector.peers.map((peer) => (
                        <TableRow key={peer.legalEntityId}>
                          <TableHead scope="row" className="font-normal">
                            <span className="flex items-center gap-2">
                              <CompanyMark
                                ticker={peer.symbol ?? peer.legalName ?? "?"}
                                name={peer.legalName}
                                logoUrl={
                                  peer.symbol === null
                                    ? null
                                    : requestCompanyLogoUrl(peer.symbol)
                                }
                                size="sm"
                              />
                              {peer.symbol === null ? (
                                (peer.legalName ?? "Sin nombre al corte")
                              ) : (
                                <Link
                                  className="underline underline-offset-4"
                                  href={`/valuacion/${encodeURIComponent(peer.symbol)}`}
                                >
                                  <span className="font-mono">
                                    {peer.symbol}
                                  </span>
                                  {peer.legalName === null
                                    ? null
                                    : ` · ${peer.legalName}`}
                                </Link>
                              )}
                            </span>
                          </TableHead>
                          <TableCell>{METHOD_COPY[peer.method]}</TableCell>
                          <TableCell>{STATUS_COPY[peer.status]}</TableCell>
                          <TableCell>
                            <time className="numeric" dateTime={peer.asOf}>
                              {formatCalendarDate(peer.asOf)}
                            </time>
                          </TableCell>
                          {METRICS.map(({ key }) => (
                            <TableCell key={key} className="text-right">
                              <MetricCell metric={peer.metrics[key]} />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
