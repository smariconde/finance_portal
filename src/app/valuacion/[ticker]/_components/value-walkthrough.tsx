import type { ReactNode } from "react";

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
  formatAmount,
  formatCompactAmount,
  formatPercent,
  formatShares,
} from "@/modules/valuation/domain/display-format";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";
import { valueChain } from "@/modules/valuation/domain/valuation-verdict";

import { Concept } from "./concept";

const STRONG = "numeric font-semibold";

function pct(value: string, scale = 1): string {
  return formatPercent(value, { scale });
}

function Step({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
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
      <h3 className="self-center text-sm font-medium">{title}</h3>
      <div className="col-start-2 flex max-w-prose flex-col gap-1.5 text-sm text-muted-foreground">
        {children}
      </div>
    </li>
  );
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
        <CardDescription className="max-w-prose">
          Una empresa vale la caja que va a generar de acá en adelante, traída a
          valor de hoy. El modelo lo calcula en seis pasos. Todos los supuestos
          salen de una regla aplicada a lo que la empresa ya reportó; ninguno lo
          escribió una persona.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <ol className="flex flex-col gap-5">
          <Step index={1} title="Proyecta las ventas">
            <p>
              Parte de las ventas del último ejercicio y las hace crecer{" "}
              <strong className={STRONG}>{pct(first.revenueGrowth)}</strong> por
              año
              {holdYears > 0 ? ` durante ${holdYears} años` : ""}, la tendencia
              de su historia. Después el crecimiento se apaga hasta{" "}
              <strong className={STRONG}>{pct(last.revenueGrowth)}</strong> en
              el año {chain.explicitYears}, porque ninguna empresa crece más
              rápido que la economía para siempre.
            </p>
            <p>
              Ventas del año 1: {compact(chain.firstYear.revenue)}. Del año{" "}
              {chain.explicitYears}: {compact(chain.lastYear.revenue)}.
            </p>
          </Step>

          <Step index={2} title="Calcula cuánto gana con esas ventas">
            <p>
              Aplica un margen operativo de{" "}
              <strong className={STRONG}>{pct(first.ebitMargin)}</strong>, el
              del último ejercicio ajustado, y lo mantiene{" "}
              {first.ebitMargin === last.ebitMargin
                ? "todos los años"
                : `hasta ${pct(last.ebitMargin)}`}
              . Ganancia operativa del año 1: {compact(chain.firstYear.ebit)}.
            </p>
          </Step>

          <Step index={3} title="Resta impuestos y lo que reinvierte">
            <p>
              Para crecer, la empresa tiene que invertir: el modelo resta esa
              reinversión y los impuestos (de {pct(first.taxRate)} a{" "}
              {pct(terminal.taxRate)}). Lo que queda es el flujo de caja libre:{" "}
              {compact(chain.firstYear.fcff)} en el año 1 y{" "}
              {compact(chain.lastYear.fcff)} en el año {chain.explicitYears}.
            </p>
          </Step>

          <Step index={4} title="Trae esos flujos a valor de hoy">
            <p>
              Un dólar dentro de diez años vale menos que uno hoy. El modelo
              descuenta cada año con una tasa de{" "}
              <strong className={STRONG}>{pct(first.wacc, 2)}</strong> que baja
              a <strong className={STRONG}>{pct(terminal.wacc, 2)}</strong> a
              largo plazo. Los {chain.explicitYears} años valen hoy{" "}
              {compact(chain.explicitPresentValue)}.
            </p>
          </Step>

          <Step index={5} title="Suma lo que viene después">
            <p>
              Después del año {chain.explicitYears} supone que la empresa sigue
              creciendo{" "}
              <strong className={STRONG}>{pct(terminal.growth)}</strong> por año
              para siempre. Ese «valor terminal» vale hoy{" "}
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
                  en ese crecimiento mueven mucho el resultado.
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
              Valor de las operaciones:{" "}
              <strong className={STRONG}>
                {compact(chain.enterpriseValue)}
              </strong>
              .
            </p>
          </Step>

          <Step index={6} title="Pasa de la empresa a sus acciones">
            <p>
              A lo que valen las operaciones le suma la caja y le resta lo que
              se debe a otros antes que a los accionistas:
            </p>
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
            <p>
              Queda para los accionistas{" "}
              <strong className={STRONG}>{compact(chain.equityValue)}</strong>,
              que repartido entre {formatCompactAmount(chain.shareCount)}{" "}
              acciones da{" "}
              <strong className={STRONG}>
                {formatAmount(chain.valuePerShare)} {currency}
              </strong>{" "}
              por acción.
            </p>
          </Step>
        </ol>

        <div className="grid gap-3 sm:grid-cols-2">
          <Concept term="el flujo de caja descontado">
            El método que usa la página. Proyecta cuánta caja va a generar el
            negocio, la trae a valor de hoy con una tasa que refleja su riesgo y
            le resta las deudas. Es el método de Aswath Damodaran.
          </Concept>
          <Concept term="el valor terminal">
            El valor de todos los años después del horizonte explícito,
            resumidos en una fórmula de crecimiento perpetuo. Suele ser la mayor
            parte del valor, y por eso es donde más pesa un supuesto equivocado.
          </Concept>
        </div>

        <p className="text-xs text-muted-foreground">
          {formatShares(chain.shareCount)} acciones, contando las unidades de
          empleados todavía no consolidadas. Las tablas exactas de cada paso
          están en la auditoría. <CodeValue>{chain.version}</CodeValue>
        </p>
      </CardContent>
    </Card>
  );
}
