import { z } from "zod";

export const BCRA_REM_PAGE_PARSER_VERSION = "bcra-rem-release-page-1.0.0";

const MONTHS = new Map([
  ["Ene", 1],
  ["Feb", 2],
  ["Mar", 3],
  ["Abr", 4],
  ["May", 5],
  ["Jun", 6],
  ["Jul", 7],
  ["Ago", 8],
  ["Sep", 9],
  ["Oct", 10],
  ["Nov", 11],
  ["Dic", 12],
]);

export type RemPageResult =
  | {
      readonly ok: true;
      readonly publishedOn: string;
      /** Conservative availability: midnight Argentina at the start of the next day. */
      readonly availableAt: string;
      readonly workbookUrl: string;
    }
  | { readonly ok: false; readonly code: string };

/** BCRA publication page, not a release date inferred from the survey month. */
export function parseBcraRemReleasePage(
  html: string,
  roundMonth: string,
): RemPageResult {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(roundMonth))
    return { ok: false, code: "round_invalid" };
  if (html.length > 1_000_000) return { ok: false, code: "page_too_large" };
  const dateBlock =
    /<div\s+id=["']fecha-publicacion["'][^>]*>([\s\S]{0,600}?)<\/div>/iu.exec(
      html,
    );
  if (!dateBlock) return { ok: false, code: "publication_date_missing" };
  const dateText = dateBlock[1]!
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ");
  const dateMatch =
    /Publicado el\s+(\d{1,2})\s+(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)\s+(\d{4})/iu.exec(
      dateText,
    );
  if (!dateMatch) return { ok: false, code: "publication_date_invalid" };
  const month = MONTHS.get(
    dateMatch[2]![0]!.toUpperCase() + dateMatch[2]!.slice(1).toLowerCase(),
  );
  if (!month) return { ok: false, code: "publication_date_invalid" };
  const publishedOn = `${dateMatch[3]}-${String(month).padStart(2, "0")}-${dateMatch[1]!.padStart(2, "0")}`;
  if (!z.iso.date().safeParse(publishedOn).success)
    return { ok: false, code: "publication_date_invalid" };
  const roundEnd = new Date(
    Date.UTC(Number(roundMonth.slice(0, 4)), Number(roundMonth.slice(5, 7)), 0),
  );
  if (Date.parse(`${publishedOn}T00:00:00Z`) <= roundEnd.getTime())
    return { ok: false, code: "publication_before_round" };

  const expectedUrl = `https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/relevamiento-expectativas-mercado-tablas-${roundMonth}.xlsx`;
  const links = [
    ...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/giu),
  ].map((match) => match[1]);
  if (!links.includes(expectedUrl))
    return { ok: false, code: "workbook_link_missing" };
  const nextDay = new Date(Date.parse(`${publishedOn}T00:00:00Z`) + 86_400_000);
  return {
    ok: true,
    publishedOn,
    availableAt: new Date(nextDay.getTime() + 3 * 3_600_000).toISOString(),
    workbookUrl: expectedUrl,
  };
}
