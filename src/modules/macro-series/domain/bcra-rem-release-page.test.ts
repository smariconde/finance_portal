import { describe, expect, it } from "vitest";

import { parseBcraRemReleasePage } from "./bcra-rem-release-page";

const url =
  "https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/relevamiento-expectativas-mercado-tablas-2026-10.xlsx";
const page = (date: string, href = url) => `
  <div id="fecha-publicacion"><div>Publicado el ${date}</div></div>
  <p><a href="${href}">Tablas REM XLSX</a></p>
`;

describe("bcra-rem-release-page-1.0.0", () => {
  it("binds publication day and the exact workbook to the requested round", () => {
    expect(parseBcraRemReleasePage(page("5 Nov 2026"), "2026-10")).toEqual({
      ok: true,
      publishedOn: "2026-11-05",
      availableAt: "2026-11-06T03:00:00.000Z",
      workbookUrl: url,
    });
  });

  it("refuses missing, pre-round, impossible or mismatched evidence", () => {
    expect(
      parseBcraRemReleasePage(page("5 Nov 2026"), "2026-09"),
    ).toMatchObject({
      ok: false,
      code: "workbook_link_missing",
    });
    expect(
      parseBcraRemReleasePage(page("30 Oct 2026"), "2026-10"),
    ).toMatchObject({
      ok: false,
      code: "publication_before_round",
    });
    expect(
      parseBcraRemReleasePage(page("31 Nov 2026"), "2026-10"),
    ).toMatchObject({
      ok: false,
      code: "publication_date_invalid",
    });
    expect(
      parseBcraRemReleasePage("<p>Sin fecha</p>", "2026-10"),
    ).toMatchObject({
      ok: false,
      code: "publication_date_missing",
    });
  });
});
