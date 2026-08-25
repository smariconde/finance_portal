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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatAmount,
  formatCalendarDate,
  formatPercent,
} from "@/modules/valuation/domain/display-format";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";

import { EvidenceKindMark } from "./data-marks";

/**
 * Supuestos del modelo y la proyección que producen.
 *
 * Van en la misma card y en este orden porque son causa y efecto: la primera
 * tabla es lo que el owner eligió, la segunda es lo que el motor derivó. Cada
 * una lleva su marca para que ninguna fila derivada se lea como un dato
 * reportado por una fuente.
 */
function Amount({ value }: { value: string }) {
  return <span className="numeric">{formatAmount(value)}</span>;
}

export function AssumptionsTables({ run }: { run: ValuationRun }) {
  const result = run.result;
  const terminal = run.input.terminal;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Supuestos y proyección</CardTitle>
        <CardDescription>
          Los supuestos son decisiones del modelo, no hechos reportados. La
          proyección se deriva de ellos con las fórmulas versionadas del motor.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0">
        <div className="flex flex-wrap items-center gap-2 px-(--card-spacing) pb-3">
          <h3 className="text-sm font-medium">Supuestos declarados</h3>
          <EvidenceKindMark kind="assumption" />
        </div>
        <Table containerLabel="Supuestos declarados, tabla desplazable">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Período</TableHead>
              <TableHead scope="col">Cierre</TableHead>
              <TableHead scope="col" className="text-right">
                Crecimiento
              </TableHead>
              <TableHead scope="col" className="text-right">
                Margen EBIT
              </TableHead>
              <TableHead scope="col" className="text-right">
                Tasa impositiva
              </TableHead>
              <TableHead scope="col" className="text-right">
                WACC
              </TableHead>
              <TableHead scope="col">Convención de reinversión</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {run.input.periods.map((period) => (
              <TableRow key={period.periodIndex}>
                <TableHead scope="row" className="font-medium">
                  Año {period.periodIndex}
                </TableHead>
                <TableCell>
                  <time className="numeric" dateTime={period.periodEnd}>
                    {formatCalendarDate(period.periodEnd)}
                  </time>
                </TableCell>
                <TableCell className="numeric text-right">
                  {formatPercent(period.revenueGrowth)}
                </TableCell>
                <TableCell className="numeric text-right">
                  {formatPercent(period.ebitMargin)}
                </TableCell>
                <TableCell className="numeric text-right">
                  {formatPercent(period.taxRate)}
                </TableCell>
                <TableCell className="numeric text-right">
                  {formatPercent(period.wacc)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {period.reinvestment.convention === "sales_to_capital" ? (
                    <>
                      Sales-to-capital{" "}
                      <span className="numeric text-foreground">
                        {formatAmount(period.reinvestment.salesToCapital, {
                          scale: 2,
                        })}
                      </span>
                    </>
                  ) : (
                    <>
                      Crecimiento sobre ROIC{" "}
                      <span className="numeric text-foreground">
                        {formatPercent(period.reinvestment.returnOnCapital)}
                      </span>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableHead scope="row" className="font-medium">
                Terminal
              </TableHead>
              <TableCell className="text-muted-foreground">
                Perpetuidad
              </TableCell>
              <TableCell className="numeric text-right">
                {formatPercent(terminal.growth)}
              </TableCell>
              <TableCell className="numeric text-right">
                {formatPercent(terminal.ebitMargin)}
              </TableCell>
              <TableCell className="numeric text-right">
                {formatPercent(terminal.taxRate)}
              </TableCell>
              <TableCell className="numeric text-right">
                {formatPercent(terminal.wacc)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                Crecimiento sobre ROIC{" "}
                <span className="numeric text-foreground">
                  {formatPercent(terminal.returnOnCapital)}
                </span>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>

      {result === null ? (
        <CardContent className="border-t pt-(--card-spacing) text-sm text-muted-foreground">
          La corrida fue rechazada antes de proyectar: no hay flujos que
          mostrar.
        </CardContent>
      ) : (
        <CardContent className="border-t px-0 pt-(--card-spacing)">
          <div className="flex flex-wrap items-center gap-2 px-(--card-spacing) pb-3">
            <h3 className="text-sm font-medium">Proyección y descuento</h3>
            <span className="text-xs text-muted-foreground">
              Valores en {run.currency}
            </span>
          </div>
          <Table containerLabel="Proyección y descuento, tabla desplazable">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Período</TableHead>
                <TableHead scope="col" className="text-right">
                  Ingresos
                </TableHead>
                <TableHead scope="col" className="text-right">
                  EBIT
                </TableHead>
                <TableHead scope="col" className="text-right">
                  NOPAT
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Reinversión
                </TableHead>
                <TableHead scope="col" className="text-right">
                  FCFF
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Factor de descuento
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Valor presente
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.periods.map((period) => (
                <TableRow key={period.periodIndex}>
                  <TableHead scope="row" className="font-medium">
                    Año {period.periodIndex}
                  </TableHead>
                  <TableCell className="text-right">
                    <Amount value={period.revenue} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={period.ebit} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={period.nopat} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={period.reinvestment} />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Amount value={period.fcff} />
                  </TableCell>
                  <TableCell className="numeric text-right text-muted-foreground">
                    {formatAmount(period.discountFactor, { scale: 4 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={period.presentValue} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableHead scope="row" className="font-medium">
                  Terminal
                </TableHead>
                <TableCell className="text-right">
                  <Amount value={result.terminal.revenue} />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={result.terminal.ebit} />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={result.terminal.nopat} />
                </TableCell>
                <TableCell className="numeric text-right text-muted-foreground">
                  {formatPercent(result.terminal.reinvestmentRate)} del NOPAT
                </TableCell>
                <TableCell className="text-right font-medium">
                  <Amount value={result.terminal.fcff} />
                </TableCell>
                <TableCell className="numeric text-right text-muted-foreground">
                  {formatAmount(result.terminal.discountFactor, { scale: 4 })}
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={result.terminal.presentValue} />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}
