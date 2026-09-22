import {
  isEffectiveAt,
  isKnownAt,
} from "@/modules/temporal/domain/temporal-version";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import type { IndexMembership } from "@/modules/universe/domain/index-membership";

import {
  resolveClassificationAt,
  type ClassificationAbsence,
  type SubjectClassification,
} from "./subject-classification";
import { SP500_SECTOR_TAXONOMY_ID } from "./sector-taxonomy";

/**
 * Población de un sector al `as_of`
 * ([ADR 0025](../../../../docs/architecture/adr/0025-declared-sector-classification.md),
 * punto 4).
 *
 * Es la **composición de dos vigencias leídas al mismo corte**: la membresía al
 * índice y la clasificación. Las dos salen del mismo archivo pineado, así que
 * son consistentes por construcción y no hay que reconciliarlas.
 *
 * El sujeto de la membresía es la security y el de la clasificación es la
 * entidad legal, que es el motivo de que haga falta el emisor de cada security:
 * dos clases del mismo emisor son dos puntos de la matriz y un solo sector.
 */
export const SECTOR_POPULATION_RULE_VERSION = "sector-population-1.0.0";

export type SecurityIssuer = {
  readonly securityId: string;
  readonly issuerLegalEntityId: string;
};

export type SectorMember = {
  readonly securityId: string;
  readonly issuerLegalEntityId: string;
  readonly code: string;
  readonly label: string;
  readonly taxonomyVersion: string;
};

/**
 * Una security del índice que no entra en ninguna población, con el motivo.
 *
 * Nunca es un sector por defecto ni un cajón «Otros»: agrupar lo que no se supo
 * clasificar haría que la matriz lo dibuje como si fuera una respuesta.
 */
export type UnclassifiedMember = {
  readonly securityId: string;
  readonly issuerLegalEntityId: string | null;
  readonly reason: ClassificationAbsence | "issuer_unknown";
};

export type SectorPopulation = {
  readonly ruleVersion: string;
  readonly taxonomyId: string;
  readonly indexId: string;
  readonly effectiveAt: string;
  readonly members: readonly SectorMember[];
  readonly unclassified: readonly UnclassifiedMember[];
};

export type ResolveSectorPopulationInput = {
  readonly indexId: string;
  readonly memberships: readonly IndexMembership[];
  readonly issuers: readonly SecurityIssuer[];
  readonly classifications: readonly SubjectClassification[];
  readonly query: PointInTimeQuery;
  /** Filtra a un solo sector; `null` devuelve el índice entero clasificado. */
  readonly code: string | null;
  readonly taxonomyId?: string;
};

export function resolveSectorPopulation(
  input: ResolveSectorPopulationInput,
): SectorPopulation {
  const {
    indexId,
    memberships,
    issuers,
    classifications,
    query,
    code,
    taxonomyId = SP500_SECTOR_TAXONOMY_ID,
  } = input;

  const issuerBySecurity = new Map(
    issuers.map((issuer) => [issuer.securityId, issuer.issuerLegalEntityId]),
  );

  const members: SectorMember[] = [];
  const unclassified: UnclassifiedMember[] = [];

  for (const membership of memberships) {
    if (
      membership.indexId !== indexId ||
      !isEffectiveAt(membership, query.effectiveAt) ||
      !isKnownAt(membership, query)
    ) {
      continue;
    }

    const issuerLegalEntityId = issuerBySecurity.get(membership.securityId);

    if (issuerLegalEntityId === undefined) {
      unclassified.push({
        securityId: membership.securityId,
        issuerLegalEntityId: null,
        reason: "issuer_unknown",
      });
      continue;
    }

    const resolution = resolveClassificationAt(
      classifications,
      taxonomyId,
      query,
      issuerLegalEntityId,
    );

    if (!resolution.classified) {
      unclassified.push({
        securityId: membership.securityId,
        issuerLegalEntityId,
        reason: resolution.absence,
      });
      continue;
    }

    if (code !== null && resolution.classification.code !== code) {
      continue;
    }

    members.push({
      securityId: membership.securityId,
      issuerLegalEntityId,
      code: resolution.classification.code,
      label: resolution.classification.label,
      taxonomyVersion: resolution.classification.taxonomyVersion,
    });
  }

  return {
    ruleVersion: SECTOR_POPULATION_RULE_VERSION,
    taxonomyId,
    indexId,
    effectiveAt: query.effectiveAt,
    members,
    unclassified,
  };
}
