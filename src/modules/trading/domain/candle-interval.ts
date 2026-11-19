import {
  createDecimalOperations,
  sum,
} from "@/modules/numeric/domain/decimal-policy";

import type { Candle } from "./schwab-price-history";
import type { ChartResolution } from "./trade-chart";

/**
 * Velas de minutos reagrupadas en un intervalo más largo
 * (`candle-interval-1.0.0`), para el gráfico de un trade: con velas de 1 minuto
 * de una acción líquida la apertura y el cierre casi coinciden y el cuerpo no
 * se ve; en 5 o 15 minutos sí. Es una vista de las mismas velas, nunca otro
 * pedido a Schwab:
 *
 * - el intervalo empieza en un múltiplo de su largo contado desde la época, que
 *   cae en el cuarto de hora de Nueva York (sus husos son horas enteras), así
 *   que las 9:30 abren una vela de 5, 15 y 30 minutos;
 * - apertura de la primera vela, máximo y mínimo de todas, cierre de la última
 *   y volumen sumado, con el texto de la fuente; un hueco no se rellena: la vela agrupa lo que hay;
 * - cada vela original sabe a qué vela agrupada fue, para ubicar las ejecuciones.
 */
export const CANDLE_INTERVAL_VERSION = "candle-interval-1.0.0";

const LONGER_INTERVALS = [5, 15, 30] as const;

const { parseDecimal, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);
const PATH = "candle-interval";

/** Los intervalos que se pueden dibujar: el nativo y los múltiplos más largos. */
export function candleIntervalsOf(resolution: ChartResolution): number[] {
  if (resolution.kind === "daily") return [];
  return [
    resolution.minutes,
    ...LONGER_INTERVALS.filter(
      (minutes) =>
        minutes > resolution.minutes && minutes % resolution.minutes === 0,
    ),
  ];
}

export function aggregateCandles(
  candles: readonly Candle[],
  minutes: number,
): {
  readonly candles: Candle[];
  /** Por índice de vela original, el de su vela agrupada. */
  readonly indexOf: number[];
} {
  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new Error("A candle interval needs a whole number of minutes.");
  }
  const width = minutes * 60_000;
  const groups: Candle[][] = [];
  const starts: number[] = [];
  const indexOf: number[] = [];
  for (const candle of candles) {
    const start = Math.floor(candle.time / width) * width;
    if (starts.at(-1) !== start) {
      if (starts.length > 0 && start < starts.at(-1)!) {
        throw new Error("Candles must be in time order to be grouped.");
      }
      starts.push(start);
      groups.push([]);
    }
    groups.at(-1)!.push(candle);
    indexOf.push(groups.length - 1);
  }
  const parse = (value: string) => parseDecimal(value, PATH);
  return {
    candles: groups.map((group, index) => {
      // El texto de la fuente, nunca un número reescrito.
      const extreme = (key: "high" | "low") =>
        group
          .map((candle) => candle[key])
          .reduce((best, value) => {
            const comparison = parse(value).comparedTo(parse(best));
            return (key === "high" ? comparison > 0 : comparison < 0)
              ? value
              : best;
          });
      return {
        time: starts[index]!,
        open: group[0]!.open,
        high: extreme("high"),
        low: extreme("low"),
        close: group.at(-1)!.close,
        volume: formatDecimal(
          sum(group.map((candle) => parse(candle.volume))),
          PATH,
        ),
      };
    }),
    indexOf,
  };
}
