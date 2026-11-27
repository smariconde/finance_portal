import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";

export type CalendarSource = {
  readonly sourceId: string;
  readonly datasetId: string;
  readonly parserVersion: string;
  readonly url: string;
  readonly zone: string;
  readonly credential?: string;
};

export async function readCalendarResource(
  source: CalendarSource,
  registry: SourceRegistryRepository,
  fetch: EgressFetch,
  url = source.url,
) {
  const entry = await registry.findBySourceId(source.sourceId);
  if (
    !entry?.datasets.includes(source.datasetId) ||
    !evaluateIngestionRights(entry, {
      storesRawPayload: false,
      storesNormalizedValues: true,
      publicDisplay: false,
    }).allowed
  ) {
    throw new Error("calendar_rights_not_approved");
  }
  const response = await fetch({ sourceId: source.sourceId, url });
  if (response.status !== 200)
    throw new Error(`calendar_http_${response.status}`);
  return {
    text: new TextDecoder("utf-8", { fatal: true }).decode(response.body),
    observedAt: response.fetchedAt,
  };
}
