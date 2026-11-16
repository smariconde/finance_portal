import { ChevronRight } from "lucide-react";
import type { ReactNode, SyntheticEvent } from "react";

import { cn } from "@/lib/utils";

/**
 * Lo que se lee a demanda —la tabla equivalente de un gráfico, la metodología,
 * las citas—: un `<details>` nativo, así se abre con teclado sin JavaScript.
 * Es el único plegable de las superficies de análisis; la auditoría de una
 * corrida tiene el suyo porque lleva título y resumen (`AuditGroup`).
 */
export function Fold({
  summary,
  children,
  divided = true,
  defaultOpen,
  onToggle,
  className,
  contentClassName,
}: {
  readonly summary: ReactNode;
  readonly children: ReactNode;
  /** Una raya arriba lo separa de lo anterior; dentro de una lista, no. */
  readonly divided?: boolean;
  readonly defaultOpen?: boolean;
  readonly onToggle?: (event: SyntheticEvent<HTMLDetailsElement>) => void;
  readonly className?: string;
  readonly contentClassName?: string;
}) {
  return (
    <details
      open={defaultOpen}
      onToggle={onToggle}
      className={cn("group", divided && "border-t pt-3", className)}
    >
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        {summary}
      </summary>
      <div className={cn("pt-3", contentClassName)}>{children}</div>
    </details>
  );
}
