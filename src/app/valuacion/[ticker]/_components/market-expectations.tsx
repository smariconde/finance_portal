import { EvidenceKindMark } from "@/app/valuacion/_components/run/data-marks";
import { CodeValue } from "@/app/valuacion/_components/run/field";
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
import type { ValuationResultMarket } from "@/modules/valuation/application/read-valuation-result";
import {
  formatAmount,
  formatCalendarDate,
  formatPercent,
} from "@/modules/valuation/domain/display-format";
import type {
  MarketImpliedContext,
  MarketImpliedDriver,
  MarketImpliedReading,
  MarketPriceComparisonUnavailableReason,
} from "@/modules/valuation/domain/market-implied";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";

const COMPARISON_GAP_COPY: Record<
  MarketPriceComparisonUnavailableReason,
  string
> = {
  no_value_per_share:
    "La corrida fue rechazada: sin valor por acción no hay comparación.",
  no_close_at_as_of:
    "No hay un cierre guardado en la fecha de valuación. El precio de otro día no se usa en su lugar.",
  currency_mismatch:
    "El cierre guardado está en otra moneda que la valuación, y no se convierte.",
  non_positive_close: "El cierre guardado no es positivo.",
  non_positive_value:
    "El valor por acción no es positivo: la proporción con el precio no significa nada.",
  split_after_share_basis:
    "Hubo un split entre el conteo de acciones de la corrida y el cierre: precio y valor hablan de acciones distintas. Volver a valuar toma el conteo nuevo.",
};

const DRIVER_COPY: Record<
  MarketImpliedDriver,
  { label: string; scope: string }
> = {
  revenue_growth: {
    label: "Crecimiento de ventas",
    scope: "Años 1–5; del 6 al 10 converge al crecimiento terminal",
  },
  ebit_margin: {
    label: "Margen EBIT",
    scope: "Todos los años y el terminal",
  },
  terminal_return_on_capital: {
    label: "ROIC terminal",
    scope: "Cuánto se reinvierte para crecer a perpetuidad",
  },
  discount_rate: {
    label: "Tasa de descuento",
    scope: "Una sola tasa para todos los años: la TIR que paga el precio",
  },
};

function percent(value: string): string {
  return formatPercent(value, { scale: 2 });
}

/** Contra qué leer lo exigido: lo que la propia empresa ya mostró. */
function referenceFor(
  driver: MarketImpliedDriver,
  context: MarketImpliedContext,
): string {
  switch (driver) {
    case "revenue_growth":
      return context.historicalGrowth.length === 0
        ? "Sin historia de ventas congelada en la corrida"
        : context.historicalGrowth
            .map(
              (entry) =>
                `${percent(entry.cagr)} anual en ${entry.years} ${entry.years === 1 ? "año" : "años"} desde ${formatCalendarDate(entry.fromFiscalYearEnd)}`,
            )
            .join(" · ");
    case "ebit_margin":
      return context.baseEbitMargin === null
        ? "Sin margen ajustado del año base"
        : `${percent(context.baseEbitMargin)} ajustado en el año base`;
    case "terminal_return_on_capital":
      return context.baseReturnOnCapital === null
        ? "Sin ROIC ajustado del año base"
        : `${percent(context.baseReturnOnCapital)} ajustado en el año base`;
    case "discount_rate":
      return `Costo del equity ${percent(context.costOfEquity)}`;
  }
}

function runValueOf(
  reading: MarketImpliedReading,
  context: MarketImpliedContext,
): string {
  if (reading.runValue === null) {
    return "—";
  }

  // La corrida no descuenta a una sola tasa: el WACC converge al terminal.
  return reading.driver === "discount_rate"
    ? `${percent(context.wacc)} → ${percent(context.terminalWacc)}`
    : percent(reading.runValue);
}

function ImpliedCell({
  reading,
  currency,
}: {
  reading: MarketImpliedReading;
  currency: string;
}) {
  switch (reading.status) {
    case "solved":
      return (
        <span className="text-sm font-semibold">
          {percent(reading.implied)}
        </span>
      );
    case "price_above_range":
      return (
        <span className="text-sm">
          No alcanza: con {percent(reading.bounds.upper)} el valor llega a{" "}
          {formatAmount(reading.closestValuePerShare)} {currency}
        </span>
      );
    case "price_below_range":
      return (
        <span className="text-sm">
          Sobra: aun con {percent(reading.bounds.lower)} el valor es{" "}
          {formatAmount(reading.closestValuePerShare)} {currency}
        </span>
      );
    case "unavailable":
      return (
        <span className="text-sm text-muted-foreground">
          {reading.reason === "growth_shape_unsupported"
            ? "No se resuelve: los períodos no tienen la forma de la regla derivada"
            : "El motor rechazó el snapshot en el borde del intervalo"}
        </span>
      );
  }
}

/**
 * Precio de mercado y lo que exige (`F6-09`, ADR 0048).
 *
 * El cierre crudo al `as_of` de la corrida contra su valor, y un DCF inverso
 * que mueve un driver por vez hasta que el motor devuelve el precio. Ninguna
 * de las dos lecturas cambia la corrida, y ninguna es una recomendación: dicen
 * cuánto optimismo hay en el precio respecto de los supuestos y de la historia.
 */
export function MarketExpectations({
  run,
  market,
  attribution,
}: {
  run: ValuationRun;
  market: ValuationResultMarket;
  attribution: string | null;
}) {
  const { comparison, implied, context, latestClose } = market;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Precio de mercado y lo que exige</CardTitle>
        <CardDescription>
          El cierre del día de la valuación contra el valor de la corrida, y qué
          tendría que pasar para que el precio sea razonable. Es una lectura
          educativa, no una recomendación.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {comparison.status === "compared" ? (
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                Precio al{" "}
                <time dateTime={comparison.price.marketDate}>
                  {formatCalendarDate(comparison.price.marketDate)}
                </time>
                <EvidenceKindMark kind="reference_data" />
              </dt>
              <dd className="numeric mt-1 text-2xl font-semibold tracking-tight">
                {formatAmount(comparison.price.close)}{" "}
                <span className="text-base font-medium text-muted-foreground">
                  {comparison.price.currency}
                </span>
              </dd>
              <dd className="text-xs text-muted-foreground">
                Cierre crudo, sin ajustar
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">
                Valor por acción de la corrida
              </dt>
              <dd className="numeric mt-1 text-2xl font-semibold tracking-tight">
                {formatAmount(comparison.valuePerShare)}{" "}
                <span className="text-base font-medium text-muted-foreground">
                  {run.currency}
                </span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                Precio sobre valor
                <EvidenceKindMark kind="derived_by_rule" />
              </dt>
              <dd className="numeric mt-1 text-2xl font-semibold tracking-tight">
                {formatAmount(comparison.priceToValue, { scale: 2 })}×
              </dd>
              <dd className="numeric text-xs text-muted-foreground">
                {comparison.valueToPrice.startsWith("-")
                  ? `El valor está ${formatPercent(comparison.valueToPrice.slice(1), { scale: 1 })} por debajo del precio`
                  : `El valor está ${formatPercent(comparison.valueToPrice, { scale: 1 })} por encima del precio`}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm" role="status">
            Sin comparación con el precio.{" "}
            {COMPARISON_GAP_COPY[comparison.reason]}
          </p>
        )}

        {latestClose === null ? null : (
          <p className="text-sm text-muted-foreground">
            Hay un cierre guardado posterior: {formatAmount(latestClose.close)}{" "}
            {latestClose.currency} al{" "}
            <time dateTime={latestClose.marketDate}>
              {formatCalendarDate(latestClose.marketDate)}
            </time>
            . La corrida no lo vio, así que no se compara con su valor; volver a
            valuar mueve el corte.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {attribution === null ? "Serie de precios guardada" : attribution}.
          Descarga aceptada por el owner para uso personal, sin licencia de la
          fuente. <CodeValue>{comparison.version}</CodeValue>
        </p>
      </CardContent>

      {implied.status !== "computed" ? null : (
        <CardContent className="flex flex-col gap-3 border-t px-0 pt-(--card-spacing)">
          <div className="flex flex-col gap-1 px-(--card-spacing)">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">Lo que exige el precio</h3>
              <EvidenceKindMark kind="derived_by_rule" />
            </div>
            <p className="max-w-prose text-sm text-muted-foreground">
              Cada fila mueve un solo supuesto, con todo lo demás igual a la
              corrida, hasta que el mismo motor devuelve el precio. Cuanto más
              lejos queda lo exigido de lo que la empresa ya mostró, más
              optimismo hay en el precio. Estas lecturas no pasan por los
              controles de la corrida ni se registran.
            </p>
          </div>
          <Table containerLabel="Lo que exige el precio, tabla desplazable">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Supuesto</TableHead>
                <TableHead scope="col" className="text-right">
                  En la corrida
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Exigido por el precio
                </TableHead>
                <TableHead scope="col">Lo que mostró la empresa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {implied.readings.map((reading) => (
                <TableRow key={reading.driver}>
                  <TableHead scope="row" className="align-top font-medium">
                    {DRIVER_COPY[reading.driver].label}
                    <span className="block text-xs font-normal whitespace-normal text-muted-foreground">
                      {DRIVER_COPY[reading.driver].scope}
                    </span>
                  </TableHead>
                  <TableCell className="numeric text-right align-top">
                    {runValueOf(reading, context)}
                  </TableCell>
                  <TableCell className="numeric max-w-64 text-right align-top whitespace-normal">
                    <ImpliedCell reading={reading} currency={run.currency} />
                  </TableCell>
                  <TableCell className="numeric align-top whitespace-normal text-muted-foreground">
                    {referenceFor(reading.driver, context)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="px-(--card-spacing) text-xs text-muted-foreground">
            Bisección de {implied.readings.length} drivers sobre el motor de la
            corrida, con intervalos declarados; fuera de ellos se dice de qué
            lado queda el precio, nunca se extrapola.{" "}
            <CodeValue>{implied.version}</CodeValue>
          </p>
        </CardContent>
      )}
    </Card>
  );
}
