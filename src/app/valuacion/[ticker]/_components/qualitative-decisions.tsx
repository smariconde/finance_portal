import {
  EvidenceKindMark,
  type EvidenceKind,
} from "@/app/valuacion/_components/run/data-marks";
import {
  CodeValue,
  Field,
  FieldList,
  HashValue,
} from "@/app/valuacion/_components/run/field";
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
  formatCalendarDate,
  formatPercent,
  formatShares,
  formatUtcTimestamp,
} from "@/modules/valuation/domain/display-format";
import type { EvidenceDigest } from "@/modules/valuation/domain/qualitative-decisions";
import type { ValuationRun } from "@/modules/valuation/domain/valuation-run";

import { CONFIDENCE_LABELS } from "./labels";

/**
 * Lo cualitativo de la corrida: la industria de Damodaran, el mix geográfico
 * que pondera el riesgo país y las opciones y unidades de empleados.
 *
 * Cada decisión dice **quién la tomó** —una regla sobre el SIC, el owner o la
 * IA— y qué la sostiene. Una propuesta de IA se muestra con su modelo, sus
 * versiones y la cita del filing; el valor que mueve lo calculó el código
 * (ADR 0007: la IA propone, el motor calcula).
 */
function DecisionHeading({
  title,
  kind,
}: {
  title: string;
  kind: EvidenceKind;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <EvidenceKindMark kind={kind} />
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: readonly EvidenceDigest[] }) {
  return (
    <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
      {evidence.map((item) => (
        <li key={item.evidenceId} className="flex flex-wrap items-center gap-1">
          <CodeValue>{item.evidenceId}</CodeValue>
          <span>{item.section}</span>
          {item.accessionNumber === null ? (
            <span>búsqueda web</span>
          ) : (
            <CodeValue>{item.accessionNumber}</CodeValue>
          )}
          <HashValue hash={item.sha256} />
          {item.truncated ? <span>recortado</span> : null}
        </li>
      ))}
    </ul>
  );
}

function IndustryDecision({ run }: { run: ValuationRun }) {
  const decision = run.input.qualitativeDecisions.industry;

  if (decision === null) {
    return (
      <section className="flex flex-col gap-3">
        <DecisionHeading title="Industria" kind="declared_absent" />
        <p className="text-sm text-muted-foreground">
          La corrida no tiene industria de Damodaran asignada.
        </p>
      </section>
    );
  }

  const kind: EvidenceKind =
    decision.basis === "sic"
      ? "derived_by_rule"
      : decision.basis === "owner_declaration"
        ? "owner_declaration"
        : "ai_proposal";

  return (
    <section className="flex flex-col gap-3">
      <DecisionHeading title="Industria de Damodaran" kind={kind} />
      <FieldList className="sm:grid-cols-3">
        <Field term="Industria">
          <CodeValue>{decision.industryKey}</CodeValue>
        </Field>
        <Field term="SIC observado">
          {decision.sic === null ? (
            "—"
          ) : (
            <span className="numeric">{decision.sic}</span>
          )}
        </Field>
        <Field
          term="Mapeo"
          hint={`${decision.candidates.length} candidata${decision.candidates.length === 1 ? "" : "s"}`}
        >
          <CodeValue>{decision.mappingVersion}</CodeValue>
        </Field>
      </FieldList>
      {decision.basis === "sic" ? (
        <p className="text-sm text-muted-foreground">
          El SIC tiene una sola industria candidata, así que la regla la asigna
          sin que nadie la elija.
        </p>
      ) : decision.basis === "owner_declaration" ? (
        <p className="text-sm text-muted-foreground">
          Declarada por el owner el{" "}
          <time dateTime={decision.declaredOn}>
            {formatCalendarDate(decision.declaredOn)}
          </time>
          : {decision.rationale}
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">
            El SIC tenía {decision.candidates.length} candidatas (
            {decision.candidates.join(", ")}). La IA eligió una citando el 10-K
            y la policy la aceptó: {decision.resolution.rationale}
          </p>
          <FieldList className="sm:grid-cols-3">
            <Field
              term="Modelo"
              hint={`Escalón ${decision.resolution.acceptedRung}`}
            >
              <CodeValue>{decision.resolution.respondedModel}</CodeValue>
            </Field>
            <Field term="Confianza">
              {CONFIDENCE_LABELS[decision.resolution.confidence]}
            </Field>
            <Field term="Resuelta">
              <time
                className="numeric"
                dateTime={decision.resolution.resolvedAt}
              >
                {formatUtcTimestamp(decision.resolution.resolvedAt)}
              </time>
            </Field>
          </FieldList>
          <EvidenceList evidence={decision.resolution.evidence} />
        </div>
      )}
    </section>
  );
}

function OperationsMixDecision({ run }: { run: ValuationRun }) {
  const decision = run.input.qualitativeDecisions.operationsMix;
  const exposure = run.input.costOfCapital.operationsExposure ?? null;

  if (decision === null || exposure === null) {
    return (
      <section className="flex flex-col gap-3">
        <DecisionHeading
          title="Mix geográfico de ingresos"
          kind="declared_absent"
        />
        <p className="text-sm text-muted-foreground">
          No hay un mix aceptado a este corte: la prima de riesgo país sale del
          país del listing primario, y el rigor lo declara.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <DecisionHeading
        title="Mix geográfico de ingresos"
        kind={
          decision.source === "ai_proposal"
            ? "ai_proposal"
            : "owner_declaration"
        }
      />
      {decision.source === "ai_proposal" ? (
        <p className="text-sm text-muted-foreground">
          La IA transcribió la tabla geográfica del 10-K{" "}
          <CodeValue>{decision.proposal.accessionNumber}</CodeValue> línea por
          línea y la policy verificó cada monto contra su cita y el total contra
          las ventas del ejercicio. Los pesos los calculó el código. Modelo{" "}
          <CodeValue>{decision.proposal.respondedModel}</CodeValue>, confianza{" "}
          {CONFIDENCE_LABELS[decision.proposal.confidence]}.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Declarado por el owner el{" "}
          <time dateTime={decision.declaredOn}>
            {formatCalendarDate(decision.declaredOn)}
          </time>
          : {decision.rationale}
        </p>
      )}
      <Table containerLabel="Exposiciones del mix geográfico, tabla desplazable">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Exposición</TableHead>
            <TableHead scope="col" className="text-right">
              Peso
            </TableHead>
            <TableHead scope="col" className="text-right">
              Filas de riesgo país
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {exposure.exposures.map((item, index) => (
            <TableRow key={`${item.exposureKeys.join("+")}-${index}`}>
              <TableHead scope="row" className="font-medium whitespace-normal">
                {item.exposureKeys.length === 0
                  ? "Resto del mundo"
                  : item.exposureKeys.join(", ")}
              </TableHead>
              <TableCell className="numeric text-right">
                {formatPercent(item.weight, { scale: 1 })}
              </TableCell>
              <TableCell className="numeric text-right text-muted-foreground">
                {item.components.length}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {decision.source === "ai_proposal" ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            Líneas transcriptas, como se imprimieron ({decision.lines.length})
          </summary>
          <ol className="mt-2 flex flex-col gap-2">
            {decision.lines.map((line) => (
              <li key={line.ordinal} className="rounded-lg border p-2">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{line.label}</span>
                  <span className="numeric">{line.printedAmount}</span>
                </p>
                <blockquote className="mt-1 text-xs text-muted-foreground">
                  «{line.quote}»
                </blockquote>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

function EmployeeEquityDecision({ run }: { run: ValuationRun }) {
  const claim = run.input.employeeEquity;
  const { decision, derived } = claim;
  const options = derived.reading.options;
  const sharedFields = (
    <>
      <Field
        term="Unidades no consolidadas"
        hint={
          derived.reading.unitsBasis === "not_reported"
            ? "No publicadas: no suman al denominador"
            : "RSU y PSU, suman al denominador"
        }
      >
        <span className="numeric">
          {formatShares(derived.reading.unvestedUnits)}
        </span>
      </Field>
      <Field term="Acciones del denominador" hint="Carátula más unidades">
        <span className="numeric">{formatShares(derived.shareCount)}</span>
      </Field>
    </>
  );

  if (decision.basis === "not_subtracted") {
    return (
      <section className="flex flex-col gap-3">
        <DecisionHeading
          title="Opciones y unidades de empleados"
          kind="declared_absent"
        />
        <p className="text-sm text-muted-foreground">
          No se restan. No hay una transcripción aceptada de la nota de
          compensación en acciones del ejercicio{" "}
          <time dateTime={decision.fiscalYearEnd}>
            {formatCalendarDate(decision.fiscalYearEnd)}
          </time>
          , y el XBRL de la misma presentación no publica la cantidad y el
          strike de las opciones vivas. Si la empresa tiene opciones, el valor
          por acción es una cota superior; por eso el rigor baja un nivel.
        </p>
        <FieldList className="sm:grid-cols-3">
          {sharedFields}
          <Field term="Regla">
            <CodeValue>{decision.version}</CodeValue>
          </Field>
        </FieldList>
      </section>
    );
  }

  if (decision.basis === "xbrl_same_10k") {
    return (
      <section className="flex flex-col gap-3">
        <DecisionHeading
          title="Opciones y unidades de empleados"
          kind="reported_fact"
        />
        <p className="text-sm text-muted-foreground">
          Del XBRL de la presentación{" "}
          <CodeValue>{decision.sourceDocumentId}</CodeValue> al cierre del
          ejercicio{" "}
          <time dateTime={decision.fiscalYearEnd}>
            {formatCalendarDate(decision.fiscalYearEnd)}
          </time>
          , porque no hay una transcripción aceptada de la nota. El XBRL no trae
          el plazo remanente: las opciones se valúan a{" "}
          {options.status === "outstanding" ? options.maturityYears : "10"}{" "}
          años, el plazo contractual de una opción de empleado, que es su cota
          superior y resta lo más posible.
        </p>
        <FieldList className="sm:grid-cols-3">
          <Field term="Opciones">
            {options.status === "outstanding"
              ? `${formatShares(options.count)} a ${options.strike}`
              : "Ninguna en el XBRL"}
          </Field>
          {sharedFields}
          <Field term="Regla">
            <CodeValue>{decision.version}</CodeValue>
          </Field>
        </FieldList>
      </section>
    );
  }

  const transcription = decision.transcription;

  return (
    <section className="flex flex-col gap-3">
      <DecisionHeading
        title="Opciones y unidades de empleados"
        kind="ai_proposal"
      />
      <p className="text-sm text-muted-foreground">
        Transcriptas de la nota de compensación en acciones del 10-K{" "}
        <CodeValue>{decision.accessionNumber}</CodeValue> (ejercicio{" "}
        <time dateTime={decision.fiscalYearEnd}>
          {formatCalendarDate(decision.fiscalYearEnd)}
        </time>
        ) y corroboradas contra el XBRL del mismo filing.{" "}
        {transcription.rationale}
      </p>
      <FieldList className="sm:grid-cols-3">
        <Field term="Opciones">
          {options.status === "outstanding"
            ? `${formatShares(options.count)} a ${options.strike}`
            : "Ninguna en la nota"}
        </Field>
        {sharedFields}
        <Field
          term="Modelo"
          hint={`Confianza ${CONFIDENCE_LABELS[transcription.confidence] ?? transcription.confidence}`}
        >
          <CodeValue>{decision.respondedModel}</CodeValue>
        </Field>
        <Field term="Policy">
          <CodeValue>{decision.policyVersion}</CodeValue>
        </Field>
        <Field term="Nota del filing">
          <HashValue hash={decision.evidenceSha256} />
        </Field>
      </FieldList>
      {transcription.units.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {transcription.units.map((unit, index) => (
            <li key={`${unit.kind}-${index}`}>
              <blockquote className="rounded-lg border p-2 text-xs text-muted-foreground">
                «{unit.quote}»
              </blockquote>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function QualitativeDecisions({ run }: { run: ValuationRun }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Decisiones cualitativas</CardTitle>
        <CardDescription>
          Lo que no es un número reportado pero mueve el resultado. Cada
          decisión dice quién la tomó y qué la sostiene; ninguna se recalcula al
          leer esta página.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 divide-y [&>*:not(:last-child)]:pb-6">
        <IndustryDecision run={run} />
        <OperationsMixDecision run={run} />
        <EmployeeEquityDecision run={run} />
      </CardContent>
    </Card>
  );
}
