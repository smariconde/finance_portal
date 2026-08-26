import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  formatAmount,
  formatCalendarDate,
  formatPercent,
  formatUtcTimestamp,
} from "@/modules/valuation/domain/display-format";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";

import { RunStatusMark } from "./data-marks";
import { CodeValue, Field, FieldList, HashValue } from "./field";
import {
  ADJUSTMENT_POLICY_LABELS,
  ASSET_PROFILE_LABELS,
  KNOWLEDGE_BASIS_LABELS,
  REVISION_POLICY_LABELS,
} from "./labels";

/**
 * Respuesta de la corrida junto al contrato que la hace defendible.
 *
 * El valor y su corte de conocimiento comparten bloque a propósito: un valor
 * por acción sin decir bajo qué conocimiento se calculó es exactamente el
 * número que después nadie puede reproducir.
 */
export function RunHeadline({ run }: { run: ValuationRun }) {
  const knowledge = run.provenance.knowledge;
  const result = run.result;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Resultado de la corrida</CardTitle>
        <CardDescription>
          Valor por acción bajo los supuestos declarados. No es un precio
          objetivo ni una recomendación.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-8">
        <div className="flex flex-col gap-4">
          {result === null ? (
            <div className="space-y-2">
              <p className="text-2xl font-semibold tracking-tight">
                Sin valor calculado
              </p>
              <p className="text-sm text-muted-foreground">
                La corrida quedó registrada con su motivo de rechazo. Un valor
                no calculado se explica; no se reemplaza por un cero.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Valor por acción
              </p>
              <p className="numeric flex flex-wrap items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
                  {formatAmount(result.valuePerShare)}
                </span>
                <span className="text-lg font-medium text-muted-foreground">
                  {run.currency}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Valor exacto del motor:{" "}
                <CodeValue>{result.valuePerShare}</CodeValue>
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <RunStatusMark status={run.status} />
            {result?.terminalValueShare == null ? null : (
              <span className="numeric text-xs text-muted-foreground">
                Valor terminal:{" "}
                {formatPercent(result.terminalValueShare, { scale: 1 })} del
                enterprise value
              </span>
            )}
          </div>

          {run.failure === null ? null : (
            <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-sm dark:border-rose-900 dark:bg-rose-950/30">
              <p className="font-medium">Motivo del rechazo</p>
              <p className="mt-1 text-muted-foreground">
                {run.failure.message}
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-1 text-xs">
                <CodeValue>{run.failure.code}</CodeValue>
                {run.failure.subjects.map((subject) => (
                  <CodeValue key={subject}>{subject}</CodeValue>
                ))}
              </p>
            </div>
          )}

          <Separator className="lg:hidden" />

          <FieldList className="sm:grid-cols-2">
            <Field term="Fecha de valuación">
              <time className="numeric" dateTime={run.asOf}>
                {formatCalendarDate(run.asOf)}
              </time>
            </Field>
            <Field term="Perfil del activo">
              {ASSET_PROFILE_LABELS[run.assetProfile] ?? run.assetProfile}
            </Field>
            <Field term="Método" hint={`Motor ${run.engineVersion}`}>
              <CodeValue>{run.method}</CodeValue>
            </Field>
            <Field term="Moneda de la valuación">{run.currency}</Field>
          </FieldList>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4">
          <div>
            <h3 className="text-sm font-medium">Cómo se leyeron los datos</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Contrato point-in-time de la corrida. Una publicación posterior al
              corte no puede haber entrado en este resultado.
            </p>
          </div>

          <FieldList className="sm:grid-cols-2">
            <Field term="Tiempo efectivo">
              <time className="numeric" dateTime={knowledge.effectiveAt}>
                {formatUtcTimestamp(knowledge.effectiveAt)}
              </time>
            </Field>
            <Field term="Corte de conocimiento">
              {knowledge.knownAt === null ? (
                <span className="text-muted-foreground">
                  Sin corte: vista actual
                </span>
              ) : (
                <time className="numeric" dateTime={knowledge.knownAt}>
                  {formatUtcTimestamp(knowledge.knownAt)}
                </time>
              )}
            </Field>
            <Field term="Política de revisión">
              {REVISION_POLICY_LABELS[knowledge.revisionPolicy] ??
                knowledge.revisionPolicy}
            </Field>
            <Field term="Base de conocimiento">
              {KNOWLEDGE_BASIS_LABELS[knowledge.knowledgeBasis] ??
                knowledge.knowledgeBasis}
            </Field>
            <Field term="Acciones societarias">
              {ADJUSTMENT_POLICY_LABELS[knowledge.adjustmentPolicy] ??
                knowledge.adjustmentPolicy}
            </Field>
            <Field term="Política de fuentes">
              <CodeValue>{knowledge.sourcePolicyVersion}</CodeValue>
            </Field>
          </FieldList>

          <Separator />

          <div>
            <h3 className="text-sm font-medium">Reproducibilidad</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              El mismo snapshot canónico produce estos mismos hashes bajo otro
              identificador de corrida.
            </p>
          </div>

          <FieldList className="sm:grid-cols-1">
            <Field term="Hash del snapshot de entrada">
              <HashValue hash={run.inputHash} />
            </Field>
            <Field term="Hash del resultado">
              {run.resultHash === null ? (
                <span className="text-muted-foreground">
                  Sin resultado: la corrida fue rechazada
                </span>
              ) : (
                <HashValue hash={run.resultHash} />
              )}
            </Field>
            <Field
              term="Política decimal"
              hint={`Metodología ${run.methodologyVersion}`}
            >
              <span className="numeric">
                {run.decimalPolicy.precision} dígitos ·{" "}
                {run.decimalPolicy.rounding}
              </span>
            </Field>
          </FieldList>
        </div>
      </CardContent>
    </Card>
  );
}
