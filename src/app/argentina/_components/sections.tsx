import type {
  ActivityBlock,
  DollarBlock,
  ExternalBlock,
  FiscalBlock,
  MonetaryBlock,
} from "@/modules/argentina-dashboard/domain/argentina-dashboard";
import type {
  SoyBlock,
  SoyDay,
  SoyUnavailableReason,
} from "@/modules/argentina-dashboard/domain/soy-block";
import { formatCompactAmount } from "@/modules/valuation/domain/display-format";

import { DashboardBlock, DataTable } from "./block";
import { ChartViews } from "./chart-views";
import { GovernmentChart } from "./government-chart";
import {
  amount,
  calendarDate,
  compactMillions,
  comparisonText,
  fractionAsPoints,
  longMonth,
  points,
  resultWord,
  shortMonth,
  signedAmount,
  signedPoints,
} from "./format";
import { SectorHeatmap } from "./sector-heatmap";
import { TimelineChart, type TimelineRow } from "./timeline-chart";

const NO_DATA = "Sin dato";

function Empty({ what }: { readonly what: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      Todavía no hay {what} guardados. Se cargan a mano con los comandos de la
      fase 9; esta página no descarga nada.
    </p>
  );
}

function reversed<T>(items: readonly T[]): T[] {
  return [...items].reverse();
}

function rowsOf(
  points: readonly { readonly on: string; readonly value: string | null }[],
  key: string,
): TimelineRow[] {
  return points.map((point) => ({
    on: point.on,
    values: { [key]: point.value },
  }));
}

const VIEW_TIMELINE = "Línea de tiempo";

/**
 * Cómo se leen los gráficos de largo plazo: va en la metodología de cada
 * bloque que los usa, para que la regla esté junto al dato.
 */
function ChartReadingNote() {
  return (
    <p>
      Más allá de cinco años una serie diaria se dibuja al cierre de cada mes:
      el último valor publicado en el mes, nunca un promedio (
      <code className="text-xs">month-end-close-1.0.0</code>). La comparación
      entre dos puntos es su variación porcentual para un nivel y su diferencia
      para una tasa o un saldo (
      <code className="text-xs">point-change-1.0.0</code>). La vista por
      gobierno lee cada presidencia desde su asunción (
      <code className="text-xs">government-comparison-1.0.0</code>) y las marcas
      de gobiernos y regímenes son fechas declaradas con su fuente (
      <code className="text-xs">argentina-timeline-1.0.0</code>).
    </p>
  );
}
const VIEW_GOVERNMENTS = "Por gobierno";

export function ActivitySection({
  activity,
}: {
  readonly activity: ActivityBlock;
}) {
  const latest = activity.latest;
  const trend = new Map(activity.trend.map((point) => [point.on, point.value]));
  const rows: TimelineRow[] = activity.seasonallyAdjusted.map((point) => ({
    on: point.on,
    values: { sa: point.value, trend: trend.get(point.on) ?? null },
  }));
  const reading =
    latest === null
      ? "Sin datos de actividad guardados."
      : `En ${longMonth(latest.on)} la actividad desestacionalizada varió ${comparisonText(latest.monthOverMonth)} contra el mes anterior; la serie original quedó ${comparisonText(latest.yearOverYear)} contra el mismo mes de ${Number(latest.on.slice(0, 4)) - 1}.`;

  return (
    <DashboardBlock
      id="actividad"
      title="Actividad económica (EMAE)"
      reading={reading}
      provenance={
        <>
          INDEC, Catálogo API-INDEC · índice base 2004 = 100 · último dato{" "}
          {latest ? shortMonth(latest.on) : NO_DATA}
        </>
      }
      methodology={
        <>
          <p>
            Estimador Mensual de Actividad Económica del INDEC, base 2004. La
            variación mensual se calcula sobre la serie desestacionalizada que
            publica el INDEC, entre meses contiguos; la interanual, sobre la
            serie original contra el mismo mes del año anterior, donde la
            estacionalidad se cancela. El portal no desestacionaliza nada.
          </p>
          <p>
            Los sectores sólo se publican en su serie original, por eso se leen
            en variación interanual. Cada punto guarda sus revisiones: el INDEC
            corrige meses recientes con cada publicación.
          </p>
          <p>
            Fórmulas <code className="text-xs">argentina-indicator-1.1.0</code>;
            lectura <code className="text-xs">argentina-dashboard-2.0.0</code>.
          </p>
          <ChartReadingNote />
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty what="datos de actividad" />
      ) : (
        <ChartViews
          label="Vista de la actividad"
          views={[
            {
              id: "timeline",
              label: VIEW_TIMELINE,
              content: (
                <TimelineChart
                  key="timeline"
                  label={`EMAE desestacionalizado y tendencia-ciclo desde ${shortMonth(rows[0]!.on)}. ${reading}`}
                  caption="EMAE desestacionalizado y tendencia-ciclo por mes"
                  monthly={rows}
                  frequency="monthly"
                  ranges={["2y", "5y", "10y", "20y", "max"]}
                  defaultRange="5y"
                  axis="index"
                  allowLog
                  series={[
                    {
                      key: "sa",
                      label: "Desestacionalizado",
                      color: "var(--chart-1)",
                      mark: "line",
                      format: { kind: "amount", scale: 1 },
                      change: "ratio",
                    },
                    {
                      key: "trend",
                      label: "Tendencia-ciclo",
                      color: "var(--chart-4)",
                      mark: "dashed",
                      format: { kind: "amount", scale: 1 },
                      change: "ratio",
                    },
                  ]}
                />
              ),
            },
            {
              id: "governments",
              label: VIEW_GOVERNMENTS,
              content: (
                <GovernmentChart
                  key="governments"
                  label="EMAE desestacionalizado de cada presidencia, con 100 el mes anterior a la asunción."
                  caption="EMAE desestacionalizado por presidencia, índice 100 el mes anterior a asumir"
                  basis="index"
                  basisNote="EMAE desestacionalizado, 100 = mes anterior a asumir"
                  format={{ kind: "amount", scale: 1 }}
                  axis="index"
                  options={[
                    {
                      id: "emae",
                      label: "EMAE",
                      paths: activity.governments,
                      baseFormat: { kind: "amount", scale: 1 },
                      baseIsDay: false,
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      )}
      {activity.sectors.length === 0 ||
      activity.sectorMonths.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            ¿Qué sectores crecen contra el año pasado?
          </h3>
          <SectorHeatmap activity={activity} />
        </div>
      )}
    </DashboardBlock>
  );
}

export function DollarSection({ dollar }: { readonly dollar: DollarBlock }) {
  const { latestOfficial, latestCcl, latestGap, latestBand } = dollar;
  const insideBand =
    latestOfficial &&
    latestBand &&
    latestBand.on === latestOfficial.on &&
    latestOfficial.value !== null
      ? Number(latestOfficial.value) >= Number(latestBand.low) &&
        Number(latestOfficial.value) <= Number(latestBand.high)
      : null;
  const reading =
    latestOfficial === null || latestOfficial.value === null
      ? "Sin cotizaciones guardadas."
      : [
          `El ${calendarDate(latestOfficial.on)} el mayorista oficial cerró en $ ${amount(latestOfficial.value, 2)}`,
          latestCcl?.value
            ? ` y el CCL implícito del ${calendarDate(latestCcl.on)} en $ ${amount(latestCcl.value, 2)}`
            : "",
          latestGap
            ? `; la brecha del ${calendarDate(latestGap.on)} fue de ${fractionAsPoints(latestGap.gap)}`
            : "",
          ".",
          insideBand === null || !latestBand
            ? ""
            : insideBand
              ? ` El mayorista está dentro de la banda cambiaria ($ ${amount(latestBand.low, 2)} a $ ${amount(latestBand.high, 2)}).`
              : ` El mayorista está fuera de la banda cambiaria ($ ${amount(latestBand.low, 2)} a $ ${amount(latestBand.high, 2)}).`,
        ].join("");
  const values = (day: (typeof dollar.days)[number]) => ({
    official: day.official,
    ccl: day.ccl,
    bandLow: day.bandLow,
    bandHigh: day.bandHigh,
  });
  const daily: TimelineRow[] = dollar.days.map((day) => ({
    on: day.on,
    values: values(day),
  }));
  const monthly: TimelineRow[] = dollar.months.map((month) => ({
    on: month.on,
    values: values(month),
  }));
  const gapDaily: TimelineRow[] = dollar.days
    .filter((day) => day.gap !== null)
    .map((day) => ({ on: day.on, values: { gap: day.gap } }));
  const gapMonthly: TimelineRow[] = dollar.months.map((month) => ({
    on: month.on,
    values: { gap: month.gap },
  }));
  const dollarRanges = ["1y", "2y", "5y", "10y", "20y", "max"] as const;

  return (
    <DashboardBlock
      id="dolar"
      title="Dólar: oficial, CCL y brecha"
      reading={reading}
      provenance={
        <>
          BCRA (mayorista Com. A 3500 y bandas) y CCL implícito por diez pares
          ADR · pesos por dólar · diario en los últimos cinco años, al cierre de
          cada mes antes
        </>
      }
      methodology={
        <>
          <p>
            El mayorista es el tipo de cambio de referencia que publica el BCRA.
            Las bandas son los límites del régimen cambiario que el BCRA publica
            día por día.
          </p>
          <p>
            El CCL implícito es la mediana, entre los pares que cotizaron ese
            día en las dos plazas, del precio local de la acción dividido por el
            del ADR y su ratio (
            <code className="text-xs">ccl-implied-1.0.0</code>); con menos de
            tres pares no hay dato. Es una tasa de mercado calculada, no una
            cotización publicada. La brecha es CCL / oficial − 1 sólo en días en
            que los dos publicaron (
            <code className="text-xs">fx-gap-1.0.0</code>).
          </p>
          <ChartReadingNote />
        </>
      }
    >
      {daily.length === 0 ? (
        <Empty what="cotizaciones" />
      ) : (
        <ChartViews
          label="Vista del dólar"
          views={[
            {
              id: "timeline",
              label: VIEW_TIMELINE,
              content: (
                <div key="timeline" className="flex flex-col gap-6">
                  <TimelineChart
                    label={`Mayorista oficial, CCL implícito y bandas cambiarias. ${reading}`}
                    caption="Mayorista oficial, CCL implícito y bandas cambiarias, en pesos por dólar"
                    daily={daily}
                    monthly={monthly}
                    frequency="daily"
                    ranges={dollarRanges}
                    defaultRange="2y"
                    axis="pesos"
                    allowLog
                    series={[
                      {
                        key: "official",
                        label: "Mayorista oficial",
                        color: "var(--chart-1)",
                        mark: "line",
                        format: { kind: "amount", scale: 2 },
                        change: "ratio",
                      },
                      {
                        key: "ccl",
                        label: "CCL implícito",
                        color: "var(--chart-3)",
                        mark: "line",
                        format: { kind: "amount", scale: 2 },
                        change: "ratio",
                      },
                    ]}
                    band={{
                      lowKey: "bandLow",
                      highKey: "bandHigh",
                      label: "Banda cambiaria",
                      color: "var(--muted-foreground)",
                      format: { kind: "amount", scale: 2 },
                    }}
                  />
                  {gapDaily.length === 0 ? null : (
                    <div className="flex flex-col gap-2">
                      <h3 className="text-sm font-medium">
                        Brecha CCL / oficial
                      </h3>
                      <TimelineChart
                        label={`Brecha entre el CCL implícito y el mayorista oficial.${latestGap ? ` Último dato ${fractionAsPoints(latestGap.gap)} el ${calendarDate(latestGap.on)}.` : ""}`}
                        caption="Brecha entre el CCL implícito y el mayorista oficial"
                        daily={gapDaily}
                        monthly={gapMonthly}
                        frequency="daily"
                        ranges={dollarRanges}
                        defaultRange="2y"
                        axis="fraction"
                        height="sm"
                        zeroLine
                        series={[
                          {
                            key: "gap",
                            label: "Brecha",
                            color: "var(--chart-3)",
                            mark: "line",
                            format: { kind: "fraction" },
                            change: "difference",
                          },
                        ]}
                      />
                    </div>
                  )}
                </div>
              ),
            },
            {
              id: "governments",
              label: VIEW_GOVERNMENTS,
              content: (
                <GovernmentChart
                  key="governments"
                  label="Dólar de cada presidencia, con 100 el último cierre anterior a la asunción."
                  caption="Dólar por presidencia, índice 100 el último cierre anterior a asumir"
                  basis="index"
                  basisNote="100 = último cierre antes de asumir"
                  format={{ kind: "amount", scale: 1 }}
                  axis="index"
                  allowLog
                  options={[
                    {
                      id: "official",
                      label: "Mayorista",
                      paths: dollar.governments.official,
                      baseFormat: { kind: "amount", scale: 2 },
                      baseIsDay: true,
                    },
                    {
                      id: "ccl",
                      label: "CCL",
                      paths: dollar.governments.ccl,
                      baseFormat: { kind: "amount", scale: 2 },
                      baseIsDay: true,
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      )}
    </DashboardBlock>
  );
}

export function MonetarySection({
  monetary,
}: {
  readonly monetary: MonetaryBlock;
}) {
  const lastMonthly = monetary.monthlyInflation.at(-1);
  const lastReserve = monetary.reserves.at(-1);
  const reading =
    lastMonthly?.value == null
      ? "Sin datos de inflación guardados."
      : [
          `La inflación de ${longMonth(lastMonthly.on)} fue ${points(lastMonthly.value)} mensual`,
          monetary.annualInflation?.value
            ? ` y ${points(monetary.annualInflation.value)} interanual (${shortMonth(monetary.annualInflation.on)})`
            : "",
          ".",
          lastReserve?.value
            ? ` Las reservas brutas del ${calendarDate(lastReserve.on)} eran US$ ${amount(lastReserve.value)} millones.`
            : "",
        ].join("");

  return (
    <DashboardBlock
      id="monetario"
      title="Inflación, reservas y base monetaria"
      reading={reading}
      provenance={
        <>
          BCRA, Estadísticas Monetarias v4 · inflación del INDEC publicada por
          el BCRA · base monetaria en pesos constantes por IPC
        </>
      }
      methodology={
        <>
          <p>
            Inflación mensual e interanual, reservas internacionales brutas y
            base monetaria como las publica el BCRA en sus Principales
            Variables, con revisiones por punto.
          </p>
          <p>
            La base monetaria real es el stock de fin de mes deflactado por el
            IPC encadenado desde la inflación mensual (
            <code className="text-xs">macro-transform-1.0.0</code>,
            <code className="text-xs">bcra-cpi-chain-1.0.0</code>); su unidad
            nombra el mes base.
          </p>
          <ChartReadingNote />
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-sm font-medium">Inflación</h3>
        {monetary.monthlyInflation.length === 0 ? (
          <Empty what="datos de inflación" />
        ) : (
          <ChartViews
            label="Vista de la inflación"
            views={[
              {
                id: "monthly",
                label: "Mensual",
                content: (
                  <TimelineChart
                    key="monthly"
                    label={`Inflación mensual desde ${shortMonth(monetary.monthlyInflation[0]!.on)}. ${reading}`}
                    caption="Inflación mensual por mes, en %"
                    monthly={rowsOf(monetary.monthlyInflation, "inflation")}
                    frequency="monthly"
                    ranges={["2y", "5y", "10y", "20y", "max"]}
                    defaultRange="2y"
                    axis="points"
                    series={[
                      {
                        key: "inflation",
                        label: "Inflación mensual",
                        color: "var(--chart-1)",
                        mark: "bar",
                        format: { kind: "points" },
                        change: "difference",
                      },
                    ]}
                  />
                ),
              },
              {
                id: "annual",
                label: "Interanual",
                content: (
                  <TimelineChart
                    key="annual"
                    label={`Inflación interanual que publica el BCRA, mes por mes.${monetary.annualInflation?.value ? ` Último dato ${points(monetary.annualInflation.value)} en ${shortMonth(monetary.annualInflation.on)}.` : ""}`}
                    caption="Inflación interanual por mes, en %"
                    monthly={rowsOf(monetary.annualInflationSeries, "annual")}
                    frequency="monthly"
                    ranges={["2y", "5y", "10y", "20y", "max"]}
                    defaultRange="10y"
                    axis="points"
                    allowLog
                    series={[
                      {
                        key: "annual",
                        label: "Inflación interanual",
                        color: "var(--chart-1)",
                        mark: "line",
                        format: { kind: "points" },
                        change: "difference",
                      },
                    ]}
                  />
                ),
              },
              {
                id: "governments",
                label: VIEW_GOVERNMENTS,
                content: (
                  <GovernmentChart
                    key="governments"
                    label="Precios acumulados de cada presidencia desde la asunción, con 100 el mes anterior."
                    caption="Nivel de precios por presidencia, índice 100 el mes anterior a asumir"
                    basis="cumulative_rate"
                    basisNote="Precios, 100 = mes anterior a asumir"
                    format={{ kind: "amount", scale: 1 }}
                    axis="index"
                    allowLog
                    options={[
                      {
                        id: "prices",
                        label: "Precios",
                        paths: monetary.governments.prices,
                        baseFormat: { kind: "points" },
                        baseIsDay: false,
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-sm font-medium">
          Reservas internacionales brutas, en miles de millones de US$
        </h3>
        {monetary.reserves.length === 0 ? (
          <Empty what="datos de reservas" />
        ) : (
          <ChartViews
            label="Vista de las reservas"
            views={[
              {
                id: "timeline",
                label: VIEW_TIMELINE,
                content: (
                  <TimelineChart
                    key="timeline"
                    label={`Reservas internacionales brutas.${lastReserve?.value ? ` Último dato US$ ${amount(lastReserve.value)} millones el ${calendarDate(lastReserve.on)}.` : ""}`}
                    caption="Reservas internacionales brutas, en millones de US$"
                    daily={rowsOf(monetary.reserves, "reserves")}
                    monthly={rowsOf(monetary.reserveMonths, "reserves")}
                    frequency="daily"
                    ranges={["1y", "2y", "5y", "10y", "20y", "max"]}
                    defaultRange="2y"
                    axis="decimal"
                    allowLog
                    series={[
                      {
                        key: "reserves",
                        label: "Reservas brutas, US$ M",
                        color: "var(--chart-2)",
                        mark: "line",
                        format: { kind: "amount" },
                        change: "ratio",
                        divisor: 1_000,
                      },
                    ]}
                  />
                ),
              },
              {
                id: "governments",
                label: VIEW_GOVERNMENTS,
                content: (
                  <GovernmentChart
                    key="governments"
                    label="Reservas ganadas o perdidas por cada presidencia desde el último día antes de asumir, en millones de US$."
                    caption="Variación de reservas por presidencia, en millones de US$ contra el último día antes de asumir"
                    basis="difference"
                    basisNote="Diferencia en US$ M contra el último día antes de asumir"
                    format={{ kind: "signedAmount" }}
                    axis="millions"
                    options={[
                      {
                        id: "reserves",
                        label: "Reservas",
                        paths: monetary.governments.reserves,
                        baseFormat: { kind: "amount" },
                        baseIsDay: true,
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </div>
      {monetary.realBase.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-medium">
            Base monetaria real, en billones de pesos
            {monetary.realBaseOn
              ? ` de ${longMonth(`${monetary.realBaseOn.slice(0, 7)}-01`)}`
              : null}
          </h3>
          <TimelineChart
            label="Base monetaria en pesos constantes."
            caption="Base monetaria real, en millones de pesos constantes"
            monthly={rowsOf(monetary.realBase, "base")}
            frequency="monthly"
            ranges={["2y", "5y", "10y", "20y", "max"]}
            defaultRange="5y"
            axis="decimal"
            height="sm"
            allowLog
            series={[
              {
                key: "base",
                label: "Base monetaria real, $ M",
                color: "var(--chart-1)",
                mark: "line",
                format: { kind: "amount" },
                change: "ratio",
                divisor: 1_000_000,
              },
            ]}
          />
        </div>
      )}
    </DashboardBlock>
  );
}

export function FiscalSection({ fiscal }: { readonly fiscal: FiscalBlock }) {
  const lastYear = fiscal.years.at(-1);
  const ytd = fiscal.yearToDate;
  const reading =
    lastYear === undefined
      ? "Sin resultados fiscales guardados."
      : [
          `En ${lastYear.year} el resultado primario del Sector Público Nacional fue ${comparisonText(lastYear.primary)} del PIB y los intereses netos ${comparisonText(lastYear.interest, (value) => points(value))} del PIB.`,
          ytd
            ? ` En ${ytd.year}, hasta ${longMonth(ytd.lastOn)}, el primario acumula un ${resultWord(ytd.primary)} de $ ${compactMillions(ytd.primary)}; el porcentaje del PIB del año se calcula cuando el año cierra.`
            : "",
        ].join("");

  return (
    <DashboardBlock
      id="fiscal"
      title="Resultado fiscal sobre el PIB"
      reading={reading}
      provenance={
        <>
          Secretaría de Hacienda (IMIG) y PIB a precios corrientes del INDEC,
          vía Series de Tiempo · % del PIB del mismo año · años completos
        </>
      }
      methodology={
        <>
          <p>
            Suma de los doce meses del Informe Mensual de Ingresos y Gastos del
            Sector Público Nacional no financiero, base caja, dividida por el
            PIB a precios corrientes de ese mismo año. Un año incompleto no
            tiene porcentaje: sumar meses contra un PIB anual mezclaría bases.
          </p>
          <p>
            El resultado financiero (primario menos intereses) no se muestra
            todavía: el distribuidor publica su serie vacía y derivarlo es una
            decisión pendiente (<code className="text-xs">F9-11</code>).
          </p>
          <ChartReadingNote />
        </>
      }
    >
      {fiscal.years.length === 0 ? (
        <Empty what="resultados fiscales" />
      ) : (
        <>
          <TimelineChart
            label={`Resultado primario e intereses netos en % del PIB, ${fiscal.years[0]!.year} a ${lastYear!.year}. ${reading}`}
            caption="Resultado primario e intereses netos en % del PIB por año"
            monthly={fiscal.years.map((year) => ({
              on: `${year.year}-01-01`,
              values: {
                primary:
                  year.primary.status === "computed"
                    ? year.primary.value
                    : null,
                interest:
                  year.interest.status === "computed"
                    ? year.interest.value
                    : null,
              },
            }))}
            frequency="annual"
            ranges={["max"]}
            axis="points"
            showTable={false}
            series={[
              {
                key: "primary",
                label: "Resultado primario",
                color: "var(--chart-1)",
                mark: "bar",
                format: { kind: "signedPoints", scale: 2 },
                change: "difference",
              },
              {
                key: "interest",
                label: "Intereses netos",
                color: "var(--chart-3)",
                mark: "bar",
                format: { kind: "points", scale: 2 },
                change: "difference",
              },
            ]}
          />
          <DataTable
            caption="Resultado primario e intereses netos en % del PIB por año"
            columns={[
              { label: "Año" },
              { label: "Primario, % del PIB", numeric: true },
              { label: "Intereses, % del PIB", numeric: true },
            ]}
            rows={reversed(fiscal.years).map((year) => [
              String(year.year),
              comparisonText(year.primary, (value) => signedPoints(value, 2)),
              comparisonText(year.interest, (value) => points(value, 2)),
            ])}
          />
        </>
      )}
    </DashboardBlock>
  );
}

export function ExternalSection({
  external,
}: {
  readonly external: ExternalBlock;
}) {
  const last = external.months.at(-1);
  const twelve = external.lastTwelve;
  const reading =
    last === undefined
      ? "Sin datos de comercio exterior guardados."
      : [
          `En ${longMonth(last.on)} se exportaron US$ ${last.exports === null ? NO_DATA : amount(last.exports)} millones y se importaron US$ ${last.imports === null ? NO_DATA : amount(last.imports)} millones: un saldo de US$ ${comparisonText(last.balance, (value) => signedAmount(value))} millones.`,
          twelve
            ? ` En los doce meses hasta ${longMonth(twelve.toOn)} el saldo acumula US$ ${signedAmount(twelve.balance)} millones.`
            : "",
        ].join("");

  return (
    <DashboardBlock
      id="externo"
      title="Comercio exterior de bienes"
      reading={reading}
      provenance={
        <>
          INDEC, Intercambio Comercial Argentino, vía Series de Tiempo ·
          millones de US$ · exportaciones FOB, importaciones CIF · toda la serie
        </>
      }
      methodology={
        <>
          <p>
            Totales mensuales publicados del Intercambio Comercial Argentino. El
            saldo se calcula como exportaciones menos importaciones del mismo
            mes, y concilia con el saldo publicado.
          </p>
          <p>
            La composición por rubro, uso económico y destino llega con
            <code className="text-xs">F9-09</code>, desde el INDEC directo.
          </p>
          <ChartReadingNote />
        </>
      }
    >
      {external.months.length === 0 ? (
        <Empty what="datos de comercio exterior" />
      ) : (
        <>
          <ChartViews
            label="Vista del comercio exterior"
            views={[
              {
                id: "timeline",
                label: VIEW_TIMELINE,
                content: (
                  <TimelineChart
                    key="timeline"
                    label={`Exportaciones, importaciones y saldo comercial mensual desde ${shortMonth(external.months[0]!.on)}. ${reading}`}
                    caption="Exportaciones, importaciones y saldo comercial por mes, en millones de US$"
                    monthly={external.months.map((month) => ({
                      on: month.on,
                      values: {
                        exports: month.exports,
                        imports: month.imports,
                        balance:
                          month.balance.status === "computed"
                            ? month.balance.value
                            : null,
                      },
                    }))}
                    frequency="monthly"
                    ranges={["2y", "3y", "5y", "10y", "20y", "max"]}
                    defaultRange="3y"
                    axis="millions"
                    series={[
                      {
                        key: "balance",
                        label: "Saldo",
                        color: "var(--chart-1)",
                        mark: "bar",
                        format: { kind: "signedAmount" },
                        change: "difference",
                      },
                      {
                        key: "exports",
                        label: "Exportaciones",
                        color: "var(--chart-2)",
                        mark: "line",
                        format: { kind: "amount" },
                        change: "ratio",
                      },
                      {
                        key: "imports",
                        label: "Importaciones",
                        color: "var(--chart-4)",
                        mark: "dashed",
                        format: { kind: "amount" },
                        change: "ratio",
                      },
                    ]}
                  />
                ),
              },
              {
                id: "governments",
                label: VIEW_GOVERNMENTS,
                content: (
                  <GovernmentChart
                    key="governments"
                    label="Saldo comercial acumulado por cada presidencia desde el mes de asunción, en millones de US$."
                    caption="Saldo comercial acumulado por presidencia, en millones de US$"
                    basis="cumulative_sum"
                    basisNote="Saldo acumulado desde el mes de asunción, US$ M"
                    format={{ kind: "signedAmount" }}
                    axis="millions"
                    options={[
                      {
                        id: "balance",
                        label: "Saldo",
                        paths: external.governments,
                        baseFormat: { kind: "signedAmount" },
                        baseIsDay: false,
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
        </>
      )}
    </DashboardBlock>
  );
}

/** Por qué un día de pizarra no tiene basis: la pata que faltó ese día. */
const SOY_UNAVAILABLE: Record<SoyUnavailableReason, string> = {
  missing_rosario: "Pizarra sin cotización",
  missing_fx: "Sin BNA ese día",
  missing_chicago: "Sin Chicago ese día",
  date_mismatch: "Fechas distintas",
  not_yet_known: "No publicado al corte",
  non_positive_input: "Precio no positivo",
};

function contractText(day: SoyDay): string {
  return day.inDeliveryPeriod ? `${day.contract} · en entrega` : day.contract;
}

/** Cuántas ruedas recientes lista la tabla con contrato y motivo. */
const SOY_RECENT_DAYS = 30;

export function SoySection({ soy }: { readonly soy: SoyBlock }) {
  const { latest, legs } = soy;
  const reading =
    latest === null
      ? "Sin un día con pizarra, BNA y Chicago guardados a la vez."
      : [
          `El ${calendarDate(latest.on)} la pizarra de Rosario fue de US$ ${amount(latest.rosarioUsd!, 2)} por tonelada ($ ${amount(latest.rosarioArs!)} al BNA comprador de $ ${amount(latest.fx!, 2)})`,
          ` y Chicago, de US$ ${amount(latest.chicagoUsd!, 2)} (${latest.contract}): un basis de ${signedPoints(latest.basis)}.`,
          latest.inDeliveryPeriod
            ? ` El ${latest.contract} estaba en su período de entrega, que termina el ${calendarDate(latest.lastTradeOn)}.`
            : "",
        ].join("");
  const daily: TimelineRow[] = soy.days.map((day) => ({
    on: day.on,
    values: {
      basis: day.basis,
      rosarioUsd: day.rosarioUsd,
      chicagoUsd: day.chicagoUsd,
    },
  }));
  const monthly: TimelineRow[] = soy.months.map((month) => ({
    on: month.on,
    values: {
      basis: month.basis.value,
      rosarioUsd: month.rosarioUsd.value,
      chicagoUsd: month.chicagoUsd.value,
    },
  }));
  const ranges = ["1y", "2y", "5y", "10y", "20y", "max"] as const;
  const campaigns = soy.campaigns.filter(
    (campaign) => campaign.productionT !== null,
  );
  const lastCampaign = campaigns.at(-1);
  const change = soy.productionChange;
  const legDate = (leg: { readonly on: string } | null) =>
    leg === null ? NO_DATA : calendarDate(leg.on);

  return (
    <DashboardBlock
      id="soja"
      title="Soja: Rosario contra Chicago"
      reading={reading}
      provenance={
        <>
          Cámara Arbitral de Cereales (BCR) · BNA divisas comprador · CBOT vía
          Yahoo (ZS=F) · US$ por tonelada · pizarra {legDate(legs.rosario)}, BNA{" "}
          {legDate(legs.fx)}, Chicago {legDate(legs.chicago)}
        </>
      }
      methodology={
        <>
          <p>
            La pizarra es el precio que fija la Cámara Arbitral de Cereales de
            la Bolsa de Comercio de Rosario: pesos por tonelada, entrega
            inmediata, pago contado, sobre camión o vagón en zona Rosario. Se
            pasa a dólares con la cotización de divisas del Banco Nación al
            cierre, tipo comprador, del mismo día: es la que usa la propia
            Cámara. Un día sin pizarra, sin BNA o sin Chicago no tiene basis, y
            nunca se toma el dato de otro día.
          </p>
          <p>
            Chicago es el cierre diario del contrato más cercano de soja de CBOT
            según Yahoo, en centavos de dólar por bushel, pasado a dólares por
            tonelada con 36,7437 bushels por tonelada. Yahoo rueda al último día
            de negociación —el hábil anterior al 15 del mes del contrato—; el
            contrato de cada día se deduce con esa regla (
            <code className="text-xs">cbot-soy-front-contract-1.0.0</code>) y
            los días desde el first notice day se marcan «en entrega». Es el
            cierre de Yahoo, no el precio de ajuste de CME.
          </p>
          <p>
            El basis es pizarra en dólares sobre Chicago menos uno, en por
            ciento (<code className="text-xs">soy-basis-1.0.0</code>). Esa
            diferencia junta derechos de exportación, flete, márgenes y calidad;
            esta página no la descompone. Durante el cepo y los programas de
            «dólar soja» el exportador no liquidaba al BNA comprador, y en esos
            períodos el basis en dólares oficiales no describe lo que cobraba el
            mercado.
          </p>
          <p>
            Superficies, producción y rendimiento son las Estimaciones Agrícolas
            del Ministerio de Agricultura, Ganadería y Pesca, conciliadas en
            cada corrida con la serie CC BY 4.0 de datos.magyp.gob.ar. La
            campaña en curso se revisa mes a mes; el gráfico la ubica en su año
            de cosecha.
          </p>
          <p>
            Lectura <code className="text-xs">argentina-dashboard-2.1.0</code>.
          </p>
          <ChartReadingNote />
        </>
      }
    >
      {daily.length === 0 ? (
        <Empty what="precios de soja" />
      ) : (
        <ChartViews
          label="Vista de la soja"
          views={[
            {
              id: "basis",
              label: "Basis",
              content: (
                <TimelineChart
                  key="basis"
                  label={`Basis de la soja: pizarra de Rosario en dólares contra Chicago. ${reading}`}
                  caption="Basis de la soja, pizarra de Rosario contra Chicago, en por ciento"
                  daily={daily}
                  monthly={monthly}
                  frequency="daily"
                  ranges={ranges}
                  defaultRange="2y"
                  axis="points"
                  zeroLine
                  series={[
                    {
                      key: "basis",
                      label: "Basis",
                      color: "var(--chart-1)",
                      mark: "line",
                      format: { kind: "signedPoints", scale: 1 },
                      change: "difference",
                    },
                  ]}
                />
              ),
            },
            {
              id: "prices",
              label: "Precios en US$/t",
              content: (
                <TimelineChart
                  key="prices"
                  label="Pizarra de Rosario en dólares y Chicago, en dólares por tonelada."
                  caption="Pizarra de Rosario y Chicago en dólares por tonelada"
                  daily={daily}
                  monthly={monthly}
                  frequency="daily"
                  ranges={ranges}
                  defaultRange="2y"
                  axis="pesos"
                  allowLog
                  series={[
                    {
                      key: "rosarioUsd",
                      label: "Rosario (pizarra)",
                      color: "var(--chart-1)",
                      mark: "line",
                      format: { kind: "amount", scale: 2 },
                      change: "ratio",
                    },
                    {
                      key: "chicagoUsd",
                      label: "Chicago (contrato más cercano)",
                      color: "var(--chart-3)",
                      mark: "dashed",
                      format: { kind: "amount", scale: 2 },
                      change: "ratio",
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      )}
      {soy.days.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            Últimas ruedas, con su contrato
          </h3>
          <DataTable
            caption="Últimas ruedas de pizarra con BNA, Chicago, contrato y basis"
            columns={[
              { label: "Fecha" },
              { label: "Pizarra, $/t", numeric: true },
              { label: "BNA comprador", numeric: true },
              { label: "Chicago, ¢/bu", numeric: true },
              { label: "Contrato" },
              { label: "Basis", numeric: true },
            ]}
            rows={reversed(soy.days.slice(-SOY_RECENT_DAYS)).map((day) => [
              calendarDate(day.on),
              day.rosarioArs === null ? "S/C" : amount(day.rosarioArs),
              day.fx === null ? NO_DATA : amount(day.fx, 2),
              day.chicagoCents === null ? NO_DATA : amount(day.chicagoCents, 2),
              contractText(day),
              day.basis === null
                ? SOY_UNAVAILABLE[day.reason!]
                : signedPoints(day.basis),
            ])}
          />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Producción por campaña</h3>
        {lastCampaign === undefined ? (
          <Empty what="estimaciones agrícolas" />
        ) : (
          <>
            <p className="text-sm">
              {`La campaña ${lastCampaign.campaign} produjo ${formatCompactAmount(lastCampaign.productionT!, { scale: 1 })} de toneladas`}
              {change !== null && change.change.status === "computed"
                ? `, ${fractionAsPoints(change.change.value)} contra ${change.previous}.`
                : "."}
            </p>
            <TimelineChart
              label={`Producción de soja por campaña y año de cosecha, con el eje en millones de toneladas. La campaña ${lastCampaign.campaign} produjo ${formatCompactAmount(lastCampaign.productionT!, { scale: 1 })} de toneladas.`}
              caption="Producción de soja por campaña"
              monthly={campaigns.map((campaign) => ({
                // Año de cosecha: la campaña 2025/26 se cosecha en 2026.
                on: `${Number(campaign.on.slice(0, 4)) + 1}-01-01`,
                values: { production: campaign.productionT },
              }))}
              frequency="annual"
              ranges={["20y", "max"]}
              defaultRange="20y"
              axis="decimal"
              height="sm"
              showTable={false}
              series={[
                {
                  key: "production",
                  label: "Producción, t",
                  color: "var(--chart-2)",
                  mark: "bar",
                  format: { kind: "amount", scale: 0 },
                  change: "ratio",
                  divisor: 1_000_000,
                },
              ]}
            />
            <DataTable
              caption="Superficie, producción y rendimiento de soja por campaña"
              columns={[
                { label: "Campaña" },
                { label: "Sembrada, ha", numeric: true },
                { label: "Cosechada, ha", numeric: true },
                { label: "Producción, t", numeric: true },
                { label: "Rendimiento, kg/ha", numeric: true },
              ]}
              rows={reversed(soy.campaigns).map((campaign) => [
                campaign.campaign,
                campaign.sownHa === null ? NO_DATA : amount(campaign.sownHa),
                campaign.harvestedHa === null
                  ? NO_DATA
                  : amount(campaign.harvestedHa),
                campaign.productionT === null
                  ? NO_DATA
                  : amount(campaign.productionT),
                campaign.yieldKgHa === null
                  ? NO_DATA
                  : amount(campaign.yieldKgHa),
              ])}
            />
          </>
        )}
      </div>
    </DashboardBlock>
  );
}
