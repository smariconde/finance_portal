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
import type {
  CompanyTrajectory,
  TrajectoryChange,
  TrajectoryNullReason,
  TrajectoryValue,
  TrajectoryYear,
} from "@/modules/valuation/domain/company-trajectory";
import {
  displayMagnitude,
  formatCalendarDate,
  formatInMagnitude,
  formatPercent,
  formatUtcTimestamp,
  type DisplayMagnitude,
} from "@/modules/valuation/domain/display-format";

import { termName, termSpanish } from "@/app/_components/financial-terms";
import { InfoTip } from "@/app/_components/info-tip";

import {
  HistoryCharts,
  type HistoryBar,
  type HistoryMetric,
} from "./history-charts";

const NULL_COPY: Record<TrajectoryNullReason, string> = {
  not_reported: "no publicado",
  currency_mismatch: "monedas distintas",
  non_positive_revenue: "ventas no positivas",
  non_positive_shares: "sin acciones",
  debt_unresolved: "deuda sin receta",
};

type MetricKey = Exclude<
  keyof TrajectoryYear,
  "fiscalYearEnd" | "revenueGrowth"
>;

type MetricSpec = {
  readonly key: MetricKey;
  readonly title: string;
  readonly kind: "money" | "percent" | "per_share" | "count";
};

/** Cada métrica por su nombre estándar en inglés (`financial-terms.ts`). */
const METRICS: readonly MetricSpec[] = (
  [
    { key: "revenue", kind: "money" },
    { key: "operatingMargin", kind: "percent" },
    { key: "dilutedEps", kind: "per_share" },
    { key: "freeCashFlow", kind: "money" },
    { key: "netCash", kind: "money" },
    { key: "dilutedShares", kind: "count" },
  ] as const
).map((spec) => ({ ...spec, title: termName(spec.key) }));

/** Lo que antes eran «¿Qué es…?» al pie, ahora junto a cada gráfico. */
const DEFINITIONS: Partial<Record<MetricKey, string>> = {
  operatingMargin:
    "Lo que queda de cada dólar vendido después de costos y gastos del negocio, antes de intereses e impuestos. Si sube, suele indicar poder de precios o escala.",
  dilutedEps:
    "La ganancia neta repartida entre las acciones diluidas. Puede crecer más que la ganancia total si la empresa recompra acciones.",
  freeCashFlow:
    "La caja que deja la operación después de invertir en equipos y plantas: lo que puede ir a dividendos, recompras o bajar deuda. La valuación descuenta flujos de este tipo.",
  netCash:
    "Caja e inversiones líquidas menos deuda financiera, sin arrendamientos operativos. Negativa es deuda neta.",
  dilutedShares:
    "Acciones diluidas en la base de splits vigente al corte. Si bajan, la empresa recompró (buyback) más de lo que emitió y cada acción representa una parte mayor del negocio.",
};

const yearOf = (fiscalYearEnd: string) => fiscalYearEnd.slice(0, 4);

function valuesOf(years: readonly TrajectoryYear[], key: MetricKey) {
  return years.flatMap((year) => {
    const reading = year[key];
    return reading.status === "value" ? [reading.value] : [];
  });
}

function magnitudeFor(
  years: readonly TrajectoryYear[],
  spec: MetricSpec,
): DisplayMagnitude {
  return spec.kind === "money" || spec.kind === "count"
    ? displayMagnitude(valuesOf(years, spec.key))
    : { exponent: 0, unit: null };
}

/** La aclaración en castellano y la unidad: «flujo de caja libre · USD». */
function unitOf(
  spec: MetricSpec,
  magnitude: DisplayMagnitude,
  currency: string,
): string {
  return `${termSpanish(spec.key)} · ${unitOnly(spec, magnitude, currency)}`;
}

function unitOnly(
  spec: MetricSpec,
  magnitude: DisplayMagnitude,
  currency: string,
): string {
  switch (spec.kind) {
    case "percent":
      return "% de las ventas";
    case "per_share":
      return `${currency} por acción`;
    case "count":
      return magnitude.unit === null
        ? "acciones"
        : `${magnitude.unit} de acciones`;
    case "money":
      return magnitude.unit === null
        ? currency
        : `${magnitude.unit} de ${currency}`;
  }
}

function formatValue(
  value: string,
  spec: MetricSpec,
  magnitude: DisplayMagnitude,
): string {
  switch (spec.kind) {
    case "percent":
      return formatPercent(value, { scale: 1 });
    case "per_share":
      return formatInMagnitude(value, magnitude, { scale: 2 });
    default:
      return formatInMagnitude(value, magnitude, { scale: 1 });
  }
}

function changeYears(change: Extract<TrajectoryChange, { status: "value" }>) {
  return `${change.years} ${change.years === 1 ? "año" : "años"}`;
}

/** La frase que lee cada gráfico. Habla de la historia, nunca del futuro. */
function readingOf(
  spec: MetricSpec,
  trajectory: CompanyTrajectory,
  missing: readonly string[],
): string {
  const { summary } = trajectory;
  const gaps =
    missing.length === 0 ? "" : ` Sin dato en ${missing.join(", ")}.`;
  let text: string;

  switch (spec.key) {
    case "revenue": {
      const cagr = summary.revenueCagr;
      text =
        cagr.status === "value"
          ? `Creció ${formatPercent(cagr.value, { scale: 1 })} por año en ${changeYears(cagr)}.`
          : "No hay dos años comparables para medir el crecimiento.";
      break;
    }
    case "operatingMargin": {
      const change = summary.operatingMarginChange;
      text =
        change.status !== "value"
          ? "No hay dos años comparables para medir el cambio."
          : change.value.startsWith("-")
            ? `Perdió ${formatPercent(change.value.slice(1), { scale: 1 }).replace(" %", "")} puntos de margen en ${changeYears(change)}.`
            : `Ganó ${formatPercent(change.value, { scale: 1 }).replace(" %", "")} puntos de margen en ${changeYears(change)}.`;
      break;
    }
    case "freeCashFlow": {
      const { positive, measured } = summary.positiveFreeCashFlowYears;
      text =
        measured === 0
          ? "Sin años con flujo libre medible."
          : `Tuvo FCF positivo en ${positive} de ${measured} años.`;
      break;
    }
    case "dilutedShares": {
      const change = summary.dilutedSharesChange;
      text =
        change.status !== "value"
          ? "No hay dos años comparables para medir el cambio."
          : change.value.startsWith("-")
            ? `Hay ${formatPercent(change.value.slice(1), { scale: 1 })} menos acciones que hace ${changeYears(change)}: recompró más de lo que emitió.`
            : `Hay ${formatPercent(change.value, { scale: 1 })} más acciones que hace ${changeYears(change)}: emitió más de lo que recompró.`;
      break;
    }
    case "netCash": {
      const last = trajectory.years.at(-1)?.netCash;
      text =
        last?.status !== "value"
          ? "Sin caja neta medible en el último ejercicio."
          : last.value.startsWith("-")
            ? "En el último ejercicio debe más de lo que tiene en caja."
            : "En el último ejercicio tiene más caja que deuda financiera.";
      break;
    }
    case "dilutedEps": {
      const points = trajectory.years.filter(
        (year) => year.dilutedEps.status === "value",
      );
      const first = points[0]?.dilutedEps;
      const last = points.at(-1)?.dilutedEps;
      text =
        first?.status !== "value" ||
        last?.status !== "value" ||
        points.length < 2
          ? "No hay dos años comparables."
          : `Pasó de ${formatValue(first.value, spec, { exponent: 0, unit: null })} a ${formatValue(last.value, spec, { exponent: 0, unit: null })} ${trajectory.currency ?? ""} por acción.`;
      break;
    }
  }

  return `${text}${gaps}`;
}

function cellText(
  reading: TrajectoryValue,
  spec: MetricSpec,
  magnitude: DisplayMagnitude,
): string {
  return reading.status === "value"
    ? formatValue(reading.value, spec, magnitude)
    : `Sin dato: ${NULL_COPY[reading.reason]}`;
}

/**
 * Cómo viene la empresa (`F6-17`): seis métricas reportadas de los últimos
 * ejercicios, cada una con su gráfico, su lectura en una frase y la tabla
 * equivalente. Es la historia al corte de la corrida, no una proyección.
 */
export function CompanyHistory({
  trajectory,
  knownAt,
}: {
  trajectory: CompanyTrajectory | null;
  knownAt: string;
}) {
  if (trajectory === null || trajectory.years.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h2">Cómo viene la empresa</CardTitle>
          <CardDescription>
            No hay serie anual de la SEC guardada para esta empresa al corte de
            la corrida, así que no hay historia que mostrar.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const currency = trajectory.currency ?? "USD";
  const { years } = trajectory;
  const specs = METRICS.map((spec) => {
    const magnitude = magnitudeFor(years, spec);
    return { spec, magnitude, unit: unitOf(spec, magnitude, currency) };
  });

  const metrics: HistoryMetric[] = specs.map(({ spec, magnitude, unit }) => {
    const bars: HistoryBar[] = years.map((year) => {
      const reading = year[spec.key];
      return {
        year: yearOf(year.fiscalYearEnd),
        value:
          reading.status === "value"
            ? Number(reading.value) / 10 ** magnitude.exponent
            : null,
        label:
          reading.status !== "value"
            ? ""
            : // La unidad está en el subtítulo: la barra lleva sólo la cifra.
              formatValue(reading.value, spec, magnitude).replace(" %", ""),
      };
    });
    const lastWithValue = [...years]
      .reverse()
      .find((year) => year[spec.key].status === "value");
    const lastReading = lastWithValue?.[spec.key];
    const missing = years
      .filter((year) => year[spec.key].status !== "value")
      .map((year) => yearOf(year.fiscalYearEnd));

    return {
      id: spec.key,
      title: spec.title,
      definition: DEFINITIONS[spec.key],
      unit,
      reading: readingOf(spec, trajectory, missing),
      bars,
      latest:
        lastWithValue === undefined || lastReading?.status !== "value"
          ? null
          : {
              year: yearOf(lastWithValue.fiscalYearEnd),
              label: formatValue(lastReading.value, spec, magnitude),
            },
    };
  });

  const first = years[0]!;
  const last = years.at(-1)!;

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle as="h2">Cómo viene la empresa</CardTitle>
          <EvidenceKindMark kind="reported_fact" />
        </div>
        <CardDescription className="flex items-center gap-0.5">
          Reportado a la SEC, {yearOf(first.fiscalYearEnd)}–
          {yearOf(last.fiscalYearEnd)}.
          <InfoTip title="Por qué mirar esto primero">
            <p>
              Antes de la valuación conviene saber si la empresa vende más, si
              le queda más de cada venta, si genera caja y qué hace con sus
              acciones.
            </p>
            <p>
              Es la lectura reportada: no capitaliza arrendamientos ni I+D como
              la valuación, así que su margen puede diferir del ajustado.
            </p>
          </InfoTip>
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <HistoryCharts metrics={metrics} />
      </CardContent>

      <details className="group border-t">
        <summary className="cursor-pointer px-(--card-spacing) py-3 text-sm font-medium">
          Ver las cifras en tabla
        </summary>
        <CardContent className="flex flex-col gap-2 px-0 pb-(--card-spacing)">
          <Table containerLabel="Historia de la empresa, tabla desplazable">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Métrica</TableHead>
                {years.map((year) => (
                  <TableHead
                    key={year.fiscalYearEnd}
                    scope="col"
                    className="text-right"
                  >
                    <time dateTime={year.fiscalYearEnd}>
                      {formatCalendarDate(year.fiscalYearEnd)}
                    </time>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {specs.map(({ spec, magnitude, unit }) => (
                <TableRow key={spec.key}>
                  <TableHead scope="row" className="font-medium">
                    {spec.title}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {unit}
                    </span>
                  </TableHead>
                  {years.map((year) => (
                    <TableCell
                      key={year.fiscalYearEnd}
                      className={
                        year[spec.key].status === "value"
                          ? "numeric text-right"
                          : "text-right text-xs text-muted-foreground"
                      }
                    >
                      {cellText(year[spec.key], spec, magnitude)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="max-w-prose px-(--card-spacing) text-xs text-muted-foreground">
            Hechos de los 10-K como se conocían el {formatUtcTimestamp(knownAt)}
            , el corte de la corrida. Es la lectura reportada: no capitaliza
            arrendamientos ni I+D como hace la valuación, así que su margen
            puede diferir del ajustado. Acciones y ganancia por acción en la
            base de splits vigente al corte. Caja neta: caja e inversiones
            líquidas menos deuda financiera, sin arrendamientos operativos.{" "}
            <CodeValue>{trajectory.version}</CodeValue>
          </p>
        </CardContent>
      </details>
    </Card>
  );
}
