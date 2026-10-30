import type { ReactNode } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import { EvidenceKindMark } from "@/app/valuacion/_components/run/data-marks";
import { CodeValue } from "@/app/valuacion/_components/run/field";
import { BRIDGE_LABELS } from "@/app/valuacion/_components/run/labels";
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
  displayMagnitude,
  formatAmount,
  formatCompactAmount,
  formatInMagnitude,
  formatPercent,
  formatShares,
} from "@/modules/valuation/domain/display-format";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";
import { valueChain } from "@/modules/valuation/domain/valuation-verdict";

import { ProjectionChart } from "./projection-chart";
import { ValueComposition } from "./value-composition";

const STRONG = "numeric font-semibold";

function pct(value: string, scale = 1): string {
  return formatPercent(value, { scale });
}

/**
 * Un paso de la cadena (`F6-28`): el título y sus cifras a la vista; la
 * explicación en palabras, detrás de ⓘ.
 */
function Step({
  index,
  title,
  figures,
  children,
}: {
  index: number;
  title: string;
  figures: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 gap-y-1">
      <span
        aria-hidden="true"
        className="numeric flex size-7 items-center justify-center rounded-full bg-muted text-sm font-medium"
      >
        {index}
      </span>
      <h3 className="flex items-center gap-0.5 self-center text-sm font-medium">
        {title}
        <InfoTip title={title}>{children}</InfoTip>
      </h3>
      <div className="col-start-2 flex flex-col gap-1 text-sm text-muted-foreground">
        {figures}
      </div>
    </li>
  );
}

/** Una cifra de un paso: rótulo apagado y valor destacado. */
function Fig({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span>
      {label}{" "}
      <span className="numeric font-medium text-foreground">{children}</span>
    </span>
  );
}

function Figs({ children }: { children: ReactNode }) {
  return <p className="flex flex-wrap gap-x-4 gap-y-0.5">{children}</p>;
}

/**
 * ¿Por qué el modelo da ese valor? (`F6-17`). La corrida contada como una
 * cadena de pasos en palabras, con las cifras del motor reducidas a una
 * lectura. Las tablas exactas siguen en la auditoría.
 */
export function ValueWalkthrough({ run }: { run: ValuationRun }) {
  const result = run.result;
  if (result === null) return null;

  const chain = valueChain(result);
  // Una cíclica (`F6-18`) cuenta su margen contra el ciclo medido.
  const cycle = result.cycleComparison;
  const cycleMargins = (cycle?.annualMargins ?? []).map(Number);
  const cycleLow =
    cycle === undefined
      ? null
      : cycle.annualMargins[cycleMargins.indexOf(Math.min(...cycleMargins))]!;
  const cycleHigh =
    cycle === undefined
      ? null
      : cycle.annualMargins[cycleMargins.indexOf(Math.max(...cycleMargins))]!;
  const currency = run.currency;
  const periods = run.input.periods;
  const first = periods[0]!;
  const last = periods.at(-1)!;
  const terminal = run.input.terminal;
  const holdYears = periods.findIndex(
    (period) => period.revenueGrowth !== first.revenueGrowth,
  );
  const compact = (value: string) =>
    `${formatCompactAmount(value)} ${currency}`;
  const failure = chain.failureProbability;
  const bridge = chain.bridge.filter((item) => item.value !== "0");
  const projection = result.periods;
  const projectionMagnitude = displayMagnitude(
    projection.flatMap((period) => [period.fcff, period.presentValue]),
  );
  const projectionUnit =
    projectionMagnitude.unit === null
      ? currency
      : `${projectionMagnitude.unit} de ${currency}`;
  const inProjection = (value: string) =>
    formatInMagnitude(value, projectionMagnitude, { scale: 1 });

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle as="h2">
            Por qué el modelo da{" "}
            <span className="numeric">
              {formatAmount(result.valuePerShare)} {currency}
            </span>
          </CardTitle>
          <EvidenceKindMark kind="derived_by_rule" />
        </div>
        <CardDescription className="flex items-center gap-0.5">
          Seis pasos, de las ventas al valor por acción.
          <InfoTip title="El DCF (flujo de caja descontado)">
            <p>
              Una empresa vale la caja que va a generar de acá en adelante,
              traída a valor de hoy con una tasa que refleja su riesgo, menos
              sus deudas. Es el método de Aswath Damodaran.
            </p>
            <p>
              Todos los supuestos salen de una regla aplicada a lo que la
              empresa ya reportó; ninguno lo escribió una persona.
            </p>
          </InfoTip>
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/*
         * Los dibujos van a la derecha de los pasos y los acompañan al
         * desplazar: la columna de texto es angosta a propósito (65–75
         * caracteres) y sin esto la mitad de la card quedaba vacía.
         */}
        <div className="flex min-w-0 flex-col gap-8 xl:sticky xl:top-20 xl:col-start-2 xl:row-start-1 xl:self-start">
          <figure className="flex min-w-0 flex-col gap-3">
            <figcaption className="flex flex-col gap-0.5">
              <h3 className="text-sm font-medium">De dónde sale el valor</h3>
              <span className="text-xs text-muted-foreground">
                {currency}, valor de hoy. Cada fila suma o resta sobre la
                anterior.
              </span>
            </figcaption>
            <ValueComposition chain={chain} currency={currency} />
          </figure>

          <figure className="flex min-w-0 flex-col gap-3">
            <figcaption className="flex flex-col gap-0.5">
              <h3 className="text-sm font-medium">FCFF de cada año y su PV</h3>
              <span className="text-xs text-muted-foreground">
                {projectionUnit}. La diferencia entre las dos barras es el
                descuento, que crece con los años.
              </span>
            </figcaption>
            <ProjectionChart
              label={`Flujo de caja libre proyectado: ${compact(chain.firstYear.fcff)} en el año 1 y ${compact(chain.lastYear.fcff)} en el año ${chain.explicitYears}. Traídos a hoy, los ${chain.explicitYears} años suman ${compact(chain.explicitPresentValue)}.`}
              years={projection.map((period) => ({
                year: `Año ${period.periodIndex}`,
                fcff: Number(period.fcff) / 10 ** projectionMagnitude.exponent,
                presentValue:
                  Number(period.presentValue) /
                  10 ** projectionMagnitude.exponent,
              }))}
            />
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-xs bg-chart-1/45"
                />
                FCFF del año
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-xs bg-chart-2"
                />
                PV: ese flujo, valuado hoy
              </span>
            </div>
            <details className="group text-sm">
              <summary className="w-fit text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Las cifras por año
              </summary>
              <Table containerLabel="Proyección por año, tabla desplazable">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Año</TableHead>
                    <TableHead scope="col" className="text-right">
                      Revenue
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      FCFF
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      PV
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projection.map((period) => (
                    <TableRow key={period.periodIndex}>
                      <TableHead scope="row" className="font-normal">
                        {period.periodIndex}
                      </TableHead>
                      <TableCell className="numeric text-right">
                        {inProjection(period.revenue)}
                      </TableCell>
                      <TableCell className="numeric text-right">
                        {inProjection(period.fcff)}
                      </TableCell>
                      <TableCell className="numeric text-right">
                        {inProjection(period.presentValue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-1 text-xs text-muted-foreground">
                En {projectionUnit}.
              </p>
            </details>
          </figure>
        </div>

        <ol className="flex flex-col gap-5 xl:col-start-1 xl:row-start-1">
          <Step
            index={1}
            title="Proyecta las ventas"
            figures={
              <Figs>
                <Fig label="Revenue growth">
                  {pct(first.revenueGrowth)}
                  {first.revenueGrowth === last.revenueGrowth
                    ? ""
                    : ` → ${pct(last.revenueGrowth)}`}
                </Fig>
                <Fig label="Revenue año 1">
                  {compact(chain.firstYear.revenue)}
                </Fig>
                <Fig label={`Año ${chain.explicitYears}`}>
                  {compact(chain.lastYear.revenue)}
                </Fig>
              </Figs>
            }
          >
            {cycle === undefined ? (
              <p>
                Parte de las ventas del último ejercicio y las hace crecer{" "}
                <strong className={STRONG}>{pct(first.revenueGrowth)}</strong>{" "}
                por año
                {holdYears > 0 ? ` durante ${holdYears} años` : ""}, la
                tendencia de su historia. Después el crecimiento se apaga hasta{" "}
                <strong className={STRONG}>{pct(last.revenueGrowth)}</strong> en
                el año {chain.explicitYears}, porque ninguna empresa crece más
                rápido que la economía para siempre.
              </p>
            ) : (
              <p>
                Parte de las ventas del último ejercicio y las hace crecer{" "}
                <strong className={STRONG}>{pct(first.revenueGrowth)}</strong>{" "}
                por año desde el primero, al ritmo de la economía. En una
                empresa cíclica, unos pocos años de ventas miden el ciclo —un
                piso o un pico— y no un crecimiento que vaya a seguir.
              </p>
            )}
            <p>
              Revenue del año 1: {compact(chain.firstYear.revenue)}. Del año{" "}
              {chain.explicitYears}: {compact(chain.lastYear.revenue)}.
            </p>
          </Step>

          <Step
            index={2}
            title="Calcula cuánto gana con esas ventas"
            figures={
              <Figs>
                {cycle === undefined ? (
                  <Fig label="EBIT margin">
                    {pct(first.ebitMargin)}
                    {first.ebitMargin === last.ebitMargin
                      ? ""
                      : ` → ${pct(last.ebitMargin)}`}
                  </Fig>
                ) : (
                  <Fig label="EBIT margin hoy → ciclo">
                    {pct(cycle.currentMargin)} → {pct(cycle.historicalMargin)}
                  </Fig>
                )}
                <Fig label="EBIT año 1">{compact(chain.firstYear.ebit)}</Fig>
              </Figs>
            }
          >
            {cycle === undefined ? (
              <p>
                Aplica un EBIT margin (margen operativo) de{" "}
                <strong className={STRONG}>{pct(first.ebitMargin)}</strong>, el
                del último ejercicio ajustado, y lo mantiene{" "}
                {first.ebitMargin === last.ebitMargin
                  ? "todos los años"
                  : `hasta ${pct(last.ebitMargin)}`}
                . EBIT del año 1: {compact(chain.firstYear.ebit)}.
              </p>
            ) : (
              <>
                <p>
                  Hoy la empresa gana{" "}
                  <strong className={STRONG}>{pct(cycle.currentMargin)}</strong>{" "}
                  de cada venta. En los {cycle.annualMargins.length} ejercicios
                  medidos ganó entre {pct(cycleLow!)} y {pct(cycleHigh!)}, con
                  un promedio de{" "}
                  <strong className={STRONG}>
                    {pct(cycle.historicalMargin)}
                  </strong>
                  . El modelo supone que el ciclo vuelve a ese promedio en{" "}
                  {run.input.cycleNormalization?.convergenceYears ?? "—"} años:
                  no extrapola ni un pico ni un valle.
                </p>
                <p>
                  Si el margen de hoy se mantuviera para siempre, el valor sería{" "}
                  <strong className={STRONG}>
                    {formatAmount(cycle.currentMarginValuePerShare)} {currency}
                  </strong>{" "}
                  por acción. EBIT del año 1: {compact(chain.firstYear.ebit)}.
                </p>
              </>
            )}
          </Step>

          <Step
            index={3}
            title="Resta impuestos y lo que reinvierte"
            figures={
              <Figs>
                <Fig label="Tax rate">
                  {pct(first.taxRate)} → {pct(terminal.taxRate)}
                </Fig>
                <Fig label="FCFF año 1">{compact(chain.firstYear.fcff)}</Fig>
                <Fig label={`Año ${chain.explicitYears}`}>
                  {compact(chain.lastYear.fcff)}
                </Fig>
              </Figs>
            }
          >
            <p>
              Para crecer, la empresa tiene que invertir: el modelo resta esa
              reinversión y los impuestos (de {pct(first.taxRate)} a{" "}
              {pct(terminal.taxRate)}). Lo que queda es el FCFF (flujo de caja
              libre de la empresa): {compact(chain.firstYear.fcff)} en el año 1
              y {compact(chain.lastYear.fcff)} en el año {chain.explicitYears}.
            </p>
          </Step>

          <Step
            index={4}
            title="Trae esos flujos a valor de hoy"
            figures={
              <Figs>
                <Fig label="WACC">
                  {pct(first.wacc, 2)} → {pct(terminal.wacc, 2)}
                </Fig>
                <Fig label={`PV de los ${chain.explicitYears} años`}>
                  {compact(chain.explicitPresentValue)}
                </Fig>
              </Figs>
            }
          >
            <p>
              Un dólar dentro de diez años vale menos que uno hoy. El modelo
              descuenta cada año con un WACC de{" "}
              <strong className={STRONG}>{pct(first.wacc, 2)}</strong> que baja
              a <strong className={STRONG}>{pct(terminal.wacc, 2)}</strong> a
              largo plazo. Los {chain.explicitYears} años valen hoy{" "}
              {compact(chain.explicitPresentValue)}.
            </p>
          </Step>

          <Step
            index={5}
            title="Suma lo que viene después"
            figures={
              <Figs>
                <Fig label="Terminal growth">{pct(terminal.growth)}</Fig>
                <Fig label="Terminal value">
                  {compact(chain.terminalPresentValue)}
                  {result.terminalValueShare === null
                    ? ""
                    : ` (${pct(result.terminalValueShare, 0)} del EV)`}
                </Fig>
                <Fig label="EV">{compact(chain.enterpriseValue)}</Fig>
              </Figs>
            }
          >
            <p>
              Después del año {chain.explicitYears} supone que la empresa sigue
              creciendo{" "}
              <strong className={STRONG}>{pct(terminal.growth)}</strong> por año
              para siempre. Ese terminal value (valor terminal) vale hoy{" "}
              {compact(chain.terminalPresentValue)}
              {result.terminalValueShare === null ? (
                "."
              ) : (
                <>
                  :{" "}
                  <strong className={STRONG}>
                    {pct(result.terminalValueShare, 0)}
                  </strong>{" "}
                  del valor de la empresa. Por eso pequeños cambios en la tasa o
                  en ese crecimiento mueven mucho el resultado: es donde más
                  pesa un supuesto equivocado.
                </>
              )}
            </p>
            {failure === "0" ? null : (
              <p>
                Le resta una probabilidad de quiebra de {pct(failure, 2)}, según
                la calificación de su deuda.
              </p>
            )}
            <p>
              Enterprise value (EV, el valor de las operaciones):{" "}
              <strong className={STRONG}>
                {compact(chain.enterpriseValue)}
              </strong>
              .
            </p>
          </Step>

          <Step
            index={6}
            title="Pasa de la empresa a sus acciones"
            figures={
              <>
                <ul className="flex flex-col gap-0.5">
                  {bridge.map((item) => (
                    <li key={item.key} className="numeric flex gap-2">
                      <span aria-hidden="true" className="w-3 text-foreground">
                        {item.sign === "add" ? "+" : "−"}
                      </span>
                      <span>
                        <span className="sr-only">
                          {item.sign === "add" ? "suma " : "resta "}
                        </span>
                        {BRIDGE_LABELS[item.key]}: {compact(item.value)}
                      </span>
                    </li>
                  ))}
                </ul>
                <Figs>
                  <Fig label="Equity value">{compact(chain.equityValue)}</Fig>
                  <Fig label="÷ acciones">
                    {formatCompactAmount(chain.shareCount)}
                  </Fig>
                  <Fig label="=">
                    {formatAmount(chain.valuePerShare)} {currency}
                  </Fig>
                </Figs>
              </>
            }
          >
            <p>
              A lo que valen las operaciones le suma la caja y le resta lo que
              se debe a otros antes que a los accionistas. Lo que queda es el
              equity value, que se reparte entre las acciones.
            </p>
            <p>
              {formatShares(chain.shareCount)} acciones, contando las unidades
              de empleados todavía no consolidadas.
            </p>
          </Step>
        </ol>

        <p className="text-xs text-muted-foreground xl:col-span-2">
          Las tablas exactas de cada paso están en la auditoría.{" "}
          <CodeValue>{chain.version}</CodeValue>
        </p>
      </CardContent>
    </Card>
  );
}
