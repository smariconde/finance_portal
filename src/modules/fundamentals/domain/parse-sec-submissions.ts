/**
 * Parser del formato de cable de `submissions` de la SEC: el índice de
 * presentaciones de un filer.
 *
 * De este documento sale lo único que companyfacts no trae: el **instante de
 * aceptación** de cada presentación, que es el `available_at` defendible de todo
 * hecho que esa presentación publicó.
 *
 * Contrato de cable verificado el 2026-09-14 contra el filer 320193, sin conservar
 * el payload:
 *
 * - las presentaciones vienen como **columnas paralelas** —`accessionNumber[i]`,
 *   `form[i]`, `filingDate[i]`— y no como objetos, en `filings.recent` (las últimas
 *   mil) y en archivos históricos listados en `filings.files` con la misma forma
 *   en la raíz;
 * - `acceptanceDateTime` llega como `YYYY-MM-DDTHH:MM:SS.sssZ` y el `Z` es UTC
 *   real: leído así, 998 de 1.000 aceptaciones caen dentro del horario operativo
 *   de EDGAR (6:00 a 22:00 de Nueva York); leyendo los dígitos como hora de Nueva
 *   York caerían 339. Tomarlo por hora local habría adelantado cada hecho entre
 *   cuatro y cinco horas, que es look-ahead;
 * - `reportDate` puede venir vacío.
 *
 * Igual que los parsers del universo, un envelope que no se entiende es un parser
 * roto y cuarentena el documento entero (`TM-05`), mientras que una fila inválida
 * se rechaza nombrando su posición y su campo, nunca su valor (`TM-02`).
 */
export const SEC_SUBMISSIONS_PARSER_VERSION = "sec-submissions-1.0.0";

export type SecFiling = {
  readonly accessionNumber: string;
  readonly form: string;
  readonly filingDate: string;
  readonly reportDate: string | null;
  /** UTC normalizado; `null` si la fuente no lo publica para esa fila. */
  readonly acceptedAt: string | null;
};

export type SecSubmissionsHistoryFile = {
  readonly name: string;
  readonly filingFrom: string;
  readonly filingTo: string;
};

export type SecSubmissionsPayloadRejectionCode =
  | "payload_not_object"
  | "cik_invalid"
  | "filings_missing"
  | "column_missing"
  | "column_length_mismatch"
  | "history_files_invalid";

export type SecFilingRowRejection = {
  readonly row: number;
  readonly field: SecFilingColumn;
  /**
   * Accession de la fila, cuando se pudo leer. Es un identificador público, no un
   * valor del payload, y hace falta: los hechos de una presentación cuya fila no
   * se entendió no pueden caer en silencio en la disponibilidad inferida.
   */
  readonly accessionNumber: string | null;
};

const COLUMNS = [
  "accessionNumber",
  "form",
  "filingDate",
  "reportDate",
  "acceptanceDateTime",
] as const;

export type SecFilingColumn = (typeof COLUMNS)[number];

export type SecFilingColumnsResult =
  | {
      readonly ok: true;
      readonly filings: readonly SecFiling[];
      readonly rejections: readonly SecFilingRowRejection[];
    }
  | {
      readonly ok: false;
      readonly code: "column_missing" | "column_length_mismatch";
    };

export type SecSubmissionsParseResult =
  | {
      readonly ok: true;
      readonly parserVersion: string;
      readonly cik: string;
      /**
       * Nombre del filer tal como lo publica la SEC, o `null` si no llega como
       * texto usable. No invalida el documento: los hechos no dependen de él, y
       * quien lo necesite —la sucesión de emisor— rechaza su ausencia con nombre.
       */
      readonly entityName: string | null;
      readonly filings: readonly SecFiling[];
      readonly historyFiles: readonly SecSubmissionsHistoryFile[];
      readonly rejections: readonly SecFilingRowRejection[];
    }
  | {
      readonly ok: false;
      readonly parserVersion: string;
      readonly code: SecSubmissionsPayloadRejectionCode;
    };

const ACCESSION = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u;
const CALENDAR_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const ACCEPTANCE =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z$/u;
const HISTORY_FILE = /^CIK[0-9]{10}-submissions-[0-9]{3}\.json$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Una fecha que la regex acepta pero el calendario no (`2025-02-30`) es inválida. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !CALENDAR_DATE.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** CIK de la fuente normalizado a diez dígitos, como lo guarda el grafo. */
export function normalizeCik(value: unknown): string | null {
  const digits =
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : typeof value === "string" && /^[0-9]{1,10}$/u.test(value.trim())
        ? value.trim()
        : null;

  if (digits === null || Number(digits) === 0 || digits.length > 10) {
    return null;
  }

  return digits.padStart(10, "0");
}

function readAcceptance(value: unknown): string | null | undefined {
  if (value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !ACCEPTANCE.test(value)) {
    return undefined;
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

/**
 * Lee las columnas paralelas de presentaciones. Compartido por `recent` y por los
 * archivos históricos, que tienen exactamente la misma forma.
 */
export function parseSecFilingColumns(
  columns: unknown,
): SecFilingColumnsResult {
  if (!isRecord(columns)) {
    return { ok: false, code: "column_missing" };
  }

  for (const column of COLUMNS) {
    if (!Array.isArray(columns[column])) {
      return { ok: false, code: "column_missing" };
    }
  }

  const arrays = COLUMNS.map((column) => columns[column] as unknown[]);
  const length = arrays[0]!.length;

  if (arrays.some((array) => array.length !== length)) {
    // Columnas paralelas de distinto largo: la fila `i` ya no describe una sola
    // presentación, y alinear «lo que se pueda» asignaría fechas ajenas.
    return { ok: false, code: "column_length_mismatch" };
  }

  const [accessions, forms, filingDates, reportDates, acceptances] = arrays as [
    unknown[],
    unknown[],
    unknown[],
    unknown[],
    unknown[],
  ];
  const filings: SecFiling[] = [];
  const rejections: SecFilingRowRejection[] = [];

  for (let row = 0; row < length; row += 1) {
    const accession = accessions[row];
    const form = forms[row];
    const filingDate = filingDates[row];
    const reportDate = reportDates[row];
    const acceptedAt = readAcceptance(acceptances[row]);

    if (typeof accession !== "string" || !ACCESSION.test(accession)) {
      rejections.push({ row, field: "accessionNumber", accessionNumber: null });
      continue;
    }

    const reject = (field: SecFilingColumn) =>
      rejections.push({ row, field, accessionNumber: accession });

    if (
      typeof form !== "string" ||
      form.trim().length === 0 ||
      form.trim().length > 32
    ) {
      reject("form");
      continue;
    }

    if (!isCalendarDate(filingDate)) {
      reject("filingDate");
      continue;
    }

    if (
      reportDate !== "" &&
      reportDate !== null &&
      !isCalendarDate(reportDate)
    ) {
      reject("reportDate");
      continue;
    }

    if (acceptedAt === undefined) {
      reject("acceptanceDateTime");
      continue;
    }

    filings.push({
      accessionNumber: accession,
      form: form.trim(),
      filingDate,
      reportDate: reportDate === "" || reportDate === null ? null : reportDate,
      acceptedAt,
    });
  }

  return { ok: true, filings, rejections };
}

export function parseSecSubmissions(
  payload: unknown,
): SecSubmissionsParseResult {
  const parserVersion = SEC_SUBMISSIONS_PARSER_VERSION;

  if (!isRecord(payload)) {
    return { ok: false, parserVersion, code: "payload_not_object" };
  }

  const cik = normalizeCik(payload.cik);

  if (cik === null) {
    return { ok: false, parserVersion, code: "cik_invalid" };
  }

  if (!isRecord(payload.filings)) {
    return { ok: false, parserVersion, code: "filings_missing" };
  }

  const recent = parseSecFilingColumns(payload.filings.recent);

  if (!recent.ok) {
    return { ok: false, parserVersion, code: recent.code };
  }

  const rawFiles = payload.filings.files ?? [];

  if (!Array.isArray(rawFiles)) {
    return { ok: false, parserVersion, code: "history_files_invalid" };
  }

  const historyFiles: SecSubmissionsHistoryFile[] = [];

  for (const file of rawFiles) {
    if (
      !isRecord(file) ||
      typeof file.name !== "string" ||
      !HISTORY_FILE.test(file.name) ||
      // Un archivo histórico de otro filer no describe a este.
      !file.name.startsWith(`CIK${cik}-`) ||
      !isCalendarDate(file.filingFrom) ||
      !isCalendarDate(file.filingTo) ||
      file.filingFrom > file.filingTo
    ) {
      // El nombre del archivo termina en un path de egress: uno que no tiene la
      // forma declarada no se sigue, y el índice deja de ser confiable.
      return { ok: false, parserVersion, code: "history_files_invalid" };
    }

    historyFiles.push({
      name: file.name,
      filingFrom: file.filingFrom,
      filingTo: file.filingTo,
    });
  }

  const entityName =
    typeof payload.name === "string" &&
    payload.name.trim().length > 0 &&
    payload.name.trim().length <= 256
      ? payload.name.trim()
      : null;

  return {
    ok: true,
    parserVersion,
    cik,
    entityName,
    filings: recent.filings,
    historyFiles,
    rejections: recent.rejections,
  };
}
