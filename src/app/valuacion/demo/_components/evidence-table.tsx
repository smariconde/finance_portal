import { Badge } from "@/components/ui/badge";
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
  formatAmount,
  formatCalendarDate,
  formatShares,
  formatUtcTimestamp,
} from "@/modules/valuation/domain/display-format";
import {
  FRESHNESS_THRESHOLD_DAYS,
  type DeclaredAbsence,
  type ReportedFact,
} from "@/modules/valuation/domain/valuation-report";

import { EvidenceKindMark, FreshnessMark } from "./data-marks";
import { CodeValue } from "./field";
import { FACT_LABELS, qualityFlagLabel } from "./labels";

/**
 * Evidencia del snapshot: qué reportó una fuente, cuándo fue conocible, con qué
 * antigüedad entra en esta valuación y qué se declaró ausente.
 *
 * Las ausencias comparten card con los hechos, pero no comparten tabla: un
 * `declared_absent` vale cero **con motivo registrado** y ponerlo como una fila
 * de valor cero sería precisamente el error que `TM-05` prohíbe.
 */
function factValue(fact: ReportedFact) {
  if (fact.unit === "shares") {
    return (
      <>
        <span className="numeric">{formatShares(fact.value)}</span>{" "}
        <span className="text-xs text-muted-foreground">acciones</span>
      </>
    );
  }

  return (
    <>
      <span className="numeric">{formatAmount(fact.value)}</span>{" "}
      <span className="text-xs text-muted-foreground">{fact.currency}</span>
    </>
  );
}

export function EvidenceTable({
  facts,
  absences,
  policyVersion,
}: {
  facts: readonly ReportedFact[];
  absences: readonly DeclaredAbsence[];
  policyVersion: string;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Evidencia que sostiene el resultado</CardTitle>
        <CardDescription>
          Cada hecho conserva fuente, documento, fecha de cierre, disponibilidad
          pública y banderas de calidad. Sin esa fila, el número no es
          auditable.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0">
        <Table containerLabel="Hechos reportados, tabla desplazable">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Concepto</TableHead>
              <TableHead scope="col" className="text-right">
                Valor
              </TableHead>
              <TableHead scope="col">Cierre</TableHead>
              <TableHead scope="col">Disponible desde</TableHead>
              <TableHead scope="col">Antigüedad</TableHead>
              <TableHead scope="col">Fuente y documento</TableHead>
              <TableHead scope="col">Calidad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {facts.map((fact) => (
              <TableRow key={fact.id}>
                <TableCell className="font-medium">
                  <div className="flex flex-col gap-1">
                    <span>{FACT_LABELS[fact.id] ?? fact.id}</span>
                    <EvidenceKindMark kind="reported_fact" className="w-fit" />
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {factValue(fact)}
                </TableCell>
                <TableCell>
                  <time className="numeric" dateTime={fact.asOf}>
                    {formatCalendarDate(fact.asOf)}
                  </time>
                </TableCell>
                <TableCell>
                  <time className="numeric" dateTime={fact.availableAt}>
                    {formatUtcTimestamp(fact.availableAt)}
                  </time>
                </TableCell>
                <TableCell>
                  <FreshnessMark
                    level={fact.freshness.level}
                    coverageGapDays={fact.freshness.coverageGapDays}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <CodeValue>{fact.sourceId}</CodeValue>
                    {fact.sourceDocumentId === null ? (
                      <span className="text-xs text-muted-foreground">
                        Sin documento declarado
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {fact.sourceDocumentId}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {fact.qualityFlags.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      Sin banderas
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {fact.qualityFlags.map((flag) => (
                        <Badge key={flag} variant="secondary">
                          {qualityFlagLabel(flag)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <CardContent className="border-t pt-(--card-spacing)">
        <h3 className="text-sm font-medium">Ausencias declaradas</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Estas claims valen cero porque el owner registró por qué no existen.
          Un dato que simplemente falta bloquea la corrida en vez de valer cero.
        </p>
        {absences.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            La corrida no declara ninguna ausencia.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 lg:grid-cols-3">
            {absences.map((absence) => (
              <li
                key={absence.id}
                className="rounded-lg border bg-muted/30 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {FACT_LABELS[absence.id] ?? absence.id}
                  </span>
                  <EvidenceKindMark kind="declared_absent" />
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {absence.rationale}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <CardContent className="border-t pt-(--card-spacing) text-xs text-muted-foreground">
        <p>
          La antigüedad compara el cierre del hecho con la fecha de valuación:
          hasta {FRESHNESS_THRESHOLD_DAYS.current} días es vigente, hasta{" "}
          {FRESHNESS_THRESHOLD_DAYS.aging} días es envejecido y más allá es
          vencido. Es una convención de lectura versionada{" "}
          <CodeValue>{policyVersion}</CodeValue>, no un juicio de calidad de la
          fuente.
        </p>
      </CardContent>
    </Card>
  );
}
