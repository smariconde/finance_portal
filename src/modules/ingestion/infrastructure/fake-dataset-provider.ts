import {
  datasetFetchRequestSchema,
  type DatasetFetchRequest,
  type DatasetFetchResponse,
  type DatasetProvider,
} from "@/modules/ingestion/application/dataset-provider";

/**
 * Proveedor determinista en memoria.
 *
 * No importa framework, SDK ni cliente HTTP: su única entrada es un catálogo de
 * fixtures y un reloj inyectado, de modo que dos corridas con la misma entrada
 * producen exactamente la misma respuesta. Es el sustituto explícito de un
 * proveedor real mientras la Fase 2 no apruebe ninguno.
 */
export type FakeDatasetFixture =
  | {
      kind: "records";
      records: readonly unknown[];
      sourceDocumentId?: string | null;
    }
  | { kind: "unavailable"; message: string };

export type FakeDatasetCatalog = Readonly<
  Record<string, Readonly<Record<string, FakeDatasetFixture>>>
>;

export type FakeDatasetProviderOptions = {
  providerId?: string;
  catalog: FakeDatasetCatalog;
  now: () => string;
};

export class FakeProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FakeProviderUnavailableError";
  }
}

export class FakeProviderContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FakeProviderContractError";
  }
}

const CURSOR_PATTERN = /^offset:(0|[1-9][0-9]*)$/u;

function readOffset(cursor: string | null): number {
  if (cursor === null) {
    return 0;
  }

  const match = CURSOR_PATTERN.exec(cursor);
  if (!match) {
    throw new FakeProviderContractError("El cursor recibido no es válido.");
  }

  return Number.parseInt(match[1]!, 10);
}

export function createFakeDatasetProvider(
  options: FakeDatasetProviderOptions,
): DatasetProvider {
  const { catalog, now, providerId = "fake-dataset-provider" } = options;

  return {
    providerId,
    async fetchDataset(
      request: DatasetFetchRequest,
    ): Promise<DatasetFetchResponse> {
      const parsedRequest = datasetFetchRequestSchema.parse(request);
      const fixture =
        catalog[parsedRequest.sourceId]?.[parsedRequest.datasetId];

      if (!fixture) {
        throw new FakeProviderContractError(
          "El dataset solicitado no existe en el catálogo de fixtures.",
        );
      }

      if (fixture.kind === "unavailable") {
        throw new FakeProviderUnavailableError(fixture.message);
      }

      const offset = readOffset(parsedRequest.cursor);
      const page = fixture.records.slice(
        offset,
        offset + parsedRequest.maxRecords,
      );
      const consumed = offset + page.length;

      return {
        fetchedAt: now(),
        records: page,
        nextCursor:
          consumed < fixture.records.length ? `offset:${consumed}` : null,
        sourceDocumentId: fixture.sourceDocumentId ?? null,
      };
    },
  };
}
