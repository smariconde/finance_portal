import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { EvidenceKindMark } from "@/app/valuacion/_components/run/data-marks";
import { CodeValue } from "@/app/valuacion/_components/run/field";
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
import {
  EXPECTATIONS_PLAUSIBILITY_VERSION,
  type DriverPlausibility,
  type PlausibilityVerdict,
} from "@/modules/valuation/domain/market-expectations";
import type { ReadingDriver } from "@/modules/valuation/domain/market-expectations-task";
import type {
  MarketImpliedContext,
  MarketImpliedDriver,
  MarketImpliedReading,
  MarketPriceComparisonUnavailableReason,
} from "@/modules/valuation/domain/market-implied";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";

export const COMPARISON_GAP_COPY: Record<
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

export const DRIVER_COPY: Record<
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

export const OUTLOOK_COPY: Record<string, string> = {
  decline: "en caída (menos de 0 %)",
  low: "bajo (0 % a 5 %)",
  moderate: "moderado (5 % a 10 %)",
  high: "alto (10 % a 20 %)",
  very_high: "muy alto (más de 20 %)",
  contracting: "se contrae",
  stable: "estable",
  expanding: "se expande",
  none: "ninguna",
  narrow: "acotada",
  wide: "amplia",
  not_addressed: "el 10-K no lo trata",
};

export const VERDICT_COPY: Record<PlausibilityVerdict, string> = {
  within: "Dentro de lo que sostiene",
  above: "Un escalón por encima",
  far_above: "Dos o más escalones por encima",
  unreachable: "Ningún valor de este supuesto alcanza el precio",
  not_addressed: "El 10-K no lo trata",
  no_requirement: "Sin exigencia resuelta",
};

export const READING_DRIVER: Partial<
  Record<MarketImpliedDriver, ReadingDriver>
> = {
  revenue_growth: "revenue_growth",
  ebit_margin: "operating_margin",
  terminal_return_on_capital: "competitive_advantage",
};

export const READING_COPY: Record<ReadingDriver, string> = {
  revenue_growth: "Crecimiento de ventas",
  operating_margin: "Margen operativo",
  competitive_advantage: "Ventaja competitiva",
};

const SECTION_COPY: Record<string, string> = {
  item_1_business: "Item 1, negocio",
  item_7_mdna: "Item 7, MD&A",
  item_1a_risk_factors: "Item 1A, riesgos",
};

function ReadingCell({
  plausibility,
}: {
  plausibility: DriverPlausibility | undefined;
}) {
  if (plausibility === undefined) {
    return (
      <span className="text-sm text-muted-foreground">
        El 10-K no habla del costo de capital del inversor
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-sm font-medium">
        {VERDICT_COPY[plausibility.verdict]}
      </span>
      <span className="text-xs text-muted-foreground">
        Sostiene: {OUTLOOK_COPY[plausibility.reading.outlook]}
        {plausibility.required === null
          ? ""
          : ` · exige: ${OUTLOOK_COPY[plausibility.required]}`}
      </span>
    </span>
  );
}

export function percent(value: string): string {
  return formatPercent(value, { scale: 2 });
}

/** Contra qué leer lo exigido: lo que la propia empresa ya mostró. */
export function referenceFor(
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

export function runValueOf(
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

export function ImpliedCell({
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
 * La tabla técnica de lo que exige el precio (`F6-09`, ADR 0048): un DCF
 * inverso que mueve un driver por vez hasta que el motor devuelve el precio.
 * Desde `F6-17` la lectura en palabras va antes y esta tabla queda a demanda.
 */
export function ImpliedTable({
  run,
  market,
}: {
  run: ValuationRun;
  market: ValuationResultMarket;
}) {
  const { implied, context } = market;
  const aiReading = market.reading;

  if (implied.status !== "computed") return null;

  return (
    <div className="flex flex-col gap-2">
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
            {aiReading === null ? null : (
              <TableHead scope="col">Lo que sostiene el 10-K</TableHead>
            )}
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
              {aiReading === null ? null : (
                <TableCell className="min-w-48 align-top whitespace-normal">
                  <ReadingCell
                    plausibility={aiReading.plausibility.find(
                      (entry) =>
                        entry.driver === READING_DRIVER[reading.driver],
                    )}
                  />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Bisección de {implied.readings.length} drivers sobre el motor de la
        corrida, con intervalos declarados; fuera de ellos se dice de qué lado
        queda el precio, nunca se extrapola. Estas lecturas no pasan por los
        controles de la corrida ni se registran.{" "}
        <CodeValue>{implied.version}</CodeValue>
      </p>
    </div>
  );
}

/**
 * Lo que sostiene el 10-K según la IA (`F6-11`, ADR 0050). El modelo no vio
 * el precio ni lo exigido: leyó el negocio, el MD&A y los riesgos, y cada
 * señal es una cita literal que la policy encontró en su bloque.
 */
export function AiReading({
  reading,
  run,
}: {
  reading: ValuationResultMarket["reading"];
  run: ValuationRun;
}) {
  if (reading === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin lectura de la IA del 10-K del ejercicio cerrado el{" "}
        <time dateTime={run.input.baseRevenue.asOf}>
          {formatCalendarDate(run.input.baseRevenue.asOf)}
        </time>
        : la columna de lo que sostiene el 10-K aparece cuando se pide con{" "}
        <CodeValue>pnpm valuation:market-expectations --apply</CodeValue>.
      </p>
    );
  }

  const { record, evidence } = reading.stored;
  const body = record.reading!;
  const sectionOf = (evidenceId: string) => {
    const section = evidence.find(
      (item) => item.evidenceId === evidenceId,
    )?.section;

    return section === undefined
      ? evidenceId
      : (SECTION_COPY[section] ?? section);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">Lo que sostiene el 10-K</h3>
          <EvidenceKindMark kind="ai_proposal" />
        </div>
        <p className="max-w-prose text-sm text-muted-foreground">
          La IA leyó el negocio, el MD&amp;A y los riesgos del 10-K, sin ver el
          precio ni lo que exige, y dijo qué perspectiva sostiene cada supuesto.
          Cada señal cita el filing literalmente; la comparación con lo exigido
          la hace el código. Es una lectura para discutir, no una conclusión.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {body.drivers.map((driver) => (
          <section
            key={driver.driver}
            aria-label={READING_COPY[driver.driver]}
            className="flex min-w-0 flex-col gap-2"
          >
            <h4 className="text-sm font-medium">
              {READING_COPY[driver.driver]}:{" "}
              <span className="font-normal">
                {OUTLOOK_COPY[driver.outlook]}
              </span>
            </h4>
            {driver.signals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin señales: el 10-K no lo trata.
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {driver.signals.map((signal, index) => (
                  <li key={index} className="flex gap-2 text-sm">
                    {signal.direction === "higher" ? (
                      <ArrowUpRight
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                    ) : (
                      <ArrowDownRight
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                    )}
                    <span className="flex min-w-0 flex-col gap-1">
                      <span>
                        <span className="sr-only">
                          {signal.direction === "higher"
                            ? "Empuja hacia arriba: "
                            : "Empuja hacia abajo: "}
                        </span>
                        {signal.summary}
                      </span>
                      <q className="text-xs break-words text-muted-foreground">
                        {signal.quote}
                      </q>
                      <span className="text-xs text-muted-foreground">
                        {sectionOf(signal.evidenceId)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {body.risks.length === 0 ? null : (
        <section aria-label="Riesgos" className="flex flex-col gap-2">
          <h4 className="text-sm font-medium">Lo que podría romperlo</h4>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
            {body.risks.map((risk, index) => (
              <li key={index}>
                {risk.summary}{" "}
                <span className="text-xs text-muted-foreground">
                  ({sectionOf(risk.evidenceId)})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="max-w-prose text-sm text-muted-foreground">
        {body.rationale}
      </p>

      <p className="text-xs text-muted-foreground">
        10-K <CodeValue>{record.accessionNumber}</CodeValue> · modelo{" "}
        <CodeValue>{record.respondedModel ?? "—"}</CodeValue> en el escalón{" "}
        {record.acceptedRung ?? "—"} · confianza{" "}
        {body.confidence === "high" ? "alta" : "media"} · pedida el{" "}
        <time dateTime={record.proposedAt}>
          {formatCalendarDate(record.proposedAt.slice(0, 10))}
        </time>{" "}
        · <CodeValue>{record.taskVersion}</CodeValue>{" "}
        <CodeValue>{record.policyVersion}</CodeValue>{" "}
        <CodeValue>{record.extractVersion}</CodeValue>{" "}
        <CodeValue>{EXPECTATIONS_PLAUSIBILITY_VERSION}</CodeValue>
      </p>
    </div>
  );
}
