import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { declaredEventSchema } from "@/modules/corporate-actions/domain/declared-event";
import { recordDeclaredEvent } from "@/modules/corporate-actions/application/record-declared-event";
import { createLiveListingEvidenceSource } from "@/modules/corporate-actions/application/live-listing-evidence-source";
import {
  createPacedEgressFetch,
  SEC_REQUEST_PACING,
} from "@/modules/ingestion/application/egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { getEgressClient } from "@/server/egress/get-egress-client";
import { getCorporateActionRepository } from "@/server/persistence/get-corporate-action-repository";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getSourceDocumentRepository } from "@/server/persistence/get-source-document-repository";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";
import { redactFailureMessage } from "@/modules/ingestion/domain/ingestion-failure";

async function main() {
  /** Explicit owner declaration, at most 32 KiB; no personal files in Git. */
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  if (!values.file) throw new Error("Use --file <declaracion.json> [--apply].");
  const handle = await open(values.file, "r");
  let payload: unknown;
  try {
    if (!(await handle.stat()).isFile())
      throw new Error("La declaración debe ser un archivo regular.");
    const bytes = Buffer.alloc(32_769);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 32_768) throw new Error("La declaración supera 32 KiB.");
    try {
      payload = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, bytesRead),
        ),
      );
    } catch {
      throw new Error("La declaración no es JSON UTF-8 válido.");
    }
  } finally {
    await handle.close();
  }
  const parsed = declaredEventSchema.safeParse(payload);
  if (!parsed.success)
    throw new Error(
      `Declaración inválida: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );

  // Dry run does not even sync the registry to PostgreSQL.
  const registry = getSourceRegistryRepository();
  if (values.apply)
    await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);
  const universe = getUniverseRepository();
  const fetch = createPacedEgressFetch(getEgressClient(), SEC_REQUEST_PACING, {
    elapsedMs: () => performance.now(),
    sleep: (ms) => sleep(ms),
  });
  const result = await recordDeclaredEvent(
    { declaration: parsed.data, mode: "personal", dryRun: !values.apply },
    {
      sourceRegistry: values.apply
        ? registry
        : {
            findBySourceId: async (sourceId: string) =>
              DEMO_SOURCE_REGISTRY.find(
                (entry) => entry.sourceId === sourceId,
              ) ?? null,
          },
      ingestionRuns: getIngestionRunRepository(),
      sourceDocuments: getSourceDocumentRepository(),
      corporateActions: getCorporateActionRepository(),
      loadIdentityGraph: async () =>
        (await universe.loadState({ indexId: SP500_INDEX_ID })).graph,
      source: createLiveListingEvidenceSource({ fetch }),
      now: () => new Date().toISOString(),
      newId: randomUUID,
    },
  );
  console.log(
    JSON.stringify(
      {
        mode: values.apply ? "apply" : "dry_run",
        status: result.run.status,
        rejection: result.rejection,
        runId: result.run.runId,
        plan: result.plan?.status,
        availableAt: result.plan?.corporateActions[0]?.availableAt,
        applied: result.applied,
        requests: fetch.requestCount(),
      },
      null,
      2,
    ),
  );
  process.exit(result.rejection ? 1 : 0);
}

main().catch((error) => {
  console.error(
    redactFailureMessage(
      error instanceof Error
        ? error.message
        : "Fallo al registrar la declaración.",
    ),
  );
  process.exitCode = 1;
});
