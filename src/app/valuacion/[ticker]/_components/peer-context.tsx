import Link from "next/link";

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

import { Concept } from "./concept";

const NULL_COPY: Record<PeerMetricNullReason, string> = {
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

const METRICS: readonly { key: PeerMetricKey; label: string }[] = [
  { key: "priceToValue", label: "Precio sobre valor" },
  { key: "priceToEarnings", label: "P/E" },
  { key: "enterpriseValueToEbit", label: "EV/EBIT ajustado" },
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
    <span className="text-muted-foreground">{NULL_COPY[metric.reason]}</span>
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
        .map(([reason, count]) => `${count} ${NULL_COPY[reason]}`)
        .join(", ");
}

/** La lectura del modelo: si el mercado paga más o menos que el modelo. */
function modelSentence(summary: PeerSummary): string {
  if (summary.status === "insufficient") {
    return `En la ventana hay ${summary.n} ${summary.n === 1 ? "otra empresa valuada" : "otras empresas valuadas"} con precio sobre valor; hacen falta ${summary.minimum} para leer una mediana. La comparación crece a medida que se valúan más tickers.`;
  }

  return `En todo lo valuado (n = ${summary.n}), la mediana de precio sobre valor es ${multiple(summary.value)}. Si es mayor que 1, el modelo tiende a dar valores por debajo de lo que paga el mercado; esa diferencia es del modelo, no de una empresa.`;
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
        <CardTitle as="h2">Frente a lo demás que se valuó</CardTitle>
        <CardDescription className="max-w-prose">
          Empresas valuadas entre el{" "}
          <time dateTime={context.windowFrom}>
            {formatCalendarDate(context.windowFrom)}
          </time>{" "}
          y el{" "}
          <time dateTime={context.asOf}>
            {formatCalendarDate(context.asOf)}
          </time>
          , cada una con el cierre del día de su propia corrida. Separa lo que
          es del modelo, lo que es del sector y lo que es de la empresa; no es
          una señal de compra o venta.
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
                  {METRICS.map(({ key, label: metricLabel }) => {
                    const excluded = exclusions(sector.summaries[key]);

                    return (
                      <TableRow key={key}>
                        <TableHead scope="row" className="font-normal">
                          <span className="flex flex-col">
                            <span>{metricLabel}</span>
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

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <EvidenceKindMark kind="derived_by_rule" />
              <span>
                Mediana exacta con {context.minimum} pares como mínimo; P/E con
                la ganancia neta reportada del año base y EV/EBIT con la deuda,
                los arrendamientos, los minoritarios, la caja y el EBIT ajustado
                de cada corrida. Regla{" "}
                <code className="font-mono">{context.version}</code>.
              </span>
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
                            {peer.symbol === null ? (
                              (peer.legalName ?? "Sin nombre al corte")
                            ) : (
                              <Link
                                className="underline underline-offset-4"
                                href={`/valuacion/${encodeURIComponent(peer.symbol)}`}
                              >
                                <span className="font-mono">{peer.symbol}</span>
                                {peer.legalName === null
                                  ? null
                                  : ` · ${peer.legalName}`}
                              </Link>
                            )}
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

        <div className="flex flex-col gap-1">
          <Concept term="el precio sobre valor">
            El cierre del día de la corrida dividido por el valor por acción del
            modelo. 1 es «el mercado paga lo que el modelo calcula»; 1,5 es
            «paga la mitad más». Comparado entre empresas valuadas con la misma
            regla, muestra si la brecha es de la empresa o del modelo.
          </Concept>
          <Concept term="el EV/EBIT ajustado">
            El valor de la empresa —capitalización más deuda, arrendamientos y
            minoritarios, menos caja— sobre el resultado operativo del año base
            con los ajustes del modelo. A diferencia del P/E, no cambia con
            cuánto se financia la empresa con deuda.
          </Concept>
        </div>
      </CardContent>
    </Card>
  );
}
