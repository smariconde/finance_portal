/**
 * Los anchos por vela del zoom, en píxeles: de alejar (muchas velas finas) a
 * acercar (pocas velas con cuerpo), como la rueda de TradingView.
 */
export const CANDLE_PITCHES = [6, 10, 16, 26] as const;
export const DEFAULT_PITCH_LEVEL = 1;

/** Índices de la ventana, sin alterar las filas ni su frecuencia. */
export function candleWindowLayout(
  count: number,
  selectedIndex: number,
  requestedStart: number,
  width: number,
  horizontalInsets: number,
  pitch: number = CANDLE_PITCHES[DEFAULT_PITCH_LEVEL],
) {
  if (count === 0) return { index: 0, start: 0, end: 0, size: 0, maxStart: 0 };
  const size = Math.min(
    count,
    Math.max(1, Math.floor(((width || 720) - horizontalInsets) / pitch)),
  );
  const index = Math.min(Math.max(selectedIndex, 0), Math.max(count - 1, 0));
  const maxStart = Math.max(count - size, 0);
  const candidate = Math.min(Math.max(requestedStart, 0), maxStart);
  const start =
    index < candidate
      ? index
      : index >= candidate + size
        ? Math.max(index - size + 1, 0)
        : candidate;
  return { index, start, end: Math.min(start + size, count), size, maxStart };
}
