/** Lo que una vela necesita de su fila para dibujarse. */
export type CandleRow = {
  /** `[mínimo, máximo]`: el rango que la barra de Recharts ocupa. */
  readonly range: readonly [number, number];
  readonly open: number;
  readonly close: number;
};

type ShapeProps = {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly payload?: CandleRow;
};

/**
 * Mecha de mínimo a máximo y cuerpo relleno de apertura a cierre. La dirección
 * también se nombra en la franja OHLC. Precio y volumen tienen su propia banda
 * X para que Recharts los centre sin repartir su ancho (diario y lecciones).
 */
export function CandleShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  payload,
}: ShapeProps) {
  if (payload === undefined || width <= 0) return null;
  const [low, high] = payload.range;
  const span = high - low;
  const at = (value: number) =>
    span === 0 ? y + height / 2 : y + ((high - value) / span) * height;
  const up = payload.close >= payload.open;
  const top = at(Math.max(payload.open, payload.close));
  const bottom = at(Math.min(payload.open, payload.close));
  const body = Math.max(Math.floor(width), 1);
  const center = x + width / 2;
  const doji = payload.close === payload.open;
  return (
    <g
      data-candle-direction={doji ? "flat" : up ? "up" : "down"}
      style={{
        color: doji
          ? "var(--muted-foreground)"
          : up
            ? "var(--candle-up)"
            : "var(--candle-down)",
      }}
    >
      <line
        x1={center}
        x2={center}
        y1={y}
        y2={y + height}
        stroke="currentColor"
        strokeWidth={1}
      />
      {doji ? (
        <line
          x1={center - body / 2}
          x2={center + body / 2}
          y1={top}
          y2={top}
          stroke="currentColor"
          strokeWidth={1.5}
        />
      ) : (
        <rect
          x={center - body / 2}
          y={top}
          width={body}
          height={Math.max(bottom - top, 1)}
          stroke="currentColor"
          strokeWidth={1}
          fill="currentColor"
        />
      )}
    </g>
  );
}
