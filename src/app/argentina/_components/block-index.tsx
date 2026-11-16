"use client";

import { useEffect, useRef, useState } from "react";

import {
  segmentActiveClass,
  segmentGroupClass,
  segmentItemClass,
} from "@/app/_components/segment-styles";
import { cn } from "@/lib/utils";

/**
 * El índice de los bloques de `/argentina`: una línea fija debajo del header
 * del shell, con el bloque que se está leyendo en `aria-current`. En un
 * teléfono se desplaza de costado y acompaña al bloque actual. Los vínculos
 * son anclas comunes: sin JavaScript siguen llevando a cada bloque.
 */
export function BlockIndex({
  blocks,
}: {
  readonly blocks: readonly { readonly id: string; readonly label: string }[];
}) {
  const [current, setCurrent] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const sections = blocks
      .map((block) => document.getElementById(block.id))
      .filter((section): section is HTMLElement => section !== null);
    if (sections.length === 0) return;

    const visible = new Set<string>();
    // La franja de lectura empieza debajo del header y del índice (~7 rem) y
    // termina a media pantalla: el bloque actual es el primero que la toca.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = blocks.find((block) => visible.has(block.id));
        setCurrent(first?.id ?? null);
      },
      { rootMargin: "-112px 0px -50% 0px" },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [blocks]);

  useEffect(() => {
    const list = listRef.current;
    if (current === null || list === null) return;
    const link = list.querySelector<HTMLElement>(`[data-block="${current}"]`);
    if (link === null) return;
    // Sólo el desplazamiento lateral del índice: nunca mueve la página.
    const left = link.offsetLeft - list.clientWidth / 2 + link.clientWidth / 2;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    list.scrollTo({ left, behavior: reduce ? "auto" : "smooth" });
  }, [current]);

  return (
    <nav
      aria-label="Bloques del tablero"
      className="sticky top-14 z-20 -mx-4 bg-background px-4 py-2 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8"
    >
      <ul
        ref={listRef}
        className={cn(
          segmentGroupClass,
          "relative w-full max-w-full overflow-x-auto [scrollbar-width:none] sm:w-fit [&::-webkit-scrollbar]:hidden",
        )}
      >
        {blocks.map((block) => (
          <li key={block.id} className="shrink-0">
            <a
              href={`#${block.id}`}
              data-block={block.id}
              aria-current={block.id === current ? "location" : undefined}
              className={cn(
                segmentItemClass,
                "min-h-7 px-2.5 text-xs",
                block.id === current && segmentActiveClass,
              )}
            >
              {block.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
