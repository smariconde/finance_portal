import { ChevronsRight, MousePointerClick } from "lucide-react";

/**
 * Piezas que las dos matrices de un sector comparten: la leyenda de las marcas
 * y el estado sin punto elegido. Una palabra por marca; cómo se lee el gráfico
 * va en el ⓘ de cada uno.
 */

/** Sin punto elegido: qué hacer, en una línea. */
export function PickPointHint() {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <MousePointerClick aria-hidden="true" className="size-4 shrink-0" />
      Elegí un punto o una fila
    </p>
  );
}

/** Logo con borde fino o punto hueco: sin CEDEAR. */
export function NoCedearLegend() {
  return (
    <li className="flex items-center gap-1.5">
      <svg aria-hidden="true" viewBox="0 0 34 16" className="h-4 w-[2.125rem]">
        <circle
          cx="8"
          cy="8"
          r="7"
          className="fill-muted stroke-foreground/25"
          strokeWidth="1"
        />
        <circle
          cx="27"
          cy="8"
          r="4.5"
          className="fill-background stroke-muted-foreground"
          strokeWidth="1.75"
        />
      </svg>
      Sin CEDEAR
    </li>
  );
}

/** Anillo grueso con insignia, o cuadrado: con CEDEAR. */
export function CedearLegend({ count }: { readonly count?: number }) {
  return (
    <li className="flex items-center gap-1.5">
      <svg aria-hidden="true" viewBox="0 0 34 16" className="h-4 w-[2.125rem]">
        <circle
          cx="8"
          cy="8"
          r="6.5"
          className="fill-muted stroke-[var(--chart-1)]"
          strokeWidth="2.5"
        />
        <rect
          x="10"
          y="10"
          width="5.5"
          height="5.5"
          rx="1"
          className="fill-[var(--chart-1)] stroke-background"
          strokeWidth="1"
        />
        <rect
          x="22.5"
          y="3.5"
          width="9"
          height="9"
          rx="1.5"
          className="fill-[var(--chart-1)]"
        />
      </svg>
      Con CEDEAR
      {count === undefined ? null : <span className="numeric">({count})</span>}
    </li>
  );
}

/** El chevron de un punto recortado, sólo si hay alguno. */
export function ClippedLegend() {
  return (
    <li className="flex items-center gap-1.5">
      <ChevronsRight className="size-3.5" aria-hidden="true" />
      Fuera de escala: valor en la tabla
    </li>
  );
}
