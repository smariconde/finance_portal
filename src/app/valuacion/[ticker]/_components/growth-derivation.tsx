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
import {
  formatAmount,
  formatCalendarDate,
  formatPercent,
  formatUtcTimestamp,
} from "@/modules/valuation/domain/display-format";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";

/** The frozen rule and source evidence of an app-derived growth screening. */
export function GrowthDerivation({ run }: { run: ValuationRun }) {
  const plan = run.input.revenueMargin;
  const derived = plan?.derivedFrom;
  if (plan === undefined || derived === undefined) return null;
  const { trajectory, margin } = derived;
  const diagnostics = run.result?.growthDiagnostics;
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Ventas, margen y supervivencia</CardTitle>
        <CardDescription>
          Screening experimental · diez años explícitos · requiere revisión
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 pt-4 lg:grid-cols-2">
        <div className="space-y-3 text-sm">
          <p>
            CAGR de ventas de tres años:{" "}
            <strong className="numeric">
              {formatPercent(trajectory.threeYearCagr)}
            </strong>
            . Tasa inicial:{" "}
            <strong className="numeric">
              {formatPercent(trajectory.initialRevenueGrowth)}
            </strong>
            , limitada al 30 %. Se mantiene tres años y cae linealmente hasta{" "}
            <span className="numeric">
              {formatPercent(run.input.terminal.growth)}
            </span>{" "}
            en el décimo.
          </p>
          <p>
            El margen EBIT ajustado converge en cinco años a{" "}
            <strong className="numeric">{formatPercent(margin.value)}</strong>{" "}
            de <span className="font-medium">{margin.rowKey}</span> (Damodaran,{" "}
            {margin.publishedLabel ?? "release sin etiqueta"}), disponible desde{" "}
            <time dateTime={margin.availableAt}>
              {formatUtcTimestamp(margin.availableAt)}
            </time>
            .
          </p>
          <p>
            Pérdidas fiscales utilizables:{" "}
            {plan.lossCarryforward === null ? (
              "sin saldo conciliado"
            ) : (
              <>
                {run.currency}{" "}
                <strong className="numeric">
                  {formatAmount(plan.lossCarryforward.value)}
                </strong>{" "}
                del 10-K{" "}
                <span className="font-mono text-xs">
                  {plan.lossCarryforward.sourceDocumentId}
                </span>
              </>
            )}
            ; compensación anual máxima{" "}
            <span className="numeric">
              {formatPercent(plan.lossOffsetLimit)}
            </span>
            .
          </p>
          <p className="text-muted-foreground">{plan.financingRationale}</p>
          {diagnostics === undefined ? null : (
            <dl className="grid grid-cols-2 gap-3 border-t pt-3">
              <div>
                <dt className="text-muted-foreground">
                  Necesidad máxima de fondos
                </dt>
                <dd className="numeric font-medium">
                  {run.currency} {formatAmount(diagnostics.peakFundingNeed)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  Probabilidad de fracaso, 10 años
                </dt>
                <dd className="numeric font-medium">
                  {formatPercent(run.result!.failureAdjustment.probability)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  Pérdidas sin usar al terminal
                </dt>
                <dd className="numeric font-medium">
                  {run.currency}{" "}
                  {formatAmount(diagnostics.unusedLossAtTerminal)}
                </dd>
              </div>
            </dl>
          )}
        </div>
        <Table containerLabel="Ventas usadas para derivar el crecimiento, tabla desplazable">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Cierre fiscal</TableHead>
              <TableHead scope="col" className="text-right">
                Ventas ({run.currency})
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trajectory.revenueHistory.map((year) => (
              <TableRow key={year.fiscalYearEnd}>
                <TableCell>
                  <time dateTime={year.fiscalYearEnd}>
                    {formatCalendarDate(year.fiscalYearEnd)}
                  </time>
                </TableCell>
                <TableCell className="numeric text-right">
                  {formatAmount(year.value)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
