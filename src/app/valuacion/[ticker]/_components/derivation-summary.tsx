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
  explainDerivation,
  type DerivationExplanation,
  type TerminalReturnBasis,
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
  INTEREST_BASIS_LABELS,
  notAppliedReasonLabel,
} from "./labels";

const TERMINAL_RETURN_COPY: Record<TerminalReturnBasis, string> = {
  cost_of_capital:
    "igual al WACC terminal: el crecimiento a perpetuidad no crea valor",
  industry:
    "el ROC de su industria según Damodaran, menor que el ROIC propio: la ventaja se acerca a la de la industria",
  company:
    "su propio ROIC ajustado, menor que el de su industria: no se la supone mejor que hoy",
  cost_of_capital_floor:
    "igual al WACC terminal, porque ni la industria ni la empresa lo superan",
  no_industry_reference:
    "igual al WACC terminal, porque no hay ROC de la industria visible al corte",
  no_company_return:
    "igual al WACC terminal, porque el ROIC ajustado del año base no se pudo calcular",
};

function percent(value: string): string {
  return formatPercent(value, { scale: 2 });
}

/** La regla `2.0.0`: tendencia, ventanas, ROIC terminal y escenarios. */
function RuleV2({
  run,
  explanation,
}: {
  run: ValuationRun;
  explanation: DerivationExplanation;
}) {
  const first = run.input.periods[0]!;
  const industry = explanation.industryReturn;

  return (
    <>
      <li>
        Crecimiento de ventas de{" "}
        <span className="numeric font-medium text-foreground">
          {percent(first.revenueGrowth)}
        </span>
        : la tendencia log-lineal de los ejercicios de la tabla, que usa todos
        los años y no sólo las puntas
        {explanation.windows.length === 0
          ? ""
          : ` (entre puntas: ${explanation.windows
              .map(
                (window) =>
                  `${percent(window.cagr)} en ${window.years} ${window.years === 1 ? "año" : "años"}`,
              )
              .join(", ")})`}
        . Se sostiene {DERIVED_HOLD_YEARS} años y converge a la libre de riesgo,
        que es también el crecimiento terminal (
        <span className="numeric font-medium text-foreground">
          {percent(run.input.terminal.growth)}
        </span>
        ).
      </li>
      <li>
        Margen EBIT ajustado y sales-to-capital del ejercicio base, iguales en
        los {DERIVED_EXPLICIT_YEARS} años.
      </li>
      <li>
        Tasa impositiva aplicada que converge a la marginal, y WACC que converge
        al terminal, en los años {DERIVED_HOLD_YEARS + 1} a{" "}
        {DERIVED_EXPLICIT_YEARS}.
      </li>
      <li>
        ROIC terminal de{" "}
        <span className="numeric font-medium text-foreground">
          {percent(run.input.terminal.returnOnCapital)}
        </span>
        : {TERMINAL_RETURN_COPY[explanation.terminalReturnBasis]}.{" "}
        {industry === null ? null : (
          <>
            Industria <span className="numeric">{percent(industry.value)}</span>{" "}
            ({industry.publishedLabel ?? "release sin fecha publicada"}
            {" · "}
            <CodeValue>{industry.rowKey}</CodeValue>)
          </>
        )}
        {explanation.baseReturn === null ? null : (
          <>
            {industry === null ? "" : ", "}empresa{" "}
            <span className="numeric">{percent(explanation.baseReturn)}</span>,
            WACC terminal{" "}
            <span className="numeric">{percent(run.input.terminal.wacc)}</span>.
          </>
        )}
      </li>
      <li>
        {run.input.scenarios === null
          ? "Sin escenarios: bear o bull no cambiarían ningún supuesto respecto de la base."
          : "Bear y bull salen de lo medido: el crecimiento más bajo y más alto entre la tendencia y las ventanas, y el ROIC terminal en el WACC (sin ventaja) o en el propio de la empresa (ventaja intacta)."}
      </li>
    </>
  );
}

/**
 * Cómo salieron los supuestos (`F6-07`, `derived-assumptions-1.0.0` y
 * `2.0.0` desde `F6-10`) y qué
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
  const explanation =
    derivation === undefined
      ? null
      : explainDerivation({
          derivation,
          normalization: run.input.normalization,
          costOfCapital: run.input.costOfCapital,
        });

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
              {explanation !== null ? (
                <RuleV2 run={run} explanation={explanation} />
              ) : (
                <>
                  <li>
                    Crecimiento de ventas de{" "}
                    <span className="numeric font-medium text-foreground">
                      {formatPercent(first.revenueGrowth, { scale: 2 })}
                    </span>
                    : el CAGR de los {derivation.revenueHistory.length}{" "}
                    ejercicios consecutivos de la tabla, sostenido{" "}
                    {DERIVED_HOLD_YEARS} años y convergente después a la libre
                    de riesgo, que es también el crecimiento terminal (
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
                    Tasa impositiva aplicada que converge a la marginal, y WACC
                    que converge al terminal, en los años{" "}
                    {DERIVED_HOLD_YEARS + 1} a {DERIVED_EXPLICIT_YEARS}.
                  </li>
                  <li>
                    ROIC terminal igual al WACC terminal: el crecimiento a
                    perpetuidad no crea valor. Sin escenarios bear ni bull.
                  </li>
                </>
              )}
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
          <BaseYearBasis run={run} />
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

/**
 * Lo que el ejercicio base no publicó y una regla resolvió (`F6-15`): el EBIT
 * desde el resultado antes de impuestos y la deuda con evidencia. Sin ninguno,
 * nada: la corrida leyó lo publicado.
 */
function BaseYearBasis({ run }: { run: ValuationRun }) {
  const derivation = run.input.capitalization.ebitDerivation;
  const { debt } = run.input.normalization;
  const evidence = run.input.normalization.facts.zeroDebtEvidence;
  const debtLine =
    evidence === undefined
      ? null
      : debt.status === "zero_with_evidence"
        ? "Deuda: cero. En los cinco ejercicios no hay préstamos ni vencimientos de deuda publicados, y los intereses son nulos o caben en la banda más alta de la tabla de ratings."
        : debt.status === "resolved" && debt.recipe === "finance_leases_only"
          ? "Deuda: sólo los arrendamientos financieros. En los cinco ejercicios no hay préstamos ni vencimientos de deuda publicados."
          : null;

  if (derivation === undefined && debtLine === null) {
    return null;
  }

  return (
    <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
      {derivation === undefined ? null : (
        <li>
          EBIT: la empresa no publica resultado operativo, así que es el
          resultado antes de impuestos más los intereses (
          {INTEREST_BASIS_LABELS[derivation.interest.basis] ??
            derivation.interest.basis}
          ). <CodeValue>{derivation.version}</CodeValue>
        </li>
      )}
      {debtLine === null || evidence === undefined ? null : (
        <li>
          {debtLine} <CodeValue>{evidence.version}</CodeValue>
        </li>
      )}
    </ul>
  );
}
