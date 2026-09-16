import "server-only";

/** El envelope temporal viaja como ISO en el dominio y como `Date` en la fila. */
export type TemporalRow = {
  validFrom: Date;
  validTo: Date | null;
  availableAt: Date;
  supersededAt: Date | null;
  sourceId: string;
  sourceDocumentId: string | null;
  contentHash: string;
  recordedAt: Date;
};

export type TemporalFields = {
  validFrom: string;
  validTo: string | null;
  availableAt: string;
  supersededAt: string | null;
  sourceId: string;
  sourceDocumentId: string | null;
  contentHash: string;
  recordedAt: string;
};

export function toTemporalFields(row: TemporalRow): TemporalFields {
  return {
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo?.toISOString() ?? null,
    availableAt: row.availableAt.toISOString(),
    supersededAt: row.supersededAt?.toISOString() ?? null,
    sourceId: row.sourceId,
    sourceDocumentId: row.sourceDocumentId,
    contentHash: row.contentHash,
    recordedAt: row.recordedAt.toISOString(),
  };
}

export function toTemporalRow(version: TemporalFields): TemporalRow {
  return {
    validFrom: new Date(version.validFrom),
    validTo: version.validTo === null ? null : new Date(version.validTo),
    availableAt: new Date(version.availableAt),
    supersededAt:
      version.supersededAt === null ? null : new Date(version.supersededAt),
    sourceId: version.sourceId,
    sourceDocumentId: version.sourceDocumentId,
    contentHash: version.contentHash,
    recordedAt: new Date(version.recordedAt),
  };
}
