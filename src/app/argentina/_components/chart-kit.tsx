"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import {
  amount,
  calendarDate,
  fractionAsPoints,
  points,
  shortMonth,
  signedAmount,
  signedPoints,
} from "./format";

/**
 * Cómo se escribe una cifra en la lectura y en la tabla. Va por nombre porque
 * un Server Component no puede pasarle funciones a uno cliente.
 */
export type ValueFormat =
  | { readonly kind: "amount"; readonly scale?: number }
  | { readonly kind: "signedAmount"; readonly scale?: number }
  /** Ya en puntos porcentuales: `1.9` es `1,9 %`. */
  | { readonly kind: "points"; readonly scale?: number }
  | { readonly kind: "signedPoints"; readonly scale?: number }
  /** Una fracción: `0.071` es `+7,1 %`. */
  | { readonly kind: "fraction"; readonly scale?: number };

export function formatValue(value: string | null, format: ValueFormat): string {
  if (value === null) return "Sin dato";
  switch (format.kind) {
    case "amount":
      return amount(value, format.scale ?? 0);
    case "signedAmount":
      return signedAmount(value, format.scale ?? 0);
    case "points":
      return points(value, format.scale ?? 1);
    case "signedPoints":
      return signedPoints(value, format.scale ?? 1);
    case "fraction":
      return fractionAsPoints(value, format.scale ?? 1);
  }
}

/** Formatos de eje: la cifra del tick, sin unidad, que la dice el título. */
export type AxisFormat =
  "index" | "decimal" | "points" | "pesos" | "millions" | "fraction";

const group = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});
const twoDecimals = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function axisLabel(format: AxisFormat, value: number): string {
  switch (format) {
    case "points":
      return `${oneDecimal.format(value)} %`;
    case "decimal":
      return Math.abs(value) < 10
        ? twoDecimals.format(value)
        : oneDecimal.format(value);
    case "fraction":
      return `${oneDecimal.format(value * 100)} %`;
    case "millions":
      return Math.abs(value) >= 1000
        ? `${oneDecimal.format(value / 1000)} mil`
        : group.format(value);
    case "pesos":
    case "index":
      return Math.abs(value) < 10
        ? twoDecimals.format(value)
        : group.format(value);
  }
}

/** Días desde 1970: la posición de una fecha en un eje de tiempo. */
export function dayNumber(on: string): number {
  return Date.parse(`${on}T00:00:00Z`) / 86_400_000;
}

export function dateOf(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/**
 * Ticks de un eje de tiempo según lo que abarca: cada cinco años, cada año,
 * cada trimestre o cada mes. Un rango de veinte años rotulado «ene 24» no se
 * lee.
 */
export function timeTicks(
  fromDay: number,
  toDay: number,
): { readonly ticks: number[]; readonly label: (day: number) => string } {
  const years = (toDay - fromDay) / 365.25;
  const from = dateOf(fromDay);
  const to = dateOf(toDay);
  const firstYear = Number(from.slice(0, 4));
  const lastYear = Number(to.slice(0, 4));

  if (years > 4) {
    const step = years > 30 ? 10 : years > 15 ? 5 : years > 8 ? 2 : 1;
    const ticks: number[] = [];
    for (
      let year = Math.ceil(firstYear / step) * step;
      year <= lastYear;
      year += step
    ) {
      const day = dayNumber(`${year}-01-01`);
      if (day >= fromDay && day <= toDay) ticks.push(day);
    }
    return { ticks, label: (day) => dateOf(day).slice(0, 4) };
  }

  const step = years > 1.5 ? 6 : years > 0.75 ? 3 : 1;
  const ticks: number[] = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    for (let month = 0; month < 12; month += step) {
      const day = dayNumber(`${year}-${String(month + 1).padStart(2, "0")}-01`);
      if (day >= fromDay && day <= toDay) ticks.push(day);
    }
  }
  return {
    ticks,
    label: (day) => {
      const on = dateOf(day);
      return `${MONTHS[Number(on.slice(5, 7)) - 1]} ${on.slice(2, 4)}`;
    },
  };
}

/**
 * Ticks de una escala logarítmica: 1, 2 y 5 por cada potencia de diez dentro
 * del dominio, y si son demasiados, sólo las potencias.
 */
export function logTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > 0)) return [];
  const ticks: number[] = [];
  for (
    let power = Math.floor(Math.log10(min));
    power <= Math.ceil(Math.log10(max));
    power += 1
  ) {
    for (const step of [1, 2, 5]) {
      const tick = step * 10 ** power;
      if (tick >= min && tick <= max) ticks.push(tick);
    }
  }
  if (ticks.length > 8) {
    return ticks.filter((tick) => Number.isInteger(Math.log10(tick)));
  }
  return ticks;
}

/** El rótulo de una fila según su frecuencia. */
export function periodLabel(
  on: string,
  resolution: "daily" | "month_end" | "monthly" | "annual",
): string {
  switch (resolution) {
    case "daily":
      return calendarDate(on);
    case "month_end":
      return `Cierre de ${shortMonth(on)}`;
    case "monthly":
      return shortMonth(on);
    case "annual":
      return on.slice(0, 4);
  }
}

/**
 * Un grupo de botones excluyentes: rango, escala o vista. Cada botón dice si
 * está elegido con `aria-pressed`, así el estado no depende del color.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly {
    readonly value: T;
    readonly label: string;
    readonly disabled?: boolean;
    readonly title?: string;
  }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex shrink-0 rounded-md border bg-muted/40 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-7 min-w-8 rounded-[calc(var(--radius)-4px)] px-2 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
            option.value === value &&
              "bg-card text-foreground shadow-sm ring-1 ring-border",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export type LegendItem = {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly shape: "line" | "dashed" | "square" | "band";
};

/** Una muestra del trazo: la misma forma que en el gráfico. */
export function Swatch({ item }: { readonly item: LegendItem }) {
  return (
    <svg
      width="18"
      height="10"
      viewBox="0 0 18 10"
      className="shrink-0"
      aria-hidden="true"
    >
      {item.shape === "square" ? (
        <rect x="4" y="0" width="10" height="10" rx="2" fill={item.color} />
      ) : item.shape === "band" ? (
        <rect
          x="1"
          y="1"
          width="16"
          height="8"
          rx="1"
          fill={item.color}
          fillOpacity={0.18}
          stroke={item.color}
          strokeDasharray="3 2"
        />
      ) : (
        <line
          x1="1"
          x2="17"
          y1="5"
          y2="5"
          stroke={item.color}
          strokeWidth={2.5}
          strokeDasharray={item.shape === "dashed" ? "4 3" : undefined}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/** La barra de controles de un gráfico: se envuelve en mobile. */
export function ChartToolbar({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {children}
    </div>
  );
}
