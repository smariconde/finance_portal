import { ChangeIndicator, StatTile } from "@/app/_components/stat-tile";
import { Fold } from "@/app/_components/fold";
import { InfoTip } from "@/app/_components/info-tip";
import { termName, termSpanish } from "@/app/_components/financial-terms";
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
import type { ForwardMultiplesView } from "@/modules/consensus/application/load-forward-multiples";
import type {
  ForwardPeReason,
  PegReason,
} from "@/modules/consensus/domain/forward-pe";
import {
  formatAmount,
  formatCalendarDate,
  formatPercent,
} from "@/modules/valuation/domain/display-format";

import { ConsensusRefresh } from "./consensus-refresh";
import { ForwardPeChart } from "./forward-pe-chart";
import { ForwardPeThreshold } from "./forward-pe-threshold";

const REASON_COPY: Record<ForwardPeReason | PegReason, string> = {
  no_consensus: "Sin consenso capturado",
  stale_consensus: "Precio y consenso a más de 7 días",
  insufficient_horizons: "Faltan dos ejercicios por delante",
  no_close: "Sin cierre guardado",
  currency_mismatch: "Monedas distintas",
  non_positive_close: "Cierre no positivo",
  non_positive_eps: "EPS esperado cero o negativo",
  non_positive_base: "FY1 en pérdida",
  non_positive_growth: "Crecimiento esperado ≤ 0",
};

const monthYear = new Intl.DateTimeFormat("es-AR", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** «FY sep. 2027»: the fiscal year by its month end, as the source labels it. */
function fiscalLabel(periodEnd: string | null, fallback = "FY"): string {
  if (periodEnd === null) return fallback;
  return `FY ${monthYear.format(new Date(`${periodEnd}T00:00:00.000Z`))}`;
}

function times(value: string | null): string {
  return value === null ? "—" : `${formatAmount(value, { scale: 1 })}×`;
}

function capturedLabel(instant: string): string {
  return formatCalendarDate(instant.slice(0, 10));
}

export function ForwardPe({
  ticker,
  view,
  readiness,
  trailingMedian,
}: {
  readonly ticker: string;
  readonly view: ForwardMultiplesView;
  readonly readiness: {
    readonly needsRefresh: boolean;
    readonly failed: boolean;
  };
  /** The trailing GAAP P/E median of the fiscal band, as a reference line. */
  readonly trailingMedian: string | null;
}) {
  const { current } = view;
  const fy1 = view.years[0];
  const analysts = fy1?.values.epsAnalystCount ?? null;
  const thresholdValue = view.threshold?.value ?? null;
  const drawn = view.history.filter((point) => point.forwardPe !== null);
  const latestPoint = drawn.at(-1);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-0.5">
          <CardTitle as="h2">{termName("forwardPe")}</CardTitle>
          <InfoTip title={termName("forwardPe")}>
            <p>
              Cierre sobre el EPS de los próximos doce meses: el de FY1 y el de
              FY2 ponderados por lo que le queda a FY1.
            </p>
            <p>
              El EPS es el consenso de Alpha Vantage y puede ser ajustado, no el
              GAAP de la ficha.
            </p>
            <p>
              Reglas <code className="font-mono">{current.version}</code> y{" "}
              <code className="font-mono">{current.pegVersion}</code>.
            </p>
          </InfoTip>
        </div>
        <CardDescription className="numeric">
          {termSpanish("forwardPe")}
          {view.lastCaptureAt === null ? null : (
            <>
              {" · "}consenso del{" "}
              <time dateTime={view.lastCaptureAt}>
                {capturedLabel(view.lastCaptureAt)}
              </time>
            </>
          )}
          {current.closeDate === null ? null : (
            <>
              {" · "}cierre del{" "}
              <time dateTime={current.closeDate}>
                {formatCalendarDate(current.closeDate)}
              </time>
            </>
          )}
          {" · "}Alpha Vantage
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ConsensusRefresh
          ticker={ticker}
          needsRefresh={readiness.needsRefresh}
          failed={readiness.failed}
        />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile
            variant="inset"
            label="NTM"
            value={times(current.forwardPe)}
            detail={
              current.forwardPe === null
                ? REASON_COPY[current.forwardPeReason!]
                : analysts === null
                  ? undefined
                  : `${analysts} analistas`
            }
          />
          <StatTile
            variant="inset"
            label={fiscalLabel(
              current.fy1?.periodEnd ?? view.years[0]?.periodEnd ?? null,
              "FY1",
            )}
            value={times(current.fy1Pe)}
          />
          <StatTile
            variant="inset"
            label={fiscalLabel(
              current.fy2?.periodEnd ?? view.years[1]?.periodEnd ?? null,
              "FY2",
            )}
            value={times(current.fy2Pe)}
          />
          <StatTile
            variant="inset"
            label={termName("peg")}
            labelAside={
              <InfoTip title={termName("peg")}>
                <p>
                  Forward P/E sobre el crecimiento del EPS de FY1 a FY2, en
                  puntos. Es un crecimiento a un año: la fuente no publica uno a
                  cinco.
                </p>
              </InfoTip>
            }
            value={
              current.peg === null
                ? "—"
                : formatAmount(current.peg, { scale: 2 })
            }
            detail={
              current.peg === null
                ? REASON_COPY[current.pegReason!]
                : `crecimiento ${formatPercent(current.growth!, { scale: 1 })}`
            }
          />
        </div>

        {view.years.length === 0 ? null : (
          <div className="overflow-x-auto">
            <Table>
              <caption className="sr-only">
                Consenso de EPS por ejercicio, capturado de Alpha Vantage
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{termName("consensusEps")}</TableHead>
                  <TableHead scope="col" className="text-right">
                    Promedio
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Bajo – alto
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Analistas
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    vs. 90 días
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.years.map((year) => {
                  const moved = year.change90Days;
                  return (
                    <TableRow key={year.periodEnd}>
                      <TableHead scope="row" className="font-medium">
                        {fiscalLabel(year.periodEnd)}
                      </TableHead>
                      <TableCell className="numeric text-right">
                        {formatAmount(year.values.epsAverage, { scale: 2 })}
                      </TableCell>
                      <TableCell className="numeric text-right">
                        {year.values.epsLow === null ||
                        year.values.epsHigh === null
                          ? "—"
                          : `${formatAmount(year.values.epsLow, { scale: 2 })} – ${formatAmount(year.values.epsHigh, { scale: 2 })}`}
                      </TableCell>
                      <TableCell className="numeric text-right">
                        {year.values.epsAnalystCount ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {moved === null ? (
                          "—"
                        ) : (
                          <ChangeIndicator
                            amount={moved}
                            text={formatPercent(moved, { scale: 1 })}
                            polarity="neutral"
                            className="justify-end"
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">
              Forward P/E desde la primera captura
            </h3>
            {view.firstCaptureAt === null ? null : (
              <span className="numeric text-xs text-muted-foreground">
                desde el {capturedLabel(view.firstCaptureAt)}
              </span>
            )}
          </div>
          {drawn.length < 2 ? (
            <p className="text-sm text-muted-foreground">
              {drawn.length === 0
                ? "La historia empieza con la primera captura."
                : "Un solo cierre con consenso: la línea aparece con el segundo."}
            </p>
          ) : (
            <ForwardPeChart
              label={`Forward P/E de ${ticker} desde el ${capturedLabel(view.firstCaptureAt!)}: último ${times(latestPoint?.forwardPe ?? null)}${thresholdValue === null ? "" : `, tu umbral ${times(thresholdValue)}`}${trailingMedian === null ? "" : `, mediana trailing ${times(trailingMedian)}`}.`}
              points={view.history.map((point) => ({
                date: point.marketDate,
                value:
                  point.forwardPe === null ? null : Number(point.forwardPe),
                label:
                  point.forwardPe === null
                    ? REASON_COPY[point.reason!]
                    : times(point.forwardPe),
              }))}
              threshold={
                thresholdValue === null ? null : Number(thresholdValue)
              }
              trailingMedian={
                trailingMedian === null ? null : Number(trailingMedian)
              }
            />
          )}
          {view.history.length === 0 ? null : (
            <Fold divided={false} summary={<>Ver cierres</>}>
              <div className="max-h-72 overflow-auto">
                <Table>
                  <caption className="sr-only">
                    Forward P/E por cierre desde la primera captura
                  </caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Cierre</TableHead>
                      <TableHead scope="col" className="text-right">
                        Forward P/E
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...view.history].reverse().map((point) => (
                      <TableRow key={point.marketDate}>
                        <TableCell>
                          {formatCalendarDate(point.marketDate)}
                        </TableCell>
                        <TableCell
                          className={
                            point.forwardPe === null
                              ? "text-right text-xs text-muted-foreground"
                              : "numeric text-right"
                          }
                        >
                          {point.forwardPe === null
                            ? REASON_COPY[point.reason!]
                            : times(point.forwardPe)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Fold>
          )}
          <ForwardPeThreshold ticker={ticker} current={thresholdValue} />
        </div>
      </CardContent>
    </Card>
  );
}
