import { z } from "zod";

import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";
import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
import {
  ingestionRunSchema,
  isPublishableStatus,
} from "@/modules/ingestion/domain/ingestion-run";
import { sourceIdSchema } from "@/modules/ingestion/domain/source-registry-entry";

import { findCedearDepositary } from "../domain/cedear-depositaries";
import {
  isEmptyCedearPlan,
  planCedearRegistry,
  type CedearRegistryPlan,
} from "../domain/plan-cedear-registry";

import type {
  CedearRegistryRepository,
  CedearRegistrySummary,
} from "./cedear-registry-repository";
import type { CedearSourceProvider } from "./live-cedear-source";

/**
 * Registra la publicación vigente de un emisor de CEDEAR
 * ([ADR 0027](../../../../docs/architecture/adr/0027-cedear-registry-sources.md)).
 *
 * Un emisor por llamada: cada uno es una fuente con sus derechos, su cuota y su
 * corrida, y un emisor caído no tiene por qué impedir registrar al otro.
 *
 * El plan es **idempotente y se calcula contra lo guardado**, no contra la
 * corrida anterior: la misma publicación no escribe nada, y una aplicación
 * cortada a la mitad se completa en la siguiente.
 */
export const recordCedearRegistryCommandSchema = z.object({
  sourceId: sourceIdSchema,
  /** Destraba el guard de bajas masivas. Lo decide el owner, nunca un default. */
  acceptWithdrawals: z.boolean().default(false),
});

export type RecordCedearRegistryCommand = z.input<
  typeof recordCedearRegistryCommandSchema
>;

export type RecordCedearRegistryDependencies = {
  readonly source: CedearSourceProvider;
  readonly repository: CedearRegistryRepository;
  readonly ingestionRuns: IngestionRunRepository;
  /** El grafo vigente: resuelve subyacentes y encuentra CEDEAR ya registrados. */
  readonly loadGraph: () => Promise<IdentityGraph>;
  readonly now: () => string;
  readonly newId: () => string;
  readonly hashContent: (input: string) => string;
  /** En seco no se registra corrida ni se escribe fila. */
  readonly dryRun?: boolean;
};

export type RecordCedearRegistryOutcome = {
  readonly sourceId: string;
  readonly parserVersion: string;
  readonly byteLength: number;
  readonly observedAt: string;
  readonly plan: CedearRegistryPlan;
  /** `null` en seco, con el plan negado o sin nada que escribir. */
  readonly summary: CedearRegistrySummary | null;
  readonly runId: string | null;
  readonly runStatus: string | null;
};

export class UnknownCedearSourceError extends Error {
  constructor(sourceId: string) {
    super(`${sourceId} is not a declared CEDEAR issuer`);
    this.name = "UnknownCedearSourceError";
  }
}

export async function recordCedearRegistry(
  command: RecordCedearRegistryCommand,
  dependencies: RecordCedearRegistryDependencies,
): Promise<RecordCedearRegistryOutcome> {
  const parsed = recordCedearRegistryCommandSchema.parse(command);
  const {
    source,
    repository,
    ingestionRuns,
    loadGraph,
    now,
    newId,
    hashContent,
    dryRun = false,
  } = dependencies;
  const depositary = findCedearDepositary(parsed.sourceId);

  if (depositary === null) {
    throw new UnknownCedearSourceError(parsed.sourceId);
  }

  const startedAt = now();
  const fetched = await source.load(depositary.sourceId);
  const { publication } = fetched;
  const [graph, stored] = await Promise.all([
    loadGraph(),
    repository.loadRegistry({
      depositaryLegalEntityId: depositary.legalEntityId,
    }),
  ]);

  // Lo que la publicación afirma, ordenado: dos lecturas con el mismo contenido
  // son la misma corrida aunque el emisor reordene sus filas.
  const contentHash = hashContent(
    JSON.stringify({
      sourceId: depositary.sourceId,
      parserVersion: publication.parserVersion,
      claims: [...publication.claims]
        .sort((left, right) => left.cedearIsin.localeCompare(right.cedearIsin))
        .map((claim) => [
          claim.cedearIsin,
          claim.cajaValoresCode,
          claim.originSymbols,
          claim.originMarket,
          claim.reportedUnderlyingIsin,
          claim.ratio.depositaryUnits,
          claim.ratio.underlyingUnits,
          claim.status,
          claim.investorScope,
        ]),
      listed: [...publication.listedIsins].sort(),
    }),
  );

  // Una publicación que ya se registró con el mismo contenido: si igual hay
  // algo que escribir —el grafo cambió, o la aplicación anterior se cortó—, las
  // filas citan la corrida original, que es la que observó ese contenido.
  const previous = await ingestionRuns.findByIdempotencyKey(contentHash);
  const replayOf =
    previous !== null && isPublishableStatus(previous.status) ? previous : null;
  const runId = newId();
  const plan = planCedearRegistry({
    depositary,
    publication,
    graph,
    stored,
    observedAt: fetched.fetchedAt,
    recordedAt: now(),
    sourceDocumentId: replayOf?.runId ?? runId,
    acceptWithdrawals: parsed.acceptWithdrawals,
    newId,
    hashContent,
  });

  const base = {
    sourceId: depositary.sourceId,
    parserVersion: publication.parserVersion,
    byteLength: fetched.byteLength,
    observedAt: fetched.fetchedAt,
    plan,
  };

  if (dryRun) {
    return { ...base, summary: null, runId: null, runStatus: null };
  }

  const { status, counts } = cedearRunVerdict(plan, replayOf !== null);
  const finishedAt = now();
  const qualityFlags = [
    // La vigencia es la observación y no una fecha que la fuente publique: se
    // declara en la corrida para que nadie la lea como una fecha de la fuente.
    "availability_is_observation",
    ...(plan.refusal === null ? [] : [plan.refusal.code]),
    ...(replayOf === null ? [] : ["duplicate_content"]),
  ];

  const run = await ingestionRuns.append(
    ingestionRunSchema.parse({
      runId,
      sourceId: depositary.sourceId,
      datasetId: depositary.datasetId,
      parserVersion: publication.parserVersion,
      idempotencyKey: contentHash,
      requestedAsOf: null,
      requestedVintage: null,
      cursor: null,
      nextCursor: null,
      subjectKey: null,
      selectionVersion: null,
      selectionAnchorOn: null,
      status,
      startedAt,
      finishedAt,
      counts,
      contentHash,
      failure: null,
      qualityFlags,
      replayOfRunId: replayOf?.runId ?? null,
      recordedAt: finishedAt,
    }),
  );

  const publishes =
    status === "succeeded" || status === "partial" || status === "duplicate";
  const summary =
    !publishes || isEmptyCedearPlan(plan)
      ? null
      : await repository.applyRegistryPlan(plan);

  return { ...base, summary, runId: run.runId, runStatus: run.status };
}

/**
 * Estado y conteos de la corrida.
 *
 * Lo que la corrida cuenta son las filas **en alcance** —las que resolvieron a
 * una security del grafo y las rechazadas—: una fila fuera del universo se leyó
 * bien y no es para este registro, así que no es ni aceptada ni rechazada, y el
 * plan la informa aparte. Un plan negado queda en cuarentena, y una publicación
 * sin nada en alcance no publica nada, ni siquiera bajas.
 */
export function cedearRunVerdict(
  plan: CedearRegistryPlan,
  duplicateContent: boolean,
): {
  readonly status:
    "succeeded" | "partial" | "duplicate" | "quarantined" | "empty";
  readonly counts: {
    readonly fetched: number;
    readonly accepted: number;
    readonly rejected: number;
    readonly duplicate: number;
  };
} {
  const fetched = plan.counts.resolved + plan.counts.rejected;

  if (fetched === 0) {
    return {
      status: "empty",
      counts: { fetched: 0, accepted: 0, rejected: 0, duplicate: 0 },
    };
  }

  if (plan.refusal !== null) {
    return {
      status: "quarantined",
      counts: { fetched, accepted: 0, rejected: fetched, duplicate: 0 },
    };
  }

  if (duplicateContent) {
    return {
      status: "duplicate",
      counts: { fetched, accepted: 0, rejected: 0, duplicate: fetched },
    };
  }

  const counts = {
    fetched,
    accepted: plan.counts.resolved,
    rejected: plan.counts.rejected,
    duplicate: 0,
  };

  return {
    status:
      counts.rejected === 0
        ? "succeeded"
        : counts.accepted > 0
          ? "partial"
          : "quarantined",
    counts,
  };
}
