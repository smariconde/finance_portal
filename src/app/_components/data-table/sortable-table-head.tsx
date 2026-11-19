"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { nextSort, type SortDirection, type SortState } from "./table-sort";

/**
 * El orden de una tabla con el sentido con que arranca cada columna. Devuelve
 * el estado y el `onSort` que espera `SortableTableHead`.
 */
export function useTableSort<K extends string>(
  initial: SortState<K>,
  firstDirection: (key: K) => SortDirection,
): readonly [SortState<K>, (key: K) => void] {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const onSort = (key: K) =>
    setSort((current) => nextSort(current, key, firstDirection(key)));
  return [sort, onSort] as const;
}

/**
 * Un encabezado que ordena. El estado vive en `aria-sort` del `th` —no en el
 * color ni en la flecha—, y el botón ocupa el rótulo entero. En una columna de
 * cifras la flecha va a la izquierda, así los rótulos quedan alineados con los
 * números.
 */
export function SortableTableHead<K extends string>({
  sortKey,
  sort,
  onSort,
  align = "left",
  className,
  children,
}: {
  readonly sortKey: K;
  readonly sort: SortState<K>;
  readonly onSort: (key: K) => void;
  readonly align?: "left" | "right";
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const active = sort.key === sortKey;
  const Icon = !active
    ? ArrowUpDown
    : sort.direction === "ascending"
      ? ArrowUp
      : ArrowDown;
  const icon = (
    <Icon
      aria-hidden="true"
      className={cn("size-3.5 shrink-0", !active && "opacity-40")}
    />
  );

  return (
    <TableHead
      scope="col"
      aria-sort={active ? sort.direction : "none"}
      className={cn(align === "right" && "text-right", className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "-mx-1 inline-flex min-h-7 items-center gap-1 rounded-sm px-1 font-medium leading-tight outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
          align === "right" && "text-right",
        )}
      >
        {align === "right" ? icon : null}
        {children}
        {align === "right" ? null : icon}
      </button>
    </TableHead>
  );
}
