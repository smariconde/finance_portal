import { readXlsxSheets } from "@/modules/reference-data/domain/xlsx-sheet-reader";
import { withComafiLocalSymbols } from "../domain/comafi-local-symbols";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import {
  evaluateIngestionRights,
  type IngestionRightsRequest,
} from "@/modules/ingestion/domain/source-registry-entry";

import type { CedearPublication } from "../domain/cedear-claim";
import {
  CAJA_VALORES_DEPOSITARY,
  COMAFI_DEPOSITARY,
} from "../domain/cedear-depositaries";
import { parseCajaValoresCedears } from "../domain/parse-caja-valores-cedears";
import { parseComafiProducts } from "../domain/parse-comafi-products";

/**
 * Adaptador vivo de las dos publicaciones del registro
 * ([ADR 0027](../../../../docs/architecture/adr/0027-cedear-registry-sources.md)).
 *
 * Una request de Caja y dos de Comafi (JSON + símbolos de la planilla) traen el registro. La respuesta se normaliza y
 * **no se conserva**: las dos filas de derechos declaran `rawStorage`
 * `restricted` —Comafi lo prohíbe por escrito—, y el gate se negaría si esta
 * corrida dijera que guarda el payload.
 */
const RIGHTS_REQUEST: IngestionRightsRequest = {
  storesRawPayload: false,
  storesNormalizedValues: true,
  publicDisplay: false,
};

type PublicationEndpoint = {
  readonly url: string;
  readonly accept: string;
  readonly parse: (text: string) => CedearPublication;
};

const ENDPOINTS: Readonly<Record<string, PublicationEndpoint>> = Object.freeze({
  [COMAFI_DEPOSITARY.sourceId]: {
    url: "https://www.comafi.com.ar/custodiaglobal/json/apps/getproducts.aspx",
    accept: "application/json",
    parse: (text: string) => {
      let body: unknown;

      try {
        body = JSON.parse(text);
      } catch {
        return { ok: false, code: "payload_unparsable" } as const;
      }

      return parseComafiProducts(body);
    },
  },
  [CAJA_VALORES_DEPOSITARY.sourceId]: {
    url: "https://cajadevalores.com.ar/Servicios/Cedears",
    accept: "text/html",
    parse: parseCajaValoresCedears,
  },
});

export type CedearSourceErrorCode =
  | "source_not_registered"
  | "rights_not_approved"
  | "fetch_failed"
  | "unexpected_status"
  | "payload_rejected";

export class CedearSourceError extends Error {
  readonly code: CedearSourceErrorCode;
  readonly sourceId: string;
  readonly detail: string | null;

  constructor(
    code: CedearSourceErrorCode,
    sourceId: string,
    detail: string | null = null,
  ) {
    super(detail === null ? code : `${code}: ${detail}`);
    this.name = "CedearSourceError";
    this.code = code;
    this.sourceId = sourceId;
    this.detail = detail;
  }
}

export type FetchedCedearPublication = {
  readonly sourceId: string;
  readonly publication: Extract<CedearPublication, { ok: true }>;
  readonly byteLength: number;
  /** El instante de la observación: es la vigencia de lo que se registre. */
  readonly fetchedAt: string;
};

export type CedearSourceProvider = {
  load(sourceId: string): Promise<FetchedCedearPublication>;
};

export type CedearSourceDependencies = {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
};

export function createLiveCedearSource(
  dependencies: CedearSourceDependencies,
): CedearSourceProvider {
  return {
    async load(sourceId: string): Promise<FetchedCedearPublication> {
      const endpoint = ENDPOINTS[sourceId];
      const entry = await dependencies.sourceRegistry.findBySourceId(sourceId);

      if (endpoint === undefined || !entry) {
        throw new CedearSourceError("source_not_registered", sourceId);
      }

      const rights = evaluateIngestionRights(entry, RIGHTS_REQUEST);

      if (!rights.allowed) {
        // Fail-closed **antes** del egress: la red no se toca.
        throw new CedearSourceError(
          "rights_not_approved",
          sourceId,
          rights.blockedBy.join(", "),
        );
      }

      let response: Awaited<ReturnType<EgressFetch>>;

      try {
        response = await dependencies.fetch({
          sourceId,
          url: endpoint.url,
          accept: endpoint.accept,
        });
      } catch (cause) {
        throw new CedearSourceError(
          "fetch_failed",
          sourceId,
          cause instanceof Error ? cause.message : "egress failed",
        );
      }

      if (response.status !== 200) {
        throw new CedearSourceError(
          "unexpected_status",
          sourceId,
          `status ${response.status}`,
        );
      }

      let publication = endpoint.parse(
        new TextDecoder("utf-8").decode(response.body),
      );

      if (!publication.ok) {
        throw new CedearSourceError(
          "payload_rejected",
          sourceId,
          publication.code,
        );
      }

      let extraBytes = 0;
      let fetchedAt = response.fetchedAt;
      if (sourceId === COMAFI_DEPOSITARY.sourceId) {
        const sheet = await dependencies.fetch({
          sourceId,
          url: "https://www.comafi.com.ar/custodiaglobal/Multimedios/otros/14779.xlsx",
          accept:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        if (sheet.status !== 200)
          throw new CedearSourceError("unexpected_status", sourceId);
        const book = readXlsxSheets(sheet.body, ["LISTA TOTAL DE CEDEARS"]);
        if (!book.ok)
          throw new CedearSourceError("payload_rejected", sourceId, book.code);
        publication = withComafiLocalSymbols(
          publication,
          book.sheets.get("LISTA TOTAL DE CEDEARS")!,
        );
        if (!publication.ok)
          throw new CedearSourceError(
            "payload_rejected",
            sourceId,
            publication.code,
          );
        extraBytes = sheet.byteLength;
        fetchedAt = sheet.fetchedAt > fetchedAt ? sheet.fetchedAt : fetchedAt;
      }
      return {
        sourceId,
        publication,
        byteLength: response.byteLength + extraBytes,
        fetchedAt,
      };
    },
  };
}
