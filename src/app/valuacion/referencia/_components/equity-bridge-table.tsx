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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatAmount,
  formatShares,
} from "@/modules/valuation/domain/display-format";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";

import { ClaimStatusMark } from "./data-marks";
import { BRIDGE_LABELS } from "./labels";

/**
 * Puente enterprise value → equity → valor por acción.
 *
 * Cada componente lleva su signo escrito además de su posición: leer el signo
 * de una resta a partir del color o del alineado es exactamente donde se cuelan
 * los errores. El estado de la claim viaja al lado porque un cero por ausencia
 * declarada y un cero reportado no significan lo mismo.
 */
export function EquityBridgeTable({ run }: { run: ValuationRun }) {
  const result = run.result;

  if (result === null) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Puente de valor</CardTitle>
        <CardDescription>
          Del enterprise value al valor por acción, con el signo y el estado de
          cada claim. Valores en {run.currency}.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0">
        <Table containerLabel="Puente de valor, tabla desplazable">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Componente</TableHead>
              <TableHead scope="col">Signo</TableHead>
              <TableHead scope="col" className="text-right">
                Importe
              </TableHead>
              <TableHead scope="col">Estado</TableHead>
              <TableHead scope="col" className="w-[38%]">
                Motivo registrado
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableHead scope="row" className="font-medium">
                Enterprise value
              </TableHead>
              <TableCell className="text-muted-foreground">Base</TableCell>
              <TableCell className="numeric text-right font-medium">
                {formatAmount(result.enterpriseValue)}
              </TableCell>
              <TableCell className="text-muted-foreground">Calculado</TableCell>
              <TableCell className="text-muted-foreground whitespace-normal">
                Suma de los valores presentes explícitos y del valor terminal
                descontado.
              </TableCell>
            </TableRow>

            {result.bridgeComponents.map((component) => (
              <TableRow key={component.key}>
                <TableHead scope="row" className="font-medium">
                  {BRIDGE_LABELS[component.key]}
                </TableHead>
                <TableCell>
                  <span aria-hidden="true" className="numeric">
                    {component.sign === "add" ? "+" : "−"}
                  </span>
                  <span className="sr-only">
                    {component.sign === "add" ? "Suma" : "Resta"}
                  </span>
                </TableCell>
                <TableCell className="numeric text-right">
                  {formatAmount(component.value)}
                </TableCell>
                <TableCell>
                  <ClaimStatusMark status={component.status} />
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-normal">
                  {component.rationale ?? (
                    <span className="text-xs">
                      Importe reportado por la fuente.
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableHead scope="row" className="font-medium">
                Equity value
              </TableHead>
              <TableCell className="text-muted-foreground">Resultado</TableCell>
              <TableCell className="numeric text-right font-medium">
                {formatAmount(result.equityValue)}
              </TableCell>
              <TableCell className="text-muted-foreground">Calculado</TableCell>
              <TableCell className="text-muted-foreground whitespace-normal">
                Dividido por{" "}
                <span className="numeric text-foreground">
                  {formatShares(result.dilutedShares)}
                </span>{" "}
                acciones diluidas da{" "}
                <span className="numeric text-foreground">
                  {formatAmount(result.valuePerShare)} {run.currency}
                </span>{" "}
                por acción.
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}
