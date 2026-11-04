import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Un bloque de la página: la pregunta, su lectura en una frase, el gráfico y,
 * plegados, los números y la metodología. La fuente y la última fecha van
 * siempre a la vista, junto al resultado (`The Evidence Travels With the
 * Result Rule`).
 */
export function DashboardBlock({
  id,
  title,
  reading,
  provenance,
  children,
  methodology,
}: {
  readonly id: string;
  readonly title: string;
  /** La lectura en una frase, sin causalidad ni consejo. */
  readonly reading: ReactNode;
  /** Fuente, último dato y transformación, en una línea. */
  readonly provenance: ReactNode;
  readonly children: ReactNode;
  readonly methodology: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20" aria-labelledby={`${id}-title`}>
      <Card>
        <CardHeader className="gap-2">
          <CardTitle as="h2" id={`${id}-title`} className="text-lg">
            {title}
          </CardTitle>
          <p className="max-w-3xl text-sm">{reading}</p>
          <p className="text-xs text-muted-foreground">{provenance}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {children}
          <Fold summary="Metodología y fuentes">
            <div className="flex max-w-3xl flex-col gap-2 text-sm text-muted-foreground">
              {methodology}
            </div>
          </Fold>
        </CardContent>
      </Card>
    </section>
  );
}

export function Fold({
  summary,
  children,
}: {
  readonly summary: string;
  readonly children: ReactNode;
}) {
  return (
    <details className="group border-t pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        {summary}
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

export type DataColumn = {
  readonly label: string;
  /** Las cifras se alinean a la derecha con numerales tabulares. */
  readonly numeric?: boolean;
};

/**
 * La tabla equivalente de un gráfico: las mismas cifras, escritas, con las
 * filas más recientes primero. Va plegada para que la lectura rápida no
 * desplace, y se abre con teclado o click.
 */
export function DataTable({
  caption,
  columns,
  rows,
}: {
  readonly caption: string;
  readonly columns: readonly DataColumn[];
  /** Cada celda ya formateada; una ausencia se escribe con su motivo. */
  readonly rows: readonly (readonly string[])[];
}) {
  return (
    <Fold summary={`Ver los datos (${rows.length} filas)`}>
      {/* Con scroll propio: tiene que poder enfocarse para recorrerlo con teclado. */}
      <div
        role="region"
        aria-label={caption}
        tabIndex={0}
        className="max-h-96 overflow-auto rounded-md border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Table>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader className="sticky top-0 bg-card">
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.label}
                  scope="col"
                  className={column.numeric ? "text-right" : undefined}
                >
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row[0]}>
                {row.map((cell, index) =>
                  index === 0 ? (
                    <TableHead key={index} scope="row" className="font-normal">
                      {cell}
                    </TableHead>
                  ) : (
                    <TableCell
                      key={index}
                      className={
                        columns[index]?.numeric
                          ? "numeric text-right"
                          : undefined
                      }
                    >
                      {cell}
                    </TableCell>
                  ),
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Fold>
  );
}
