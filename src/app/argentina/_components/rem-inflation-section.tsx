import { cn } from "@/lib/utils";
import type { RemInflationComparisonRow } from "@/modules/macro-series/application/read-rem-inflation-comparison";
import {
  remTargetMonthState,
  type RemTargetMonthState,
} from "@/modules/macro-series/domain/rem-target-month";
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

/**
 * Why a month has no observed CPI (`rem-target-month-1.0.0`, `F9-24`): a
 * month still running or to come cannot have one; a closed month is waiting
 * for its CPI to be stored, which the refresh on open asks for.
 */
const MISSING_CPI: Readonly<Record<RemTargetMonthState, string>> = {
  closed: "Pendiente",
  current: "En curso",
  future: "Por venir",
};

export function RemInflationSection({
  rows,
  readAt,
}: {
  readonly rows: readonly RemInflationComparisonRow[] | null;
  /** The page's cutoff: which target months have ended. */
  readonly readAt: string;
}) {
  const latest = rows?.[0] ?? null;
  const observed = rows?.filter((row) => row.error.status === "computed") ?? [];
  const round = latest?.forecast.roundMonth ?? null;
  const awaited =
    rows?.filter(
      (row) =>
        row.actual.status !== "computed" &&
        remTargetMonthState(row.forecast.targetMonth, readAt) === "closed",
    ) ?? [];
  const awaitedText =
    awaited.length === 0
      ? ""
      : ` El IPC de ${awaited.map((row) => shortMonth(`${row.forecast.targetMonth}-01`)).join(", ")} todavía no está guardado.`;

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
              ? `La ronda de ${shortMonth(`${round}-01`)} proyecta ${rows.length} meses; ninguno tiene IPC observado todavía.${awaitedText}`
              : `La ronda de ${shortMonth(`${round}-01`)} tiene ${observed.length} ${observed.length === 1 ? "mes" : "meses"} con IPC observado y error calculado.${awaitedText}`
      }
      provenance={
        latest === null
          ? "Fuentes: BCRA, REM mensual; INDEC, IPC nacional."
          : `BCRA, REM ${shortMonth(`${round}-01`)} · publicado ${calendarDate(latest.forecast.publishedOn)} · IPC nacional del INDEC o, si falta, del BCRA`
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
            La fecha de publicación del REM es la de la edición del BCRA. Un mes
            en curso o por venir todavía no tiene IPC. La página le pide el
            índice al INDEC al abrirse, una vez por semana; su API suele tardar
            en traer el mes que el INDEC ya difundió. Mientras falta, la fila
            usa la inflación mensual que republica el BCRA (variable 27, con un
            decimal) y lo dice: «vía BCRA». Sin ninguna de las dos, el mes
            figura pendiente. Las cifras proyectadas no son inflación ya
            observada.
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
                  <TableCell
                    className={cn(
                      "numeric text-right",
                      row.actual.status !== "computed" &&
                        remTargetMonthState(
                          row.forecast.targetMonth,
                          readAt,
                        ) !== "closed" &&
                        "text-muted-foreground",
                    )}
                  >
                    {row.actual.status === "computed" ? (
                      <>
                        {points(
                          row.actual.monthlyPercent,
                          row.actual.source === "bcra_monthly" ? 1 : 2,
                        )}
                        {row.actual.source === "bcra_monthly" ? (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            vía BCRA
                          </span>
                        ) : null}
                      </>
                    ) : (
                      MISSING_CPI[
                        remTargetMonthState(row.forecast.targetMonth, readAt)
                      ]
                    )}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    {row.error.status === "computed"
                      ? // Con el dato del BCRA, un decimal: no inventa precisión.
                        `${signedAmount(
                          row.error.errorPp,
                          row.actual.status === "computed" &&
                            row.actual.source === "bcra_monthly"
                            ? 1
                            : 2,
                        )} pp`
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
