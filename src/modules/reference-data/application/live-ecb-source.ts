import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import {
  evaluateIngestionRights,
  type IngestionRightsRequest,
} from "@/modules/ingestion/domain/source-registry-entry";

import {
  ECB_SOURCE_ID,
  ecbSeriesUrl,
  parseEcbSeriesCsv,
  type RiskFreeCurve,
} from "../domain/risk-free-curves";

import {
  ReferenceSourceError,
  type FetchedReferencePublication,
} from "./live-damodaran-source";

/**
 * Adaptador vivo de las series del ECB (`F6-55`, ADR 0087): una request por
 * curva, sólo datos, las últimas observaciones. Se guardan los valores
 * normalizados; la respuesta no se conserva.
 */
const RIGHTS_REQUEST: IngestionRightsRequest = {
  storesRawPayload: false,
  storesNormalizedValues: true,
  publicDisplay: false,
};

export type RiskFreeCurveSource = {
  load(curve: RiskFreeCurve): Promise<FetchedReferencePublication>;
};

export function createLiveEcbSource(dependencies: {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
}): RiskFreeCurveSource {
  return {
    async load(curve) {
      const entry =
        await dependencies.sourceRegistry.findBySourceId(ECB_SOURCE_ID);

      if (!entry) {
        throw new ReferenceSourceError(
          "source_not_registered",
          curve.datasetId,
        );
      }

      if (!entry.datasets.includes(curve.datasetId)) {
        throw new ReferenceSourceError(
          "dataset_not_registered",
          curve.datasetId,
        );
      }

      const rights = evaluateIngestionRights(entry, RIGHTS_REQUEST);

      if (!rights.allowed) {
        throw new ReferenceSourceError(
          "rights_not_approved",
          curve.datasetId,
          rights.blockedBy.join(", "),
        );
      }

      const url = ecbSeriesUrl(curve);
      let response: Awaited<ReturnType<EgressFetch>>;

      try {
        response = await dependencies.fetch({
          sourceId: ECB_SOURCE_ID,
          url,
          accept: "text/csv",
        });
      } catch (cause) {
        throw new ReferenceSourceError(
          "fetch_failed",
          curve.datasetId,
          cause instanceof Error ? cause.message : "egress failed",
        );
      }

      if (response.status !== 200) {
        throw new ReferenceSourceError(
          "unexpected_status",
          curve.datasetId,
          `status ${response.status}`,
        );
      }

      const publication = parseEcbSeriesCsv(
        curve,
        new TextDecoder("utf-8").decode(response.body),
      );

      if (!publication.ok) {
        throw new ReferenceSourceError(
          "payload_rejected",
          curve.datasetId,
          publication.code,
        );
      }

      return {
        publication,
        url,
        byteLength: response.byteLength,
        fetchedAt: response.fetchedAt,
      };
    },
  };
}
