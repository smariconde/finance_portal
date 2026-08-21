import { z } from "zod";

export const snapshotManifestStatusSchema = z.enum([
  "stored",
  "not_provided",
  "license_restricted",
]);

const utcTimestampSchema = z.iso.datetime({ offset: true });

export const datasetSnapshotSchema = z
  .object({
    snapshotId: z.uuid(),
    datasetId: z.string().trim().min(1).max(128),
    version: z.string().trim().min(1).max(64),
    validFrom: utcTimestampSchema,
    validTo: utcTimestampSchema.nullable(),
    availableAt: utcTimestampSchema,
    supersededAt: utcTimestampSchema.nullable(),
    recordedAt: utcTimestampSchema,
    manifest: z.record(z.string(), z.unknown()).nullable(),
    manifestStatus: snapshotManifestStatusSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .superRefine((snapshot, context) => {
    if (
      snapshot.validTo !== null &&
      Date.parse(snapshot.validFrom) >= Date.parse(snapshot.validTo)
    ) {
      context.addIssue({
        code: "custom",
        path: ["validTo"],
        message: "validTo must be later than validFrom.",
      });
    }

    const manifestIsStored = snapshot.manifestStatus === "stored";
    if (manifestIsStored !== (snapshot.manifest !== null)) {
      context.addIssue({
        code: "custom",
        path: ["manifest"],
        message: "manifest must be present only when manifestStatus is stored.",
      });
    }
  });

export type DatasetSnapshot = z.infer<typeof datasetSnapshotSchema>;
