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
 * Mecha de mínimo a máximo y cuerpo de apertura a cierre; hueco si cerró
 * arriba, lleno si cerró abajo, así que el color nunca es el único canal. Es la
 * forma de la barra `range` de un `ComposedChart` (diario y lecciones).
 */
export function CandleShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  payload,
}: ShapeProps) {
  if (payload === undefined) return null;
  const [low, high] = payload.range;
  const span = high - low;
  const at = (value: number) =>
    span === 0 ? y + height / 2 : y + ((high - value) / span) * height;
  const up = payload.close >= payload.open;
  const top = at(Math.max(payload.open, payload.close));
  const bottom = at(Math.min(payload.open, payload.close));
  const body = Math.max(width * 0.7, 1);
  const center = x + width / 2;
  return (
    <g
      className={
        up
          ? "text-emerald-600 dark:text-emerald-500"
          : "text-red-600 dark:text-red-500"
      }
    >
      <line
        x1={center}
        x2={center}
        y1={y}
        y2={y + height}
        stroke="currentColor"
        strokeWidth={1}
      />
      <rect
        x={center - body / 2}
        y={top}
        width={body}
        height={Math.max(bottom - top, 1)}
        stroke="currentColor"
        strokeWidth={1}
        fill={up ? "var(--card)" : "currentColor"}
      />
    </g>
  );
}
