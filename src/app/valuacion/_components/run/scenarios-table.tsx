import { CheckCircle2, TriangleAlert } from "lucide-react";

import { Fold } from "@/app/_components/fold";
import { InfoTip } from "@/app/_components/info-tip";
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
import { ScenarioPathChart } from "./scenario-path-chart";
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

  // Una serie que cambia se lee en el gráfico de arriba; acá, de dónde a
  // dónde va.
  return (
    <span className="whitespace-nowrap">
      {formatDriverValue(driver, first)} →{" "}
      {formatDriverValue(driver, values.at(-1)!)}{" "}
      <span className="text-xs text-muted-foreground max-sm:sr-only">
        años 1–{values.length}
      </span>
    </span>
  );
}

type DriverPath = {
  driver: ScenarioDriverKey;
  base: readonly string[];
  bear: readonly string[];
  bull: readonly string[];
};

/**
 * Los drivers que cambian año por año en algún escenario, con el camino de
 * los tres. Un driver que no cambia en un escenario sigue el de la base.
 * Sólo tasas: ventas sobre capital es un cociente y queda en su tabla.
 */
function driverPaths(reading: ScenarioReading): DriverPath[] {
  const drivers = [
    ...new Set(
      [...reading.drivers.bear.changes, ...reading.drivers.bull.changes]
        .filter(
          (change) =>
            change.baseValues.length > 1 && change.driver !== "salesToCapital",
        )
        .map((change) => change.driver),
    ),
  ];

  return drivers.flatMap((driver) => {
    const bearChange = reading.drivers.bear.changes.find(
      (change) => change.driver === driver,
    );
    const bullChange = reading.drivers.bull.changes.find(
      (change) => change.driver === driver,
    );
    const base = (bearChange ?? bullChange)!.baseValues;
    const path = {
      driver,
      base,
      bear: bearChange?.scenarioValues ?? base,
      bull: bullChange?.scenarioValues ?? base,
    };
    const flat = [path.base, path.bear, path.bull].every((values) =>
      values.every((value) => value === values[0]),
    );

    return flat ||
      path.bear.length !== base.length ||
      path.bull.length !== base.length
      ? []
      : [path];
  });
}

function percentPoints(value: string): number {
  // Sólo geometría: la cifra que se lee sale de `formatPercent`.
  return Number(value) * 100;
}

function DriverPaths({ paths }: { paths: readonly DriverPath[] }) {
  return (
    <section
      aria-labelledby="scenario-paths-title"
      className="flex flex-col gap-4 border-t px-4 pt-6"
    >
      <h3 id="scenario-paths-title" className="text-sm font-medium">
        Año por año
      </h3>
      <div className="grid gap-6 lg:grid-cols-2">
        {paths.map((path) => {
          const label = SCENARIO_DRIVER_LABELS[path.driver];

          return (
            <figure key={path.driver} className="flex min-w-0 flex-col gap-2">
              <figcaption className="text-sm">{label}</figcaption>
              <ScenarioPathChart
                label={`${label} por año en bear, base y bull`}
                years={path.base.map((value, index) => ({
                  year: index + 1,
                  base: percentPoints(value),
                  bear: percentPoints(path.bear[index]!),
                  bull: percentPoints(path.bull[index]!),
                  baseLabel: formatPercent(value, { scale: 1 }),
                  bearLabel: formatPercent(path.bear[index]!, { scale: 1 }),
                  bullLabel: formatPercent(path.bull[index]!, { scale: 1 }),
                }))}
              />
            </figure>
          );
        })}
      </div>
      <Fold summary="Ver las cifras año por año">
        <div className="flex flex-col gap-4">
          {paths.map((path) => (
            // Sin `caption`: la grilla de sensibilidad es la única tabla de la
            // página que lo lleva, y el gate E2E la encuentra así.
            <Table
              key={path.driver}
              containerLabel={`${SCENARIO_DRIVER_LABELS[path.driver]} por año, tabla desplazable`}
            >
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    {SCENARIO_DRIVER_LABELS[path.driver]} · año
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Bear
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Base
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Bull
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {path.base.map((value, index) => (
                  <TableRow key={index}>
                    <TableHead scope="row" className="numeric font-normal">
                      {index + 1}
                    </TableHead>
                    <TableCell className="numeric text-right">
                      {formatPercent(path.bear[index]!, { scale: 1 })}
                    </TableCell>
                    <TableCell className="numeric text-right font-medium">
                      {formatPercent(value, { scale: 1 })}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {formatPercent(path.bull[index]!, { scale: 1 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ))}
        </div>
      </Fold>
    </section>
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
  const paths = driverPaths(reading);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2" id="scenarios-title">
          Escenarios bear, base y bull
        </CardTitle>
        <CardDescription className="flex items-center gap-0.5">
          En {currency}. No son probabilidades.
          <InfoTip title="Cómo se arman los escenarios">
            <p>
              Tres conjuntos de supuestos, cada uno valuado entero por el motor
              y sometido a los mismos controles que la base: no es la base
              multiplicada por un factor.
            </p>
            <p>
              El costo de capital, la tasa impositiva, los hechos y el puente
              son los mismos en los tres. El rango no se pondera.
            </p>
          </InfoTip>
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 px-0">
        <div className="flex flex-col gap-3">
          <Table containerLabel="Escenarios, tabla desplazable">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Escenario</TableHead>
                <TableHead scope="col" className="text-right">
                  Value per share
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Contra la base
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Enterprise value
                </TableHead>
                <TableHead scope="col" className="text-right">
                  TV share
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

        {paths.length === 0 ? null : <DriverPaths paths={paths} />}

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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scenario.changes.map((change) => (
                    <TableRow key={change.driver}>
                      <TableHead scope="row" className="font-medium">
                        <span className="flex items-center gap-0.5">
                          {SCENARIO_DRIVER_LABELS[change.driver]}
                          {/* El motivo registrado, a demanda (`F6-28`). */}
                          <InfoTip
                            title={`Motivo: ${SCENARIO_DRIVER_LABELS[change.driver]}`}
                          >
                            <p>{storedTextEs(change.rationale)}</p>
                          </InfoTip>
                        </span>
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
