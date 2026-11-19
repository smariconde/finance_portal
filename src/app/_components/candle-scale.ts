import { linearTicks } from "./chart-ticks";

/**
 * La escala de un gráfico de velas, como la separan TradingView o
 * lightweight-charts: el precio arriba y el volumen en una franja propia abajo,
 * para que las velas bajas no queden tapadas por las barras de volumen.
 */
export const VOLUME_SHARE = 0.2;
/** Las barras de volumen llenan esta parte de su franja; el resto es aire. */
const VOLUME_FILL = 0.85;

/**
 * El dominio del eje de precio, ajustado a los valores pedidos con un margen
 * —no a un número redondo: eso puede gastar un cuarto del alto en aire— y con
 * los ticks redondos adentro. Debajo, lo necesario para que ese rango quede
 * sobre la franja de volumen.
 */
export function candlePriceScale(
  values: readonly number[],
  { padding = 0.06, volumeShare = VOLUME_SHARE } = {},
): {
  readonly domain: [number, number];
  readonly ticks: number[];
  /** El rango de precio visible, sin la franja de volumen. */
  readonly price: readonly [number, number];
} {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { domain: [0, 1], ticks: [], price: [0, 1] };
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  const pad = (high - low) * padding || Math.abs(high) * 0.01 || 1;
  const bottom = low - pad;
  const top = high + pad;
  const ticks = linearTicks(bottom, top, 5).filter(
    (tick) => tick >= bottom && tick <= top,
  );
  const below = ((top - bottom) * volumeShare) / (1 - volumeShare);
  return { domain: [bottom - below, top], ticks, price: [bottom, top] };
}

/** El dominio del eje de volumen: la barra más alta ocupa casi toda su franja. */
export function candleVolumeDomain(
  volumes: readonly number[],
  volumeShare = VOLUME_SHARE,
): [number, number] {
  const max = Math.max(...volumes.filter(Number.isFinite), 1);
  return [0, max / (volumeShare * VOLUME_FILL)];
}
