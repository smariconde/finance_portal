import type { EconomicPublication } from "./calendar-publication";

export const INDEC_CALENDAR = {
  semester: "2026-2",
  publishedOn: "2026-10-01",
  coversTo: "2026-12-31",
  source:
    "https://www.indec.gob.ar/ftp/cuadros/publicaciones/calendario_2sem2026.pdf",
  usualTime: "16:00",
} as const;

export const FISCAL_CALENDAR = {
  consultedOn: "2026-11-26",
  source:
    "https://www.argentina.gob.ar/economia/sechacienda/calendariodepublicacion",
} as const;

const TITLES = {
  ipc: "IPC nacional",
  emae: "Actividad económica (EMAE)",
  ica: "Intercambio comercial argentino",
  fiscal: "Resultado fiscal",
} as const;

const INDEC_DATES = [
  ["ipc", "07-14", "06"],
  ["emae", "07-22", "05"],
  ["ica", "07-20", "06"],
  ["ipc", "08-13", "07"],
  ["emae", "08-20", "06"],
  ["ica", "08-20", "07"],
  ["ipc", "09-10", "08"],
  ["emae", "09-24", "07"],
  ["ica", "09-18", "08"],
  ["ipc", "10-13", "09"],
  ["emae", "10-21", "08"],
  ["ica", "10-19", "09"],
  ["ipc", "11-12", "10"],
  ["emae", "11-24", "09"],
  ["ica", "11-19", "10"],
  ["ipc", "12-15", "11"],
  ["emae", "12-18", "10"],
  ["ica", "12-18", "11"],
] as const;

function publications(
  dates: ReadonlyArray<readonly [keyof typeof TITLES, string, string]>,
): readonly EconomicPublication[] {
  return dates.map(([id, day, month]) => ({
    id,
    title: TITLES[id],
    date: `2026-${day}`,
    period: `2026-${month}-01`,
    status: "scheduled",
  }));
}

export const INDEC_PUBLICATIONS = publications(INDEC_DATES);
export const FISCAL_PUBLICATIONS = publications([
  ["fiscal", "11-16", "10"],
  ["fiscal", "12-17", "11"],
]);
