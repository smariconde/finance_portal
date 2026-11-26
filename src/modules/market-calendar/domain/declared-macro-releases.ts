/** FRED supplies dates. These agencies publish the usual Eastern times. */
export const DECLARED_MACRO_RELEASES = [
  {
    releaseId: 10,
    title: "IPC de Estados Unidos",
    agency: "BLS",
    time: "08:30",
    high: true,
  },
  {
    releaseId: 50,
    title: "Informe de empleo",
    agency: "BLS",
    time: "08:30",
    high: true,
  },
  {
    releaseId: 46,
    title: "Precios al productor",
    agency: "BLS",
    time: "08:30",
    high: false,
  },
  {
    releaseId: 53,
    title: "PIB de Estados Unidos",
    agency: "BEA",
    time: "08:30",
    high: true,
  },
  {
    releaseId: 54,
    title: "Ingresos y gastos personales (PCE)",
    agency: "BEA",
    time: "08:30",
    high: true,
  },
  {
    releaseId: 9,
    title: "Ventas minoristas",
    agency: "Census Bureau",
    time: "08:30",
    high: false,
  },
  {
    releaseId: 192,
    title: "Vacantes laborales (JOLTS)",
    agency: "BLS",
    time: "10:00",
    high: false,
  },
  {
    releaseId: 180,
    title: "Pedidos iniciales de desempleo",
    agency: "Department of Labor",
    time: "08:30",
    high: false,
  },
] as const;

export const FOMC_SOURCE =
  "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
export const FOMC_REVISION_SOURCE =
  "https://www.federalreserve.gov/newsevents/pressreleases/monetary20261112a.htm";
export const FOMC_CONSULTED_ON = "2026-11-26";

/** For rate meetings the event is the decision on the second day. */
export const FOMC_MEETINGS = [
  ["2026-01-27", "2026-01-28"],
  ["2026-03-17", "2026-03-18"],
  ["2026-04-28", "2026-04-29"],
  ["2026-06-16", "2026-06-17"],
  ["2026-07-28", "2026-07-29"],
  ["2026-09-15", "2026-09-16"],
  ["2026-10-27", "2026-10-28"],
  ["2026-12-08", "2026-12-09"],
  ["2027-01-26", "2027-01-27"],
  ["2027-03-16", "2027-03-17"],
  ["2027-04-27", "2027-04-28"],
  ["2027-06-08", "2027-06-09"],
  ["2027-07-27", "2027-07-28"],
  ["2027-09-14", "2027-09-15"],
  ["2027-10-26", "2027-10-27", "strategy"],
  ["2027-11-16", "2027-11-17"],
  ["2028-01-25", "2028-01-26"],
] as const;
