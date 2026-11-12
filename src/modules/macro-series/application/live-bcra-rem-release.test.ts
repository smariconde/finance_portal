import { describe, expect, it } from "vitest";

import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import { buildXlsx } from "@/modules/reference-data/infrastructure/fixture-xlsx";

import {
  BCRA_REM_OCTOBER_PAGE,
  BCRA_REM_SOURCE_ID,
  createLiveBcraRemRelease,
} from "./live-bcra-rem-release";

const workbookUrl =
  "https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/relevamiento-expectativas-mercado-tablas-2026-10.xlsx";
const html = `<div id="fecha-publicacion">Publicado el 5 Nov 2026</div><a href="${workbookUrl}">XLSX</a>`;
const book = buildXlsx([
  {
    name: "Cuadros de resultados",
    rows: [
      [],
      [null, "REM - BCRA - Octubre 2026"],
      [],
      [],
      [null, "Precios minoristas (IPC nivel general-Nacional; INDEC)"],
      [null, "Período", "Referencia", "Mediana"],
      [null, { n: "46326" }, "var. % mensual", { n: "1.8" }],
    ],
  },
]);
const entry = DEMO_SOURCE_REGISTRY.find(
  (row) => row.sourceId === BCRA_REM_SOURCE_ID,
)!;
const registry = (approved: boolean) =>
  createInMemorySourceRegistryRepository([
    approved
      ? {
          ...entry,
          technicalStatus: "integrated",
          approvalStatus: "approved_personal",
          rightsReviewedAt: "2026-11-12T00:00:00.000Z",
          rights: {
            ...entry.rights,
            personalUse: "allowed",
            automatedAccess: "owner_accepted",
            normalizedStorage: "allowed",
          },
        }
      : entry,
  ]);

describe("BCRA REM release adapter", () => {
  it("refuses undeclared rounds and pending rights before egress", async () => {
    const fetch: EgressFetch = async () => {
      throw new Error("unexpected egress");
    };
    const load = createLiveBcraRemRelease({
      sourceRegistry: registry(false),
      fetch,
    });
    await expect(load("2026-09")).rejects.toMatchObject({
      code: "round_not_declared",
    });
    await expect(load("2026-10")).rejects.toMatchObject({
      code: "rights_not_approved",
    });
  });

  it("uses the verified page and only its linked workbook", async () => {
    const requested: string[] = [];
    const fetch: EgressFetch = async (request) => {
      requested.push(request.url);
      const body =
        request.url === BCRA_REM_OCTOBER_PAGE
          ? new TextEncoder().encode(html)
          : book;
      return {
        status: 200,
        body,
        byteLength: body.length,
        fetchedAt: "2026-11-12T16:00:00.000Z",
      };
    };
    const result = await createLiveBcraRemRelease({
      sourceRegistry: registry(true),
      fetch,
    })("2026-10");
    expect(requested).toEqual([BCRA_REM_OCTOBER_PAGE, workbookUrl]);
    expect(result).toMatchObject({
      roundMonth: "2026-10",
      publishedOn: "2026-11-05",
      availableAt: "2026-11-06T03:00:00.000Z",
      forecasts: [
        { roundMonth: "2026-10", targetMonth: "2026-10", medianPercent: "1.8" },
      ],
      requests: 2,
    });
  });

  it("stops on a changed page before requesting a workbook", async () => {
    let calls = 0;
    const fetch: EgressFetch = async () => {
      calls += 1;
      return {
        status: 200,
        body: new TextEncoder().encode("<p>Sin fecha</p>"),
        byteLength: 16,
        fetchedAt: "2026-11-12T16:00:00.000Z",
      };
    };
    await expect(
      createLiveBcraRemRelease({
        sourceRegistry: registry(true),
        fetch,
      })("2026-10"),
    ).rejects.toMatchObject({ code: "page_schema_changed" });
    expect(calls).toBe(1);
  });

  it("keeps a failed or changed workbook out of publication", async () => {
    for (const [workbookStatus, expected] of [
      [503, "rate_limited"],
      [200, "workbook_schema_changed"],
    ] as const) {
      const fetch: EgressFetch = async (request) => {
        const isPage = request.url === BCRA_REM_OCTOBER_PAGE;
        const body = isPage
          ? new TextEncoder().encode(html)
          : new Uint8Array([1, 2, 3]);
        return {
          status: isPage ? 200 : workbookStatus,
          body,
          byteLength: body.length,
          fetchedAt: "2026-11-12T16:00:00.000Z",
        };
      };
      await expect(
        createLiveBcraRemRelease({
          sourceRegistry: registry(true),
          fetch,
        })("2026-10"),
      ).rejects.toMatchObject({ code: expected });
    }
  });
});
