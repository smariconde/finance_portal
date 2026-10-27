import { EvidenceKindMark } from "@/app/valuacion/_components/run/data-marks";
import { CodeValue } from "@/app/valuacion/_components/run/field";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ValuationResultMarket } from "@/modules/valuation/application/read-valuation-result";
import {
  formatAmount,
  formatCalendarDate,
} from "@/modules/valuation/domain/display-format";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";
import type {
  PriceZone,
  ValuationVerdict,
} from "@/modules/valuation/domain/valuation-verdict";

import { COMPARISON_GAP_COPY } from "./market-expectations";

/** Qué significa cada ubicación. Describe, no recomienda. */
const ZONE_COPY: Record<PriceZone, { place: string; meaning: string }> = {
  below_bear: {
    place: "por debajo incluso del escenario pesimista",
    meaning:
      "El mercado paga menos de lo que vale la empresa si las cosas salen peor que en su historia. O espera algo peor de lo que muestran los números, o el modelo no está viendo un riesgo. Vale la pena buscar cuál de las dos.",
  },
  bear_to_base: {
    place: "entre el escenario pesimista y el valor central",
    meaning:
      "El precio queda dentro del rango que el modelo considera razonable, del lado prudente: el mercado no paga más de lo que justifica la historia de la empresa.",
  },
  base_to_bull: {
    place: "entre el valor central y el escenario optimista",
    meaning:
      "El precio queda dentro del rango del modelo, del lado optimista: el mercado paga algo más que el caso central, pero no más de lo que la mejor parte de la historia sostiene.",
  },
  above_bull: {
    place: "por encima del escenario optimista",
    meaning:
      "Para que este precio tenga sentido, el futuro tiene que ser mejor que el mejor escenario que el modelo arma con la historia de la empresa. La sección siguiente dice cuánto mejor.",
  },
};

const RELATION_COPY = {
  below: "por debajo",
  equal: "igual",
  above: "por encima",
} as const;

function RangeBar({
  verdict,
  currency,
}: {
  verdict: Extract<ValuationVerdict, { status: "placed" }>;
  currency: string;
}) {
  const { scale } = verdict;

  return (
    <div className="flex flex-col gap-3">
      {/* La barra es un dibujo: lo que dice está escrito arriba y abajo. */}
      <div aria-hidden="true" className="relative h-14">
        <div className="absolute top-9 right-0 left-0 h-2 rounded-full bg-muted" />
        {scale.bear === null || scale.bull === null ? null : (
          <div
            className="absolute top-9 h-2 rounded-full bg-chart-1/35"
            style={{
              left: `${scale.bear}%`,
              width: `${scale.bull - scale.bear}%`,
            }}
          />
        )}
        <div
          className="absolute top-7 h-6 w-0.5 -translate-x-1/2 rounded-full bg-chart-1"
          style={{ left: `${scale.value}%` }}
        />
        {/* Cerca de un borde, el rótulo se alinea hacia adentro. */}
        <span
          className={`numeric absolute top-0 text-xs font-medium whitespace-nowrap ${
            scale.price > 75
              ? "-translate-x-full"
              : scale.price < 25
                ? ""
                : "-translate-x-1/2"
          }`}
          style={{ left: `${scale.price}%` }}
        >
          Precio {formatAmount(verdict.price)}
        </span>
        <span
          className="absolute top-[1.875rem] size-3.5 -translate-x-1/2 rounded-full border-2 border-background bg-foreground ring-1 ring-foreground"
          style={{ left: `${scale.price}%` }}
        />
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <dt className="flex items-center gap-2 text-muted-foreground">
            <span
              aria-hidden="true"
              className="size-3 rounded-full border-2 border-background bg-foreground ring-1 ring-foreground"
            />
            Precio al{" "}
            <time dateTime={verdict.marketDate}>
              {formatCalendarDate(verdict.marketDate)}
            </time>
          </dt>
          <dd className="numeric font-medium">
            {formatAmount(verdict.price)} {currency}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="flex items-center gap-2 text-muted-foreground">
            <span
              aria-hidden="true"
              className="h-4 w-0.5 rounded-full bg-chart-1"
            />
            Valor central del modelo
          </dt>
          <dd className="numeric font-medium">
            {formatAmount(verdict.value)} {currency}
          </dd>
        </div>
        {verdict.bear === null || verdict.bull === null ? null : (
          <div className="flex items-center gap-2">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span
                aria-hidden="true"
                className="h-2 w-5 rounded-full bg-chart-1/35"
              />
              Rango pesimista–optimista
            </dt>
            <dd className="numeric font-medium">
              {formatAmount(verdict.bear)} – {formatAmount(verdict.bull)}{" "}
              {currency}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/**
 * El veredicto (`F6-17`): dónde queda el precio respecto de lo que vale la
 * empresa según el modelo, en una frase, un dibujo y su significado. Es lo
 * primero que se lee; el resto de la página explica por qué.
 */
export function VerdictPanel({
  run,
  verdict,
  market,
  attribution,
}: {
  run: ValuationRun;
  verdict: ValuationVerdict;
  market: ValuationResultMarket;
  attribution: string | null;
}) {
  const result = run.result;
  const currency = run.currency;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Precio contra valor</CardTitle>
        <CardDescription>
          Lo que pagaba el mercado el día de la valuación, al lado de lo que
          vale la empresa según el modelo. Es una lectura para aprender, no una
          recomendación ni un precio objetivo.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {result === null ? (
          <p className="max-w-prose text-base">
            La corrida fue rechazada y no tiene valor por acción, así que no hay
            nada contra qué comparar el precio. El motivo está en la auditoría,
            al final de la página.
          </p>
        ) : verdict.status === "unplaced" ? (
          <div className="flex max-w-prose flex-col gap-2">
            <p className="text-base">
              El modelo le asigna{" "}
              <strong className="numeric font-semibold">
                {formatAmount(result.valuePerShare)} {currency}
              </strong>{" "}
              por acción.
            </p>
            <p className="text-sm text-muted-foreground" role="status">
              Sin comparación con el precio.{" "}
              {COMPARISON_GAP_COPY[verdict.reason]}
            </p>
          </div>
        ) : (
          <>
            <p className="max-w-prose text-base text-pretty md:text-lg">
              El{" "}
              <time dateTime={verdict.marketDate}>
                {formatCalendarDate(verdict.marketDate)}
              </time>{" "}
              la acción cotizaba a{" "}
              <strong className="numeric font-semibold">
                {formatAmount(verdict.price)} {currency}
              </strong>{" "}
              y el modelo le asigna{" "}
              <strong className="numeric font-semibold">
                {formatAmount(verdict.value)} {currency}
              </strong>
              . El precio es{" "}
              <strong className="numeric font-semibold">
                {formatAmount(verdict.priceToValue, { scale: 2 })} veces
              </strong>{" "}
              el valor
              {verdict.zone === null
                ? ` y queda ${RELATION_COPY[verdict.relation]} de él.`
                : ` y queda ${ZONE_COPY[verdict.zone].place}.`}
            </p>

            <RangeBar verdict={verdict} currency={currency} />

            {verdict.zone === null ? null : (
              <p className="max-w-prose text-sm">
                {ZONE_COPY[verdict.zone].meaning}
              </p>
            )}
          </>
        )}

        {run.input.derivedAssumptions === undefined ? null : (
          <p className="max-w-prose rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              Cómo leer esta comparación.
            </span>{" "}
            {run.method === "normalized_fcff" ? (
              <>
                Es una empresa cíclica: el modelo lleva su margen al promedio de
                los ejercicios medidos y hace crecer las ventas al ritmo de la
                economía, en vez de extrapolar el momento del ciclo en que está
                hoy. El rango pesimista–optimista usa el peor y el mejor margen
                de ese ciclo, así que es ancho a propósito. El modelo es
                experimental y la corrida queda para revisar.
              </>
            ) : (
              <>
                El modelo proyecta la historia de la empresa sin sorpresas: el
                crecimiento de su tendencia, que se apaga hasta la tasa libre de
                riesgo, y el margen del último año. No sabe de productos nuevos
                ni de mejoras que todavía no se ven en los números. Por eso, en
                empresas que el mercado considera de calidad, el valor suele
                quedar debajo del precio. La brecha importa menos que lo que el
                precio exige, que está en la sección siguiente.
              </>
            )}
          </p>
        )}

        {market.latestClose === null ? null : (
          <p className="text-sm text-muted-foreground">
            Hay un cierre posterior guardado:{" "}
            {formatAmount(market.latestClose.close)}{" "}
            {market.latestClose.currency} al{" "}
            <time dateTime={market.latestClose.marketDate}>
              {formatCalendarDate(market.latestClose.marketDate)}
            </time>
            . La corrida no lo vio y no se compara; volver a valuar mueve el
            corte.
          </p>
        )}

        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <EvidenceKindMark kind="reference_data" />
          Precio: cierre crudo de{" "}
          {attribution === null ? "la serie guardada" : attribution}, descarga
          aceptada por el owner para uso personal.
          <EvidenceKindMark kind="derived_by_rule" />
          Valor y rango: la corrida registrada.
          <CodeValue>{market.comparison.version}</CodeValue>
          <CodeValue>{verdict.version}</CodeValue>
        </p>
      </CardContent>
    </Card>
  );
}
