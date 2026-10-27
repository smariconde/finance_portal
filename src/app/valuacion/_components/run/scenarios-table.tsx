import { CheckCircle2, TriangleAlert } from "lucide-react";

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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  formatAmount,
  formatCompactAmount,
  formatPercent,
  formatSignedAmount,
} from "@/modules/valuation/domain/display-format";
import type { ScenarioDriverKey } from "@/modules/valuation/domain/scenarios";
import type {
  ScenarioReading,
  ScenarioReadingRow,
} from "@/modules/valuation/domain/valuation-report";

import { checkLabel, SCENARIO_DRIVER_LABELS } from "./labels";
import { storedTextEs } from "./stored-text";

const SCENARIO_LABELS: Record<ScenarioReadingRow["key"], string> = {
  bear: "Bear",
  base: "Base",
  bull: "Bull",
};

/** Ventas sobre capital es un cociente; el resto de los drivers, tasas. */
function formatDriverValue(driver: ScenarioDriverKey, value: string): string {
  return driver === "salesToCapital"
    ? formatAmount(value)
    : formatPercent(value, { scale: 1 });
}

function DriverValues({
  driver,
  values,
}: {
  driver: ScenarioDriverKey;
  values: readonly string[];
}) {
  if (values.length === 1) {
    return <>{formatDriverValue(driver, values[0]!)}</>;
  }

  // Una serie plana se dice una vez: repetir el mismo valor cinco veces sólo
  // obliga a contarlos para ver que no cambian.
  const first = values[0]!;

  if (values.every((value) => value === first)) {
    return (
      <>
        {formatDriverValue(driver, first)}{" "}
        <span className="text-xs text-muted-foreground">
          los {values.length} años
        </span>
      </>
    );
  }

  return (
    <ol className="flex gap-x-2 whitespace-nowrap">
      {values.map((value, index) => (
        <li key={index}>
          <span className="sr-only">Año {index + 1}: </span>
          {formatDriverValue(driver, value)}
        </li>
      ))}
    </ol>
  );
}

/**
 * Barra de valor por acción anclada en cero. Es redundante con el número de
 * la misma celda y por eso no se anuncia: sólo existe para que el rango se lea
 * de un vistazo. Con algún valor no positivo no se dibuja ninguna, porque una
 * barra que nace en cero no puede mostrar un valor negativo sin mentir.
 */
function ValueBar({ value, max }: { value: string; max: number | null }) {
  if (max === null) {
    return null;
  }

  return (
    <span
      aria-hidden="true"
      className="mt-1 block h-1.5 w-full max-w-40 rounded-full bg-muted"
    >
      <span
        className="block h-full rounded-full bg-muted-foreground/60"
        style={{ width: `${(Number(value) / max) * 100}%` }}
      />
    </span>
  );
}

/**
 * Escenarios bear/base/bull (`F4-04`). Cada uno es un conjunto de supuestos
 * que el motor valuó entero con los mismos controles que la base; la tabla de
 * drivers muestra qué cambió respecto de la base y por qué, así que ningún
 * número del rango queda sin su historia. No hay probabilidades: el rango no
 * se pondera ni se presenta como distribución.
 */
export function ScenariosTable({
  reading,
  currency,
}: {
  reading: ScenarioReading;
  currency: string;
}) {
  const values = reading.rows.map((row) => Number(row.valuePerShare));
  const max = values.every((value) => value > 0) ? Math.max(...values) : null;
  const ordered = reading.orderCheck?.status === "passed";

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2" id="scenarios-title">
          Escenarios bear, base y bull
        </CardTitle>
        <CardDescription className="max-w-4xl">
          Tres conjuntos de supuestos, cada uno valuado entero por el motor y
          sometido a los mismos controles que la base: no es la base
          multiplicada por un factor. El costo de capital, la tasa impositiva,
          los hechos y el puente son los mismos en los tres. No son
          probabilidades: el rango no se pondera. Valores en {currency}.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 px-0">
        <div className="flex flex-col gap-3">
          <Table containerLabel="Escenarios, tabla desplazable">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Escenario</TableHead>
                <TableHead scope="col" className="text-right">
                  Valor por acción
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Contra la base
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Enterprise value
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Peso del terminal
                </TableHead>
                <TableHead scope="col">Controles en revisión</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reading.rows.map((row) => (
                <TableRow
                  key={row.key}
                  className={cn(row.key === "base" && "bg-muted/40")}
                >
                  <TableHead scope="row" className="font-medium">
                    {SCENARIO_LABELS[row.key]}
                  </TableHead>
                  <TableCell className="numeric text-right">
                    <span
                      className={cn(
                        "flex flex-col items-end",
                        row.key === "base" && "font-semibold",
                      )}
                    >
                      {formatAmount(row.valuePerShare)}
                      <ValueBar value={row.valuePerShare} max={max} />
                    </span>
                  </TableCell>
                  <TableCell className="numeric text-right text-muted-foreground">
                    {row.deltaVsBase === null
                      ? "—"
                      : formatSignedAmount(row.deltaVsBase)}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    {formatCompactAmount(row.enterpriseValue)}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    {row.terminalValueShare === null
                      ? "Sin definir"
                      : formatPercent(row.terminalValueShare, { scale: 1 })}
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {row.reviewCheckIds.length === 0
                      ? "Ninguno"
                      : row.reviewCheckIds.map(checkLabel).join(", ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {reading.orderCheck === null ? null : (
            <p className="flex items-start gap-2 px-4 text-sm">
              {ordered ? (
                <CheckCircle2
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300"
                />
              ) : (
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300"
                />
              )}
              <span>
                {ordered
                  ? "Bear, base y bull quedan ordenados en valor por acción."
                  : "Los valores no quedan ordenados: la corrida pide revisión, porque un escenario que vale más que el bull o menos que el bear contradice su etiqueta."}
              </span>
            </p>
          )}
        </div>

        {(["bear", "bull"] as const).map((key) => {
          const scenario = reading.drivers[key];

          return (
            <section
              key={key}
              aria-labelledby={`scenario-${key}-title`}
              className="flex flex-col gap-3 border-t pt-6"
            >
              <div className="flex flex-col gap-1 px-4">
                <h3
                  id={`scenario-${key}-title`}
                  className="text-sm font-medium"
                >
                  Qué cambia en el {SCENARIO_LABELS[key].toLowerCase()}
                </h3>
                <p className="max-w-3xl text-sm text-muted-foreground">
                  {storedTextEs(scenario.thesis)}
                </p>
              </div>

              <Table
                containerLabel={`Drivers del escenario ${SCENARIO_LABELS[key].toLowerCase()}, tabla desplazable`}
              >
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Driver</TableHead>
                    <TableHead scope="col">Base</TableHead>
                    <TableHead scope="col">{SCENARIO_LABELS[key]}</TableHead>
                    <TableHead scope="col" className="w-[38%] min-w-64">
                      Motivo registrado
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scenario.changes.map((change) => (
                    <TableRow key={change.driver}>
                      <TableHead scope="row" className="font-medium">
                        {SCENARIO_DRIVER_LABELS[change.driver]}
                      </TableHead>
                      <TableCell className="numeric text-muted-foreground">
                        <DriverValues
                          driver={change.driver}
                          values={change.baseValues}
                        />
                      </TableCell>
                      <TableCell className="numeric">
                        <DriverValues
                          driver={change.driver}
                          values={change.scenarioValues}
                        />
                      </TableCell>
                      <TableCell className="whitespace-normal text-muted-foreground">
                        {storedTextEs(change.rationale)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
