"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { tabBaselineClass, tabClass, tabListClass } from "./tab-styles";

export type IndexedSection = {
  readonly id: string;
  readonly label: string;
  /** Después del rótulo: una marca de novedad, nunca texto que haga falta. */
  readonly trailing?: ReactNode;
};

/**
 * El índice de una página larga —el resultado de una valuación, el tablero
 * argentino—: queda pegado debajo del header del shell, con la gramática de
 * pestañas de `tab-styles.ts`, y marca la sección que se está leyendo
 * (`aria-current="location"`). En un teléfono es una sola línea que se
 * desplaza de costado y trae la marcada a la vista sin mover la página. Sin
 * JavaScript sigue siendo una lista de anclas; cada sección necesita
 * `scroll-mt-28` o más para no quedar debajo.
 */
export function SectionIndex({
  label,
  sections,
  className,
}: {
  readonly label: string;
  readonly sections: readonly IndexedSection[];
  readonly className?: string;
}) {
  const [current, setCurrent] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  // Sólo los IDs deciden qué se observa: un `trailing` nuevo no reinicia nada.
  const ids = sections.map((section) => section.id).join(" ");

  useEffect(() => {
    const order = ids.split(" ").filter((id) => id !== "");
    const visible = new Set<string>();
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
  }, [ids]);

  // La marcada queda a la vista en la fila que se desplaza de costado. Se
  // mueve sólo el `scrollLeft` del índice: `scrollIntoView` también movería
  // la página.
  useEffect(() => {
    const container = list.current;
    if (container === null || current === null) return;
    const link = container.querySelector<HTMLElement>(
      `[data-section="${CSS.escape(current)}"]`,
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
      aria-label={label}
      className={cn(
        "sticky top-14 z-20 -mx-4 bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8",
        tabBaselineClass,
        className,
      )}
    >
      <ul ref={list} className={tabListClass}>
        {sections.map((section) => {
          const active = section.id === current;

          return (
            <li key={section.id} className="shrink-0">
              <a
                data-section={section.id}
                aria-current={active ? "location" : undefined}
                href={`#${section.id}`}
                className={tabClass(active)}
                onClick={() => setCurrent(section.id)}
              >
                {section.label}
                {section.trailing}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
