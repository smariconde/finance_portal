"use client";

import { Info } from "lucide-react";
import type { ReactNode } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * La explicación a demanda (`F6-28`): un ⓘ que abre por click, toque, Enter o
 * Espacio, nunca sólo por hover (`UI-02`). La página muestra la cifra y una
 * línea; lo didáctico —qué es la métrica, cómo leer el gráfico— vive acá.
 */
export function InfoTip({
  title,
  children,
  className,
  label,
}: {
  /** Nombra el ⓘ para lectores de pantalla y encabeza el panel. */
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
  /** Con rótulo, el disparador es texto («Fuente») en vez del ícono solo. */
  readonly label?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label === undefined ? `Qué significa: ${title}` : undefined}
        className={cn(
          // Área de toque de 24 px alrededor de un ícono de 14 (`UI-02`).
          "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-full align-middle text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:text-foreground",
          label === undefined ? "w-6" : "px-1.5 text-xs",
          className,
        )}
      >
        <Info aria-hidden="true" className="size-3.5" />
        {label}
      </PopoverTrigger>
      <PopoverContent>
        <PopoverTitle>{title}</PopoverTitle>
        <div className="flex flex-col gap-2 text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
