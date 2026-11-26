/**
 * Feriados y cierres tempranos de la NYSE declarados tal como los publica la
 * bolsa (`F12-01`, ADR 0088 decisión 2). Nasdaq publica el mismo calendario
 * para las acciones. Nada de esto se consulta en runtime: la tabla es código,
 * se revisa contra la página de la NYSE y Schwab la corrobora el día que se
 * opera.
 *
 * Fuera de `coversFrom`–`coversTo` una fecha es «sin calendario», nunca un día
 * hábil supuesto. El anuncio de 2026–2028 salió el 2025-12-23; el de 2029 se
 * declara cuando salga.
 */
export type DeclaredHoliday = {
  readonly date: string;
  /** El nombre oficial en inglés, como lo publica la NYSE. */
  readonly name: string;
};

export type DeclaredEarlyClose = {
  readonly date: string;
  /** Cierre de la sesión regular, hora de Nueva York. */
  readonly regularClose: string;
  /** Cierre de la sesión tardía de NYSE Arca y afines ese día. */
  readonly lateClose: string;
  readonly reason: string;
};

export type MarketCalendarDeclaration = {
  readonly venue: "XNYS";
  readonly source: string;
  readonly announcedOn: string;
  readonly consultedOn: string;
  readonly coversFrom: string;
  readonly coversTo: string;
  readonly holidays: readonly DeclaredHoliday[];
  readonly earlyCloses: readonly DeclaredEarlyClose[];
};

export const NYSE_CALENDAR: MarketCalendarDeclaration = {
  venue: "XNYS",
  source: "https://www.nyse.com/markets/hours-calendars",
  announcedOn: "2025-12-23",
  consultedOn: "2026-11-26",
  coversFrom: "2026-01-01",
  coversTo: "2028-12-31",
  holidays: [
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-01-19", name: "Martin Luther King, Jr. Day" },
    { date: "2026-02-16", name: "Washington's Birthday" },
    { date: "2026-04-03", name: "Good Friday" },
    { date: "2026-05-25", name: "Memorial Day" },
    { date: "2026-06-19", name: "Juneteenth" },
    { date: "2026-07-03", name: "Independence Day (observed)" },
    { date: "2026-09-07", name: "Labor Day" },
    { date: "2026-11-26", name: "Thanksgiving Day" },
    { date: "2026-12-25", name: "Christmas Day" },
    { date: "2027-01-01", name: "New Year's Day" },
    { date: "2027-01-18", name: "Martin Luther King, Jr. Day" },
    { date: "2027-02-15", name: "Washington's Birthday" },
    { date: "2027-03-26", name: "Good Friday" },
    { date: "2027-05-31", name: "Memorial Day" },
    { date: "2027-06-18", name: "Juneteenth (observed)" },
    { date: "2027-07-05", name: "Independence Day (observed)" },
    { date: "2027-09-06", name: "Labor Day" },
    { date: "2027-11-25", name: "Thanksgiving Day" },
    { date: "2027-12-24", name: "Christmas Day (observed)" },
    // 2028: el 1 de enero cae sábado y la NYSE no observa feriado.
    { date: "2028-01-17", name: "Martin Luther King, Jr. Day" },
    { date: "2028-02-21", name: "Washington's Birthday" },
    { date: "2028-04-14", name: "Good Friday" },
    { date: "2028-05-29", name: "Memorial Day" },
    { date: "2028-06-19", name: "Juneteenth" },
    { date: "2028-07-04", name: "Independence Day" },
    { date: "2028-09-04", name: "Labor Day" },
    { date: "2028-11-23", name: "Thanksgiving Day" },
    { date: "2028-12-25", name: "Christmas Day" },
  ],
  earlyCloses: [
    {
      date: "2026-11-27",
      regularClose: "13:00",
      lateClose: "17:00",
      reason: "Día después de Thanksgiving",
    },
    {
      date: "2026-12-24",
      regularClose: "13:00",
      lateClose: "17:00",
      reason: "Nochebuena",
    },
    {
      date: "2027-11-26",
      regularClose: "13:00",
      lateClose: "17:00",
      reason: "Día después de Thanksgiving",
    },
    {
      date: "2028-07-03",
      regularClose: "13:00",
      lateClose: "17:00",
      reason: "Víspera del 4 de julio",
    },
    {
      date: "2028-11-24",
      regularClose: "13:00",
      lateClose: "17:00",
      reason: "Día después de Thanksgiving",
    },
  ],
};
