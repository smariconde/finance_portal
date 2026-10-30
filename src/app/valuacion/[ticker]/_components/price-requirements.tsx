import type { ReactNode } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import { EvidenceKindMark } from "@/app/valuacion/_components/run/data-marks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ValuationResultMarket } from "@/modules/valuation/application/read-valuation-result";
import { formatAmount } from "@/modules/valuation/domain/display-format";
import type { DriverPlausibility } from "@/modules/valuation/domain/market-expectations";
import type {
  MarketImpliedContext,
  MarketImpliedReading,
} from "@/modules/valuation/domain/market-implied";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";

import {
  AiReading,
  ImpliedTable,
  OUTLOOK_COPY,
  percent,
  READING_DRIVER,
} from "./market-expectations";
import { requirementScale, type RequirementMarks } from "./requirement-scale";

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
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <EvidenceKindMark kind="ai_proposal" />
      <span>
        El 10-K sostiene: {supports}; {verdict}
      </span>
    </span>
  );
}

type Requirement = {
  /** El término estándar en inglés primero (`financial-terms.ts`). */
  readonly label: string;
  readonly definition: ReactNode;
  /** Lo exigido, en pocas palabras, a la derecha del rótulo. */
  readonly headline: ReactNode;
  readonly marks: RequirementMarks;
  /** La barra en texto: es su equivalente accesible. */
  readonly legend: readonly { glyph: string; text: string }[];
};

/**
 * Una exigencia (`F6-28`): rótulo, cifra exigida y una barra con lo que mostró
 * la empresa, lo que usa el modelo y lo que exige el precio. Cada una mueve un
 * solo supuesto con todo lo demás igual a la corrida, así que se leen como
 * alternativas, no como suma.
 */
function requirementOf(
  reading: MarketImpliedReading,
  context: MarketImpliedContext,
  currency: string,
  /** Una cíclica (`F6-18`): el margen de la corrida es el del ciclo. */
  cyclical: boolean,
): Requirement | null {
  if (reading.status === "unavailable") return null;

  // Fuera del intervalo, la marca queda en el borde que se probó.
  const required =
    reading.status === "solved"
      ? reading.implied
      : reading.status === "price_above_range"
        ? reading.bounds.upper
        : reading.bounds.lower;
  const headline =
    reading.status === "solved" ? (
      <>
        exige <strong className={STRONG}>{percent(reading.implied)}</strong>
      </>
    ) : reading.status === "price_above_range" ? (
      <>
        ni con <strong className={STRONG}>{percent(required)}</strong> alcanza
      </>
    ) : (
      <>
        aun con <strong className={STRONG}>{percent(required)}</strong> sobra
      </>
    );
  const requiredText =
    reading.status === "solved"
      ? `exige el precio ${percent(reading.implied)}`
      : `con ${percent(required)} el valor llega a ${formatAmount(reading.closestValuePerShare)} ${currency}`;

  switch (reading.driver) {
    case "revenue_growth": {
      const [longest, ...rest] = context.historicalGrowth;
      return {
        label: "Revenue growth",
        definition: (
          <p>
            Crecimiento anual de las ventas. Lo exigido rige durante los años 1
            a 5, con margen, reinversión y tasa iguales a la corrida.
          </p>
        ),
        headline,
        marks: {
          shown: longest?.cagr ?? null,
          model: reading.runValue,
          required,
        },
        legend: [
          {
            glyph: "●",
            text:
              longest === undefined
                ? "sin historia de ventas"
                : `mostró ${[longest, ...rest].map((entry) => `${percent(entry.cagr)} en ${entry.years} ${entry.years === 1 ? "año" : "años"}`).join(" · ")}`,
          },
          { glyph: "◆", text: `modelo ${percent(reading.runValue)}` },
          { glyph: "▲", text: requiredText },
        ],
      };
    }
    case "ebit_margin":
      return {
        label: "EBIT margin",
        definition: (
          <p>
            Ganancia operativa sobre ventas.{" "}
            {cyclical
              ? "En una cíclica el modelo usa el promedio de su ciclo."
              : "El modelo mantiene el margen ajustado del último ejercicio."}{" "}
            Lo exigido es el margen permanente que, solo, explica el precio.
          </p>
        ),
        headline,
        marks: {
          shown: context.baseEbitMargin,
          model: reading.runValue,
          required,
        },
        legend: [
          {
            glyph: "●",
            text:
              context.baseEbitMargin === null
                ? "sin margen ajustado del año base"
                : `mostró ${percent(context.baseEbitMargin)} ajustado`,
          },
          {
            glyph: "◆",
            text: `modelo ${percent(reading.runValue)}${cyclical ? ", promedio del ciclo" : ""}`,
          },
          { glyph: "▲", text: requiredText },
        ],
      };
    case "terminal_return_on_capital":
      return {
        label: "Terminal ROIC",
        definition: (
          <p>
            Cuánta ganancia operativa, después de impuestos, genera cada dólar
            invertido en el negocio, a largo plazo. Si es mayor que la tasa de
            descuento, crecer crea valor; si es igual, crecer no agrega nada.
          </p>
        ),
        headline,
        marks: {
          shown: context.baseReturnOnCapital,
          model: reading.runValue,
          required,
        },
        legend: [
          {
            glyph: "●",
            text:
              context.baseReturnOnCapital === null
                ? "sin ROIC ajustado del año base"
                : `mostró ${percent(context.baseReturnOnCapital)} ajustado`,
          },
          { glyph: "◆", text: `modelo ${percent(reading.runValue)}` },
          { glyph: "▲", text: requiredText },
        ],
      };
    case "discount_rate":
      return {
        label: "Discount rate",
        definition: (
          <p>
            Lo que un inversor pide ganar por año por esta empresa en vez de
            algo sin riesgo: tasa del Tesoro, prima del mercado y beta. Al
            revés, lo exigido es lo que <strong>rinde</strong> comprar a este
            precio si los flujos del modelo se cumplen.
          </p>
        ),
        headline:
          reading.status === "solved" ? (
            <>
              rinde{" "}
              <strong className={STRONG}>{percent(reading.implied)}</strong>
            </>
          ) : (
            headline
          ),
        marks: { shown: null, model: context.wacc, required },
        legend: [
          {
            glyph: "◆",
            text: `el modelo pide ${percent(context.wacc)} → ${percent(context.terminalWacc)}`,
          },
          {
            glyph: "▲",
            text:
              reading.status === "solved"
                ? `rinde a este precio ${percent(reading.implied)}`
                : requiredText,
          },
        ],
      };
  }
}

/** La barra de una exigencia. Es un dibujo: su texto está en la leyenda. */
function RequirementBar({ marks }: { marks: RequirementMarks }) {
  const scale = requirementScale(marks);

  return (
    <div aria-hidden="true" className="relative h-5">
      <div className="absolute top-2 right-0 left-0 h-1 rounded-full bg-muted" />
      {scale.zero > 0 ? (
        <div
          className="absolute top-0.5 h-4 w-px bg-border"
          style={{ left: `${scale.zero}%` }}
        />
      ) : null}
      {scale.model !== null && scale.required !== null ? (
        <div
          className="absolute top-2 h-1 rounded-full bg-chart-1/35"
          style={{
            left: `${Math.min(scale.model, scale.required)}%`,
            width: `${Math.abs(scale.required - scale.model)}%`,
          }}
        />
      ) : null}
      {scale.shown === null ? null : (
        <span
          className="absolute top-1 size-3 -translate-x-1/2 rounded-full border-2 border-background bg-muted-foreground"
          style={{ left: `${scale.shown}%` }}
        />
      )}
      {scale.model === null ? null : (
        <span
          className="absolute top-1 size-3 -translate-x-1/2 rotate-45 rounded-[2px] border-2 border-background bg-chart-1"
          style={{ left: `${scale.model}%` }}
        />
      )}
      {scale.required === null ? null : (
        <svg
          viewBox="0 0 14 12"
          className="absolute top-0.5 h-3.5 w-4 -translate-x-1/2 fill-foreground stroke-background"
          strokeWidth={1.5}
          style={{ left: `${scale.required}%` }}
        >
          <path d="M7 1 L13 11 L1 11 Z" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

/**
 * ¿Qué tendría que pasar para que el precio tenga sentido? (`F6-17`). El DCF
 * inverso (ADR 0048) dibujado por driver desde `F6-28`, con lo que sostiene
 * el 10-K (ADR 0050). La tabla técnica y las citas quedan a demanda.
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
          <InfoTip title="Cómo se lee">
            <p>
              El mismo modelo, resuelto al revés: cuánto tendría que valer cada
              supuesto para que el valor dé exactamente el precio.
            </p>
            <p>
              Cada línea cambia uno solo y deja el resto igual, así que alcanza
              con una
              {above
                ? ", o con una mezcla más moderada de varias. Cuanto más lejos queda ▲ de ●, más optimismo hay en el precio."
                : ", o con una mezcla de varias. Acá el precio pide menos de lo que supone el modelo."}
            </p>
          </InfoTip>
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span aria-hidden="true">● </span>mostró la empresa
          </span>
          <span>
            <span aria-hidden="true" className="text-chart-1">
              ◆{" "}
            </span>
            usa el modelo
          </span>
          <span>
            <span aria-hidden="true">▲ </span>exige el precio
          </span>
        </p>
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
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="flex items-center gap-0.5 font-medium">
                    {requirement.label}
                    <InfoTip title={requirement.label}>
                      {requirement.definition}
                    </InfoTip>
                  </span>
                  <span className="text-sm">{requirement.headline}</span>
                </div>
                <RequirementBar marks={requirement.marks} />
                <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {requirement.legend.map((entry) => (
                    <span key={entry.glyph}>
                      <span
                        aria-hidden="true"
                        className={entry.glyph === "◆" ? "text-chart-1" : ""}
                      >
                        {entry.glyph}{" "}
                      </span>
                      <span className="numeric">{entry.text}</span>
                    </span>
                  ))}
                </p>
                {filingLine(plausibilityOf(reading.driver))}
              </li>
            );
          })}
        </ol>

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
