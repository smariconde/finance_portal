"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { candleWindowLayout } from "./candle-window-layout";

/** Cambia sólo qué filas se dibujan: no agrega, agrupa ni descarta OHLC. */
export function useCandleWindow(
  count: number,
  initialIndex: number,
  horizontalInsets: number,
) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [selection, setSelection] = useState({ index: initialIndex, start: 0 });

  useEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry?.contentRect.width ?? 0),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { index, start, end, size, maxStart } = candleWindowLayout(
    count,
    selection.index,
    selection.start,
    width,
    horizontalInsets,
  );

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

  return { frame, width, index, start, end, size, count, move, show };
}

export function CandleWindowControls({
  window: view,
}: {
  readonly window: ReturnType<typeof useCandleWindow>;
}) {
  if (view.size >= view.count) return null;
  const step = Math.max(Math.floor(view.size * 0.8), 1);
  const description = `Velas ${view.start + 1}–${view.end} de ${view.count}`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
    </div>
  );
}
