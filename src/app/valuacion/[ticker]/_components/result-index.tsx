"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type ResultSection = { readonly id: string; readonly label: string };

/**
 * El índice de la página del resultado: queda pegado debajo del header del
 * shell y marca la sección que se está leyendo (`aria-current`). En un
 * teléfono es una sola línea que se desplaza de costado y lleva la marcada a
 * la vista. Sin JavaScript sigue siendo una lista de anclas.
 */
export function ResultIndex({
  sections,
}: {
  sections: readonly ResultSection[];
}) {
  const [current, setCurrent] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const visible = new Set<string>();
    const order = sections.map((section) => section.id);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // La primera sección, en el orden de la página, que cruza la franja
        // de lectura: debajo del header y del índice, en el tercio de arriba.
        const first = order.find((id) => visible.has(id));
        if (first !== undefined) setCurrent(first);
      },
      { rootMargin: "-112px 0px -60% 0px" },
    );

    for (const id of order) {
      const node = document.getElementById(id);
      if (node !== null) observer.observe(node);
    }

    return () => observer.disconnect();
  }, [sections]);

  // La marcada queda a la vista en la fila que se desplaza de costado. Se
  // mueve sólo el `scrollLeft` del índice: `scrollIntoView` también movería
  // la página.
  useEffect(() => {
    const container = list.current;
    if (container === null || current === null) return;
    const link = container.querySelector<HTMLElement>(
      `[data-section="${current}"]`,
    );
    if (link === null) return;
    const left = link.offsetLeft - container.offsetLeft;
    const right = left + link.offsetWidth;
    if (
      left >= container.scrollLeft &&
      right <= container.scrollLeft + container.clientWidth
    ) {
      return;
    }
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    container.scrollTo({
      left: Math.max(0, left - 16),
      behavior: reduced ? "auto" : "smooth",
    });
  }, [current]);

  return (
    <nav
      aria-label="Secciones del resultado"
      className="sticky top-14 z-20 -mx-4 -mt-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8"
    >
      <ul
        ref={list}
        className="flex [scrollbar-width:none] gap-x-1 overflow-x-auto text-sm whitespace-nowrap [&::-webkit-scrollbar]:hidden"
      >
        {sections.map((section) => {
          const active = section.id === current;

          return (
            <li key={section.id} className="shrink-0">
              <a
                data-section={section.id}
                aria-current={active ? "location" : undefined}
                href={`#${section.id}`}
                className={cn(
                  "-mb-px inline-flex h-11 items-center border-b-2 px-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:h-10",
                  active
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setCurrent(section.id)}
              >
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
