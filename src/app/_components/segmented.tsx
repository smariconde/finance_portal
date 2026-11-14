"use client";

import { cn } from "@/lib/utils";

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
