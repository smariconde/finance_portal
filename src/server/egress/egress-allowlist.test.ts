import { describe, expect, it } from "vitest";

import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  findEgressAllowlistEntry,
  listEgressAllowlistEntries,
} from "@/server/egress/egress-allowlist";
import { authorizeEgressUrl } from "@/server/egress/egress-policy";

describe("egress allowlist", () => {
  it("holds only sources that a delivered slice needs", () => {
    // La allowlist no se escribe por adelantado. Cada fila de más es un destino
    // alcanzable que ningún test ejercita.
    expect(listEgressAllowlistEntries().map((entry) => entry.sourceId)).toEqual(
      ["sec-edgar", "datahub-sp500-pddl"],
    );
  });

  it("returns null for a source that is not listed, with no default", () => {
    expect(findEgressAllowlistEntry("alpaca-market-data")).toBeNull();
    expect(findEgressAllowlistEntry("openrouter")).toBeNull();
    expect(findEgressAllowlistEntry("")).toBeNull();
  });

  it("names every allowlisted source in the source registry too", () => {
    // Las dos listas responden preguntas distintas —a dónde se puede abrir un
    // socket, y de qué se tiene derecho a ingerir— pero una fuente que sólo
    // existe en una de las dos es un descuido en cualquiera de los dos sentidos.
    const registered = new Set(
      DEMO_SOURCE_REGISTRY.map((entry) => entry.sourceId),
    );

    for (const entry of listEgressAllowlistEntries()) {
      expect(registered).toContain(entry.sourceId);
    }
  });

  it("carries no rights information, so being listed cannot express permission", () => {
    // El punto de tener dos controles es que ninguno pueda cubrir al otro, y acá
    // eso es estructural: una entrada de allowlist no tiene dónde escribir un
    // derecho. Responde "¿a dónde se puede abrir un socket?" y nada más.
    for (const entry of listEgressAllowlistEntries()) {
      expect(Object.keys(entry).sort()).toEqual([
        "deadlineMs",
        "maxRedirects",
        "maxResponseBytes",
        "origins",
        "sourceId",
      ]);
    }
  });

  it("leaves an approved source unreachable when it is not listed", () => {
    // El recíproco del caso anterior: `alpaca-market-data` está registrada y aun
    // así no se alcanza, porque la aprobación de derechos no agrega destinos.
    const registered = DEMO_SOURCE_REGISTRY.map((entry) => entry.sourceId);

    expect(registered).toContain("alpaca-market-data");
    expect(findEgressAllowlistEntry("alpaca-market-data")).toBeNull();
  });

  it("records that both allowlisted sources passed the owner's rights review", () => {
    // Aprobadas el 2026-09-05. Se afirma acá para que quitarle los derechos a una
    // fuente y dejarla alcanzable sea un cambio visible y no una omisión.
    for (const sourceId of ["sec-edgar", "datahub-sp500-pddl"]) {
      const entry = DEMO_SOURCE_REGISTRY.find(
        (candidate) => candidate.sourceId === sourceId,
      );

      expect(entry?.approvalStatus).toBe("approved_personal");
      expect(entry?.rights.automatedAccess).toBe("allowed");
      // El payload descargado no se conserva, así que el derecho a guardarlo
      // sigue sin revisarse: el gate pide sólo lo que el adaptador usa.
      expect(entry?.rights.rawStorage).toBe("unknown");
      expect(entry?.rightsReviewedAt).not.toBeNull();
    }
  });

  it("authorizes the SEC endpoints that Phase 2 needs", () => {
    const entry = findEgressAllowlistEntry("sec-edgar");

    expect(entry).not.toBeNull();

    for (const url of [
      "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
      "https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Revenues.json",
      "https://data.sec.gov/api/xbrl/frames/us-gaap/Revenues/USD/CY2024Q1I.json",
      "https://data.sec.gov/submissions/CIK0000320193.json",
      "https://www.sec.gov/files/company_tickers.json",
      "https://www.sec.gov/files/company_tickers_exchange.json",
    ]) {
      expect(authorizeEgressUrl(url, entry!).allowed).toBe(true);
    }
  });

  it("leaves the rest of the SEC site unreachable", () => {
    const entry = findEgressAllowlistEntry("sec-edgar")!;

    for (const url of [
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany",
      "https://www.sec.gov/Archives/edgar/data/320193/index.json",
      "https://efts.sec.gov/LATEST/search-index?q=test",
      "https://data.sec.gov/api/xbrl/",
    ]) {
      expect(authorizeEgressUrl(url, entry).allowed).toBe(false);
    }
  });
});
