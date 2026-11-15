"use client";

import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  GlossaryEntry,
  GlossarySource,
} from "@/modules/education/domain/glossary";

/**
 * Un término del glosario (`glossary-1.0.0`, compartido con `EDU-01`): el
 * término subrayado abre por click, toque, Enter o Espacio su definición, la
 * fórmula, por qué importa y la fuente; nunca sólo por hover (`UI-02`). Todo es
 * texto plano que React escapa.
 */
export function GlossaryTerm({
  entry,
  citations,
  className,
  children,
}: {
  readonly entry: GlossaryEntry;
  readonly citations: readonly GlossarySource[];
  readonly className?: string;
  /** Sin hijos, el disparador es el término mismo. */
  readonly children?: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex min-h-6 items-center rounded-sm underline decoration-muted-foreground/60 decoration-dotted underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:decoration-foreground",
          className,
        )}
      >
        {children ?? entry.term}
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <PopoverTitle>
          {entry.term}
          <span className="font-normal text-muted-foreground">
            {" "}
            · {entry.es}
          </span>
        </PopoverTitle>
        <div className="flex flex-col gap-2 text-muted-foreground">
          <p className="text-foreground">{entry.definition}</p>
          {entry.formula === null ? null : (
            <p className="numeric rounded-md bg-muted px-2 py-1.5 text-xs text-foreground">
              {entry.formula}
            </p>
          )}
          <p>{entry.why}</p>
          <p className="text-xs">
            {citations.map((citation) => citation.citation).join(" · ")}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
