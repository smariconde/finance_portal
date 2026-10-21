import { RIGOR_COPY } from "@/app/valuacion/_components/job-copy";
import {
  CodeValue,
  Field,
  FieldList,
} from "@/app/valuacion/_components/run/field";
import { ASSET_PROFILE_LABELS } from "@/app/valuacion/_components/run/labels";
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
import { cn } from "@/lib/utils";
import type { CompletenessStatus } from "@/modules/valuation/domain/completeness-profile";
import { formatCalendarDate } from "@/modules/valuation/domain/display-format";
import type { RigorLevel } from "@/modules/valuation/domain/rigor-level";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";

import {
  COMPLETENESS_STATUS_LABELS,
  completenessCheckLabel,
  CONFIDENCE_LABELS,
  degradationLabel,
  rigorDeclarationLabel,
} from "./labels";

/** Qué promete cada nivel, en una frase. */
const RIGOR_MEANING: Record<RigorLevel, string> = {
  full: "Todas las comprobaciones de completitud se cumplen.",
  standard:
    "Alcanza para valuar, con aproximaciones que la corrida declara abajo.",
  screening:
    "Sirve para una primera lectura: faltan datos que mueven el resultado.",
  unsupported: "Los datos no alcanzan para valuar con este método.",
};

const STATUS_TONE: Record<CompletenessStatus, string> = {
  met: "text-foreground",
  partial: "text-amber-800 dark:text-amber-300",
  missing: "text-rose-800 dark:text-rose-300",
  not_evaluated: "text-muted-foreground",
};

function measuresOf(measures: Record<string, number>): string {
  if (measures.years !== undefined) {
    return `${measures.years} ejercicios`;
  }

  if (measures.present !== undefined && measures.required !== undefined) {
    return `${measures.present} de ${measures.required}`;
  }

  return "—";
}

/**
 * El nivel de rigor de la corrida, con lo que lo sostiene (`F3-01`–`F3-03`).
 *
 * Va pegado al resultado porque el valor por acción no se lee sin él: un
 * resultado `standard` dice qué aproximó, y cada comprobación de completitud
 * se lista con su estado, también las cumplidas, para que una ausencia no se
 * confunda con algo que nadie midió.
 */
export function RigorPanel({ run }: { run: ValuationRun }) {
  const { rigor, selection, completeness } = run.input.assessment;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2" id="rigor-title">
          Rigor y método
        </CardTitle>
        <CardDescription>
          El selector eligió el método por reglas explícitas y el rigor se
          deriva de lo que había guardado. El motor recalculó los dos y rechaza
          un nivel escrito a mano.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-8">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              Nivel de rigor
            </p>
            <p className="text-2xl font-semibold tracking-tight">
              {RIGOR_COPY[rigor.level]}
            </p>
            <p className="text-sm text-muted-foreground">
              {RIGOR_MEANING[rigor.level]}
            </p>
          </div>

          {rigor.degradedBy.length === 0 ? null : (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">
                Qué impidió el nivel siguiente
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {rigor.degradedBy.map((code) => (
                  <li key={code}>
                    <Badge variant="outline">{degradationLabel(code)}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rigor.declarations.length === 0 ? null : (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Aproximaciones declaradas</h3>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                {rigor.declarations.map((code) => (
                  <li key={code}>{rigorDeclarationLabel(code)}</li>
                ))}
              </ul>
            </div>
          )}

          <FieldList className="sm:grid-cols-2">
            <Field term="Perfil del activo">
              {ASSET_PROFILE_LABELS[selection.assetProfile ?? ""] ??
                selection.assetProfile ??
                "—"}
            </Field>
            <Field
              term="Confianza del selector"
              hint="Ordinal, no una probabilidad"
            >
              {CONFIDENCE_LABELS[selection.confidence ?? ""] ??
                selection.confidence ??
                "—"}
            </Field>
            <Field term="Método recomendado">
              <CodeValue>{selection.recommendedMethod ?? "—"}</CodeValue>
            </Field>
            <Field term="Reglas que se activaron">
              {selection.activatedRules.length === 0
                ? "—"
                : selection.activatedRules.map((rule) => (
                    <CodeValue key={rule} className="mr-1">
                      {rule}
                    </CodeValue>
                  ))}
            </Field>
          </FieldList>

          <p className="text-xs text-muted-foreground">
            <CodeValue>{selection.version}</CodeValue>{" "}
            <CodeValue>{rigor.version}</CodeValue>
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-medium">
              Comprobaciones de completitud
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Medidas sobre el último ejercicio publicado,{" "}
              <time
                className="numeric"
                dateTime={completeness.latestFiscalYearEnd ?? undefined}
              >
                {completeness.latestFiscalYearEnd === null
                  ? "sin ejercicio"
                  : formatCalendarDate(completeness.latestFiscalYearEnd)}
              </time>
              . <CodeValue>{completeness.version}</CodeValue>
            </p>
          </div>
          <Table containerLabel="Comprobaciones de completitud, tabla desplazable">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Comprobación</TableHead>
                <TableHead scope="col">Estado</TableHead>
                <TableHead scope="col" className="text-right">
                  Medida
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {completeness.checks.map((check) => (
                <TableRow key={check.check}>
                  <TableHead
                    scope="row"
                    className="font-medium whitespace-normal"
                  >
                    {completenessCheckLabel(check.check)}
                    {check.missing.length === 0 ? null : (
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        {/*
                         * Texto mono sin chip: el padding del chip desbordaba
                         * la celda un píxel y volvía desplazable la tabla.
                         */}
                        Falta:{" "}
                        <span className="font-mono break-all">
                          {check.missing.join(", ")}
                        </span>
                      </span>
                    )}
                  </TableHead>
                  <TableCell
                    className={cn("font-medium", STATUS_TONE[check.status])}
                  >
                    {COMPLETENESS_STATUS_LABELS[check.status]}
                  </TableCell>
                  <TableCell className="numeric text-right text-muted-foreground">
                    {measuresOf(check.measures)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
