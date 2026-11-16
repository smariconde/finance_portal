import type { SectorRiskQuality } from "@/modules/metrics/domain/sector-risk-quality";

/**
 * La nota de una matriz dicha en una palabra: «98/100 · Degradada» se leía como
 * una contradicción, porque no decía qué la degradaba. El veredicto nombra el
 * primer componente que falla, en el orden en que se arregla: precios que no
 * hay, un cierre viejo, Sortinos sin calcular, la referencia sin valor.
 */
export type QualityVerdict = {
  readonly state: "ready" | "degraded" | "empty";
  /** `98/100`, o `null` si el sector no tiene población. */
  readonly score: string | null;
  /** Lo que la degrada, en el orden en que se arregla; vacío si está completa. */
  readonly reasons: readonly string[];
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function qualityVerdict(quality: SectorRiskQuality): QualityVerdict {
  if (quality.score === null) {
    return { state: "empty", score: null, reasons: ["Sector vacío"] };
  }

  const reasons: string[] = [];
  const score = `${quality.score}/100`;

  if (quality.seriesWithoutRows > 0) {
    reasons.push(`${quality.seriesWithoutRows} sin precios`);
  }

  if (quality.components.freshness < 100) {
    reasons.push(
      `Cierre de hace ${plural(quality.daysSinceClose, "día", "días")}`,
    );
  }

  if (quality.components.comparability === 0 && quality.comparable > 0) {
    // Hay securities con las dos ventanas y aun así ninguna es comparable:
    // a la referencia le falta el Sortino. Con cero comparables, la nota es
    // cero por las securities, no por la referencia.
    reasons.push("Referencia sin Sortino");
  }

  // Las que no tienen precios ya están nombradas: no se cuentan dos veces.
  const incomplete =
    quality.population - quality.comparable - quality.seriesWithoutRows;

  if (incomplete > 0) {
    reasons.push(`${incomplete} sin Sortino`);
  }

  if (quality.status === "ready") {
    return { state: "ready", score, reasons: [] };
  }

  return {
    state: "degraded",
    score,
    reasons: reasons.length === 0 ? ["Degradada"] : reasons,
  };
}
