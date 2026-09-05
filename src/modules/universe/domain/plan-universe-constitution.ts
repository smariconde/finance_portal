import {
  legalEntitySchema,
  listingSchema,
  listingSymbolSchema,
  identifierAssignmentSchema,
  normalizeSymbol,
  securitySchema,
  type IdentifierAssignment,
  type IdentityGraph,
  type LegalEntity,
  type Listing,
  type ListingSymbol,
  type Security,
} from "@/modules/identity/domain/identity-graph";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import type { TemporalVersion } from "@/modules/temporal/domain/temporal-version";

import {
  indexMembershipSchema,
  isOpenMembership,
  type IndexMembership,
} from "./index-membership";
import type {
  ConstituentResolution,
  ResolvedConstituent,
} from "./resolve-constituents";

/**
 * Planificación pura de una constitución de universo.
 *
 * El planner no escribe: decide qué versiones **abre** y cuáles **cierra**, y
 * devuelve esa decisión completa para que la persistencia sea una transacción
 * sin lógica. Eso permite probar en dominio las tres cosas que importan:
 *
 * 1. los cuatro niveles de identidad se crean separados, y el CIK cuelga de la
 *    entidad legal —nunca se copia a la security ni al listing (`TM-06`);
 * 2. correr la misma constitución dos veces no duplica nada: la segunda corrida
 *    reconoce lo que ya existe y no abre una versión más;
 * 3. lo que cambia se historiza. Un renombre abre una versión nueva y cierra la
 *    anterior; una salida del índice cierra la membresía. Ninguna fila histórica
 *    se reescribe (`TM-16`).
 *
 * Lo que el planner **no** hace, por no poder hacerlo con estas dos fuentes: si
 * un emisor conocido aparece con un símbolo que no tiene listing, no se puede
 * distinguir "cambió de ticker" de "agregó una clase de acciones". Ese caso sale
 * como `unresolved_share_class` y espera a las corporate actions con vigencia
 * (`F2-04`), que son la única evidencia que decide entre las dos.
 */
export const UNIVERSE_CONSTITUTION_RULE_VERSION = "universe-constitution-1.0.0";

export type UniverseState = {
  readonly graph: IdentityGraph;
  readonly memberships: readonly IndexMembership[];
};

export type UniverseConstitutionInput = {
  readonly indexId: string;
  /** Vigencia del snapshot del índice: desde cuándo aplica lo que dice. */
  readonly effectiveAt: string;
  /** Primer instante en que ese snapshot pudo conocerse. */
  readonly availableAt: string;
  /** Reloj inyectado: el dominio no lee `Date.now()`. */
  readonly recordedAt: string;
  readonly sourceId: string;
  readonly sourceDocumentId: string | null;
  readonly resolution: ConstituentResolution;
  readonly state: UniverseState;
  /** Generador inyectado: los IDs internos son opacos y no derivan del ticker. */
  readonly newId: () => string;
};

export type ConstitutionRejectionCode =
  /** El ticker ya pertenece a una security de otro emisor. */
  | "issuer_conflict"
  /** Emisor conocido con un símbolo sin listing: renombre o clase nueva. */
  | "unresolved_share_class"
  /** El snapshot es anterior o igual a la versión vigente que debería cerrar. */
  | "stale_effective_date";

export type PlanRejection = {
  readonly claimSymbol: string | null;
  readonly stage: "match" | "plan";
  readonly code: string;
  readonly candidates: readonly string[];
};

export type VersionClosure = {
  readonly level: "legal_entity" | "index_membership";
  /** Dirección de la fila: el sujeto más su `validFrom` la identifican. */
  readonly subjectId: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly reason: "renamed" | "index_exit";
};

export type UniverseConstitutionPlan = {
  readonly ruleVersion: string;
  readonly matchRuleVersion: string;
  readonly indexId: string;
  readonly effectiveAt: string;
  readonly legalEntities: readonly LegalEntity[];
  readonly securities: readonly Security[];
  readonly listings: readonly Listing[];
  readonly listingSymbols: readonly ListingSymbol[];
  readonly identifierAssignments: readonly IdentifierAssignment[];
  readonly memberships: readonly IndexMembership[];
  readonly closures: readonly VersionClosure[];
  readonly rejections: readonly PlanRejection[];
  readonly counts: {
    readonly claims: number;
    readonly members: number;
    readonly entitiesOpened: number;
    readonly securitiesOpened: number;
    readonly exits: number;
    readonly rejected: number;
    /** Matches que necesitaron la regla relajada de separadores. */
    readonly relaxedMatches: number;
  };
};

function isOpen(version: TemporalVersion): boolean {
  return version.validTo === null && version.supersededAt === null;
}

/**
 * El hash cubre el contenido de la versión, no el instante en que se registró:
 * la misma versión insertada en otra corrida tiene que hashear igual, o la
 * idempotencia sería indistinguible de una escritura nueva.
 */
function withHash<TContent extends Record<string, unknown>>(
  content: TContent,
  recordedAt: string,
): TContent & { contentHash: string; recordedAt: string } {
  return {
    ...content,
    contentHash: computeContentHash(content),
    recordedAt,
  };
}

type EntityDecision =
  | { readonly kind: "resolved"; readonly legalEntityId: string }
  | { readonly kind: "rejected"; readonly rejection: PlanRejection };

export function planUniverseConstitution(
  input: UniverseConstitutionInput,
): UniverseConstitutionPlan {
  const {
    indexId,
    effectiveAt,
    availableAt,
    recordedAt,
    sourceId,
    sourceDocumentId,
    resolution,
    state,
    newId,
  } = input;

  const provenance = { sourceId, sourceDocumentId } as const;
  const opening = {
    validFrom: effectiveAt,
    validTo: null,
    availableAt,
    supersededAt: null,
  } as const;

  const openEntities = new Map(
    state.graph.legalEntities
      .filter(isOpen)
      .map((entity) => [entity.legalEntityId, entity]),
  );
  const openSecurities = state.graph.securities.filter(isOpen);
  const securityById = new Map(
    openSecurities.map((security) => [security.securityId, security]),
  );
  /**
   * Cuenta **congelada** de securities que ya existían antes de esta corrida.
   *
   * La ambigüedad entre renombre y clase nueva sólo existe a través del tiempo.
   * Dentro de un mismo snapshot, dos símbolos del mismo CIK conviven —`GOOG` y
   * `GOOGL` cotizan a la vez—, así que ahí no hay nada que decidir: son dos
   * instrumentos. Contar también lo que abre esta corrida convertiría ese caso
   * normal en un rechazo.
   */
  const preexistingSecurityCountByEntity = new Map<string, number>();
  for (const security of openSecurities) {
    preexistingSecurityCountByEntity.set(
      security.issuerLegalEntityId,
      (preexistingSecurityCountByEntity.get(security.issuerLegalEntityId) ??
        0) + 1,
    );
  }

  const openListings = state.graph.listings.filter(isOpen);
  const listingById = new Map(
    openListings.map((listing) => [listing.listingId, listing]),
  );

  const entityIdByCik = new Map(
    state.graph.identifierAssignments
      .filter(
        (assignment) =>
          isOpen(assignment) &&
          assignment.identifierType === "cik" &&
          assignment.subjectType === "legal_entity" &&
          assignment.confidence === "authoritative",
      )
      .map((assignment) => [assignment.normalizedValue, assignment.subjectId]),
  );

  const listingBySymbolKey = new Map<string, Listing>();
  for (const symbol of state.graph.listingSymbols.filter(isOpen)) {
    const listing = listingById.get(symbol.listingId);

    if (listing) {
      listingBySymbolKey.set(
        `${listing.mic}:${normalizeSymbol(symbol.symbol)}`,
        listing,
      );
    }
  }

  const openMembershipBySecurity = new Map(
    state.memberships
      .filter(
        (membership) =>
          membership.indexId === indexId && isOpenMembership(membership),
      )
      .map((membership) => [membership.securityId, membership]),
  );

  const legalEntities: LegalEntity[] = [];
  const securities: Security[] = [];
  const listings: Listing[] = [];
  const listingSymbols: ListingSymbol[] = [];
  const identifierAssignments: IdentifierAssignment[] = [];
  const memberships: IndexMembership[] = [];
  const closures: VersionClosure[] = [];
  const rejections: PlanRejection[] = resolution.rejections.map(
    (rejection) => ({
      claimSymbol: rejection.claimSymbol,
      stage: "match" as const,
      code: rejection.code,
      candidates: rejection.candidates,
    }),
  );

  const effectiveMs = Date.parse(effectiveAt);
  const memberSecurityIds = new Set<string>();
  let relaxedMatches = 0;

  const resolveEntity = (constituent: ResolvedConstituent): EntityDecision => {
    const existingId = entityIdByCik.get(constituent.normalizedCik);

    if (existingId === undefined) {
      const legalEntityId = newId();
      legalEntities.push(
        legalEntitySchema.parse(
          withHash(
            {
              ...provenance,
              ...opening,
              legalEntityId,
              legalName: constituent.legalName,
              // La lista no dice qué tipo de organización es y la SEC tampoco:
              // `other` es la ausencia declarada. Clasificar por nombre sería
              // inventar el dato. El arquetipo se decide en `F3-01` con reglas.
              entityType: "other",
              // El CIK identifica al filer ante la SEC; no prueba jurisdicción.
              jurisdiction: null,
              status: "active",
            },
            recordedAt,
          ),
        ),
      );
      identifierAssignments.push(
        identifierAssignmentSchema.parse(
          withHash(
            {
              ...provenance,
              ...opening,
              identifierAssignmentId: newId(),
              // El CIK vive en la entidad legal. Copiarlo a la security haría
              // que dos clases del mismo emisor parecieran el mismo instrumento.
              subjectType: "legal_entity",
              subjectId: legalEntityId,
              identifierType: "cik",
              identifierValue: constituent.normalizedCik,
              normalizedValue: constituent.normalizedCik,
              scope: "sec:filer",
              issuingAuthority: "U.S. Securities and Exchange Commission",
              confidence: "authoritative",
            },
            recordedAt,
          ),
        ),
      );
      entityIdByCik.set(constituent.normalizedCik, legalEntityId);

      return { kind: "resolved", legalEntityId };
    }

    const openEntity = openEntities.get(existingId);

    if (openEntity && openEntity.legalName !== constituent.legalName) {
      if (Date.parse(openEntity.validFrom) >= effectiveMs) {
        return {
          kind: "rejected",
          rejection: {
            claimSymbol: constituent.claimSymbol,
            stage: "plan",
            code: "stale_effective_date" satisfies ConstitutionRejectionCode,
            candidates: [existingId],
          },
        };
      }

      // Un renombre abre una versión y cierra la anterior en el mismo instante:
      // intervalos que se tocan, nunca una fila histórica sobrescrita.
      closures.push({
        level: "legal_entity",
        subjectId: existingId,
        validFrom: openEntity.validFrom,
        validTo: effectiveAt,
        reason: "renamed",
      });
      legalEntities.push(
        legalEntitySchema.parse(
          withHash(
            {
              ...provenance,
              ...opening,
              legalEntityId: existingId,
              legalName: constituent.legalName,
              entityType: openEntity.entityType,
              jurisdiction: openEntity.jurisdiction,
              status: openEntity.status,
            },
            recordedAt,
          ),
        ),
      );
      openEntities.set(existingId, {
        ...openEntity,
        legalName: constituent.legalName,
        validFrom: effectiveAt,
      });
    }

    return { kind: "resolved", legalEntityId: existingId };
  };

  for (const constituent of resolution.resolved) {
    if (constituent.matchKind === "separator_relaxed") {
      relaxedMatches += 1;
    }

    const decision = resolveEntity(constituent);

    if (decision.kind === "rejected") {
      rejections.push(decision.rejection);
      continue;
    }

    const { legalEntityId } = decision;
    const symbolKey = `${constituent.venue.mic}:${constituent.normalizedSymbol}`;
    const existingListing = listingBySymbolKey.get(symbolKey);
    let securityId: string;

    if (existingListing) {
      const security = securityById.get(existingListing.securityId);

      if (!security || security.issuerLegalEntityId !== legalEntityId) {
        // El ticker ya pertenece a la security de otro emisor: eso es un
        // conflicto de identidad, no un dato a sobrescribir.
        rejections.push({
          claimSymbol: constituent.claimSymbol,
          stage: "plan",
          code: "issuer_conflict" satisfies ConstitutionRejectionCode,
          candidates: [existingListing.listingId, legalEntityId],
        });
        continue;
      }

      securityId = security.securityId;
    } else if ((preexistingSecurityCountByEntity.get(legalEntityId) ?? 0) > 0) {
      rejections.push({
        claimSymbol: constituent.claimSymbol,
        stage: "plan",
        code: "unresolved_share_class" satisfies ConstitutionRejectionCode,
        candidates: [legalEntityId],
      });
      continue;
    } else {
      securityId = newId();
      const listingId = newId();

      securities.push(
        securitySchema.parse(
          withHash(
            {
              ...provenance,
              ...opening,
              securityId,
              issuerLegalEntityId: legalEntityId,
              securityType: "common_equity",
              // Ninguna de las dos fuentes nombra la clase. Queda `null`, que es
              // "no informada", y no se deduce del sufijo del ticker.
              shareClass: null,
              economicCurrency: constituent.venue.quoteCurrency,
              status: "active",
            },
            recordedAt,
          ),
        ),
      );
      listings.push(
        listingSchema.parse(
          withHash(
            {
              ...provenance,
              ...opening,
              listingId,
              securityId,
              mic: constituent.venue.mic,
              quoteCurrency: constituent.venue.quoteCurrency,
              country: constituent.venue.country,
              status: "active",
              // Único listing conocido del instrumento en estas fuentes. No se
              // declara primario por descarte: se declara lo que hay.
              primaryListing: true,
            },
            recordedAt,
          ),
        ),
      );
      listingSymbols.push(
        listingSymbolSchema.parse(
          withHash(
            {
              ...provenance,
              ...opening,
              listingSymbolId: newId(),
              listingId,
              // Se persiste el símbolo de la fuente autoritativa, no el de la
              // lista: `BRK-B` y `BRK.B` son la misma asignación escrita en dos
              // convenciones y la que manda es la del asignador.
              symbol: constituent.assignedSymbol,
              symbolType: "ticker",
            },
            recordedAt,
          ),
        ),
      );

      listingBySymbolKey.set(symbolKey, listings.at(-1)!);
      securityById.set(securityId, securities.at(-1)!);
    }

    memberSecurityIds.add(securityId);

    if (!openMembershipBySecurity.has(securityId)) {
      memberships.push(
        indexMembershipSchema.parse(
          withHash(
            {
              ...provenance,
              ...opening,
              indexMembershipId: newId(),
              indexId,
              securityId,
            },
            recordedAt,
          ),
        ),
      );
    }
  }

  for (const [securityId, membership] of openMembershipBySecurity) {
    if (memberSecurityIds.has(securityId)) {
      continue;
    }

    if (Date.parse(membership.validFrom) >= effectiveMs) {
      rejections.push({
        claimSymbol: null,
        stage: "plan",
        code: "stale_effective_date" satisfies ConstitutionRejectionCode,
        candidates: [securityId],
      });
      continue;
    }

    // Salir del índice cierra el intervalo. La fila queda: el universo de una
    // fecha pasada sigue siendo respondible después del rebalanceo.
    closures.push({
      level: "index_membership",
      subjectId: membership.indexMembershipId,
      validFrom: membership.validFrom,
      validTo: effectiveAt,
      reason: "index_exit",
    });
  }

  return {
    ruleVersion: UNIVERSE_CONSTITUTION_RULE_VERSION,
    matchRuleVersion: resolution.matchRuleVersion,
    indexId,
    effectiveAt,
    legalEntities,
    securities,
    listings,
    listingSymbols,
    identifierAssignments,
    memberships,
    closures,
    rejections,
    counts: {
      claims: resolution.resolved.length + resolution.rejections.length,
      members: memberSecurityIds.size,
      entitiesOpened: legalEntities.length,
      securitiesOpened: securities.length,
      exits: closures.filter((closure) => closure.reason === "index_exit")
        .length,
      rejected: rejections.length,
      relaxedMatches,
    },
  };
}
