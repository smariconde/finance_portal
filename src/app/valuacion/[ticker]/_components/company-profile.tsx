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
import type {
  CompanyProfile as CompanyProfileReading,
  ProfileNullReason,
} from "@/modules/valuation/domain/company-profile";
import type { HistoricalPeBand } from "@/modules/valuation/domain/historical-pe-band";
import {
  formatAmount,
  formatCalendarDate,
} from "@/modules/valuation/domain/display-format";

const PROFILE_COPY: Record<CompanyProfileReading["assetProfile"], string> = {
  non_financial_mature: "Empresa madura",
  high_growth: "Alto crecimiento",
  loss_making: "Empresa en pérdidas",
  bank: "Banco",
  insurer: "Aseguradora",
  reit: "REIT",
  cyclical: "Cíclica",
  commodity: "Commodity",
  holding: "Holding",
  distressed: "Distress",
};

const NULL_COPY: Record<ProfileNullReason, string> = {
  not_reported: "Falta una partida reportada",
  no_comparable_close: "Sin cierre comparable al corte",
  currency_mismatch: "Monedas distintas",
  non_positive_denominator: "Denominador cero o negativo",
  non_positive_market_value: "Valor de mercado no positivo",
  not_applicable: "No aplica con el flujo actual",
  cycle_earnings_unavailable: "Sin utilidad normalizada de ciclo",
  affo_nav_unavailable: "Sin AFFO o NAV conciliado",
};

function metricValue(metric: CompanyProfileReading["metrics"][number]): string {
  if (metric.status === "null") return NULL_COPY[metric.reason!];
  const value = metric.value!;
  return metric.unit === "percent"
    ? `${formatAmount(value, { scale: 1 })} %`
    : metric.unit === "years"
      ? `${formatAmount(value, { scale: 1 })} años`
      : `${formatAmount(value, { scale: 2 })}×`;
}

/** Lectura compacta; las fórmulas quedan visibles en una tabla semántica. */
export function CompanyProfile({
  profile,
  peBand = null,
}: {
  profile: CompanyProfileReading;
  peBand?: HistoricalPeBand | null;
}) {
  const currentPe = profile.metrics.find(
    (metric) => metric.key === "pe" && metric.status === "value",
  )?.value;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Ficha de la empresa</CardTitle>
        <CardDescription>
          {PROFILE_COPY[profile.assetProfile]} · ejercicio cerrado el{" "}
          <time dateTime={profile.fiscalYearEnd}>
            {formatCalendarDate(profile.fiscalYearEnd)}
          </time>
          . Precio al{" "}
          {profile.priceDate === null ? (
            "corte no comparable"
          ) : (
            <time dateTime={profile.priceDate}>
              {formatCalendarDate(profile.priceDate)}
            </time>
          )}
          . SEC y cierre guardado; regla {profile.version}.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {profile.metrics.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Este arquetipo aún no tiene múltiplos comparables definidos.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Métrica</TableHead>
                <TableHead scope="col" className="text-right">
                  Valor
                </TableHead>
                <TableHead scope="col">Cálculo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profile.metrics.map((metric) => (
                <TableRow key={metric.key}>
                  <TableCell className="font-medium">{metric.label}</TableCell>
                  <TableCell className="numeric text-right whitespace-nowrap">
                    {metricValue(metric)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {metric.formula}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {peBand === null ? null : (
          <div className="mt-5 border-t pt-4 text-sm">
            <h3 className="font-medium">P/E frente a su historia fiscal</h3>
            {peBand.unavailableReason === "multiple_share_classes" ? (
              <p className="mt-1 text-muted-foreground">
                Sin banda: el emisor tiene varias clases de acciones y el total
                de acciones no corresponde sólo a esta cotización.
              </p>
            ) : (
              <>
                <p className="mt-1 text-muted-foreground">
                  Mínimo, mediana y máximo de hasta cinco cierres fiscales
                  guardados; precio crudo y acciones del mismo ejercicio, sin
                  años con split no conciliado. {peBand.n} de{" "}
                  {peBand.points.length} ejercicios comparables ·{" "}
                  {peBand.version}.
                </p>
                {currentPe == null ? null : (
                  <p className="mt-2 font-medium">
                    P/E actual: {formatAmount(currentPe, { scale: 2 })}× ·
                    precio al {formatCalendarDate(profile.priceDate!)} y
                    utilidad del ejercicio base.
                  </p>
                )}
                <dl className="mt-3 grid grid-cols-3 gap-4 border-y py-3">
                  {(
                    [
                      ["Mínimo", peBand.minimum],
                      ["Mediana", peBand.median],
                      ["Máximo", peBand.maximum],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="numeric mt-1 font-semibold">
                        {value === null
                          ? "Sin dato"
                          : `${formatAmount(value, { scale: 2 })}×`}
                      </dd>
                    </div>
                  ))}
                </dl>
                <details className="mt-3">
                  <summary className="cursor-pointer font-medium underline-offset-4 hover:underline">
                    Ver ejercicios y ausencias
                  </summary>
                  <div className="mt-3 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead scope="col">Ejercicio</TableHead>
                          <TableHead scope="col">Cierre</TableHead>
                          <TableHead scope="col" className="text-right">
                            P/E
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {peBand.points.map((point) => (
                          <TableRow key={point.fiscalYearEnd}>
                            <TableCell>
                              {formatCalendarDate(point.fiscalYearEnd)}
                            </TableCell>
                            <TableCell>
                              {point.priceDate === null
                                ? "Sin cierre"
                                : formatCalendarDate(point.priceDate)}
                            </TableCell>
                            <TableCell className="numeric text-right">
                              {point.value !== null
                                ? `${formatAmount(point.value, { scale: 2 })}×`
                                : point.reason === "split_basis_unreconciled"
                                  ? "Split sin base conciliada"
                                  : point.reason === "missing_income_or_shares"
                                    ? "Faltan utilidad o acciones"
                                    : point.reason === "currency_mismatch"
                                      ? "Monedas distintas"
                                      : point.reason === "non_positive_input"
                                        ? "Dato no positivo"
                                        : "Sin cierre"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </details>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
