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
import { listTransformations } from "@/modules/valuation/domain/valuation-report";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";

import { checkLabel, checkRule, TRANSFORMATION_LABELS } from "./labels";

/**
 * Las fórmulas que la corrida aplicó y los controles que el motor ejecutó
 * sobre ella. Lo comparten la corrida de referencia y la de una empresa real:
 * una corrida se audita igual venga de donde venga.
 */
export function RunChecks({ run }: { run: ValuationRun }) {
  const transformations = listTransformations(run);
  const checks = run.result?.checks ?? [];

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Transformaciones y controles</CardTitle>
        <CardDescription>
          Las fórmulas aplicadas por esta corrida y los controles que el motor
          ejecutó sobre ella.
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
              {checks.map((check) => (
                <TableRow key={check.id}>
                  <TableHead scope="row" className="font-medium">
                    {checkLabel(check.id)}
                  </TableHead>
                  <TableCell className="text-muted-foreground">
                    {check.mode === "reject"
                      ? "Rechaza la corrida"
                      : "Exige revisión"}
                  </TableCell>
                  <TableCell>
                    <StatusMark
                      status={check.status === "passed" ? "ready" : "degraded"}
                      label={check.status === "passed" ? "Pasó" : "No pasó"}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-normal">
                    {checkRule(check.id, check.message)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
