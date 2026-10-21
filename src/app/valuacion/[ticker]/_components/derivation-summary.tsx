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
import {
  DERIVED_EXPLICIT_YEARS,
  DERIVED_HOLD_YEARS,
} from "@/modules/valuation/domain/derived-assumptions";
import {
  formatAmount,
  formatCalendarDate,
  formatPercent,
} from "@/modules/valuation/domain/display-format";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";

import {
  ADJUSTMENT_TARGET_LABELS,
  adjustmentLabel,
  notAppliedReasonLabel,
} from "./labels";

/**
 * Cómo salieron los supuestos (`F6-07`, `derived-assumptions-1.0.0`) y qué
 * ajustes llevaron el ejercicio base de reportado a ajustado (`F4-03`).
 *
 * Nada acá recalcula: el crecimiento inicial es el del primer período de la
 * corrida y la historia es la que el snapshot congeló.
 * `assumptions_derived_recomputed` y `normalization_recomputed` ya los
 * reconstruyeron al correr.
 */
export function DerivationSummary({ run }: { run: ValuationRun }) {
  const derivation = run.input.derivedAssumptions;
  const first = run.input.periods[0];
  const ledger = run.input.normalization.ledger;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">De dónde salen los supuestos</CardTitle>
        <CardDescription>
          {derivation === undefined
            ? "El ejercicio base se ajustó con un libro donde cada ajuste dice si se aplicó y por qué."
            : "Ningún supuesto de esta corrida lo escribió una persona: una regla versionada los derivó de lo guardado, y el ejercicio base se ajustó con un libro donde cada ajuste dice si se aplicó y por qué."}
        </CardDescription>
      </CardHeader>

      {derivation === undefined || first === undefined ? (
        <CardContent className="text-sm text-muted-foreground">
          El snapshot no congela una derivación: sus supuestos son los
          declarados en la tabla de supuestos.
        </CardContent>
      ) : (
        <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">La regla</h3>
              <EvidenceKindMark kind="derived_by_rule" />
            </div>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
              <li>
                Crecimiento de ventas de{" "}
                <span className="numeric font-medium text-foreground">
                  {formatPercent(first.revenueGrowth, { scale: 2 })}
                </span>
                : el CAGR de los {derivation.revenueHistory.length} ejercicios
                consecutivos de la tabla, sostenido {DERIVED_HOLD_YEARS} años y
                convergente después a la libre de riesgo, que es también el
                crecimiento terminal (
                <span className="numeric font-medium text-foreground">
                  {formatPercent(run.input.terminal.growth, { scale: 2 })}
                </span>
                ).
              </li>
              <li>
                Margen EBIT ajustado y sales-to-capital del ejercicio base,
                iguales en los {DERIVED_EXPLICIT_YEARS} años.
              </li>
              <li>
                Tasa impositiva aplicada que converge a la marginal, y WACC que
                converge al terminal, en los años {DERIVED_HOLD_YEARS + 1} a{" "}
                {DERIVED_EXPLICIT_YEARS}.
              </li>
              <li>
                ROIC terminal igual al WACC terminal: el crecimiento a
                perpetuidad no crea valor. Sin escenarios bear ni bull.
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              <CodeValue>{derivation.version}</CodeValue>
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">Ventas que congeló</h3>
              <EvidenceKindMark kind="reported_fact" />
            </div>
            <Table containerLabel="Historia de ventas de la derivación, tabla desplazable">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Cierre del ejercicio</TableHead>
                  <TableHead scope="col" className="text-right">
                    Ventas ({run.currency})
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {derivation.revenueHistory.map((year, index) => (
                  <TableRow key={year.fiscalYearEnd}>
                    <TableHead scope="row" className="font-medium">
                      <time className="numeric" dateTime={year.fiscalYearEnd}>
                        {formatCalendarDate(year.fiscalYearEnd)}
                      </time>
                      {index === 0 ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          año base
                        </span>
                      ) : null}
                    </TableHead>
                    <TableCell className="numeric text-right">
                      {formatAmount(year.value)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      )}

      <CardContent className="border-t px-0 pt-(--card-spacing)">
        <div className="flex flex-col gap-1 px-(--card-spacing) pb-3">
          <h3 className="text-sm font-medium">
            Libro de ajustes del ejercicio base
          </h3>
          <p className="text-xs text-muted-foreground">
            De reportado a ajustado. Un ajuste no aplicado queda en el libro con
            su motivo; un monto que no se reportó no se cuenta como cero.{" "}
            <CodeValue>{run.input.normalization.version}</CodeValue>
          </p>
        </div>
        <Table containerLabel="Libro de ajustes del ejercicio base, tabla desplazable">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Ajuste</TableHead>
              <TableHead scope="col">Sobre</TableHead>
              <TableHead scope="col">Estado</TableHead>
              <TableHead scope="col" className="text-right">
                Monto ({run.currency})
              </TableHead>
              <TableHead scope="col">Regla</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledger.map((entry, index) => (
              <TableRow key={`${entry.id}-${entry.target}-${index}`}>
                <TableHead scope="row" className="font-medium">
                  {adjustmentLabel(entry.id)}
                </TableHead>
                <TableCell>
                  {ADJUSTMENT_TARGET_LABELS[entry.target] ?? entry.target}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {entry.status === "applied" ? (
                    "Aplicado"
                  ) : (
                    <span className="text-muted-foreground">
                      No aplicado:{" "}
                      {entry.reason === null
                        ? "sin motivo"
                        : notAppliedReasonLabel(entry.reason)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="numeric text-right">
                  {entry.amount === null ? (
                    <span className="text-muted-foreground">No reportado</span>
                  ) : (
                    formatAmount(entry.amount)
                  )}
                </TableCell>
                <TableCell>
                  <CodeValue>{entry.rule}</CodeValue>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
