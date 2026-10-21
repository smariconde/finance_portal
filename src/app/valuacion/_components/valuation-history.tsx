import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ValuationHistoryEntry,
  ValuationHistoryView,
} from "@/modules/valuation/application/read-valuation-history";
import type { ComparisonSection } from "@/modules/valuation/domain/valuation-run-comparison";
import type { RigorLevel } from "@/modules/valuation/domain/rigor-level";
import type { ValuationRunStatus } from "@/modules/valuation/domain/valuation-run";

const RIGOR_COPY: Record<RigorLevel, string> = {
  full: "Pleno",
  standard: "Estándar",
  screening: "Screening",
  unsupported: "No admitido",
};

const SECTION_COPY: Record<ComparisonSection, string> = {
  baseRevenue: "ventas base",
  normalization: "ejercicio normalizado",
  capitalization: "arrendamientos e I+D",
  costOfCapital: "costo de capital",
  qualitativeDecisions: "industria o mix",
  assessment: "método o rigor",
  failureRisk: "probabilidad de fracaso",
  employeeEquity: "opciones o acciones",
  bridge: "puente a equity",
  assumptions: "supuestos",
  versions: "versiones",
  subject: "identidad",
};

const RUN_COPY: Record<ValuationRunStatus, string> = {
  computed: "Calculada",
  requires_review: "Pide revisión",
  rejected: "Rechazada",
};

function formatInstant(instant: string): string {
  return new Date(instant).toLocaleString("es-AR", {
    dateStyle: "medium",
    // Con minutos, dos refrescos seguidos se leen como la misma fila.
    timeStyle: "medium",
    timeZone: "UTC",
  });
}

function resultOf(entry: ValuationHistoryEntry): string {
  if (entry.runStatus !== null) {
    return RUN_COPY[entry.runStatus];
  }

  if (entry.gap === "snapshot_not_assembled") {
    return "Sin snapshot";
  }

  if (entry.gap === "unsupported_method") {
    return "Método no admitido";
  }

  if (entry.gap === "annual_fundamentals") {
    return "Sin fundamentals";
  }

  if (entry.gap === "assessment_failed") {
    return "No terminó";
  }

  return "Sin identidad";
}

function changesOf(entry: ValuationHistoryEntry): string {
  const { comparison } = entry;

  if (comparison === null) {
    return "—";
  }

  if (comparison.kind === "first_run") {
    return "Primera corrida";
  }

  if (comparison.kind === "same_run") {
    return "La misma corrida que la anterior";
  }

  if (comparison.sections.length === 0) {
    return comparison.cutoffChanged
      ? "Sólo el corte; los datos no cambiaron"
      : "Sin cambios por sección";
  }

  return comparison.sections.map((section) => SECTION_COPY[section]).join(", ");
}

/**
 * Las corridas anteriores del ticker (`F6-02`). Cada fila dice cómo terminó y
 * qué cambió respecto de la corrida previa. No muestra valores: es `F6-03`.
 */
export function ValuationHistory({
  view,
}: {
  readonly view: ValuationHistoryView | null;
}) {
  if (view === null) {
    return null;
  }

  if (view.state === "unavailable") {
    return (
      <p className="max-w-prose text-sm text-muted-foreground" role="status">
        No se pudo leer el historial de este ticker.
      </p>
    );
  }

  return (
    <section
      aria-labelledby="valuation-history-title"
      className="flex flex-col gap-3"
    >
      <div className="flex max-w-prose flex-col gap-1">
        <h2
          id="valuation-history-title"
          className="text-base font-semibold tracking-tight"
        >
          Corridas de <span className="font-mono">{view.ticker}</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Las últimas {view.limit}, la más nueva primero. Volver a encolar
          refresca: una corrida nueva nunca reemplaza a la anterior. Comparación{" "}
          <span className="font-mono">{view.comparisonVersion}</span>.
        </p>
      </div>
      {view.entries.length === 0 ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          Todavía no hay corridas terminadas para este ticker.
        </p>
      ) : (
        <Table containerLabel={`Corridas de ${view.ticker}, tabla desplazable`}>
          <TableHeader>
            <TableRow>
              <TableHead>Corte (UTC)</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>Rigor</TableHead>
              <TableHead className="w-[44%]">
                Cambios respecto de la anterior
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.entries.map((entry) => (
              <TableRow key={entry.knownAt}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  <time dateTime={entry.knownAt}>
                    {formatInstant(entry.knownAt)}
                  </time>
                </TableCell>
                <TableCell>{resultOf(entry)}</TableCell>
                <TableCell>
                  {entry.rigor === null ? "—" : RIGOR_COPY[entry.rigor]}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {changesOf(entry)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
