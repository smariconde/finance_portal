import "server-only";

import { createHash } from "node:crypto";

import sharp from "sharp";

import type { StoredCompanyLogo } from "@/modules/configuration/application/company-logo-store";
import { companyLogoUrl } from "@/modules/configuration/domain/company-logo";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import {
  evaluateIngestionRights,
  type SourceRegistryEntry,
} from "@/modules/ingestion/domain/source-registry-entry";

export const COMPANY_LOGO_SOURCE_ID = "logo-dev";
export const COMPANY_LOGO_PARSER_VERSION = "company-logo-png-1.0.0";
export const COMPANY_LOGO_MAX_BYTES = 256 * 1024;

export function createCompanyLogoDownload(dependencies: {
  readonly fetch: EgressFetch;
  readonly entry: SourceRegistryEntry;
  readonly key: () => string | undefined;
}) {
  return async (symbol: string): Promise<StoredCompanyLogo | null> => {
    const rights = evaluateIngestionRights(dependencies.entry, {
      storesRawPayload: true,
      storesNormalizedValues: true,
      publicDisplay: false,
    });
    if (
      dependencies.entry.sourceId !== COMPANY_LOGO_SOURCE_ID ||
      !rights.allowed
    ) {
      throw new Error("Company logo rights refused.");
    }
    const url = companyLogoUrl(symbol, dependencies.key());
    if (url === null) return null;
    const response = await dependencies.fetch({
      sourceId: COMPANY_LOGO_SOURCE_ID,
      url,
      accept: "image/png",
    });
    if (response.status === 404) return null;
    if (
      response.status !== 200 ||
      response.body.byteLength > COMPANY_LOGO_MAX_BYTES
    ) {
      throw new Error(`Company logo response rejected (${response.status}).`);
    }
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((byte, index) => response.body[index] === byte)) {
      throw new Error("Company logo is not a PNG.");
    }
    // Decodifica y recodifica: no confiar en Content-Type o extensión. Se limita
    // también la imagen descomprimida y se eliminan metadata y contenido adjunto.
    const image = sharp(response.body, {
      limitInputPixels: 512 * 512,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== "png" ||
      metadata.width !== 128 ||
      metadata.height !== 128 ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new Error("Company logo image rejected.");
    }
    const bytes = await image.png().toBuffer();
    if (bytes.byteLength > COMPANY_LOGO_MAX_BYTES)
      throw new Error("Company logo too large.");
    return {
      bytes: new Uint8Array(bytes),
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      fetchedAt: response.fetchedAt,
    };
  };
}
