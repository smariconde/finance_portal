"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Un bloque plegado de la auditoría (`F6-17`). Es un `<details>` nativo; lo
 * único que agrega el cliente es abrirlo cuando el ancla de la URL apunta a
 * él, para que «Rigor» o un enlace compartido no caigan en un bloque cerrado.
 */
export function AuditGroup({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  /** Qué hay adentro, en una línea, para decidir si abrirlo. */
  summary: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const openIfTargeted = () => {
      if (window.location.hash === `#${id}` && ref.current !== null) {
        ref.current.open = true;
        ref.current.scrollIntoView();
      }
    };

    openIfTargeted();
    window.addEventListener("hashchange", openIfTargeted);
    return () => window.removeEventListener("hashchange", openIfTargeted);
  }, [id]);

  return (
    <details
      ref={ref}
      id={id}
      open={defaultOpen}
      className="group scroll-mt-20 border-b last:border-b-0"
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-sm text-muted-foreground">{summary}</span>
        </span>
      </summary>
      <div className="flex flex-col gap-6 pb-6">{children}</div>
    </details>
  );
}
