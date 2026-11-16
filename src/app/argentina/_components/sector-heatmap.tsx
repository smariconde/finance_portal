import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ActivityBlock } from "@/modules/argentina-dashboard/domain/argentina-dashboard";

import { comparisonText, shortMonth } from "./format";

/**
 * Intensidad del tinte por magnitud de la variación interanual, en puntos. El
 * tope de 22 % es el medido en la grilla de sensibilidad para que el texto
 * siga arriba de 4,5:1; el signo lo dice la cifra, el tinte sólo lo refuerza.
 */
const STEPS: readonly (readonly [number, number])[] = [
  [10, 22],
  [6, 16],
  [3, 11],
  [1, 6],
];

function tintOf(value: string): string | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const step = STEPS.find(([threshold]) => Math.abs(parsed) >= threshold);
  if (!step) return undefined;
  const hue = parsed > 0 ? "--chart-2" : "--chart-5";
  return `color-mix(in oklab, var(${hue}) ${step[1]}%, var(--card))`;
}

/**
 * Variación interanual de cada sector del EMAE en los últimos doce meses. Es
 * una tabla, no un dibujo: cada celda tiene su cifra y sus dos encabezados, y
 * un mes sin dato dice por qué en vez de quedar en blanco o en cero.
 */
export function SectorHeatmap({
  activity,
}: {
  readonly activity: ActivityBlock;
}) {
  const latestIndex = activity.sectorMonths.length - 1;
  // El mes más reciente primero: en mobile la tabla desplaza y lo que se ve
  // sin desplazar tiene que ser lo último publicado.
  const months = [...activity.sectorMonths].reverse();
  const rows = [...activity.sectors].sort((left, right) => {
    const a = left.cells[latestIndex]?.change;
    const b = right.cells[latestIndex]?.change;
    const av = a?.status === "computed" ? Number(a.value) : -Infinity;
    const bv = b?.status === "computed" ? Number(b.value) : -Infinity;
    return bv - av;
  });

  return (
    <div className="flex flex-col gap-2">
      {/* Fuera del scroll: dentro de la tabla el caption medía lo que la
          tabla y se cortaba en un teléfono. */}
      <p className="text-xs text-muted-foreground" aria-hidden="true">
        Var. interanual en %, último mes primero · ordenado por{" "}
        {latestIndex < 0
          ? "el último mes"
          : shortMonth(activity.sectorMonths[latestIndex]!)}
      </p>
      <div
        role="region"
        aria-label="Variación interanual por sector"
        tabIndex={0}
        className="overflow-x-auto rounded-md border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Table className="text-xs">
          <TableCaption className="sr-only">
            Variación interanual del índice original de cada sector del EMAE, en
            %, del mes más reciente al más viejo, ordenado por el último mes. El
            tinte acompaña a la cifra y nunca la reemplaza.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="min-w-40">
                Sector
              </TableHead>
              {months.map((on) => (
                <TableHead
                  key={on}
                  scope="col"
                  className="text-right whitespace-nowrap"
                >
                  <time dateTime={on.slice(0, 7)}>{shortMonth(on)}</time>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((sector) => (
              <TableRow key={sector.id}>
                <TableHead
                  scope="row"
                  // La letra ClaNAE del INDEC queda como ayuda, no en el rótulo.
                  title={`Letra ClaNAE ${sector.code}`}
                  className="max-w-56 font-normal whitespace-normal"
                >
                  {sector.label}
                </TableHead>
                {[...sector.cells].reverse().map((cell) => (
                  <TableCell
                    key={cell.on}
                    className="numeric text-right whitespace-nowrap"
                    style={{
                      backgroundColor:
                        cell.change.status === "computed"
                          ? tintOf(cell.change.value)
                          : undefined,
                    }}
                  >
                    {comparisonText(cell.change)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
