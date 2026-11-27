import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";

import type {
  ExportedPage,
  ExportPageMessage,
  WorkerMessage,
} from "../capture/messages";
import { ALL_PORTAL_MATCHES } from "../portals/portal-matches";
import { adapterFor } from "../portals/registry";
import type { PortalAdapter, PortalDocument } from "../portals/types";

/**
 * Captura al ver (ADR 0089, `F13-02`): cuando una ficha o un listado de un
 * portal declarado termina de cargar, lee el documento ya cargado —ningún
 * pedido propio, ningún clic— y le pasa la lectura al service worker. Un
 * desafío se reporta y no se lee nada más.
 */
export default defineContentScript({
  matches: [...ALL_PORTAL_MATCHES],
  runAt: "document_idle",
  main() {
    const adapter = adapterFor(location.href);
    if (adapter === null) return;

    const snapshot = snapshotOf(adapter);

    browser.runtime.onMessage.addListener((message: unknown) => {
      if ((message as ExportPageMessage | null)?.type !== "export_page") return;
      const exported: ExportedPage = {
        exportVersion: "listing-page-export-1.0.0",
        source: adapter.sourceId,
        adapterVersion: adapter.version,
        document: snapshot,
      };
      return Promise.resolve(exported);
    });

    const challenged = adapter.challengeSelectors.some(
      (selector) => document.querySelector(selector) !== null,
    );
    const message: WorkerMessage = challenged
      ? { type: "challenge_seen", source: adapter.sourceId }
      : {
          type: "page_read",
          source: adapter.sourceId,
          adapterVersion: adapter.version,
          reading: adapter.read(snapshot),
        };
    void browser.runtime.sendMessage(message).catch(() => undefined);
  },
});

function snapshotOf(adapter: PortalAdapter): PortalDocument {
  const embeddedStates: Record<string, string | null> = {};
  for (const selector of adapter.embeddedStateSelectors) {
    embeddedStates[selector] =
      document.querySelector(selector)?.textContent ?? null;
  }
  return {
    url: location.href,
    capturedAt: new Date().toISOString(),
    embeddedStates,
    jsonLd: Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
      (script) => script.textContent ?? "",
    ),
  };
}
