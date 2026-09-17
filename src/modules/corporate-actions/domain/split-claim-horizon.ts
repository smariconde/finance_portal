import type { SecReportedFact } from "@/modules/fundamentals/domain/parse-sec-company-facts";
import type { Observation } from "@/modules/observations/domain/observation";
import type { SourceDocument } from "@/modules/observations/domain/source-document";

/**
 * Qué ratios declarados puede juzgar la regla de evidencia (ADR 0012, ADR 0017).
 *
 * La segunda evidencia de un split son las re-expresiones de valores **ya
 * publicados** del filer. Con la ventana de historia, lo publicado empieza unos
 * seis ejercicios atrás, así que un ratio declarado antes de la primera vintage
 * sensible publicada no tiene con qué compararse. Pasárselo a la regla lo dejaría
 * como `no_coherent_reexpression` —«el filer no re-expresó»— cuando lo cierto es
 * que no se fue a buscar. Peor: sin el split viejo confirmado, un anuncio suyo
 * «corroboraría» a un split posterior con el mismo ratio (Nike declara 2:1 entre
 * 2014 y 2018).
 *
 * Esos ratios quedan afuera de la regla, nombrados. No hay nada que ajustar: todo
 * lo publicado se conoció después de ellos.
 */
export const SPLIT_CLAIM_HORIZON_VERSION = "split-claim-horizon-1.0.0";

export type SplitClaimBeforeHistory = {
  readonly accessionNumber: string;
  readonly form: string;
  readonly filed: string;
  /** Ratios declarados en la presentación, como la fuente los publicó. */
  readonly ratios: readonly string[];
  readonly code: "precedes_published_history";
};

export type SplitClaimHorizon = {
  readonly version: string;
  /** Primer instante en que se conoció una vintage sensible del filer. */
  readonly publishedFrom: string | null;
  readonly within: readonly SecReportedFact[];
  readonly before: readonly SplitClaimBeforeHistory[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Instante a partir del cual el ratio seguro se conocía. Sin documento registrado,
 * el día siguiente al filing con el offset más tardío de Nueva York: la misma cota
 * que la regla de disponibilidad, que puede llegar tarde y nunca antes.
 */
function claimKnownBy(
  filed: string,
  document: SourceDocument | undefined,
): number {
  return document === undefined
    ? Date.parse(`${filed}T05:00:00.000Z`) + DAY_MS
    : Date.parse(document.availableAt);
}

export function partitionSplitClaimsByHistory(input: {
  readonly claims: readonly SecReportedFact[];
  /** Las revisiones sensibles publicadas del filer. */
  readonly observations: readonly Observation[];
  readonly documents: readonly SourceDocument[];
}): SplitClaimHorizon {
  const publishedFrom = input.observations.reduce<number>(
    (earliest, observation) =>
      Math.min(earliest, Date.parse(observation.availableAt)),
    Number.POSITIVE_INFINITY,
  );

  if (!Number.isFinite(publishedFrom)) {
    // Sin historia no hay horizonte que aplicar: el job ni sale a la red.
    return {
      version: SPLIT_CLAIM_HORIZON_VERSION,
      publishedFrom: null,
      within: input.claims,
      before: [],
    };
  }

  const documents = new Map(
    input.documents.map((document) => [document.sourceDocumentId, document]),
  );
  const byAccession = new Map<string, SecReportedFact[]>();

  for (const claim of input.claims) {
    const list = byAccession.get(claim.accessionNumber);

    if (list === undefined) {
      byAccession.set(claim.accessionNumber, [claim]);
    } else {
      list.push(claim);
    }
  }

  const within: SecReportedFact[] = [];
  const before: SplitClaimBeforeHistory[] = [];

  for (const [accessionNumber, points] of byAccession) {
    const first = points[0]!;

    // Igual o anterior: una presentación que es la primera publicada no tiene
    // ninguna vintage previa contra la que re-expresar.
    if (
      claimKnownBy(first.filed, documents.get(accessionNumber)) <= publishedFrom
    ) {
      before.push({
        accessionNumber,
        form: first.form,
        filed: first.filed,
        ratios: [...new Set(points.map((point) => point.value))].sort(),
        code: "precedes_published_history",
      });
    } else {
      within.push(...points);
    }
  }

  return {
    version: SPLIT_CLAIM_HORIZON_VERSION,
    publishedFrom: new Date(publishedFrom).toISOString(),
    within,
    before: before.sort(
      (left, right) =>
        left.filed.localeCompare(right.filed) ||
        left.accessionNumber.localeCompare(right.accessionNumber),
    ),
  };
}
