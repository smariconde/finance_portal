import type { RealEstatePortal } from "../../../src/modules/real-estate/domain/listing-capture";

import type { PortalDocument, PortalReading } from "../portals/types";

/**
 * Los mensajes entre el content script, el service worker y el popup. El
 * content script nunca habla con la red: lee la página y le pasa la lectura al
 * service worker, que es el único que envía (ADR 0089, «Envío»).
 */
export type PageReadMessage = {
  readonly type: "page_read";
  readonly source: RealEstatePortal;
  readonly adapterVersion: string;
  readonly reading: PortalReading;
};

export type ChallengeMessage = {
  readonly type: "challenge_seen";
  readonly source: RealEstatePortal;
};

export type FlushMessage = { readonly type: "flush_now" };

export type ExportPageMessage = { readonly type: "export_page" };

export type ExportedPage = {
  readonly exportVersion: "listing-page-export-1.0.0";
  readonly source: RealEstatePortal;
  readonly adapterVersion: string;
  readonly document: PortalDocument;
};

export type WorkerMessage = PageReadMessage | ChallengeMessage | FlushMessage;
