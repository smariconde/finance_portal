import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import {
  evaluateIngestionRights,
  type IngestionRightsRequest,
} from "@/modules/ingestion/domain/source-registry-entry";

import {
  DAMODARAN_SOURCE_ID,
  parseDamodaranDataset,
  type DamodaranDataset,
} from "../domain/damodaran-datasets";
import type { ReferencePublication } from "../domain/reference-release";

/**
 * Adaptador vivo de las páginas de Damodaran (ADR 0032). Una request por página;
 * la respuesta se normaliza y **no se conserva**: la fila de derechos declara
 * `rawStorage` `restricted`, y el gate se negaría si esta corrida dijera que
 * guarda la página.
 */
const RIGHTS_REQUEST: IngestionRightsRequest = {
  storesRawPayload: false,
  storesNormalizedValues: true,
  publicDisplay: false,
};

export type ReferenceSourceErrorCode =
  | "source_not_registered"
  | "dataset_not_registered"
  | "rights_not_approved"
  | "fetch_failed"
  | "unexpected_status"
  | "payload_rejected";

export class ReferenceSourceError extends Error {
  readonly code: ReferenceSourceErrorCode;
  readonly datasetId: string;

  constructor(
    code: ReferenceSourceErrorCode,
    datasetId: string,
    detail: string | null = null,
  ) {
    super(detail === null ? code : `${code}: ${detail}`);
    this.name = "ReferenceSourceError";
    this.code = code;
    this.datasetId = datasetId;
  }
}

export type FetchedReferencePublication = {
  readonly publication: Extract<ReferencePublication, { ok: true }>;
  readonly url: string;
  readonly byteLength: number;
  /** El instante de la observación: es la vigencia de lo que se registre. */
  readonly fetchedAt: string;
};

export type ReferenceSourceProvider = {
  load(dataset: DamodaranDataset): Promise<FetchedReferencePublication>;
};

export function createLiveDamodaranSource(dependencies: {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
}): ReferenceSourceProvider {
  return {
    async load(dataset) {
      const entry =
        await dependencies.sourceRegistry.findBySourceId(DAMODARAN_SOURCE_ID);

      if (!entry) {
        throw new ReferenceSourceError(
          "source_not_registered",
          dataset.datasetId,
        );
      }

      if (!entry.datasets.includes(dataset.datasetId)) {
        throw new ReferenceSourceError(
          "dataset_not_registered",
          dataset.datasetId,
        );
      }

      const rights = evaluateIngestionRights(entry, RIGHTS_REQUEST);

      if (!rights.allowed) {
        // Fail-closed **antes** del egress: la red no se toca.
        throw new ReferenceSourceError(
          "rights_not_approved",
          dataset.datasetId,
          rights.blockedBy.join(", "),
        );
      }

      let response: Awaited<ReturnType<EgressFetch>>;

      try {
        response = await dependencies.fetch({
          sourceId: DAMODARAN_SOURCE_ID,
          url: dataset.url,
          accept: "text/html",
        });
      } catch (cause) {
        throw new ReferenceSourceError(
          "fetch_failed",
          dataset.datasetId,
          cause instanceof Error ? cause.message : "egress failed",
        );
      }

      if (response.status !== 200) {
        throw new ReferenceSourceError(
          "unexpected_status",
          dataset.datasetId,
          `status ${response.status}`,
        );
      }

      const publication = parseDamodaranDataset(
        dataset,
        new TextDecoder("utf-8").decode(response.body),
      );

      if (!publication.ok) {
        throw new ReferenceSourceError(
          "payload_rejected",
          dataset.datasetId,
          publication.code,
        );
      }

      return {
        publication,
        url: dataset.url,
        byteLength: response.byteLength,
        fetchedAt: response.fetchedAt,
      };
    },
  };
}
