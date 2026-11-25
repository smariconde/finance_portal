import "server-only";

import { SEC_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  readDilutedSharesFilingEvidence,
  type DilutedSharesFilingRequest,
  type DilutedSharesFilingResult,
} from "@/modules/valuation/application/read-diluted-shares-filing";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/**
 * Las acciones diluidas desde el instance del 10-K (`F6-49`): dos pedidos SEC
 * medidos como mucho; el instance nunca se guarda. `null` sin derecho de uso.
 */
export async function readDilutedSharesFiling(
  input: DilutedSharesFilingRequest,
): Promise<DilutedSharesFilingResult | null> {
  const registry = getSourceRegistryRepository();
  await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);
  const entry = await registry.findBySourceId("sec-edgar");
  if (
    entry === null ||
    !evaluateIngestionRights(entry, {
      storesRawPayload: false,
      storesNormalizedValues: true,
      publicDisplay: false,
    }).allowed
  )
    return null;
  const fetch = getSourceEgressFetch(SEC_REQUEST_PACING);
  const read = async (url: string, accept: string): Promise<string | null> => {
    const response = await fetch({ sourceId: "sec-edgar", url, accept });
    return response.status === 200
      ? new TextDecoder("utf-8", { fatal: true }).decode(response.body)
      : null;
  };
  return readDilutedSharesFilingEvidence(input, read);
}
