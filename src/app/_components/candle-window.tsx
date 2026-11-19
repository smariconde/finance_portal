"use client";

import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  CANDLE_PITCHES,
  DEFAULT_PITCH_LEVEL,
  candleWindowLayout,
} from "./candle-window-layout";

/** Cambia sólo qué filas se dibujan: no agrega, agrupa ni descarta OHLC. */
export function useCandleWindow(
  count: number,
  initialIndex: number,
  horizontalInsets: number,
) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [selection, setSelection] = useState({ index: initialIndex, start: 0 });
  const [level, setLevel] = useState(DEFAULT_PITCH_LEVEL);

  useEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry?.contentRect.width ?? 0),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pitch = CANDLE_PITCHES[level]!;
  const { index, start, end, size, maxStart } = candleWindowLayout(
    count,
    selection.index,
    selection.start,
    width,
    horizontalInsets,
    pitch,
  );

  // Al conocer el ancho, la vela inicial (la entrada, la primera marca) queda
  // en el centro de la ventana, no pegada al borde.
  const centered = useRef(false);
  useEffect(() => {
    if (width === 0 || centered.current) return;
    centered.current = true;
    setSelection((current) => ({
      index: current.index,
      start: Math.max(current.index - Math.floor(size / 2), 0),
    }));
  }, [width, size]);

  const move = (next: number) => {
    const nextIndex = Math.min(Math.max(next, 0), Math.max(count - 1, 0));
    setSelection((current) =>
      current.index === nextIndex && current.start === start
        ? current
        : { index: nextIndex, start },
    );
  };
  const show = (next: number) => {
    const nextStart = Math.min(Math.max(next, 0), maxStart);
    setSelection({
      start: nextStart,
      index: Math.min(Math.max(index, nextStart), nextStart + size - 1),
    });
  };
  const canZoomIn = level < CANDLE_PITCHES.length - 1;
  // Alejar sirve mientras queden velas fuera de la ventana.
  const canZoomOut = level > 0 && size < count;
  /** Acerca (+1) o aleja (−1) con la vela elegida centrada. */
  const zoom = (direction: 1 | -1) => {
    if (direction === 1 ? !canZoomIn : !canZoomOut) return;
    const nextLevel = level + direction;
    const nextSize = candleWindowLayout(
      count,
      index,
      0,
      width,
      horizontalInsets,
      CANDLE_PITCHES[nextLevel]!,
    ).size;
    setLevel(nextLevel);
    setSelection({
      index,
      start: Math.max(index - Math.floor(nextSize / 2), 0),
    });
  };

  return {
    frame,
    width,
    index,
    start,
    end,
    size,
    count,
    move,
    show,
    zoom,
    canZoomIn,
    canZoomOut,
  };
}

export type CandleWindow = ReturnType<typeof useCandleWindow>;

/**
 * Las teclas comunes de un gráfico de velas: flechas y páginas recorren,
 * Inicio y Fin van a los extremos, `+` y `−` acercan y alejan.
 */
export function handleCandleKeys(
  event: React.KeyboardEvent,
  view: CandleWindow,
) {
  const step: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    PageUp: -10,
    PageDown: 10,
  };
  if (event.key in step) {
    event.preventDefault();
    view.move(view.index + step[event.key]!);
  } else if (event.key === "Home") {
    event.preventDefault();
    view.move(0);
  } else if (event.key === "End") {
    event.preventDefault();
    view.move(view.count - 1);
  } else if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    view.zoom(1);
  } else if (event.key === "-") {
    event.preventDefault();
    view.zoom(-1);
  }
}

export function CandleWindowControls({
  window: view,
}: {
  readonly window: CandleWindow;
}) {
  const windowed = view.size < view.count;
  const step = Math.max(Math.floor(view.size * 0.8), 1);
  const description = `Velas ${view.start + 1}–${view.end} de ${view.count}`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <div className="flex items-center" role="group" aria-label="Zoom">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Alejar: más velas"
          disabled={!view.canZoomOut}
          onClick={() => view.zoom(-1)}
        >
          <ZoomOut />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Acercar: velas más anchas"
          disabled={!view.canZoomIn}
          onClick={() => view.zoom(1)}
        >
          <ZoomIn />
        </Button>
      </div>
      {windowed ? (
        <>
          <span className="numeric whitespace-nowrap">{description}</span>
          <div className="flex min-w-32 flex-1 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Ver velas anteriores"
              disabled={view.start === 0}
              onClick={() => view.show(view.start - step)}
            >
              <ChevronLeft />
            </Button>
            <input
              type="range"
              min={0}
              max={view.count - view.size}
              step={1}
              value={view.start}
              onChange={(event) => view.show(Number(event.target.value))}
              aria-label="Ventana de velas"
              aria-valuetext={description}
              className="h-6 min-w-0 flex-1 accent-primary outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Ver velas siguientes"
              disabled={view.end === view.count}
              onClick={() => view.show(view.start + step)}
            >
              <ChevronRight />
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
