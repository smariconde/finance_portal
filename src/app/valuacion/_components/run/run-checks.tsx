import { StatusMark } from "@/app/_components/status-mark";
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
import {
  isExperimentalModelCheck,
  RUN_CHECK_ORIGINS,
  type RunCheckOrigin,
} from "@/modules/valuation/domain/run-review";
import { listTransformations } from "@/modules/valuation/domain/valuation-report";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";

import { ExperimentalMark } from "./data-marks";
import {
  checkLabel,
  checkRule,
  originList,
  TRANSFORMATION_LABELS,
} from "./labels";

type CheckRow = {
  readonly id: string;
  readonly mode: "reject" | "require_review";
  readonly message: string;
  readonly failedIn: RunCheckOrigin[];
};

/**
 * Los controles de base, bear y bull en una fila por control (`F6-51`): los
 * escenarios repiten los del caso base, y el estado de la corrida cuenta los
 * tres, así que la tabla dice en qué caso falló cada uno.
 */
function checkRows(run: ValuationRun): CheckRow[] {
  const byCase = {
    base: run.result?.checks ?? [],
    bear: run.result?.scenarios?.bear.checks ?? [],
    bull: run.result?.scenarios?.bull.checks ?? [],
  };
  const rows = new Map<string, CheckRow>();

  for (const origin of RUN_CHECK_ORIGINS) {
    for (const check of byCase[origin]) {
      const key = `${check.mode}:${check.id}`;
      const row = rows.get(key) ?? {
        id: check.id,
        mode: check.mode,
        message: check.message,
        failedIn: [],
      };
      if (check.status === "failed" && !row.failedIn.includes(origin))
        row.failedIn.push(origin);
      rows.set(key, row);
    }
  }

  return [...rows.values()];
}

function outcomeLabel(failedIn: readonly RunCheckOrigin[]): string {
  if (failedIn.length === 0) return "Pasó";
  if (failedIn.length === 1 && failedIn[0] === "base") return "No pasó";
  return `No pasó en ${originList(failedIn)}`;
}

/**
 * Las fórmulas que la corrida aplicó y los controles que el motor ejecutó
 * sobre ella. Lo comparten la corrida de referencia y la de una empresa real:
 * una corrida se audita igual venga de donde venga.
 */
export function RunChecks({ run }: { run: ValuationRun }) {
  const transformations = listTransformations(run);
  const checks = checkRows(run);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Transformaciones y controles</CardTitle>
        <CardDescription>
          Fórmulas aplicadas y controles del motor.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <h3 className="text-sm font-medium">
          Fórmulas aplicadas, en orden de cálculo
        </h3>
        <ol className="mt-3 grid gap-2 lg:grid-cols-2">
          {transformations.map((step, index) => (
            <li
              key={step.id}
              className="flex gap-3 rounded-lg border bg-muted/30 p-3"
            >
              <span
                className="numeric shrink-0 text-xs text-muted-foreground"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {TRANSFORMATION_LABELS[step.id]}
                </span>
                <code className="mt-1 block font-mono text-xs break-words text-muted-foreground">
                  {step.formula}
                </code>
              </span>
            </li>
          ))}
        </ol>
      </CardContent>

      <CardContent className="border-t px-0 pt-(--card-spacing)">
        <h3 className="px-(--card-spacing) pb-3 text-sm font-medium">
          Policy checks ejecutados
        </h3>
        {checks.length === 0 ? (
          <p className="px-(--card-spacing) text-sm text-muted-foreground">
            La corrida fue rechazada y no guarda la lista de controles: el
            control que la rechazó está en el motivo del resultado.
          </p>
        ) : (
          <Table containerLabel="Policy checks ejecutados, tabla desplazable">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Control</TableHead>
                <TableHead scope="col">Modo</TableHead>
                <TableHead scope="col">Resultado</TableHead>
                <TableHead scope="col" className="w-[46%]">
                  Regla
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.map((check) => {
                const label = isExperimentalModelCheck(check.id);

                return (
                  <TableRow key={`${check.mode}:${check.id}`}>
                    <TableHead scope="row" className="font-medium">
                      {checkLabel(check.id)}
                    </TableHead>
                    <TableCell className="text-muted-foreground">
                      {label
                        ? "Rotula el método"
                        : check.mode === "reject"
                          ? "Rechaza la corrida"
                          : "Exige revisión"}
                    </TableCell>
                    <TableCell>
                      {label && check.failedIn.length > 0 ? (
                        <ExperimentalMark />
                      ) : (
                        <StatusMark
                          status={
                            check.failedIn.length === 0 ? "ready" : "degraded"
                          }
                          label={outcomeLabel(check.failedIn)}
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-normal">
                      {checkRule(check.id, check.message)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
