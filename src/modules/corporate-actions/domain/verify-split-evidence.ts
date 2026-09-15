import type { SecReportedFact } from "@/modules/fundamentals/domain/parse-sec-company-facts";
import type { Dec } from "@/modules/numeric/domain/decimal-policy";
import type { Observation } from "@/modules/observations/domain/observation";
import type { SourceDocument } from "@/modules/observations/domain/source-document";

import {
  classifyCoherence,
  laterSplitFactor,
  ShareBasisError,
  shareBasisDecimal,
  shareSensitivity,
  SPLIT_BASIS_RULE_VERSION,
  type BasisChange,
  type ShareSensitivity,
} from "./share-basis";

/**
 * Verificación de splits a partir de dos evidencias independientes de la misma
 * presentación (ADR 0012):
 *
 * 1. **el filer declara un ratio**: un punto de
 *    `us-gaap:StockholdersEquityNoteStockSplitConversionRatio1` en esa accession;
 * 2. **los números del filer se movieron por ese ratio**: la misma presentación
 *    re-expresa al menos un EPS y al menos un conteo de acciones que ya estaban
 *    publicados, y la re-expresión es coherente con el ratio.
 *
 * Con las dos, el split se confirma y su base nueva es conocible desde esa
 * presentación. Con una sola queda `candidate` y no ajusta nada. El cable real
 * muestra por qué no alcanza con el ratio: Alphabet lo declara en el 10-Q de abril
 * de 2022, tres meses antes del split y con los valores todavía en base vieja;
 * Carvana declara `0.0556` sin ningún split; Citigroup declara su `0.1` de 2011
 * recién en el 10-K de 2014.
 *
 * Una presentación que repite el ratio sin re-expresar nada **corrobora** el
 * split confirmado más cercano con el mismo ratio, siempre que no haya otro split
 * confirmado entre los dos: son el anuncio previo y las notas que lo siguen
 * contando. Sin eso, es un candidato con su motivo.
 */
export const SPLIT_EVIDENCE_RULE_VERSION = "sec-split-evidence-1.0.0";

export type SplitCandidateCode =
  /** El ratio no es positivo o vale uno. */
  | "invalid_ratio"
  /** El punto del ratio no está en `pure`. */
  | "unexpected_unit"
  | "conflicting_ratios_in_filing"
  /** La presentación no publicó ningún hecho de este filer: no se puede fechar. */
  | "claim_filing_not_published"
  | "no_coherent_reexpression"
  /** Se re-expresaron EPS o acciones, pero no los dos. */
  | "reexpression_incomplete"
  /** Los valores se movieron por la inversa del ratio declarado. */
  | "reexpression_matches_inverse_ratio"
  /** Otra presentación anterior ya mostraba la base nueva sin declarar el ratio. */
  | "reexpressed_before_ratio_filing"
  /**
   * El ratio se declara después, sin re-expresar nada completo, y antes hay
   * presentaciones que re-expresaron EPS y acciones por ese ratio sin declararlo:
   * Duke Energy publica sus acciones divididas por tres desde el 10-Q del
   * 2012-08-08 y declara `0.3333` recién en el 10-K de 2014. Las dos evidencias
   * existen, pero no en la misma presentación: queda candidato y nombra la primera
   * presentación en base nueva.
   */
  | "ratio_declared_after_reexpression"
  /** La presentación no declara su fecha de reporte. */
  | "missing_report_date";

export type SplitClaimStatus = "confirming" | "corroborating" | "candidate";

export type SplitClaimFiling = {
  readonly accessionNumber: string;
  readonly form: string;
  readonly filed: string;
  /** Ratio declarado, como decimal canónico; `null` si no hay uno legible. */
  readonly ratio: string | null;
  /** Fechas o períodos a los que el filer asoció el ratio, tal como los publicó. */
  readonly claimedPeriods: readonly string[];
  readonly status: SplitClaimStatus;
  readonly code: SplitCandidateCode | null;
  /** Presentación del split confirmado al que pertenece; `null` si es candidato. */
  readonly splitAccession: string | null;
  /**
   * Para `ratio_declared_after_reexpression`, la primera presentación que
   * re-expresó por este ratio. `null` en cualquier otro caso.
   */
  readonly reexpressingAccession: string | null;
};

export type ReexpressionEvidence = {
  readonly perShare: number;
  readonly shareCount: number;
  /** Re-expresiones de la misma presentación que no cierran con el ratio. */
  readonly outliers: number;
  /** Ceros o cambios de signo: no prueban ningún factor. */
  readonly uninformative: number;
};

export type ConfirmedSplit = {
  readonly accessionNumber: string;
  readonly form: string;
  readonly actionType: "split" | "reverse_split";
  readonly ratio: string;
  readonly availableAt: string;
  readonly acceptedAt: string | null;
  readonly publishedOn: string | null;
  /**
   * Cierre del primer período presentado en base nueva. No es la fecha de
   * distribución: XBRL no la publica de forma confiable (NVIDIA asocia su 4:1 al
   * 2021-06-03 y después al 2021-07-19; Alphabet, el 20:1 a la aprobación de
   * febrero).
   */
  readonly effectiveOn: string;
  readonly claimedPeriods: readonly string[];
  readonly evidence: ReexpressionEvidence;
  readonly qualityFlags: readonly string[];
};

export type SplitEvidence = {
  readonly ruleVersion: string;
  readonly basisRuleVersion: string;
  readonly splits: readonly ConfirmedSplit[];
  /** Una fila por presentación que declaró un ratio, en orden de publicación. */
  readonly filings: readonly SplitClaimFiling[];
};

export type SplitEvidenceInput = {
  readonly legalEntityId: string;
  /** Puntos del concepto de ratio, de `companyconcept`. */
  readonly claims: readonly SecReportedFact[];
  /** Todas las revisiones publicadas de los conceptos sensibles del filer. */
  readonly observations: readonly Observation[];
  /** Presentaciones registradas del filer entre las que declararon un ratio. */
  readonly documents: readonly SourceDocument[];
};

type RevisionPair = {
  readonly previous: Observation;
  readonly next: Observation;
  readonly sensitivity: ShareSensitivity;
};

/**
 * - `coherent`: cierra con los splits ya confirmados entre las dos vintages por el
 *   ratio declarado;
 * - `explained`: cierra sin el ratio declarado —una re-expresión tardía de un
 *   split anterior, o un redondeo—: no es evidencia ni contradicción;
 * - `outlier`: no cierra con ninguno de los dos.
 */
type PairVerdict = "coherent" | "explained" | "outlier" | "uninformative";

type ClaimGroup = {
  readonly accessionNumber: string;
  readonly form: string;
  readonly filed: string;
  readonly ratio: string | null;
  readonly claimedPeriods: readonly string[];
  readonly invalid: SplitCandidateCode | null;
  readonly document: SourceDocument | null;
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const ONE_TEXT = "1";

function groupClaims(
  claims: readonly SecReportedFact[],
  documents: ReadonlyMap<string, SourceDocument>,
): ClaimGroup[] {
  const byAccession = new Map<string, SecReportedFact[]>();

  for (const claim of claims) {
    const list = byAccession.get(claim.accessionNumber);
    if (list === undefined) {
      byAccession.set(claim.accessionNumber, [claim]);
    } else {
      list.push(claim);
    }
  }

  return [...byAccession].map(([accessionNumber, points]) => {
    const pure = points.filter((point) => point.unit === "pure");
    const ratios = [...new Set(pure.map((point) => point.value))];
    const first = points[0]!;
    const claimedPeriods = [
      ...new Set(
        pure.map((point) =>
          point.start === null ? point.end : `${point.start}..${point.end}`,
        ),
      ),
    ].sort(compareText);

    let invalid: SplitCandidateCode | null = null;
    let ratio: string | null = null;

    if (ratios.length === 0) {
      invalid = "unexpected_unit";
    } else if (ratios.length > 1) {
      invalid = "conflicting_ratios_in_filing";
    } else {
      ratio = ratios[0]!;
      const parsed = shareBasisDecimal.parseDecimal(ratio, "claim.value");

      if (!parsed.isPositive() || parsed.isZero() || ratio === ONE_TEXT) {
        invalid = "invalid_ratio";
      }
    }

    return {
      accessionNumber,
      form: first.form,
      filed: first.filed,
      ratio,
      claimedPeriods,
      invalid,
      document: documents.get(accessionNumber) ?? null,
    };
  });
}

function buildRevisionPairs(
  legalEntityId: string,
  observations: readonly Observation[],
): RevisionPair[] {
  const byId = new Map(
    observations.map((observation) => [observation.observationId, observation]),
  );
  const pairs: RevisionPair[] = [];

  for (const next of observations) {
    if (
      next.subjectType !== "legal_entity" ||
      next.subjectId !== legalEntityId
    ) {
      // La evidencia es de un filer: mezclar otro la volvería de nadie.
      throw new ShareBasisError(
        "adjustment_across_succession",
        "Split evidence received an observation of another subject.",
        [next.observationId],
      );
    }

    const sensitivity = shareSensitivity(next);

    if (sensitivity === null || next.restatementOfId === null) {
      continue;
    }

    const previous = byId.get(next.restatementOfId);

    if (previous === undefined) {
      throw new ShareBasisError(
        "revision_chain_incomplete",
        "A revision arrived without the revision it restates.",
        [next.observationId],
      );
    }

    if (previous.rawValue === null || next.rawValue === null) {
      continue;
    }

    pairs.push({ previous, next, sensitivity });
  }

  return pairs.sort(
    (left, right) =>
      Date.parse(left.next.availableAt) - Date.parse(right.next.availableAt) ||
      compareText(left.next.observationId, right.next.observationId),
  );
}

function judgePair(
  pair: RevisionPair,
  confirmed: readonly BasisChange[],
  ratio: Dec,
): PairVerdict {
  const base = laterSplitFactor(
    confirmed,
    {
      availableAt: pair.previous.availableAt,
      document: pair.previous.sourceDocumentId,
    },
    {
      availableAt: pair.next.availableAt,
      document: pair.next.sourceDocumentId,
    },
  ).factor;
  const judge = (factor: Dec) =>
    classifyCoherence({
      sensitivity: pair.sensitivity,
      previous: pair.previous.rawValue!,
      next: pair.next.rawValue!,
      factor,
    });
  const withRatio = judge(base.times(ratio));

  if (withRatio !== "incoherent") {
    return withRatio;
  }

  return judge(base) === "coherent" ? "explained" : "outlier";
}

type PendingCode = Extract<
  SplitCandidateCode,
  | "no_coherent_reexpression"
  | "reexpression_incomplete"
  | "reexpression_matches_inverse_ratio"
  | "claim_filing_not_published"
>;

export function evaluateSplitEvidence(
  input: SplitEvidenceInput,
): SplitEvidence {
  const documents = new Map(
    input.documents
      .filter(
        (document) =>
          document.subjectType === "legal_entity" &&
          document.subjectId === input.legalEntityId,
      )
      .map((document) => [document.sourceDocumentId, document]),
  );
  const groups = groupClaims(input.claims, documents);
  const pairs = buildRevisionPairs(input.legalEntityId, input.observations);
  const pairsByDocument = new Map<string, RevisionPair[]>();

  for (const pair of pairs) {
    const document = pair.next.sourceDocumentId ?? "";
    const list = pairsByDocument.get(document);
    if (list === undefined) {
      pairsByDocument.set(document, [pair]);
    } else {
      list.push(pair);
    }
  }

  // Orden de publicación: fecha de filing y, dentro del día, el instante
  // conocible; una presentación sin documento va al final de su día.
  const order = (group: ClaimGroup) =>
    `${group.filed}|${group.document?.availableAt ?? "~"}|${group.accessionNumber}`;
  groups.sort((left, right) => compareText(order(left), order(right)));

  const confirmed: BasisChange[] = [];
  const splits: ConfirmedSplit[] = [];
  const decided = new Map<string, SplitClaimFiling>();
  const pending = new Map<string, PendingCode>();

  const verdicts = (
    document: string,
    ratio: Dec,
  ): { pairs: RevisionPair[]; verdicts: PairVerdict[] } => {
    const documentPairs = pairsByDocument.get(document) ?? [];

    return {
      pairs: documentPairs,
      verdicts: documentPairs.map((pair) => judgePair(pair, confirmed, ratio)),
    };
  };

  for (const group of groups) {
    const base = {
      accessionNumber: group.accessionNumber,
      form: group.form,
      filed: group.filed,
      ratio: group.ratio,
      claimedPeriods: group.claimedPeriods,
    };

    if (group.invalid !== null) {
      decided.set(group.accessionNumber, {
        ...base,
        status: "candidate",
        code: group.invalid,
        splitAccession: null,
        reexpressingAccession: null,
      });
      continue;
    }

    if (group.document === null) {
      pending.set(group.accessionNumber, "claim_filing_not_published");
      continue;
    }

    const document = group.document;
    const ratio = shareBasisDecimal.parseDecimal(group.ratio!, "claim.value");
    const own = verdicts(group.accessionNumber, ratio);
    const coherentPairs = own.pairs.filter(
      (_pair, index) => own.verdicts[index] === "coherent",
    );
    const perShare = coherentPairs.filter(
      (pair) => pair.sensitivity === "per_share",
    ).length;
    const shareCount = coherentPairs.length - perShare;

    if (perShare === 0 || shareCount === 0) {
      if (perShare + shareCount > 0) {
        pending.set(group.accessionNumber, "reexpression_incomplete");
        continue;
      }

      const inverse = verdicts(
        group.accessionNumber,
        shareBasisDecimal.divide(
          shareBasisDecimal.parseDecimal(ONE_TEXT, "one"),
          ratio,
          "claim.value",
        ),
      );

      pending.set(
        group.accessionNumber,
        inverse.verdicts.includes("coherent")
          ? "reexpression_matches_inverse_ratio"
          : "no_coherent_reexpression",
      );
      continue;
    }

    // ¿Alguna presentación anterior ya mostraba la base nueva? Se busca entre la
    // última vintage en base vieja que esta presentación re-expresó y ella misma:
    // más atrás, una coincidencia sería otro evento.
    const lowerBound = Math.max(
      ...coherentPairs.map((pair) => Date.parse(pair.previous.availableAt)),
      ...confirmed.map((change) => Date.parse(change.availableAt)),
    );
    const upperBound = Date.parse(document.availableAt);
    const reexpressedBefore = [...pairsByDocument.keys()].some((other) => {
      if (other === group.accessionNumber) {
        return false;
      }

      const otherPairs = pairsByDocument.get(other)!;
      const at = Date.parse(otherPairs[0]!.next.availableAt);

      return (
        at > lowerBound &&
        at < upperBound &&
        verdicts(other, ratio).verdicts.includes("coherent")
      );
    });

    if (reexpressedBefore) {
      decided.set(group.accessionNumber, {
        ...base,
        status: "candidate",
        code: "reexpressed_before_ratio_filing",
        splitAccession: null,
        reexpressingAccession: null,
      });
      continue;
    }

    if (document.periodEndOn === null) {
      decided.set(group.accessionNumber, {
        ...base,
        status: "candidate",
        code: "missing_report_date",
        splitAccession: null,
        reexpressingAccession: null,
      });
      continue;
    }

    const outliers = own.verdicts.filter(
      (verdict) => verdict === "outlier",
    ).length;
    const uninformative = own.verdicts.filter(
      (verdict) => verdict === "uninformative",
    ).length;
    const qualityFlags = [
      ...(outliers > 0 ? ["split_evidence_outliers"] : []),
      ...(document.acceptedAt === null ? ["availability_inferred"] : []),
    ];

    confirmed.push({
      id: group.accessionNumber,
      availableAt: document.availableAt,
      document: group.accessionNumber,
      ratio,
    });
    splits.push({
      accessionNumber: group.accessionNumber,
      form: document.documentType,
      actionType: ratio.gt(1) ? "split" : "reverse_split",
      ratio: group.ratio!,
      availableAt: document.availableAt,
      acceptedAt: document.acceptedAt,
      publishedOn: document.publishedOn,
      effectiveOn: document.periodEndOn,
      claimedPeriods: group.claimedPeriods,
      evidence: { perShare, shareCount, outliers, uninformative },
      qualityFlags,
    });
    decided.set(group.accessionNumber, {
      ...base,
      status: "confirming",
      code: null,
      splitAccession: group.accessionNumber,
      reexpressingAccession: null,
    });
  }

  // Lo que quedó sin re-expresión corrobora al split confirmado vecino con el
  // mismo ratio, si no hay otro split confirmado entre los dos.
  const confirmedOrder = splits.map((split) => ({
    split,
    key: `${split.publishedOn ?? ""}|${split.availableAt}|${split.accessionNumber}`,
  }));

  /**
   * Primera presentación en base nueva por un ratio que se declaró después.
   *
   * Se ancla en la primera presentación, entre el último split confirmado y el
   * ratio, que re-expresó EPS **y** acciones: una sola re-expresión suelta en
   * años de historia puede ser casualidad. Desde ahí retrocede con la misma cota
   * que la confirmación —la última vintage en base vieja que esa presentación
   * re-expresó— hasta la primera con alguna re-expresión coherente. En Duke
   * Energy la completa es el 10-Q del 2012-11-08, pero el del 2012-08-08 ya
   * publicaba las acciones divididas por tres: nombrar el de noviembre ajustaría
   * esas acciones dos veces el día que alguien confirme el split ahí.
   *
   * Sólo nombra: confirmar exige las dos evidencias en la misma presentación.
   */
  const reexpressingBefore = (group: ClaimGroup): string | null => {
    // Sin documento, el ratio se conoce a más tardar al día siguiente del filing
    // con el offset más tardío de Nueva York, igual que la regla de disponibilidad.
    const claimAt =
      group.document === null
        ? Date.parse(`${group.filed}T05:00:00.000Z`) + 24 * 60 * 60 * 1000
        : Date.parse(group.document.availableAt);
    const lastConfirmed = Math.max(
      Number.NEGATIVE_INFINITY,
      ...confirmed
        .map((change) => Date.parse(change.availableAt))
        .filter((at) => at < claimAt),
    );
    const ratio = shareBasisDecimal.parseDecimal(group.ratio!, "claim.value");
    const window = [...pairsByDocument.entries()]
      .map(([document, documentPairs]) => {
        const judged = verdicts(document, ratio);

        return {
          document,
          at: Date.parse(documentPairs[0]!.next.availableAt),
          coherent: judged.pairs.filter(
            (_pair, index) => judged.verdicts[index] === "coherent",
          ),
        };
      })
      .filter(
        ({ document, at }) =>
          document !== group.accessionNumber &&
          at > lastConfirmed &&
          at < claimAt,
      )
      .sort(
        (left, right) =>
          left.at - right.at || compareText(left.document, right.document),
      );
    const anchor = window.find(
      ({ coherent }) =>
        coherent.some((pair) => pair.sensitivity === "per_share") &&
        coherent.some((pair) => pair.sensitivity === "share_count"),
    );

    if (anchor === undefined) {
      return null;
    }

    const oldBasis = Math.max(
      ...anchor.coherent.map((pair) => Date.parse(pair.previous.availableAt)),
    );

    return (
      window.find(
        ({ at, coherent }) =>
          at > oldBasis && at <= anchor.at && coherent.length > 0,
      )?.document ?? anchor.document
    );
  };

  for (const group of groups) {
    const code = pending.get(group.accessionNumber);

    if (code === undefined) {
      continue;
    }

    const key = order(group);
    const before = confirmedOrder.filter((entry) => entry.key < key).at(-1);
    const after = confirmedOrder.find((entry) => entry.key > key);
    const neighbour = [before, after].find(
      (entry) => entry !== undefined && entry.split.ratio === group.ratio,
    );
    const reexpressing =
      neighbour === undefined &&
      (code === "no_coherent_reexpression" ||
        code === "reexpression_incomplete" ||
        code === "claim_filing_not_published")
        ? reexpressingBefore(group)
        : null;

    decided.set(group.accessionNumber, {
      accessionNumber: group.accessionNumber,
      form: group.form,
      filed: group.filed,
      ratio: group.ratio,
      claimedPeriods: group.claimedPeriods,
      status: neighbour === undefined ? "candidate" : "corroborating",
      code:
        neighbour !== undefined
          ? null
          : reexpressing !== null
            ? "ratio_declared_after_reexpression"
            : code,
      splitAccession: neighbour?.split.accessionNumber ?? null,
      reexpressingAccession: reexpressing,
    });
  }

  return {
    ruleVersion: SPLIT_EVIDENCE_RULE_VERSION,
    basisRuleVersion: SPLIT_BASIS_RULE_VERSION,
    splits,
    filings: groups.map((group) => decided.get(group.accessionNumber)!),
  };
}
