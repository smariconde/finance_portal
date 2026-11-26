import { z } from "zod";

import { economicPublicationSchema } from "./calendar-publication";

export const BCRA_CALENDAR_DATASET = "bcra.report-calendar";
export const BCRA_CALENDAR_PARSER = "bcra-report-calendar-1.0.0";
export const BCRA_CALENDAR_URL =
  "https://www.bcra.gob.ar/calendario-de-informes/";

const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];
const REM_TITLE = "Relevamiento de Expectativas de Mercado (REM)";

function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/gu, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&nbsp;", " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function parseBcraReportCalendar(html: string) {
  const title = /<h1\b[^>]*>([\s\S]*?)<\/h1>/iu.exec(html)?.[1];
  const year =
    title && /^Calendario de informes (\d{4})$/u.exec(textOf(title))?.[1];
  if (!year) throw new Error("bcra_calendar_title_changed");
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/giu)];
  const candidates = tables.filter(
    ([, table]) =>
      [...table!.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/giu)]
        .map(([, cell]) => textOf(cell!))
        .join("|") === "Publicaciones|Fecha",
  );
  if (candidates.length !== 1) throw new Error("bcra_calendar_table_changed");
  const [, table] = candidates[0]!;
  const rows = [...table!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].slice(1);
  if (rows.length === 0) throw new Error("bcra_calendar_empty");

  const duplicates = new Map<string, number>();
  return rows.map(([, row]) => {
    const [title, label, ...extra] = [
      ...row!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/giu),
    ].map(([, cell]) => textOf(cell!));
    const parsed = label && /^(\d{1,2}) ([a-z]{3}) (\d{4})$/u.exec(label);
    if (!title || !parsed || parsed[3] !== year || extra.length > 0)
      throw new Error("bcra_calendar_row_changed");
    const month = MONTHS.indexOf(parsed[2]!) + 1;
    const date = z.iso
      .date()
      .parse(
        `${year}-${String(month).padStart(2, "0")}-${parsed[1]!.padStart(2, "0")}`,
      );
    const rem = title === REM_TITLE;
    const period = rem
      ? new Date(Date.UTC(Number(year), month - 2, 1))
          .toISOString()
          .slice(0, 10)
      : null;
    const id = rem
      ? "rem"
      : title
          .normalize("NFD")
          .replace(/\p{Mark}/gu, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, "-")
          .replace(/-$/u, "");
    const prefix = `bcra:${id}:${date.slice(0, 7)}`;
    const occurrence = (duplicates.get(prefix) ?? 0) + 1;
    duplicates.set(prefix, occurrence);
    return {
      key: `${prefix}:${occurrence}`,
      publication: economicPublicationSchema.parse({ id, title, date, period }),
    };
  });
}
