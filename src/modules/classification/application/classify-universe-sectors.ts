import { z } from "zod";

import { sourceIdSchema } from "@/modules/ingestion/domain/source-registry-entry";

import {
  planSectorClassification,
  type SectorClaim,
  type SectorClassificationPlan,
  type SectorSourcePin,
} from "../domain/plan-sector-classification";
import { SP500_SECTOR_TAXONOMY_ID } from "../domain/sector-taxonomy";

import type {
  ClassificationRepository,
  SectorClassificationSummary,
} from "./classification-repository";

/**
 * Clasifica por sector a los emisores del universo recién constituido.
 *
 * Corre **después** de la constitución y no dentro de su transacción, a
 * propósito. La clasificación no es identidad: si fallara, el universo sigue
 * siendo correcto y volver a correr la arregla, porque el plan es idempotente
 * —el mismo pin no escribe nada—. Meterla en la transacción de identidad
 * ataría el grafo a una aserción que no lo constituye.
 *
 * El sujeto es la **entidad legal**, no la security. Dos clases del mismo emisor
 * son dos securities y un solo sector: colgarlo de la security duplicaría la
 * respuesta y abriría la puerta a que las dos clases discrepen.
 */
export const classifyUniverseSectorsCommandSchema = z.object({
  /** Símbolo de la lista y su sector crudo, tal como la fuente los escribe. */
  claims: z
    .array(
      z.object({
        symbol: z.string().trim().min(1).max(32),
        sector: z.string().trim().min(1).max(128).nullable(),
      }),
    )
    .max(5_000),
  /** Cómo cada símbolo de la lista llegó a un CIK, según la resolución. */
  resolved: z
    .array(
      z.object({
        claimSymbol: z.string().trim().min(1).max(32),
        normalizedCik: z.string().trim().min(1).max(32),
      }),
    )
    .max(5_000),
  /** CIK → entidad legal, tomado de las asignaciones vigentes del grafo. */
  entityIdByCik: z.map(z.string(), z.uuid()),
  pin: z.object({
    commit: z.string().regex(/^[0-9a-f]{40}$/u),
    committedAt: z.iso.datetime({ offset: true }),
  }),
  sourceId: sourceIdSchema,
  sourceDocumentId: z.string().trim().min(1).max(256).nullable().default(null),
});

export type ClassifyUniverseSectorsCommand = z.input<
  typeof classifyUniverseSectorsCommandSchema
>;

export type ClassifyUniverseSectorsDependencies = {
  readonly repository: ClassificationRepository;
  readonly now: () => string;
  readonly newId: () => string;
  readonly hashContent: (input: string) => string;
};

export type ClassifyUniverseSectorsOutcome = {
  readonly plan: SectorClassificationPlan;
  readonly summary: SectorClassificationSummary | null;
  /** Símbolos resueltos cuyo CIK no tiene entidad legal en el grafo. */
  readonly unresolvedSubjects: readonly string[];
  /**
   * Emisores cuyas clases declaran sectores distintos. No se clasifican:
   * elegir una de las dos sería inventar el desempate.
   */
  readonly conflicts: readonly string[];
};

/**
 * Arma un claim por **entidad legal**, no por símbolo.
 *
 * Dos filas del mismo emisor —`GOOG` y `GOOGL`— traen el mismo sector y tienen
 * que producir una sola aserción: dos filas abiertas para el mismo sujeto es
 * justamente lo que el índice único impide. Cuando coinciden se colapsan; cuando
 * no, se declara el conflicto y no se clasifica a ese emisor, porque elegir una
 * de las dos sería inventar el desempate.
 */
export function buildSectorClaims(
  claims: readonly { symbol: string; sector: string | null }[],
  resolved: readonly { claimSymbol: string; normalizedCik: string }[],
  entityIdByCik: ReadonlyMap<string, string>,
): {
  readonly claims: readonly SectorClaim[];
  readonly conflicts: readonly string[];
  readonly unresolvedSubjects: readonly string[];
} {
  const sectorBySymbol = new Map(
    claims.map((claim) => [claim.symbol, claim.sector]),
  );

  type Entry = {
    sector: string | null;
    symbols: string[];
    conflicted: boolean;
  };

  const bySubject = new Map<string, Entry>();
  const unresolvedSubjects: string[] = [];

  for (const entry of resolved) {
    const legalEntityId = entityIdByCik.get(entry.normalizedCik);

    if (legalEntityId === undefined) {
      unresolvedSubjects.push(entry.claimSymbol);
      continue;
    }

    const sector = sectorBySymbol.get(entry.claimSymbol) ?? null;
    const existing = bySubject.get(legalEntityId);

    if (existing === undefined) {
      bySubject.set(legalEntityId, {
        sector,
        symbols: [entry.claimSymbol],
        conflicted: false,
      });
      continue;
    }

    existing.symbols.push(entry.claimSymbol);

    if (existing.sector !== sector) {
      existing.conflicted = true;
    }
  }

  const built: SectorClaim[] = [];
  const conflicts: string[] = [];

  for (const [subjectId, entry] of bySubject) {
    const label = entry.symbols.join("/");

    if (entry.conflicted) {
      conflicts.push(label);
      continue;
    }

    built.push({
      subjectId,
      rawSector: entry.sector,
      claimSymbol: label,
    });
  }

  return { claims: built, conflicts, unresolvedSubjects };
}

export async function classifyUniverseSectors(
  command: ClassifyUniverseSectorsCommand,
  dependencies: ClassifyUniverseSectorsDependencies,
): Promise<ClassifyUniverseSectorsOutcome> {
  const parsed = classifyUniverseSectorsCommandSchema.parse(command);
  const { repository, now, newId, hashContent } = dependencies;

  const { claims, conflicts, unresolvedSubjects } = buildSectorClaims(
    parsed.claims,
    parsed.resolved,
    parsed.entityIdByCik,
  );

  const stored = await repository.loadClassifications({
    taxonomyId: SP500_SECTOR_TAXONOMY_ID,
  });

  const pin: SectorSourcePin = {
    commit: parsed.pin.commit,
    committedAt: parsed.pin.committedAt,
  };

  const plan = planSectorClassification({
    claims,
    stored,
    pin,
    sourceId: parsed.sourceId,
    sourceDocumentId: parsed.sourceDocumentId,
    recordedAt: now(),
    newId,
    hashContent,
  });

  if (plan.opened.length === 0 && plan.supersessions.length === 0) {
    return { plan, summary: null, unresolvedSubjects, conflicts };
  }

  return {
    plan,
    summary: await repository.applySectorPlan(plan),
    unresolvedSubjects,
    conflicts,
  };
}
