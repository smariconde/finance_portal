import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";

/**
 * Qué filers recorre el refresh de companyfacts (ADR 0021).
 *
 * El **conjunto seguido** son los filers que ya tienen fundamentals publicados:
 * existe al menos una observación de `sec.companyfacts` cuyo sujeto es su
 * entidad legal, y esa entidad tiene un CIK vigente en el grafo. No hay lista
 * declarada ni alta previa —la consulta es la definición—, así que el conjunto
 * crece con cada ingesta y encoge cuando una poda deja a un sujeto sin filas.
 *
 * Los antecesores de reporte entran por la misma regla: la ingesta baja su CIK
 * (ADR 0011) y sus hechos son la historia del sucesor. No presentan más, así que
 * su sondeo termina en «sin novedades» y cuesta un request. Se los reconoce
 * porque no tienen símbolo vigente.
 *
 * Planear no abre la red: la pregunta es a PostgreSQL y no gasta cuota de la
 * fuente. Lo que no resuelve a un CIK vigente se rechaza con nombre, nunca se
 * adivina.
 */
export const COMPANY_FACTS_REFRESH_PLAN_VERSION =
  "companyfacts-refresh-plan-1.0.0";

const CIK_SCOPE = "sec:filer";

/**
 * Sujeto con datos publicados, tal como lo devuelve el repositorio de
 * observaciones. Se declara acá para que el dominio no importe del puerto: los
 * dos tipos coinciden estructuralmente y el plan se prueba sin repositorio.
 */
export type PublishedFilerSubject = {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly observations: number;
  readonly latestAvailableAt: string;
};

export type CompanyFactsRefreshSubject = {
  readonly cik: string;
  readonly legalEntityId: string;
  /** Cuántas filas publicadas tiene hoy; descriptivo, no decide el sondeo. */
  readonly observations: number;
  /** `available_at` más reciente de esas filas; descriptivo. */
  readonly latestAvailableAt: string;
  /** Tickers vigentes de sus securities, sólo para mostrar. */
  readonly symbols: readonly string[];
};

export type CompanyFactsRefreshRejectionCode =
  /** El sujeto publicado no es una entidad legal, así que no es un filer. */
  | "subject_not_a_filer"
  /** La entidad legal no tiene versión vigente en el grafo. */
  | "subject_not_in_graph"
  | "issuer_without_cik"
  | "issuer_with_several_ciks";

export type CompanyFactsRefreshRejection = {
  readonly code: CompanyFactsRefreshRejectionCode;
  readonly subjectId: string;
};

export type CompanyFactsRefreshPlan = {
  readonly planVersion: string;
  readonly subjects: readonly CompanyFactsRefreshSubject[];
  readonly rejections: readonly CompanyFactsRefreshRejection[];
  /** Sujetos publicados que se consideraron, rechazos incluidos. */
  readonly published: number;
};

const isOpen = (version: {
  readonly validTo: string | null;
  readonly supersededAt: string | null;
}) => version.validTo === null && version.supersededAt === null;

export function planCompanyFactsRefresh(input: {
  readonly published: readonly PublishedFilerSubject[];
  readonly graph: IdentityGraph;
}): CompanyFactsRefreshPlan {
  const { graph } = input;
  const entities = new Set(
    graph.legalEntities.filter(isOpen).map((entity) => entity.legalEntityId),
  );
  const ciksByEntity = new Map<string, Set<string>>();

  for (const assignment of graph.identifierAssignments) {
    if (
      isOpen(assignment) &&
      assignment.identifierType === "cik" &&
      assignment.scope === CIK_SCOPE &&
      assignment.subjectType === "legal_entity"
    ) {
      const ciks = ciksByEntity.get(assignment.subjectId) ?? new Set<string>();
      ciks.add(assignment.normalizedValue);
      ciksByEntity.set(assignment.subjectId, ciks);
    }
  }

  const listingsById = new Map(
    graph.listings
      .filter(isOpen)
      .map((listing) => [listing.listingId, listing]),
  );
  const issuerBySecurity = new Map(
    graph.securities
      .filter(isOpen)
      .map((security) => [security.securityId, security.issuerLegalEntityId]),
  );
  const symbolsByEntity = new Map<string, Set<string>>();

  for (const symbol of graph.listingSymbols) {
    const listing = listingsById.get(symbol.listingId);

    if (!isOpen(symbol) || symbol.symbolType !== "ticker" || !listing) {
      continue;
    }

    const issuer = issuerBySecurity.get(listing.securityId);

    if (issuer === undefined) {
      continue;
    }

    const symbols = symbolsByEntity.get(issuer) ?? new Set<string>();
    symbols.add(symbol.symbol);
    symbolsByEntity.set(issuer, symbols);
  }

  const subjects = new Map<string, CompanyFactsRefreshSubject>();
  const rejections: CompanyFactsRefreshRejection[] = [];
  const reject = (
    code: CompanyFactsRefreshRejectionCode,
    subjectId: string,
  ) => {
    rejections.push({ code, subjectId });
  };

  for (const published of input.published) {
    if (published.subjectType !== "legal_entity") {
      reject("subject_not_a_filer", published.subjectId);
      continue;
    }

    if (!entities.has(published.subjectId)) {
      reject("subject_not_in_graph", published.subjectId);
      continue;
    }

    const ciks = ciksByEntity.get(published.subjectId);

    if (ciks === undefined || ciks.size === 0) {
      reject("issuer_without_cik", published.subjectId);
      continue;
    }

    if (ciks.size > 1) {
      reject("issuer_with_several_ciks", published.subjectId);
      continue;
    }

    const [cik] = [...ciks];

    subjects.set(cik!, {
      cik: cik!,
      legalEntityId: published.subjectId,
      observations: published.observations,
      latestAvailableAt: published.latestAvailableAt,
      symbols: [...(symbolsByEntity.get(published.subjectId) ?? [])].sort(),
    });
  }

  return {
    planVersion: COMPANY_FACTS_REFRESH_PLAN_VERSION,
    // El orden es el del CIK, estable entre corridas, y forma parte del plan:
    // el hash del job depende de él.
    subjects: [...subjects.values()].sort((left, right) =>
      left.cik.localeCompare(right.cik),
    ),
    rejections,
    published: input.published.length,
  };
}
