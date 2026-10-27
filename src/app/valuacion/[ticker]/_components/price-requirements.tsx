import type { ReactNode } from "react";

import { EvidenceKindMark } from "@/app/valuacion/_components/run/data-marks";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ValuationResultMarket } from "@/modules/valuation/application/read-valuation-result";
import { formatAmount } from "@/modules/valuation/domain/display-format";
import type { DriverPlausibility } from "@/modules/valuation/domain/market-expectations";
import type {
  MarketImpliedContext,
  MarketImpliedReading,
} from "@/modules/valuation/domain/market-implied";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";

import { Concept } from "./concept";
import {
  AiReading,
  ImpliedTable,
  OUTLOOK_COPY,
  percent,
  READING_DRIVER,
  referenceFor,
} from "./market-expectations";

const STRONG = "numeric font-semibold";

/** Qué dice el 10-K del driver, en una línea, si la IA lo leyó. */
function filingLine(plausibility: DriverPlausibility | undefined): ReactNode {
  if (plausibility === undefined) return null;

  const supports = OUTLOOK_COPY[plausibility.reading.outlook];
  const verdict = {
    within: "lo exigido está dentro de eso.",
    above: "lo exigido está un escalón por encima.",
    far_above: "lo exigido está dos o más escalones por encima.",
    unreachable: "ningún valor de este supuesto alcanza el precio.",
    not_addressed: "el 10-K no habla de esto.",
    no_requirement: "no hay exigencia resuelta para comparar.",
  }[plausibility.verdict];

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <EvidenceKindMark kind="ai_proposal" />
      <span>
        El 10-K sostiene: {supports}; {verdict}
      </span>
    </span>
  );
}

/**
 * Una exigencia en palabras. Cada una mueve un solo supuesto con todo lo
 * demás igual a la corrida, así que se leen como alternativas, no como suma.
 */
function requirementOf(
  reading: MarketImpliedReading,
  context: MarketImpliedContext,
  currency: string,
  /** Una cíclica (`F6-18`): el margen de la corrida es el del ciclo. */
  cyclical: boolean,
): { headline: ReactNode; detail: string } | null {
  if (reading.status === "unavailable") return null;

  const reference = referenceFor(reading.driver, context);
  const unreachable = (subject: string) =>
    reading.status === "solved"
      ? ""
      : reading.status === "price_above_range"
        ? `Ni con ${subject} de ${percent(reading.bounds.upper)} alcanza: el valor llega a ${formatAmount(reading.closestValuePerShare)} ${currency}.`
        : `Aun con ${subject} de ${percent(reading.bounds.lower)} el valor queda en ${formatAmount(reading.closestValuePerShare)} ${currency}, encima del precio.`;

  switch (reading.driver) {
    case "revenue_growth":
      return {
        headline:
          reading.status === "solved" ? (
            <>
              Que las ventas crezcan{" "}
              <strong className={STRONG}>{percent(reading.implied)}</strong> por
              año durante cinco años.
            </>
          ) : (
            unreachable("un crecimiento")
          ),
        detail: `El modelo usa ${percent(reading.runValue)}. Lo que mostró la empresa: ${reference}.`,
      };
    case "ebit_margin":
      return {
        headline:
          reading.status === "solved" ? (
            <>
              O que el margen operativo pase a{" "}
              <strong className={STRONG}>{percent(reading.implied)}</strong> y
              se quede ahí.
            </>
          ) : (
            unreachable("un margen")
          ),
        detail: cyclical
          ? `El modelo lo lleva a ${percent(reading.runValue)}, el promedio de su ciclo.`
          : context.baseEbitMargin === null
            ? `El modelo usa ${percent(reading.runValue)}.`
            : `El modelo lo mantiene en ${percent(reading.runValue)}, el margen ajustado del último ejercicio.`,
      };
    case "terminal_return_on_capital":
      return {
        headline:
          reading.status === "solved" ? (
            <>
              O que, a largo plazo, cada dólar reinvertido rinda{" "}
              <strong className={STRONG}>{percent(reading.implied)}</strong> por
              año.
            </>
          ) : (
            <>
              A largo plazo, el retorno de lo que reinvierte no alcanza a
              explicarlo. {unreachable("un retorno sobre el capital")}
            </>
          ),
        detail:
          context.baseReturnOnCapital === null
            ? `El modelo usa ${percent(reading.runValue)}.`
            : `El modelo usa ${percent(reading.runValue)}; en el último ejercicio la empresa rindió ${percent(context.baseReturnOnCapital)} sobre su capital, ajustado.`,
      };
    case "discount_rate":
      return {
        headline:
          reading.status === "solved" ? (
            <>
              O aceptar ganar{" "}
              <strong className={STRONG}>{percent(reading.implied)}</strong> por
              año: es lo que rinde comprar a este precio si los flujos del
              modelo se cumplen.
            </>
          ) : (
            unreachable("una tasa")
          ),
        detail: `El modelo exige ${percent(context.wacc)} al principio y ${percent(context.terminalWacc)} a largo plazo, por el riesgo de esta empresa.`,
      };
  }
}

/**
 * ¿Qué tendría que pasar para que el precio tenga sentido? (`F6-17`). La
 * lectura en palabras del DCF inverso (ADR 0048) y de lo que sostiene el
 * 10-K (ADR 0050). La tabla técnica y las citas quedan a demanda.
 */
export function PriceRequirements({
  run,
  market,
}: {
  run: ValuationRun;
  market: ValuationResultMarket;
}) {
  const { implied, context, comparison } = market;

  if (implied.status !== "computed" || comparison.status !== "compared") {
    return null;
  }

  const plausibilityOf = (driver: MarketImpliedReading["driver"]) =>
    market.reading?.plausibility.find(
      (entry) => entry.driver === READING_DRIVER[driver],
    );
  // `valor ÷ precio − 1` negativo: el precio está por encima del valor.
  const above = comparison.valueToPrice.startsWith("-");

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle as="h2">
            ¿Qué tendría que pasar para pagar{" "}
            <span className="numeric">
              {formatAmount(comparison.price.close)} {run.currency}
            </span>
            ?
          </CardTitle>
          <EvidenceKindMark kind="derived_by_rule" />
        </div>
        <CardDescription className="max-w-prose">
          El mismo modelo, resuelto al revés: cuánto tendría que valer cada
          supuesto para que el valor dé exactamente el precio. Cada línea cambia
          uno solo y deja el resto igual, así que alcanza con una
          {above
            ? ", o con una mezcla más moderada de varias. Cuanto más lejos queda de lo que la empresa ya mostró, más optimismo hay en el precio."
            : ", o con una mezcla de varias. Acá el precio pide menos de lo que supone el modelo."}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <ol className="flex flex-col gap-4">
          {implied.readings.map((reading) => {
            const requirement = requirementOf(
              reading,
              context,
              run.currency,
              run.method === "normalized_fcff",
            );
            if (requirement === null) return null;

            return (
              <li
                key={reading.driver}
                className="flex flex-col gap-1.5 border-b pb-4 last:border-b-0 last:pb-0"
              >
                <p className="text-base text-pretty">{requirement.headline}</p>
                <p className="text-sm text-muted-foreground">
                  {requirement.detail}
                </p>
                {filingLine(plausibilityOf(reading.driver))}
              </li>
            );
          })}
        </ol>

        <div className="grid gap-3 sm:grid-cols-2">
          <Concept term="la tasa de descuento">
            Lo que un inversor pide ganar por año por poner su plata en esta
            empresa y no en algo sin riesgo. Cuanto más arriesgada, más alta, y
            más bajo el valor de hoy de sus flujos futuros. El modelo la arma
            con la tasa del Tesoro, la prima de riesgo del mercado y la
            sensibilidad de la acción al mercado (beta).
          </Concept>
          <Concept term="el retorno sobre el capital (ROIC)">
            Cuánta ganancia operativa, después de impuestos, genera cada dólar
            invertido en el negocio. Si es mayor que la tasa de descuento,
            crecer crea valor; si es igual, crecer no agrega nada.
          </Concept>
        </div>

        <details className="group rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            Ver la tabla técnica
          </summary>
          <div className="border-t p-3">
            <ImpliedTable run={run} market={market} />
          </div>
        </details>

        <details className="group rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            Leer lo que dice el 10-K, con citas
          </summary>
          <div className="border-t p-3">
            <AiReading reading={market.reading} run={run} />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
