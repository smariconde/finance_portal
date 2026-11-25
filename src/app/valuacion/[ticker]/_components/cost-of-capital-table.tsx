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
  formatAmount,
  formatCalendarDate,
  formatCompactAmount,
  formatPercent,
  formatUtcTimestamp,
} from "@/modules/valuation/domain/display-format";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";

import {
  termName,
  termSpanish,
  type FinancialTermKey,
} from "@/app/_components/financial-terms";

import { costDeclarationLabel, datasetLabel, parameterLabel } from "./labels";

/** Los parámetros que son una tasa se leen en porcentaje; el resto, como número. */
const RATIO_PARAMETERS = new Set(["unlevered_beta", "target_debt_to_equity"]);

function parameterValue(name: string, value: string): string {
  return RATIO_PARAMETERS.has(name)
    ? formatAmount(value, { scale: 2 })
    : formatPercent(value, { scale: 2 });
}

/**
 * Costo de capital bottom-up (`F3-06`): qué parámetros entraron, de qué
 * release de Damodaran y conocibles desde cuándo, y lo que el código derivó de
 * ellos. El WACC nunca es un input crudo: `wacc_built_from_components` lo
 * recalculó en esta corrida.
 */
export function CostOfCapitalTable({
  run,
  attribution,
}: {
  run: ValuationRun;
  /** La del registro de fuentes declarado; `null` si no declara ninguna. */
  attribution: string | null;
}) {
  const capital = run.input.costOfCapital;
  const derived = capital.derived;
  const mix = capital.businessExposure;

  const derivedRows: readonly {
    term: FinancialTermKey;
    value: string;
    hint?: string;
  }[] = [
    {
      term: "riskFree",
      value: formatPercent(derived.riskFree, { scale: 2 }),
      hint: "Tesoro menos el spread de default soberano",
    },
    {
      term: "leveredBeta",
      value: formatAmount(derived.leveredBeta, { scale: 2 }),
      hint:
        mix === undefined
          ? "Hamada sobre la deuda/equity de la industria"
          : "Hamada sobre la beta y la deuda/equity de la mezcla de negocios",
    },
    {
      term: "costOfEquity",
      value: formatPercent(derived.costOfEquity, { scale: 2 }),
    },
    {
      term: "syntheticRating",
      value: derived.syntheticRating,
      hint: `Cobertura de intereses ${formatAmount(capital.coverage.value, { scale: 1 })}× al ${formatCalendarDate(capital.coverage.fiscalYearEnd)}`,
    },
    {
      term: "preTaxCostOfDebt",
      value: formatPercent(derived.preTaxCostOfDebt, { scale: 2 }),
    },
    {
      term: "afterTaxCostOfDebt",
      value: formatPercent(derived.afterTaxCostOfDebt, { scale: 2 }),
    },
    {
      term: "equityWeight",
      value: formatPercent(derived.equityWeight, { scale: 1 }),
    },
    {
      term: "debtWeight",
      value: formatPercent(derived.debtWeight, { scale: 1 }),
    },
    {
      term: "wacc",
      hint: "Años explícitos",
      value: formatPercent(derived.wacc, { scale: 2 }),
    },
    {
      term: "terminalWacc",
      value: formatPercent(derived.terminalWacc, { scale: 2 }),
      hint: `Beta terminal ${formatAmount(derived.terminalBeta, { scale: 2 })}`,
    },
  ];

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Costo de capital</CardTitle>
        <CardDescription>
          Industria <CodeValue>{capital.industryKey}</CodeValue>, país{" "}
          <CodeValue>{capital.countryKey}</CodeValue>, en {capital.currency}.
          Cada parámetro viene de una release fechada de Damodaran y entró sólo
          si era conocible al corte de la corrida.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0">
        <div className="flex flex-wrap items-center gap-2 px-(--card-spacing) pb-3">
          <h3 className="text-sm font-medium">Parámetros</h3>
          <EvidenceKindMark kind="reference_data" />
        </div>
        <Table containerLabel="Parámetros del costo de capital, tabla desplazable">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Parámetro</TableHead>
              <TableHead scope="col" className="text-right">
                Valor
              </TableHead>
              <TableHead scope="col">Tabla y fila</TableHead>
              <TableHead scope="col">Release</TableHead>
              <TableHead scope="col">Conocible desde</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {capital.parameters.map((parameter) => (
              <TableRow key={parameter.name}>
                <TableHead scope="row" className="font-medium">
                  {parameterLabel(parameter.name)}
                </TableHead>
                <TableCell className="numeric text-right">
                  {parameterValue(parameter.name, parameter.value)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {datasetLabel(parameter.datasetId)} ·{" "}
                  <CodeValue>{parameter.rowKey}</CodeValue>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {parameter.publishedLabel ?? "Sin fecha publicada"}
                </TableCell>
                <TableCell>
                  <time className="numeric" dateTime={parameter.availableAt}>
                    {formatUtcTimestamp(parameter.availableAt)}
                  </time>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      {mix === undefined ? null : <BusinessMixTable mix={mix} />}

      <CardContent className="grid gap-6 border-t pt-(--card-spacing) lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">Lo que el código derivó</h3>
            <EvidenceKindMark kind="derived_by_rule" />
          </div>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {derivedRows.map((row) => (
              <div key={row.term} className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">
                  {termName(row.term)}
                </dt>
                <dd className="numeric mt-0.5 text-sm font-medium">
                  {row.value}
                </dd>
                <dd className="text-xs text-muted-foreground">
                  {termSpanish(row.term)}
                  {row.hint === undefined ? null : ` · ${row.hint}`}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            <CodeValue>{capital.version}</CodeValue>
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Decisiones de construcción</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
            {capital.declarations.map((code) => (
              <li key={code}>{costDeclarationLabel(code)}</li>
            ))}
          </ul>
          {attribution === null ? null : (
            <p className="text-xs text-muted-foreground">
              Fuente: {attribution}. Uso de investigación personal, con
              atribución.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type BusinessExposure = NonNullable<
  ValuationRun["input"]["costOfCapital"]["businessExposure"]
>;

/**
 * La beta por mezcla de negocios (`F6-48`, ADR 0086): cada industria con las
 * ventas del ejercicio que la IA le asignó desde el XBRL —o el peso que
 * declaró el owner—, el EV/Sales de su industria, el peso por valor y su beta
 * y D/E. La fila final es lo que entró a Hamada.
 */
function BusinessMixTable({ mix }: { mix: BusinessExposure }) {
  const declared = mix.source === "owner_declaration";

  return (
    <CardContent className="border-t px-0 pt-(--card-spacing)">
      <div className="flex flex-wrap items-center gap-2 px-(--card-spacing) pb-3">
        <h3 className="text-sm font-medium">Mezcla de negocios</h3>
        <EvidenceKindMark
          kind={declared ? "owner_declaration" : "ai_proposal"}
        />
        <EvidenceKindMark kind="reference_data" />
      </div>
      <Table containerLabel="Mezcla de negocios de la beta, tabla desplazable">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Industria</TableHead>
            <TableHead scope="col" className="text-right">
              Ventas (USD)
            </TableHead>
            <TableHead scope="col" className="text-right">
              EV/Sales
            </TableHead>
            <TableHead scope="col" className="text-right">
              Peso por valor
            </TableHead>
            <TableHead scope="col" className="text-right">
              Beta desapalancada
            </TableHead>
            <TableHead scope="col" className="text-right">
              Deuda/equity
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mix.businesses.map((business) => (
            <TableRow key={business.industryKey}>
              <TableHead scope="row" className="font-medium">
                <CodeValue>{business.industryKey}</CodeValue>
              </TableHead>
              <TableCell className="numeric text-right">
                {business.revenue === null
                  ? "Declarado"
                  : formatCompactAmount(business.revenue)}
              </TableCell>
              <TableCell className="numeric text-right">
                {business.evToSales === null
                  ? "—"
                  : `${formatAmount(business.evToSales, { scale: 2 })}×`}
              </TableCell>
              <TableCell className="numeric text-right">
                {formatPercent(business.weight, { scale: 1 })}
              </TableCell>
              <TableCell className="numeric text-right">
                {formatAmount(business.unleveredBeta, { scale: 2 })}
              </TableCell>
              <TableCell className="numeric text-right">
                {formatAmount(business.debtToEquity, { scale: 2 })}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableHead scope="row" className="font-medium">
              Combinada
            </TableHead>
            <TableCell />
            <TableCell />
            <TableCell className="numeric text-right">
              {formatPercent("1", { scale: 1 })}
            </TableCell>
            <TableCell className="numeric text-right font-medium">
              {formatAmount(mix.unleveredBeta, { scale: 2 })}
            </TableCell>
            <TableCell className="numeric text-right font-medium">
              {formatAmount(mix.debtToEquity, { scale: 2 })}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <p className="px-(--card-spacing) pt-3 text-xs text-muted-foreground">
        {declared
          ? "Pesos declarados por el owner."
          : "Peso = ventas × EV/Sales de la industria, sobre el total."}{" "}
        Betas y EV/Sales de Damodaran (EE. UU.) al corte de la corrida.
      </p>
    </CardContent>
  );
}
