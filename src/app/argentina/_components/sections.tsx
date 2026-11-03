import type {
  ActivityBlock,
  DollarBlock,
  ExternalBlock,
  FiscalBlock,
  MonetaryBlock,
} from "@/modules/argentina-dashboard/domain/argentina-dashboard";

import { DashboardBlock, DataTable } from "./block";
import { BarSeriesChart, TimeSeriesChart, type ChartRow } from "./charts";
import {
  amount,
  calendarDate,
  compactMillions,
  comparisonText,
  fractionAsPoints,
  longMonth,
  plotNumber,
  plotScaled,
  points,
  resultWord,
  shortMonth,
  signedAmount,
  signedPoints,
} from "./format";
import { SectorHeatmap } from "./sector-heatmap";

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

export function ActivitySection({
  activity,
}: {
  readonly activity: ActivityBlock;
}) {
  const latest = activity.latest;
  const trend = new Map(activity.trend.map((point) => [point.on, point.value]));
  const rows: ChartRow[] = activity.seasonallyAdjusted.map((point) => ({
    on: point.on,
    sa: plotNumber(point.value),
    trend: plotNumber(trend.get(point.on) ?? null),
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
            lectura
            <code className="text-xs">argentina-dashboard-1.0.0</code>.
          </p>
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty what="datos de actividad" />
      ) : (
        <>
          <TimeSeriesChart
            label={`EMAE desestacionalizado y tendencia-ciclo, últimos ${rows.length} meses. ${reading}`}
            data={rows}
            format="index"
            lines={[
              {
                key: "sa",
                label: "Desestacionalizado",
                color: "var(--chart-1)",
              },
              {
                key: "trend",
                label: "Tendencia-ciclo",
                color: "var(--chart-4)",
                dashed: true,
              },
            ]}
          />
          <DataTable
            caption="EMAE desestacionalizado y tendencia-ciclo por mes"
            columns={[
              { label: "Mes" },
              { label: "Desestacionalizado", numeric: true },
              { label: "Tendencia-ciclo", numeric: true },
            ]}
            rows={reversed(activity.seasonallyAdjusted).map((point) => {
              const trendValue = trend.get(point.on) ?? null;
              return [
                shortMonth(point.on),
                point.value === null ? NO_DATA : amount(point.value, 1),
                trendValue === null ? NO_DATA : amount(trendValue, 1),
              ];
            })}
          />
        </>
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
  const rows: ChartRow[] = dollar.days.map((day) => ({
    on: day.on,
    official: plotNumber(day.official),
    ccl: plotNumber(day.ccl),
    bandLow: plotNumber(day.bandLow),
    bandHigh: plotNumber(day.bandHigh),
  }));
  const gapRows: ChartRow[] = dollar.days
    .filter((day) => day.gap !== null)
    .map((day) => ({ on: day.on, gap: plotNumber(day.gap) }));

  return (
    <DashboardBlock
      id="dolar"
      title="Dólar: oficial, CCL y brecha"
      reading={reading}
      provenance={
        <>
          BCRA (mayorista Com. A 3500 y bandas) y CCL implícito por diez pares
          ADR · pesos por dólar · últimos dos años
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
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty what="cotizaciones" />
      ) : (
        <>
          <TimeSeriesChart
            label={`Mayorista oficial, CCL implícito y bandas cambiarias, últimos dos años. ${reading}`}
            data={rows}
            format="pesos"
            height="h-64"
            lines={[
              {
                key: "official",
                label: "Mayorista oficial",
                color: "var(--chart-1)",
              },
              { key: "ccl", label: "CCL implícito", color: "var(--chart-3)" },
              {
                key: "bandHigh",
                label: "Banda superior",
                color: "var(--muted-foreground)",
                dashed: true,
              },
              {
                key: "bandLow",
                label: "Banda inferior",
                color: "var(--muted-foreground)",
                dashed: true,
              },
            ]}
          />
          {gapRows.length === 0 ? null : (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Brecha CCL / oficial</h3>
              <TimeSeriesChart
                label={`Brecha entre el CCL implícito y el mayorista oficial, últimos dos años.${latestGap ? ` Último dato ${fractionAsPoints(latestGap.gap)} el ${calendarDate(latestGap.on)}.` : ""}`}
                data={gapRows}
                format="fraction"
                height="h-40"
                zeroLine
                lines={[
                  { key: "gap", label: "Brecha", color: "var(--chart-3)" },
                ]}
              />
            </div>
          )}
          <DataTable
            caption="Mayorista oficial, CCL implícito, brecha y bandas por día"
            columns={[
              { label: "Día" },
              { label: "Oficial", numeric: true },
              { label: "CCL", numeric: true },
              { label: "Brecha", numeric: true },
              { label: "Banda inferior", numeric: true },
              { label: "Banda superior", numeric: true },
            ]}
            rows={reversed(dollar.days).map((day) => [
              calendarDate(day.on),
              day.official === null ? NO_DATA : amount(day.official, 2),
              day.ccl === null ? NO_DATA : amount(day.ccl, 2),
              day.gap === null ? NO_DATA : fractionAsPoints(day.gap),
              day.bandLow === null ? "—" : amount(day.bandLow, 2),
              day.bandHigh === null ? "—" : amount(day.bandHigh, 2),
            ])}
          />
        </>
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
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-medium">Inflación mensual, en %</h3>
          {monetary.monthlyInflation.length === 0 ? (
            <Empty what="datos de inflación" />
          ) : (
            <BarSeriesChart
              label={`Inflación mensual, últimos ${monetary.monthlyInflation.length} meses. ${reading}`}
              data={monetary.monthlyInflation.map((point) => ({
                on: point.on,
                inflation: plotNumber(point.value),
              }))}
              format="points"
              bars={[
                {
                  key: "inflation",
                  label: "Inflación mensual",
                  color: "var(--chart-1)",
                },
              ]}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-medium">
            Reservas internacionales, en miles de millones de US$
          </h3>
          {monetary.reserves.length === 0 ? (
            <Empty what="datos de reservas" />
          ) : (
            <TimeSeriesChart
              label={`Reservas internacionales brutas, últimos dos años.${lastReserve?.value ? ` Último dato US$ ${amount(lastReserve.value)} millones el ${calendarDate(lastReserve.on)}.` : ""}`}
              data={monetary.reserves.map((point) => ({
                on: point.on,
                reserves: plotScaled(point.value, 1_000),
              }))}
              format="decimal"
              lines={[
                {
                  key: "reserves",
                  label: "Reservas brutas",
                  color: "var(--chart-2)",
                },
              ]}
            />
          )}
        </div>
      </div>
      {monetary.realBase.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-medium">
            Base monetaria real, en billones de pesos
            {monetary.realBaseOn
              ? ` de ${longMonth(`${monetary.realBaseOn.slice(0, 7)}-01`)}`
              : null}
          </h3>
          <TimeSeriesChart
            label="Base monetaria en pesos constantes, últimos cinco años."
            data={monetary.realBase.map((point) => ({
              on: point.on,
              base: plotScaled(point.value, 1_000_000),
            }))}
            format="decimal"
            height="h-40"
            lines={[
              {
                key: "base",
                label: "Base monetaria real",
                color: "var(--chart-1)",
              },
            ]}
          />
        </div>
      )}
      <DataTable
        caption="Inflación mensual por mes"
        columns={[
          { label: "Mes" },
          { label: "Inflación mensual", numeric: true },
        ]}
        rows={reversed(monetary.monthlyInflation).map((point) => [
          shortMonth(point.on),
          point.value === null ? NO_DATA : points(point.value),
        ])}
      />
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
        </>
      }
    >
      {fiscal.years.length === 0 ? (
        <Empty what="resultados fiscales" />
      ) : (
        <>
          <BarSeriesChart
            label={`Resultado primario e intereses netos en % del PIB, ${fiscal.years[0]!.year} a ${lastYear!.year}. ${reading}`}
            category="year"
            data={fiscal.years.map((year) => ({
              on: String(year.year),
              primary:
                year.primary.status === "computed"
                  ? plotNumber(year.primary.value)
                  : null,
              interest:
                year.interest.status === "computed"
                  ? plotNumber(year.interest.value)
                  : null,
            }))}
            format="points"
            bars={[
              {
                key: "primary",
                label: "Resultado primario",
                color: "var(--chart-1)",
              },
              {
                key: "interest",
                label: "Intereses netos",
                color: "var(--chart-3)",
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
          millones de US$ · exportaciones FOB, importaciones CIF · últimos tres
          años
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
        </>
      }
    >
      {external.months.length === 0 ? (
        <Empty what="datos de comercio exterior" />
      ) : (
        <>
          <BarSeriesChart
            label={`Exportaciones, importaciones y saldo comercial mensual, últimos ${external.months.length} meses. ${reading}`}
            data={external.months.map((month) => ({
              on: month.on,
              exports: plotNumber(month.exports),
              imports: plotNumber(month.imports),
              balance:
                month.balance.status === "computed"
                  ? plotNumber(month.balance.value)
                  : null,
            }))}
            format="millions"
            bars={[
              {
                key: "exports",
                label: "Exportaciones",
                color: "var(--chart-2)",
              },
              {
                key: "imports",
                label: "Importaciones",
                color: "var(--chart-4)",
              },
            ]}
            line={{
              key: "balance",
              label: "Saldo",
              color: "var(--foreground)",
            }}
          />
          <DataTable
            caption="Exportaciones, importaciones y saldo comercial por mes, en millones de US$"
            columns={[
              { label: "Mes" },
              { label: "Exportaciones", numeric: true },
              { label: "Importaciones", numeric: true },
              { label: "Saldo", numeric: true },
            ]}
            rows={reversed(external.months).map((month) => [
              shortMonth(month.on),
              month.exports === null ? NO_DATA : amount(month.exports),
              month.imports === null ? NO_DATA : amount(month.imports),
              comparisonText(month.balance, (value) => signedAmount(value)),
            ])}
          />
        </>
      )}
    </DashboardBlock>
  );
}
