import { z } from "zod";

import {
  datasetIdSchema,
  parserVersionSchema,
  sourceIdSchema,
} from "@/modules/ingestion/domain/source-registry-entry";

export const MAX_RECORDS_PER_FETCH = 500;

export const datasetFetchRequestSchema = z.object({
  sourceId: sourceIdSchema,
  datasetId: datasetIdSchema,
  parserVersion: parserVersionSchema,
  requestedAsOf: z.iso.date().nullable(),
  cursor: z.string().trim().min(1).max(512).nullable(),
  maxRecords: z.number().int().min(1).max(MAX_RECORDS_PER_FETCH),
});

export type DatasetFetchRequest = z.infer<typeof datasetFetchRequestSchema>;

/**
 * Respuesta cruda del adaptador. `records` es `unknown[]` a propósito: la
 * frontera runtime es el schema Zod de staging, no el tipo declarado por el
 * proveedor.
 */
export const datasetFetchResponseSchema = z.object({
  fetchedAt: z.iso.datetime({ offset: true }),
  records: z.array(z.unknown()).max(MAX_RECORDS_PER_FETCH),
  nextCursor: z.string().trim().min(1).max(512).nullable(),
  sourceDocumentId: z.string().trim().min(1).max(256).nullable(),
});

export type DatasetFetchResponse = z.infer<typeof datasetFetchResponseSchema>;

export interface DatasetProvider {
  readonly providerId: string;
  /** Nunca debe abrir red en modo demo ni en tests. */
  fetchDataset(request: DatasetFetchRequest): Promise<DatasetFetchResponse>;
}
