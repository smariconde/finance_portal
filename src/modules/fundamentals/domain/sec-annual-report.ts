import { z } from "zod";

/**
 * El último 10-K conocido al corte (`F5-03`,
 * [ADR 0033](../../../../docs/architecture/adr/0033-ai-layer-industry-resolution.md),
 * decisión 6).
 *
 * Lee de `submissions` lo único que el parser de la ingesta no necesita: el
 * documento principal de cada presentación. Es un lector aparte a propósito —
 * igual que `readSecSic`— para no cambiar la versión de un parser cuyas
 * corridas ya están publicadas.
 *
 * Sólo cuenta el `10-K` original. Una enmienda `10-K/A` suele traer únicamente
 * la Parte III y no el Item 1, y un `10-KT` es un período de transición; los dos
 * se ignoran en vez de citarse como si describieran el negocio.
 */
export const SEC_ANNUAL_REPORT_LOCATOR_VERSION =
  "sec-annual-report-locator-1.0.0";

const ANNUAL_REPORT_FORM = "10-K";

export type SecAnnualReport = {
  readonly cik: string;
  readonly accessionNumber: string;
  readonly acceptedAt: string;
  readonly reportDate: string | null;
  readonly primaryDocument: string;
  readonly url: string;
};

const columnsSchema = z.object({
  filings: z.object({
    recent: z.object({
      accessionNumber: z.array(z.unknown()),
      form: z.array(z.unknown()),
      acceptanceDateTime: z.array(z.unknown()),
      primaryDocument: z.array(z.unknown()),
      reportDate: z.array(z.unknown()).optional(),
    }),
  }),
});

const ACCESSION = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u;
const ACCEPTANCE =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z$/u;
/**
 * Un nombre de archivo plano del índice de EDGAR. Sin barras ni `..`: el nombre
 * viene del payload y termina en una URL, así que no puede salir del directorio
 * de la presentación.
 */
const PRIMARY_DOCUMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.html?$/u;

export function buildAnnualReportUrl(
  cik: string,
  accessionNumber: string,
  primaryDocument: string,
): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNumber.replaceAll("-", "")}/${primaryDocument}`;
}

export type LocateAnnualReportResult =
  | { readonly status: "found"; readonly report: SecAnnualReport }
  | {
      readonly status: "not_found";
      readonly reason: "columns_missing" | "no_annual_report_known";
    };

/**
 * El `10-K` con la aceptación más reciente que no sea posterior al corte. La
 * aceptación es la disponibilidad (ADR 0010): un 10-K aceptado después del corte
 * no se veía todavía.
 */
export function locateLatestAnnualReport(
  payload: unknown,
  cik: string,
  knownAt: string,
): LocateAnnualReportResult {
  const parsed = columnsSchema.safeParse(payload);

  if (!parsed.success) {
    return { status: "not_found", reason: "columns_missing" };
  }

  const recent = parsed.data.filings.recent;
  const cutoff = Date.parse(knownAt);
  let latest: SecAnnualReport | null = null;

  for (let row = 0; row < recent.form.length; row += 1) {
    const form = recent.form[row];
    const accessionNumber = recent.accessionNumber[row];
    const rawAcceptance = recent.acceptanceDateTime[row];
    const primaryDocument = recent.primaryDocument[row];
    const reportDate = recent.reportDate?.[row];

    if (
      form !== ANNUAL_REPORT_FORM ||
      typeof accessionNumber !== "string" ||
      !ACCESSION.test(accessionNumber) ||
      typeof rawAcceptance !== "string" ||
      !ACCEPTANCE.test(rawAcceptance) ||
      typeof primaryDocument !== "string" ||
      !PRIMARY_DOCUMENT.test(primaryDocument)
    ) {
      continue;
    }

    const acceptedAt = new Date(rawAcceptance).toISOString();

    if (Date.parse(acceptedAt) > cutoff) {
      continue;
    }

    if (
      latest === null ||
      Date.parse(acceptedAt) > Date.parse(latest.acceptedAt)
    ) {
      latest = {
        cik,
        accessionNumber,
        acceptedAt,
        reportDate:
          typeof reportDate === "string" && reportDate.length > 0
            ? reportDate
            : null,
        primaryDocument,
        url: buildAnnualReportUrl(cik, accessionNumber, primaryDocument),
      };
    }
  }

  return latest === null
    ? { status: "not_found", reason: "no_annual_report_known" }
    : { status: "found", report: latest };
}
