import { Ban } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatAmount,
  formatPercent,
  formatSignedAmount,
} from "@/modules/valuation/domain/display-format";
import type {
  AnnotatedSensitivity,
  AnnotatedSensitivityCell,
} from "@/modules/valuation/domain/valuation-report";

import { sensitivityRejectionLabel } from "./labels";

/**
 * Grilla de sensibilidad WACC × crecimiento terminal.
 *
 * Es una tabla semántica y no un heatmap dibujado: cada celda lleva su valor
 * escrito, sus dos encabezados asociados y su lectura para lector de pantalla.
 * El tinte es un refuerzo de magnitud, nunca el único canal —una celda leída
 * sólo por color no se puede auditar (`UI-03`)—, y una celda rechazada muestra
 * su motivo en vez de quedar vacía o caer a cero.
 *
 * No es una distribución de probabilidad: cada celda es un escenario mecánico,
 * no un resultado más probable que otro. La página lo dice porque una grilla
 * teñida invita exactamente a esa lectura equivocada.
 */
const HEAT_STEPS = 5;

/**
 * Intensidad visual por **posición en el orden**, no por rango lineal.
 *
 * Una perpetuidad con el denominador cerca de cero produce un valor enorme en
 * una esquina de la grilla: con una rampa lineal ese único escenario se lleva
 * todo el rango y las veinte celdas restantes quedan del mismo color, que es
 * codificar nada. El orden siempre discrimina, y ningún valor se pierde porque
 * cada celda lleva su importe escrito.
 *
 * El `Number` sólo ordena el tinte y nunca vuelve al cálculo: la aritmética
 * financiera vive en el motor decimal.
 */
function heatRamp(
  cells: readonly AnnotatedSensitivityCell[],
): Map<string, number> {
  const computed = cells
    .filter((cell) => cell.status === "computed")
    .map((cell) => ({
      key: `${cell.wacc}|${cell.terminalGrowth}`,
      value: Number(cell.valuePerShare),
    }))
    .sort((left, right) => left.value - right.value);

  return new Map(
    computed.map((cell, rank) => [
      cell.key,
      computed.length <= 1
        ? 0
        : Math.min(
            HEAT_STEPS - 1,
            Math.floor((rank / (computed.length - 1)) * HEAT_STEPS),
          ),
    ]),
  );
}

/**
 * Rampa de tinte medida, no elegida a ojo. El tope es `22 %` porque más tinte
 * baja el texto de delta —`text-foreground/85`, que es el texto más débil sobre
 * estas celdas— por debajo de 4.5:1 en tema claro. Medido sobre los tokens de
 * `globals.css` en ambos temas: peor caso 4.68:1 para el delta y 4.77:1 para la
 * etiqueta del caso base. Subir un escalón obliga a volver a medir.
 */
const TINT_PERCENT = [0, 6, 11, 16, 22];

export function SensitivityMatrix({
  sensitivity,
}: {
  sensitivity: AnnotatedSensitivity;
}) {
  const cells = sensitivity.rows.flatMap((row) => row.cells);
  const ramp = heatRamp(cells);
  const rejected = cells.filter((cell) => cell.status === "rejected");
  const rejectionReasons = [
    ...new Set(rejected.map((cell) => cell.reason)),
  ].sort();

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">
          ¿Cuánto cambia el valor si cambian el costo de capital y el
          crecimiento?
        </CardTitle>
        <CardDescription>
          Valor por acción en {sensitivity.currency} con todo lo demás fijo. El
          eje de WACC reemplaza el costo de capital de todos los períodos y del
          terminal, no de uno solo.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0">
        <Table containerLabel="Sensibilidad WACC por crecimiento terminal, tabla desplazable">
          <TableCaption className="px-(--card-spacing) text-left">
            Unidad: valor por acción en {sensitivity.currency}. Eje vertical:
            WACC de {formatPercent(sensitivity.waccValues[0])} a{" "}
            {formatPercent(sensitivity.waccValues.at(-1) ?? "0")}. Eje
            horizontal: crecimiento terminal de{" "}
            {formatPercent(sensitivity.terminalGrowthValues[0])} a{" "}
            {formatPercent(sensitivity.terminalGrowthValues.at(-1) ?? "0")}.
            Cada celda es un escenario mecánico, no un resultado más probable
            que otro.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="text-left">
                WACC \ Crecimiento terminal
              </TableHead>
              {sensitivity.terminalGrowthValues.map((growth) => (
                <TableHead
                  key={growth}
                  scope="col"
                  className="numeric text-right"
                >
                  {formatPercent(growth)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sensitivity.rows.map((row) => (
              <TableRow key={row.wacc}>
                <TableHead scope="row" className="numeric font-medium">
                  {formatPercent(row.wacc)}
                </TableHead>
                {row.cells.map((cell) => {
                  const label = `WACC ${formatPercent(cell.wacc)}, crecimiento terminal ${formatPercent(cell.terminalGrowth)}`;

                  if (cell.status === "rejected") {
                    return (
                      <TableCell
                        key={cell.terminalGrowth}
                        className="bg-muted/60 text-right align-top"
                      >
                        <span className="sr-only">
                          {label}: sin valor.{" "}
                          {sensitivityRejectionLabel(cell.reason)}
                        </span>
                        <span
                          aria-hidden="true"
                          className="flex items-center justify-end gap-1 text-xs text-muted-foreground"
                        >
                          <Ban className="size-3 shrink-0" />
                          No definido
                        </span>
                      </TableCell>
                    );
                  }

                  const step =
                    ramp.get(`${cell.wacc}|${cell.terminalGrowth}`) ?? 0;

                  return (
                    <TableCell
                      key={cell.terminalGrowth}
                      className={
                        cell.isBase
                          ? "text-right align-top ring-2 ring-primary ring-inset"
                          : "text-right align-top"
                      }
                      style={{
                        backgroundColor: `color-mix(in oklab, var(--chart-1) ${TINT_PERCENT[step]}%, var(--card))`,
                      }}
                    >
                      <span className="sr-only">
                        {label}: {cell.isBase ? "caso base, " : ""}
                        {formatAmount(cell.valuePerShare)}{" "}
                        {sensitivity.currency} por acción
                        {cell.isBase || cell.deltaVsBase === null
                          ? ""
                          : `, diferencia con el caso base ${formatSignedAmount(cell.deltaVsBase)}`}
                        .
                      </span>
                      <span aria-hidden="true" className="flex flex-col">
                        <span className="numeric font-medium">
                          {formatAmount(cell.valuePerShare)}
                        </span>
                        {cell.isBase ? (
                          <span className="text-xs font-medium text-primary">
                            Caso base
                          </span>
                        ) : cell.deltaVsBase === null ? null : (
                          <span className="numeric text-xs text-foreground/85">
                            {formatSignedAmount(cell.deltaVsBase)}
                          </span>
                        )}
                      </span>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <CardContent className="border-t pt-(--card-spacing)">
        <h3 className="text-sm font-medium">Cómo leer la grilla</h3>
        <ul className="mt-2 grid gap-2 text-sm text-muted-foreground lg:grid-cols-3">
          <li className="rounded-lg border bg-muted/30 p-3">
            El valor de cada celda está escrito. El tinte ordena las celdas de
            menor a mayor valor y no comunica nada por sí solo; el importe
            exacto no depende de él.
          </li>
          <li className="rounded-lg border bg-muted/30 p-3">
            {sensitivity.baseIsComparable ? (
              <>
                La celda marcada como caso base reproduce exactamente el
                resultado principal; las demás son diferencias contra ella.
              </>
            ) : (
              <>
                El costo de capital del snapshot no es plano, así que ninguna
                celda reproduce el caso base y no se marca ninguna.
              </>
            )}
          </li>
          <li className="rounded-lg border bg-muted/30 p-3">
            {rejected.length === 0
              ? "Todas las celdas de este rango están definidas."
              : `${rejected.length} celdas quedan fuera del modelo y lo declaran en vez de vaciarse.`}
          </li>
        </ul>
        {rejectionReasons.length === 0 ? null : (
          <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
            {rejectionReasons.map((reason) => (
              <div key={reason} className="flex flex-wrap gap-1">
                <dt className="font-medium">No definido:</dt>
                <dd>{sensitivityRejectionLabel(reason)}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
