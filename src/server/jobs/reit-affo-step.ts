import "server-only";

import { createHash } from "node:crypto";

import { runModelLadder } from "@/modules/ai/application/run-model-ladder";
import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import { SEC_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  proposeReitAffo,
  type ProposeReitAffoRequest,
  type ProposeReitAffoResult,
} from "@/modules/valuation/application/propose-reit-affo";
import { getAiLayer } from "@/server/ai/get-ai-layer";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getReitAffoRepository } from "@/server/persistence/get-reit-affo-repository";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/** The valuation worker is the only app boundary allowed to ask this task. */
export async function runReitAffoStep(
  request: ProposeReitAffoRequest,
): Promise<ProposeReitAffoResult> {
  const registry = getSourceRegistryRepository();
  await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);
  const source = await registry.findBySourceId("sec-edgar");
  const modelSource = await registry.findBySourceId("openrouter");
  if (
    source === null ||
    !evaluateIngestionRights(source, {
      storesRawPayload: false,
      storesNormalizedValues: true,
      publicDisplay: false,
    }).allowed ||
    modelSource === null ||
    !evaluateIngestionRights(modelSource, {
      storesRawPayload: false,
      storesNormalizedValues: true,
      publicDisplay: false,
    }).allowed
  )
    throw new Error("SEC REIT AFFO rights refused");
  const secFetch = getSourceEgressFetch(SEC_REQUEST_PACING);
  const read = async (url: string, accept: string): Promise<string> => {
    const response = await secFetch({ sourceId: "sec-edgar", url, accept });
    if (response.status !== 200)
      throw new Error(`SEC REIT AFFO response ${response.status}`);
    return new TextDecoder("utf-8", { fatal: true }).decode(response.body);
  };
  return proposeReitAffo(request, {
    loadSubmissions: async (cik) =>
      JSON.parse(
        await read(buildSubmissionsUrl(cik), "application/json"),
      ) as unknown,
    loadAnnualReport: (report) => read(report.url, "text/html"),
    registry: [source, modelSource],
    runLadder: (task, input) =>
      runModelLadder(task, input, getAiLayer().runDependencies()),
    repository: getReitAffoRepository(),
    now: () => new Date().toISOString(),
    sha256: (text) => createHash("sha256").update(text).digest("hex"),
  });
}
