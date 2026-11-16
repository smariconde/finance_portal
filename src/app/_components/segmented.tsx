"use client";

import { cn } from "@/lib/utils";

import {
  segmentActiveClass,
  segmentGroupClass,
  segmentItemClass,
} from "./segment-styles";

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
      className={cn(segmentGroupClass, "shrink-0")}
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
            segmentItemClass,
            "min-h-6 min-w-8 px-2 text-xs",
            option.value === value && segmentActiveClass,
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
