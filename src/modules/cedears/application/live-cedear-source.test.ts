import { describe, expect, it } from "vitest";

import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";

import {
  fixtureCajaValoresHtml,
  fixtureComafiProducts,
} from "../infrastructure/fixture-cedear-publications";

import {
  CedearSourceError,
  createLiveCedearSource,
} from "./live-cedear-source";

const FETCHED_AT = "2026-09-23T03:00:00.000Z";

function respond(body: string, status = 200): EgressFetch {
  const bytes = new TextEncoder().encode(body);

  return async () => ({
    status,
    body: bytes,
    byteLength: bytes.byteLength,
    fetchedAt: FETCHED_AT,
  });
}

describe("createLiveCedearSource", () => {
  it("asks each issuer for its own registry and parses it", async () => {
    const requested: string[] = [];
    const comafiBody = JSON.stringify(fixtureComafiProducts());
    const fetch: EgressFetch = async (request) => {
      requested.push(`${request.sourceId} ${request.url} ${request.accept}`);

      return respond(
        request.sourceId === "comafi-cedear"
          ? comafiBody
          : fixtureCajaValoresHtml(),
      )(request);
    };
    const source = createLiveCedearSource({
      sourceRegistry: createInMemorySourceRegistryRepository(),
      fetch,
    });

    const comafi = await source.load("comafi-cedear");
    const caja = await source.load("caja-valores-cedear");

    expect(requested).toEqual([
      "comafi-cedear https://www.comafi.com.ar/custodiaglobal/json/apps/getproducts.aspx application/json",
      "caja-valores-cedear https://cajadevalores.com.ar/Servicios/Cedears text/html",
    ]);
    expect(comafi.publication.claims).toHaveLength(6);
    expect(caja.publication.claims).toHaveLength(3);
    // La observación es el instante de la respuesta: es la vigencia registrada.
    expect(comafi.fetchedAt).toBe(FETCHED_AT);
  });

  it("refuses before the network when the rights row does not allow the run", async () => {
    let called = false;
    const blocked = DEMO_SOURCE_REGISTRY.map((entry) =>
      entry.sourceId === "comafi-cedear"
        ? {
            ...entry,
            rights: { ...entry.rights, automatedAccess: "unknown" as const },
          }
        : entry,
    );
    const source = createLiveCedearSource({
      sourceRegistry: createInMemorySourceRegistryRepository(blocked),
      fetch: async () => {
        called = true;
        throw new Error("the network must not be reached");
      },
    });

    await expect(source.load("comafi-cedear")).rejects.toMatchObject({
      code: "rights_not_approved",
    });
    expect(called).toBe(false);
  });

  it("names an unknown source, a bad status and an unparsable payload", async () => {
    const registry = createInMemorySourceRegistryRepository();

    await expect(
      createLiveCedearSource({
        sourceRegistry: registry,
        fetch: respond("{}"),
      }).load("byma-cedear"),
    ).rejects.toMatchObject({ code: "source_not_registered" });
    await expect(
      createLiveCedearSource({
        sourceRegistry: registry,
        fetch: respond("", 503),
      }).load("comafi-cedear"),
    ).rejects.toMatchObject({ code: "unexpected_status" });
    await expect(
      createLiveCedearSource({
        sourceRegistry: registry,
        fetch: respond("<html>mantenimiento</html>"),
      }).load("comafi-cedear"),
    ).rejects.toMatchObject({
      code: "payload_rejected",
      detail: "payload_unparsable",
    });
    await expect(
      createLiveCedearSource({
        sourceRegistry: registry,
        fetch: respond('{"products":[]}'),
      }).load("comafi-cedear"),
    ).rejects.toBeInstanceOf(CedearSourceError);
  });
});
