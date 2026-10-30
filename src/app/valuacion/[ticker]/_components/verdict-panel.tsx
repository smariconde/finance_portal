import { InfoTip } from "@/app/_components/info-tip";
import { EvidenceKindMark } from "@/app/valuacion/_components/run/data-marks";
import { CodeValue } from "@/app/valuacion/_components/run/field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ValuationResultMarket } from "@/modules/valuation/application/read-valuation-result";
import {
  formatAmount,
  formatCalendarDate,
} from "@/modules/valuation/domain/display-format";
import type {
  PeerMetric,
  PeerMetrics,
} from "@/modules/valuation/domain/peer-context";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";
import type {
  PriceZone,
  ValuationVerdict,
} from "@/modules/valuation/domain/valuation-verdict";

import { COMPARISON_GAP_COPY } from "./market-expectations";
import { PEER_NULL_COPY } from "./peer-context";

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
  below: "por debajo del valor",
  equal: "igual al valor",
  above: "por encima del valor",
} as const;

function RangeBar({
  verdict,
}: {
  verdict: Extract<ValuationVerdict, { status: "placed" }>;
}) {
  const { scale } = verdict;

  return (
    <div className="flex flex-col gap-2">
      {/* La barra es un dibujo: sus cifras están en los indicadores. */}
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

      <p
        aria-hidden="true"
        className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"
      >
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 border-background bg-foreground ring-1 ring-foreground" />
          precio
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-0.5 rounded-full bg-chart-1" />
          valor central
        </span>
        {verdict.bear === null || verdict.bull === null ? null : (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-5 rounded-full bg-chart-1/35" />
            rango pesimista–optimista
          </span>
        )}
      </p>
    </div>
  );
}

/** Un indicador de la cabecera: rótulo, cifra grande y una línea de apoyo. */
function Figure({
  label,
  value,
  note,
  info,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  info?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border bg-muted/30 px-3 py-2.5">
      <dt className="flex items-center gap-0.5 text-xs text-muted-foreground">
        {label}
        {info === undefined ? null : <InfoTip title={label}>{info}</InfoTip>}
      </dt>
      <dd className="numeric text-xl font-semibold tracking-tight">{value}</dd>
      {note === undefined ? null : (
        <dd className="text-xs text-muted-foreground">{note}</dd>
      )}
    </div>
  );
}

function multipleFigure(metric: PeerMetric | null): {
  value: string;
  note?: string;
} {
  if (metric === null) return { value: "—", note: "sin dato" };
  return metric.status === "value"
    ? { value: `${formatAmount(metric.value, { scale: 1 })}×` }
    : { value: "—", note: PEER_NULL_COPY[metric.reason] };
}

/**
 * El veredicto (`F6-17`): dónde queda el precio respecto de lo que vale la
 * empresa según el modelo. Desde `F6-28` se lee en indicadores —precio,
 * valor, precio sobre valor, P/E, EV/EBIT y rigor—, la barra y una línea; lo
 * didáctico queda detrás de ⓘ. Describe, no recomienda.
 */
export function VerdictPanel({
  run,
  verdict,
  market,
  attribution,
  multiples,
  rigorLabel,
}: {
  run: ValuationRun;
  verdict: ValuationVerdict;
  market: ValuationResultMarket;
  attribution: string | null;
  /** Los múltiplos de la propia corrida (`F6-19`); `null` sin contexto. */
  multiples: PeerMetrics | null;
  rigorLabel: string;
}) {
  const result = run.result;
  const currency = run.currency;
  const placed = verdict.status === "placed" ? verdict : null;
  const pe = multipleFigure(multiples?.priceToEarnings ?? null);
  const evEbit = multipleFigure(multiples?.enterpriseValueToEbit ?? null);

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <CardTitle as="h2">Precio contra valor</CardTitle>
            <InfoTip title="Cómo leer esta comparación">
              <p>
                Lo que pagaba el mercado el día de la valuación, al lado de lo
                que vale la empresa según el modelo. Es una lectura para
                aprender, no una recomendación ni un precio objetivo.
              </p>
              {run.input.derivedAssumptions ===
              undefined ? null : run.method === "normalized_fcff" ? (
                <p>
                  Es una empresa cíclica: el modelo lleva su margen al promedio
                  de su ciclo y hace crecer las ventas al ritmo de la economía.
                  El rango usa el peor y el mejor margen del ciclo, así que es
                  ancho a propósito. El modelo es experimental.
                </p>
              ) : (
                <p>
                  El modelo proyecta la historia sin sorpresas: su tendencia de
                  crecimiento, que se apaga hasta la tasa libre de riesgo, y el
                  margen del último año. No ve productos nuevos, así que en
                  empresas de calidad el valor suele quedar debajo del precio:
                  importa más lo que el precio exige.
                </p>
              )}
            </InfoTip>
          </div>
          <InfoTip title="Fuente" label="Fuente">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <EvidenceKindMark kind="reference_data" />
              Precio: cierre crudo de{" "}
              {attribution === null ? "la serie guardada" : attribution},
              descarga aceptada por el owner para uso personal.
            </p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <EvidenceKindMark kind="derived_by_rule" />
              Valor, rango y múltiplos: la corrida registrada.
            </p>
            <p className="flex flex-wrap gap-1">
              <CodeValue>{market.comparison.version}</CodeValue>
              <CodeValue>{verdict.version}</CodeValue>
            </p>
          </InfoTip>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Figure
            label="Precio"
            value={placed === null ? "—" : formatAmount(placed.price)}
            note={
              placed === null ? (
                "sin cierre comparable"
              ) : (
                <>
                  {currency} al{" "}
                  <time dateTime={placed.marketDate}>
                    {formatCalendarDate(placed.marketDate)}
                  </time>
                </>
              )
            }
          />
          <Figure
            label="Valor del modelo"
            value={result === null ? "—" : formatAmount(result.valuePerShare)}
            note={
              placed !== null && placed.bear !== null && placed.bull !== null
                ? `${formatAmount(placed.bear)}–${formatAmount(placed.bull)} ${currency}`
                : result === null
                  ? "corrida rechazada"
                  : `${currency} por acción`
            }
            info={
              <p>
                Valor por acción del caso central. Debajo, el rango entre el
                escenario pesimista y el optimista, que mueven crecimiento,
                margen y reinversión juntos.
              </p>
            }
          />
          <Figure
            label="Price / value"
            value={
              placed === null
                ? "—"
                : `${formatAmount(placed.priceToValue, { scale: 2 })}×`
            }
            note={
              placed === null
                ? undefined
                : placed.zone === null
                  ? RELATION_COPY[placed.relation]
                  : undefined
            }
            info={
              <p>
                Precio dividido valor. 1× es precio igual al valor; 2× es pagar
                el doble de lo que el modelo justifica.
              </p>
            }
          />
          <Figure
            label="P/E"
            value={pe.value}
            note={pe.note}
            info={
              <p>
                Capitalización sobre la ganancia neta reportada del año base de
                la corrida: cuántos años de ganancia actual paga el precio.
              </p>
            }
          />
          <Figure
            label="Adjusted EV/EBIT"
            value={evEbit.value}
            note={evEbit.note}
            info={
              <p>
                Valor de la empresa (capitalización + deuda + arrendamientos −
                caja) sobre el EBIT ajustado del modelo. No depende de cuánta
                deuda tenga.
              </p>
            }
          />
          <Figure
            label="Rigor"
            value={
              <a
                className="text-base underline underline-offset-4"
                href="#auditoria-rigor"
              >
                {rigorLabel}
              </a>
            }
            info={
              <p>
                Qué tan completos están los datos de la corrida. Un rigor más
                bajo pide leer el valor con más cuidado; el detalle está en la
                auditoría.
              </p>
            }
          />
        </dl>

        {result === null ? (
          <p className="text-sm text-muted-foreground">
            La corrida fue rechazada y no tiene valor por acción; el motivo está
            en la auditoría.
          </p>
        ) : placed === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            Sin comparación con el precio.{" "}
            {verdict.status === "unplaced"
              ? COMPARISON_GAP_COPY[verdict.reason]
              : null}
          </p>
        ) : (
          <>
            <RangeBar verdict={placed} />
            <p className="flex items-center gap-1 text-base font-medium text-pretty">
              El precio queda{" "}
              {placed.zone === null
                ? RELATION_COPY[placed.relation]
                : ZONE_COPY[placed.zone].place}
              .
              {placed.zone === null ? null : (
                <InfoTip title="Qué significa">
                  <p>{ZONE_COPY[placed.zone].meaning}</p>
                </InfoTip>
              )}
            </p>
          </>
        )}

        {market.latestClose === null ? null : (
          <p className="text-xs text-muted-foreground">
            Cierre posterior guardado:{" "}
            <span className="numeric">
              {formatAmount(market.latestClose.close)}{" "}
              {market.latestClose.currency}
            </span>{" "}
            al{" "}
            <time dateTime={market.latestClose.marketDate}>
              {formatCalendarDate(market.latestClose.marketDate)}
            </time>
            ; la corrida no lo vio. Volver a valuar mueve el corte.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
