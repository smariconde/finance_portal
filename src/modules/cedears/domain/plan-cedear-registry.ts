import {
  depositaryProgramSchema,
  depositaryRatioSchema,
  identifierAssignmentSchema,
  legalEntitySchema,
  securitySchema,
  type DepositaryProgram,
  type DepositaryRatio,
  type IdentifierAssignment,
  type IdentityGraph,
  type LegalEntity,
  type Security,
} from "@/modules/identity/domain/identity-graph";

import {
  ratiosEqual,
  type CedearClaim,
  type CedearPublication,
  type CedearRowRejectionCode,
} from "./cedear-claim";
import type { CedearDepositary } from "./cedear-depositaries";
import {
  buildUnderlyingSymbolIndex,
  CEDEAR_UNDERLYING_RESOLUTION_VERSION,
  resolveCedearUnderlying,
  type CedearQualityFlag,
} from "./resolve-cedear-underlying";

/**
 * Planificador del registro CEDEAR de un emisor
 * ([ADR 0027](../../../../docs/architecture/adr/0027-cedear-registry-sources.md)).
 *
 * Es puro: recibe lo que la publicación afirma, el grafo y lo que el registro ya
 * tiene de ese emisor, y devuelve lo que habría que escribir. No abre
 * transacciones ni mira el reloj.
 *
 * La vigencia de todo lo que abre es el instante de la observación: ninguna de
 * las dos publicaciones dice desde cuándo vale lo que publica, y la observación
 * es la primera fecha que se puede probar (decisión 5).
 */
export const CEDEAR_REGISTRY_RULE_VERSION = "cedear-registry-1.0.0";

/** El ISIN identifica al instrumento: ISO 6166, cuya agencia en Argentina es Caja de Valores. */
export const CEDEAR_ISIN_IDENTIFIER = {
  identifierType: "isin",
  scope: "iso-6166",
  issuingAuthority: "Caja de Valores S.A. (agencia de numeración ISO 6166)",
} as const;

export const CAJA_VALORES_CODE_IDENTIFIER = {
  identifierType: "caja_valores_code",
  scope: "ar:caja-valores",
  issuingAuthority: "Caja de Valores S.A.",
} as const;

/**
 * Una corrida que retiraría más que esto se niega: una baja masiva se parece
 * más a una respuesta rota que a una decisión del emisor, y retirar programas
 * por un error de la fuente borraría la marca de la matriz sin aviso.
 */
export const WITHDRAWAL_GUARD = Object.freeze({ minimum: 3, share: 0.1 });

export type StoredCedearRegistry = {
  /** Todas las versiones de los programas del emisor, vigentes o no. */
  readonly programs: readonly DepositaryProgram[];
  readonly ratios: readonly DepositaryRatio[];
};

export type CedearPlanRejectionCode =
  | CedearRowRejectionCode
  | "underlying_ticker_conflict"
  | "underlying_ambiguous"
  /**
   * El programa ya registrado resuelve hoy a otro subyacente. No se aplica: el
   * modelo de identidad lo manda a revisión manual.
   */
  | "underlying_changed"
  /** El ISIN ya identifica a una security que no emite este depositario. */
  | "cedear_isin_of_other_issuer";

export type CedearPlanRejection = {
  readonly label: string | null;
  readonly code: CedearPlanRejectionCode;
};

export type CedearSupersession = {
  readonly id: string;
  readonly validFrom: string;
  readonly supersededAt: string;
};

export type CedearProgramNote = {
  readonly cedearIsin: string;
  readonly symbol: string;
};

export type CedearRegistryPlan = {
  readonly ruleVersion: string;
  readonly resolutionVersion: string;
  readonly sourceId: string;
  readonly depositaryLegalEntityId: string;
  readonly observedAt: string;
  /** Distinto de `null` cuando el plan se niega: no escribe nada. */
  readonly refusal: {
    readonly code: "withdrawal_guard";
    readonly withdrawn: number;
    readonly open: number;
  } | null;
  readonly legalEntities: readonly LegalEntity[];
  readonly securities: readonly Security[];
  readonly identifierAssignments: readonly IdentifierAssignment[];
  readonly programs: readonly DepositaryProgram[];
  readonly programSupersessions: readonly CedearSupersession[];
  readonly ratios: readonly DepositaryRatio[];
  readonly ratioSupersessions: readonly CedearSupersession[];
  readonly rejections: readonly CedearPlanRejection[];
  readonly outsideUniverse: readonly (CedearProgramNote & {
    readonly reason:
      "symbol_not_in_universe" | "foreign_market" | "debt_program";
  })[];
  readonly flagged: readonly (CedearProgramNote & {
    readonly flags: readonly CedearQualityFlag[];
  })[];
  /** La fuente declara otro ticker o ISIN subyacente para el mismo programa. */
  readonly evidenceChanged: readonly CedearProgramNote[];
  readonly withdrawn: readonly CedearProgramNote[];
  readonly counts: {
    readonly rowsSeen: number;
    readonly claims: number;
    readonly resolved: number;
    readonly programsOpened: number;
    readonly statusChanged: number;
    readonly ratiosChanged: number;
    readonly unchanged: number;
    readonly withdrawn: number;
    readonly outsideUniverse: number;
    readonly rejected: number;
    /**
     * Programas registrados que la publicación sigue listando pero que esta
     * corrida no pudo volver a afirmar —fila rechazada, ticker que ya no
     * resuelve—. Se cuentan y no se tocan: una fila con un error no es una baja.
     */
    readonly notReasserted: number;
  };
};

export type PlanCedearRegistryInput = {
  readonly depositary: CedearDepositary;
  readonly publication: Extract<CedearPublication, { ok: true }>;
  readonly graph: IdentityGraph;
  readonly stored: StoredCedearRegistry;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly sourceDocumentId: string | null;
  readonly acceptWithdrawals: boolean;
  readonly newId: () => string;
  readonly hashContent: (input: string) => string;
};

type Temporal = {
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly supersededAt: string | null;
};

const isOpen = (version: Temporal) =>
  version.validTo === null && version.supersededAt === null;

/**
 * El contenido que identifica una versión de programa. La evidencia —ticker e
 * ISIN declarados— queda **afuera**: si entrara, cada vez que el emisor corrige
 * una descripción se reescribiría el programa aunque nada de lo que el programa
 * es hubiera cambiado. La fila guarda la evidencia de la aserción que la abrió,
 * como el `taxonomyVersion` de la ADR 0025.
 */
function programContent(program: {
  readonly depositaryProgramId: string;
  readonly programType: string;
  readonly depositarySecurityId: string;
  readonly underlyingSecurityId: string;
  readonly depositaryLegalEntityId: string | null;
  readonly investorScope: string | null;
  readonly status: string;
}): string {
  return [
    "depositary_program",
    program.depositaryProgramId,
    program.programType,
    program.depositarySecurityId,
    program.underlyingSecurityId,
    program.depositaryLegalEntityId ?? "",
    program.investorScope ?? "",
    program.status,
  ].join("|");
}

export function planCedearRegistry(
  input: PlanCedearRegistryInput,
): CedearRegistryPlan {
  const {
    depositary,
    publication,
    graph,
    stored,
    observedAt,
    recordedAt,
    sourceDocumentId,
    acceptWithdrawals,
    newId,
    hashContent,
  } = input;

  const opening = {
    validFrom: observedAt,
    validTo: null,
    availableAt: observedAt,
    supersededAt: null,
    sourceId: depositary.sourceId,
    sourceDocumentId,
    recordedAt,
  } as const;

  const index = buildUnderlyingSymbolIndex(graph, observedAt);

  // --- lo que el grafo ya tiene -------------------------------------------
  const depositaryKnown = graph.legalEntities.some(
    (entity) =>
      entity.legalEntityId === depositary.legalEntityId && isOpen(entity),
  );
  const issuerBySecurity = new Map(
    graph.securities
      .filter(isOpen)
      .map((security) => [security.securityId, security.issuerLegalEntityId]),
  );
  const securityByIsin = new Map<string, string>();
  const isinBySecurity = new Map<string, string>();

  for (const assignment of graph.identifierAssignments) {
    if (
      isOpen(assignment) &&
      assignment.subjectType === "security" &&
      assignment.identifierType === CEDEAR_ISIN_IDENTIFIER.identifierType &&
      assignment.scope === CEDEAR_ISIN_IDENTIFIER.scope
    ) {
      securityByIsin.set(assignment.normalizedValue, assignment.subjectId);
      isinBySecurity.set(assignment.subjectId, assignment.normalizedValue);
    }
  }

  // --- lo que el registro ya tiene de este emisor ---------------------------
  const ownPrograms = stored.programs.filter(
    (program) => program.depositaryLegalEntityId === depositary.legalEntityId,
  );
  const programIdBySecurity = new Map<string, string>();
  const openProgramById = new Map<string, DepositaryProgram>();

  for (const program of ownPrograms) {
    programIdBySecurity.set(
      program.depositarySecurityId,
      program.depositaryProgramId,
    );

    if (isOpen(program)) {
      openProgramById.set(program.depositaryProgramId, program);
    }
  }

  const openRatioByProgram = new Map<string, DepositaryRatio>();

  for (const ratio of stored.ratios) {
    if (isOpen(ratio)) {
      openRatioByProgram.set(ratio.depositaryProgramId, ratio);
    }
  }

  const requireAfter = (availableAt: string, subject: string) => {
    // Superseder exige un instante posterior a lo que se supersede (lo impone
    // también un check de la base). Un reloj que retrocede no es un caso a
    // resolver acá: se corta con el motivo.
    if (Date.parse(observedAt) <= Date.parse(availableAt)) {
      throw new Error(
        `observation ${observedAt} is not later than the stored assertion for ${subject}`,
      );
    }
  };

  // --- plan -----------------------------------------------------------------
  const legalEntities: LegalEntity[] = [];
  const securities: Security[] = [];
  const identifierAssignments: IdentifierAssignment[] = [];
  const programs: DepositaryProgram[] = [];
  const programSupersessions: CedearSupersession[] = [];
  const ratios: DepositaryRatio[] = [];
  const ratioSupersessions: CedearSupersession[] = [];
  const rejections: CedearPlanRejection[] = publication.rejections.map(
    (rejection) => ({ label: rejection.rowLabel, code: rejection.code }),
  );
  const outsideUniverse: CedearRegistryPlan["outsideUniverse"][number][] =
    publication.skipped.map((row) => ({
      cedearIsin: row.cedearIsin,
      symbol: "",
      reason: row.reason,
    }));
  const flagged: CedearRegistryPlan["flagged"][number][] = [];
  const evidenceChanged: CedearProgramNote[] = [];
  const reasserted = new Set<string>();
  let resolved = 0;
  let programsOpened = 0;
  let statusChanged = 0;
  let ratiosChanged = 0;
  let unchanged = 0;

  if (!depositaryKnown) {
    legalEntities.push(
      legalEntitySchema.parse({
        ...opening,
        legalEntityId: depositary.legalEntityId,
        legalName: depositary.legalName,
        entityType: depositary.entityType,
        jurisdiction: "AR",
        status: "active",
        contentHash: hashContent(
          [
            "legal_entity",
            depositary.legalEntityId,
            depositary.legalName,
            depositary.entityType,
            "AR",
          ].join("|"),
        ),
      }),
    );
  }

  const openRatio = (programId: string, claim: CedearClaim) =>
    depositaryRatioSchema.parse({
      ...opening,
      depositaryRatioId: newId(),
      depositaryProgramId: programId,
      depositaryUnits: claim.ratio.depositaryUnits,
      underlyingUnits: claim.ratio.underlyingUnits,
      // La publicación no dice cuándo se anunció el ratio: sólo que vale.
      announcedAt: null,
      contentHash: hashContent(
        [
          "depositary_ratio",
          programId,
          claim.ratio.depositaryUnits,
          claim.ratio.underlyingUnits,
        ].join("|"),
      ),
    });

  for (const claim of publication.claims) {
    const symbol = claim.originSymbols[0] ?? "";
    const resolution = resolveCedearUnderlying(claim, index);

    if (resolution.status === "rejected") {
      rejections.push({ label: claim.cedearIsin, code: resolution.code });
      continue;
    }

    if (resolution.status === "outside_universe") {
      outsideUniverse.push({
        cedearIsin: claim.cedearIsin,
        symbol,
        reason: resolution.reason,
      });
      continue;
    }

    // --- la security del CEDEAR ------------------------------------------
    let cedearSecurityId = securityByIsin.get(claim.cedearIsin);

    if (
      cedearSecurityId !== undefined &&
      issuerBySecurity.get(cedearSecurityId) !== depositary.legalEntityId
    ) {
      rejections.push({
        label: claim.cedearIsin,
        code: "cedear_isin_of_other_issuer",
      });
      continue;
    }

    // Un programa ya registrado que hoy resuelve a otro subyacente no se aplica:
    // va a revisión manual, como pide el modelo de identidad. Se decide antes de
    // contarlo como resuelto, para que la fila cuente una sola vez.
    const knownProgramId =
      cedearSecurityId === undefined
        ? undefined
        : programIdBySecurity.get(cedearSecurityId);
    const open =
      knownProgramId === undefined
        ? undefined
        : openProgramById.get(knownProgramId);

    if (
      open !== undefined &&
      open.underlyingSecurityId !== resolution.securityId
    ) {
      rejections.push({ label: claim.cedearIsin, code: "underlying_changed" });
      continue;
    }

    resolved += 1;

    if (resolution.flags.length > 0) {
      flagged.push({
        cedearIsin: claim.cedearIsin,
        symbol,
        flags: resolution.flags,
      });
    }

    if (cedearSecurityId === undefined) {
      const securityId = newId();
      cedearSecurityId = securityId;

      securities.push(
        securitySchema.parse({
          ...opening,
          securityId,
          issuerLegalEntityId: depositary.legalEntityId,
          securityType: "depositary_receipt",
          shareClass: null,
          // Un CEDEAR cotiza en pesos y en dólares; su moneda económica es la
          // del subyacente, y afirmarla acá sería adivinar.
          economicCurrency: null,
          status: "active",
          contentHash: hashContent(
            [
              "security",
              securityId,
              depositary.legalEntityId,
              "depositary_receipt",
            ].join("|"),
          ),
        }),
      );

      for (const [identifier, value] of [
        [CEDEAR_ISIN_IDENTIFIER, claim.cedearIsin],
        [CAJA_VALORES_CODE_IDENTIFIER, claim.cajaValoresCode],
      ] as const) {
        identifierAssignments.push(
          identifierAssignmentSchema.parse({
            ...opening,
            identifierAssignmentId: newId(),
            subjectType: "security",
            subjectId: securityId,
            identifierType: identifier.identifierType,
            identifierValue: value,
            normalizedValue: value,
            scope: identifier.scope,
            issuingAuthority: identifier.issuingAuthority,
            confidence: "authoritative",
            contentHash: hashContent(
              [
                "identifier",
                identifier.identifierType,
                identifier.scope,
                value,
                securityId,
              ].join("|"),
            ),
          }),
        );
      }
    }

    // --- el programa ---------------------------------------------------------
    const programId = knownProgramId ?? newId();

    reasserted.add(programId);

    const desired = {
      depositaryProgramId: programId,
      programType: "cedear",
      depositarySecurityId: cedearSecurityId,
      underlyingSecurityId: resolution.securityId,
      depositaryLegalEntityId: depositary.legalEntityId,
      investorScope: claim.investorScope,
      status: claim.status,
    } as const;

    const openVersion = () =>
      programs.push(
        depositaryProgramSchema.parse({
          ...opening,
          ...desired,
          // CEDEAR no patrocinados: ninguna de las dos fuentes publica sponsor.
          sponsorLegalEntityId: null,
          reportedUnderlyingSymbol: resolution.reportedSymbol,
          reportedUnderlyingIsin: claim.reportedUnderlyingIsin,
          contentHash: hashContent(programContent(desired)),
        }),
      );

    let changed = true;

    if (open === undefined) {
      programsOpened += 1;
      openVersion();
    } else if (
      open.status !== desired.status ||
      open.investorScope !== desired.investorScope
    ) {
      requireAfter(open.availableAt, claim.cedearIsin);
      statusChanged += 1;
      programSupersessions.push({
        id: programId,
        validFrom: open.validFrom,
        supersededAt: observedAt,
      });
      openVersion();
    } else {
      changed = false;

      if (
        open.reportedUnderlyingSymbol !== resolution.reportedSymbol ||
        open.reportedUnderlyingIsin !== claim.reportedUnderlyingIsin
      ) {
        evidenceChanged.push({ cedearIsin: claim.cedearIsin, symbol });
      }
    }

    // --- el ratio, versionado aparte del programa -----------------------------
    const currentRatio = openRatioByProgram.get(programId);

    if (currentRatio === undefined) {
      ratios.push(openRatio(programId, claim));
      changed = true;
    } else if (!ratiosEqual(currentRatio, claim.ratio)) {
      // Supersede, no cierra: la fecha efectiva del cambio está en el aviso del
      // emisor, que esta ingesta no lee. Fecharla con la corrida la inventaría.
      requireAfter(currentRatio.availableAt, claim.cedearIsin);
      ratiosChanged += 1;
      ratioSupersessions.push({
        id: currentRatio.depositaryRatioId,
        validFrom: currentRatio.validFrom,
        supersededAt: observedAt,
      });
      ratios.push(openRatio(programId, claim));
      changed = true;
    }

    if (!changed) {
      unchanged += 1;
    }
  }

  // --- programas que el emisor dejó de listar -------------------------------
  const withdrawn: CedearProgramNote[] = [];
  let notReasserted = 0;

  for (const program of openProgramById.values()) {
    if (reasserted.has(program.depositaryProgramId)) {
      continue;
    }

    const isin = isinBySecurity.get(program.depositarySecurityId);

    // Sigue listado —con una fila rechazada o un ticker que ya no resuelve—:
    // no es una baja y no se toca.
    if (isin === undefined || publication.listedIsins.has(isin)) {
      notReasserted += 1;
      continue;
    }

    // La lista del emisor **es** autoritativa sobre sus programas: dejar de
    // listar uno es la evidencia de que dejó de ofrecerlo. Se supersede sin
    // sucesor en vez de cerrarlo, porque la fecha de la baja no se publica.
    requireAfter(program.availableAt, isin);
    withdrawn.push({
      cedearIsin: isin,
      symbol: program.reportedUnderlyingSymbol ?? "",
    });
    programSupersessions.push({
      id: program.depositaryProgramId,
      validFrom: program.validFrom,
      supersededAt: observedAt,
    });

    const ratio = openRatioByProgram.get(program.depositaryProgramId);

    if (ratio !== undefined) {
      requireAfter(ratio.availableAt, isin);
      ratioSupersessions.push({
        id: ratio.depositaryRatioId,
        validFrom: ratio.validFrom,
        supersededAt: observedAt,
      });
    }
  }

  const openCount = openProgramById.size;
  const refused =
    !acceptWithdrawals &&
    withdrawn.length >
      Math.max(
        WITHDRAWAL_GUARD.minimum,
        Math.floor(openCount * WITHDRAWAL_GUARD.share),
      );

  return {
    ruleVersion: CEDEAR_REGISTRY_RULE_VERSION,
    resolutionVersion: CEDEAR_UNDERLYING_RESOLUTION_VERSION,
    sourceId: depositary.sourceId,
    depositaryLegalEntityId: depositary.legalEntityId,
    observedAt,
    refusal: refused
      ? {
          code: "withdrawal_guard",
          withdrawn: withdrawn.length,
          open: openCount,
        }
      : null,
    // Un plan negado no escribe nada, pero sigue diciendo qué habría hecho.
    legalEntities: refused ? [] : legalEntities,
    securities: refused ? [] : securities,
    identifierAssignments: refused ? [] : identifierAssignments,
    programs: refused ? [] : programs,
    programSupersessions: refused ? [] : programSupersessions,
    ratios: refused ? [] : ratios,
    ratioSupersessions: refused ? [] : ratioSupersessions,
    rejections,
    outsideUniverse,
    flagged,
    evidenceChanged,
    withdrawn,
    counts: {
      rowsSeen: publication.rowsSeen,
      claims: publication.claims.length,
      resolved,
      programsOpened,
      statusChanged,
      ratiosChanged,
      unchanged,
      withdrawn: withdrawn.length,
      outsideUniverse: outsideUniverse.length,
      rejected: rejections.length,
      notReasserted,
    },
  };
}

/** Un plan sin nada que escribir: la publicación confirma lo registrado. */
export function isEmptyCedearPlan(plan: CedearRegistryPlan): boolean {
  return (
    plan.legalEntities.length === 0 &&
    plan.securities.length === 0 &&
    plan.identifierAssignments.length === 0 &&
    plan.programs.length === 0 &&
    plan.programSupersessions.length === 0 &&
    plan.ratios.length === 0 &&
    plan.ratioSupersessions.length === 0
  );
}
