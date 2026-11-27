import {
  BookOpen,
  Calculator,
  CheckCircle2,
  CircleSlash,
  Clock3,
  FileText,
  FlaskConical,
  OctagonX,
  ScanText,
  Sliders,
  TriangleAlert,
  UserCheck,
} from "lucide-react";
import type { ComponentType } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClaimStatus } from "@/modules/valuation/domain/valuation-input";
import type { FreshnessLevel } from "@/modules/valuation/domain/valuation-report";
import type {
  RunReview,
  RunReviewMark,
} from "@/modules/valuation/domain/run-review";
import type { ValuationRunStatus } from "@/modules/valuation/domain/valuation-run";

/**
 * Marcas de datos de la superficie de valuación.
 *
 * `StatusMark` describe la disponibilidad de una capacidad; estas describen la
 * naturaleza de un dato. Son categorías distintas y mezclarlas haría que
 * “listo” signifique dos cosas en la misma página.
 *
 * Cada marca lleva icono, etiqueta y color: el color nunca es el único canal
 * (`UI-03`), y el prefijo para lector de pantalla nombra la dimensión que se
 * está calificando.
 */
type MarkConfig = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  className: string;
};

const NEUTRAL = "border-border bg-muted text-muted-foreground";
const POSITIVE = "border-positive-border bg-positive-surface text-positive";
const CAUTION = "border-warning-border bg-warning-surface text-warning";
const BLOCKED = "border-negative-border bg-negative-surface text-negative";
const INFORMATIVE = "border-info-border bg-info-surface text-info";

function Mark({
  config,
  prefix,
  className,
}: {
  config: MarkConfig;
  prefix: string;
  className?: string;
}) {
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn("gap-1", config.className, className)}
    >
      <Icon aria-hidden="true" />
      <span className="sr-only">{prefix}: </span>
      {config.label}
    </Badge>
  );
}

const RUN_STATUS: Record<ValuationRunStatus, MarkConfig> = {
  computed: {
    label: "Calculada",
    icon: CheckCircle2,
    className: POSITIVE,
  },
  requires_review: {
    label: "Requiere revisión",
    icon: TriangleAlert,
    className: CAUTION,
  },
  rejected: { label: "Rechazada", icon: OctagonX, className: BLOCKED },
};

export function RunStatusMark({ status }: { status: ValuationRunStatus }) {
  return <Mark config={RUN_STATUS[status]} prefix="Estado de la corrida" />;
}

/**
 * «Experimental» rotula el método, no el resultado (`F6-51`): falla siempre,
 * así que no comparte el ámbar de un control que falló en esta corrida.
 */
const REVIEW_MARK: Record<RunReviewMark, MarkConfig> = {
  ...RUN_STATUS,
  experimental: {
    label: "Experimental",
    icon: FlaskConical,
    className: NEUTRAL,
  },
};

/** Un control que rotula el método: no pasó ni falló en esta corrida. */
export function ExperimentalMark() {
  return <Mark config={REVIEW_MARK.experimental} prefix="Resultado" />;
}

/** El estado leído por `run-review-1.0.0`: una o dos marcas, en orden. */
export function RunReviewMarks({ review }: { review: RunReview }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {review.marks.map((mark) => (
        <Mark
          key={mark}
          config={REVIEW_MARK[mark]}
          prefix="Estado de la corrida"
        />
      ))}
    </span>
  );
}

const EVIDENCE_KIND = {
  reported_fact: {
    label: "Hecho reportado",
    icon: FileText,
    className: INFORMATIVE,
  },
  assumption: { label: "Supuesto", icon: Sliders, className: CAUTION },
  /*
   * Las tres que siguen son supuestos con su origen nombrado (`F6-03`). Comparten
   * el ámbar del supuesto porque son juicio, no dato; el icono y la etiqueta
   * dicen quién juzgó.
   */
  derived_by_rule: {
    label: "Derivado por regla",
    icon: Calculator,
    className: CAUTION,
  },
  ai_proposal: { label: "Propuesta de IA", icon: ScanText, className: CAUTION },
  owner_declaration: {
    label: "Declaración del owner",
    icon: UserCheck,
    className: CAUTION,
  },
  /** Una tabla publicada por un tercero, fechada por su release. */
  reference_data: {
    label: "Dato de referencia",
    icon: BookOpen,
    className: NEUTRAL,
  },
  declared_absent: {
    label: "Ausencia declarada",
    icon: CircleSlash,
    className: NEUTRAL,
  },
} as const satisfies Record<string, MarkConfig>;

export type EvidenceKind = keyof typeof EVIDENCE_KIND;

/**
 * Separa lo que una fuente reportó de lo que el modelo supone. Es la distinción
 * que impide leer un supuesto como si fuera un dato.
 */
export function EvidenceKindMark({
  kind,
  className,
}: {
  kind: EvidenceKind;
  className?: string;
}) {
  return (
    <Mark
      config={EVIDENCE_KIND[kind]}
      prefix="Naturaleza del dato"
      className={className}
    />
  );
}

const CLAIM_STATUS: Record<ClaimStatus, MarkConfig> = {
  reported: EVIDENCE_KIND.reported_fact,
  declared_absent: EVIDENCE_KIND.declared_absent,
  // Un faltante bloquea la corrida antes de llegar acá; si aparece, se dice.
  missing: { label: "Faltante", icon: OctagonX, className: BLOCKED },
};

export function ClaimStatusMark({ status }: { status: ClaimStatus }) {
  return <Mark config={CLAIM_STATUS[status]} prefix="Estado de la claim" />;
}

const FRESHNESS: Record<FreshnessLevel, MarkConfig> = {
  current: { label: "Vigente", icon: CheckCircle2, className: POSITIVE },
  aging: { label: "Envejecido", icon: Clock3, className: CAUTION },
  stale: { label: "Vencido", icon: TriangleAlert, className: BLOCKED },
  posterior: {
    label: "Posterior a la valuación",
    icon: OctagonX,
    className: BLOCKED,
  },
};

export function FreshnessMark({
  level,
  coverageGapDays,
}: {
  level: FreshnessLevel;
  coverageGapDays: number;
}) {
  const config = FRESHNESS[level];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn("gap-1", config.className)}>
      <Icon aria-hidden="true" />
      <span className="sr-only">Antigüedad del dato: </span>
      {config.label}
      {/*
       * La distancia se distingue por peso y no por opacidad. `opacity-80`
       * sobre las superficies teñidas de ámbar y esmeralda bajaba el texto por
       * debajo de 4.5:1 —lo detectó el gate de `F1-07`—, y atenuar es
       * justamente el canal que el contrato visual no permite gastar acá.
       */}
      <span className="numeric font-normal">
        <span className="sr-only">, distancia a la fecha de valuación: </span>
        {coverageGapDays} d
      </span>
    </Badge>
  );
}
