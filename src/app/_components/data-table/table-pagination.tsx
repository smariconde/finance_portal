"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

import type { PageWindow } from "./table-pagination-window";

const count = new Intl.NumberFormat("es-AR");

/**
 * El pie de una tabla paginada: qué filas se ven de cuántas, cuántas por
 * página y los cuatro saltos. El rango se anuncia (`aria-live`) al cambiar de
 * página; los botones que no llevan a ningún lado se deshabilitan, nunca
 * desaparecen, así el pie no salta. Con todo en una página sólo queda el rango.
 */
export function TablePagination({
  view,
  pageSize,
  pageSizes,
  onPageChange,
  onPageSizeChange,
  noun,
}: {
  readonly view: PageWindow;
  readonly pageSize: number;
  readonly pageSizes: readonly number[];
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (size: number) => void;
  /** En plural y minúscula: «trades». */
  readonly noun: string;
}) {
  const sizeId = useId();
  const { page, pageCount, start, end, total } = view;
  const paged = total > Math.min(...pageSizes);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
      <p aria-live="polite" className="text-muted-foreground">
        {total === 0 ? (
          <>Sin {noun}</>
        ) : (
          <>
            <span className="numeric text-foreground">
              {count.format(start + 1)}–{count.format(end)}
            </span>{" "}
            de <span className="numeric">{count.format(total)}</span> {noun}
          </>
        )}
      </p>
      {paged ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor={sizeId}
              className="text-muted-foreground whitespace-nowrap"
            >
              Por página
            </label>
            <NativeSelect
              id={sizeId}
              wrapperClassName="w-auto"
              className="numeric h-7 w-auto"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {pageSizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </NativeSelect>
          </div>
          <nav
            aria-label={`Páginas de ${noun}`}
            className="flex items-center gap-1"
          >
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Primera página"
              disabled={page <= 1}
              onClick={() => onPageChange(1)}
            >
              <ChevronsLeft aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Página anterior"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span className="numeric min-w-16 px-1 text-center whitespace-nowrap">
              <span className="sr-only">Página </span>
              {page}
              <span aria-hidden="true"> / </span>
              <span className="sr-only"> de </span>
              {pageCount}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Página siguiente"
              disabled={page >= pageCount}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Última página"
              disabled={page >= pageCount}
              onClick={() => onPageChange(pageCount)}
            >
              <ChevronsRight aria-hidden="true" />
            </Button>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
