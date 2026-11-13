import type { RemInflationComparisonRow } from "@/modules/macro-series/application/read-rem-inflation-comparison";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { DashboardBlock } from "./block";
import { calendarDate, points, shortMonth, signedAmount } from "./format";

export function RemInflationSection({
  rows,
}: {
  readonly rows: readonly RemInflationComparisonRow[] | null;
}) {
  const latest = rows?.[0] ?? null;
  const observed = rows?.filter((row) => row.error.status === "computed") ?? [];
  const round = latest?.forecast.roundMonth ?? null;

  return (
    <DashboardBlock
      id="rem-inflacion"
      title="Inflación: lo esperado y lo observado"
      reading={
        rows === null
          ? "No se pudo leer la comparación en este momento."
          : latest === null
            ? "Todavía no hay una edición REM guardada para comparar."
            : observed.length === 0
              ? `La ronda de ${shortMonth(`${round}-01`)} proyecta ${rows.length} meses. El IPC nacional de esos meses aún no está disponible en la serie guardada.`
              : `La ronda de ${shortMonth(`${round}-01`)} tiene ${observed.length} ${observed.length === 1 ? "mes" : "meses"} con IPC observado y error calculado.`
      }
      provenance={
        latest === null
          ? "Fuentes: BCRA, REM mensual; INDEC, IPC nacional."
          : `BCRA, REM ${shortMonth(`${round}-01`)} · publicado ${calendarDate(latest.forecast.publishedOn)} · INDEC, IPC nacional cuando esté guardado.`
      }
      methodology={
        <>
          <p>
            Cada fila compara la mediana de inflación mensual del REM con la
            variación entre dos niveles consecutivos del IPC nacional original.
            El error es IPC observado menos pronóstico, en puntos porcentuales;
            sólo se calcula si el pronóstico estuvo disponible antes del IPC.
          </p>
          <p>
            La fecha de publicación del REM es la de la edición del BCRA. El IPC
            puede publicarse antes de aparecer en la API del INDEC; hasta que el
            dato esté guardado, se muestra como pendiente. Las cifras
            proyectadas no son inflación ya observada.
          </p>
        </>
      }
    >
      {rows !== null && rows.length > 0 ? (
        <div
          role="region"
          aria-label="REM mensual frente al IPC nacional"
          tabIndex={0}
          className="overflow-x-auto rounded-md border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Table>
            <TableCaption className="sr-only">
              Mediana REM, IPC nacional observado y diferencia por mes objetivo
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Mes objetivo</TableHead>
                <TableHead scope="col" className="text-right">
                  REM
                </TableHead>
                <TableHead scope="col" className="text-right">
                  IPC
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Error
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.forecast.targetMonth}>
                  <TableHead
                    scope="row"
                    className="whitespace-nowrap font-normal"
                  >
                    {shortMonth(`${row.forecast.targetMonth}-01`)}
                  </TableHead>
                  <TableCell className="numeric text-right">
                    {points(row.forecast.medianPercent, 2)}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    {row.actual.status === "computed"
                      ? points(row.actual.monthlyPercent, 2)
                      : "Pendiente"}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    {row.error.status === "computed"
                      ? `${signedAmount(row.error.errorPp, 2)} pp`
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </DashboardBlock>
  );
}
