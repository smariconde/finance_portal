import {
  indexConstituentClaimSchema,
  type IndexConstituentClaim,
} from "./universe-source-records";

/**
 * Parser del CSV de constituyentes del paquete PDDL.
 *
 * El archivo real trae comillas: `"Saint Paul, Minnesota"` es **un** campo con una
 * coma adentro, y 503 de sus 505 líneas contienen alguna. Un `split(",")` partiría
 * esas filas y correría las columnas siguientes, así que acá hay un lector con las
 * reglas de comillas de la RFC 4180 y no una división por separador.
 *
 * La columna que el parser **no** usa es la más tentadora: el CSV publica su
 * propio `CIK`. No se lee. La lista deriva de Wikipedia y no es autoritativa sobre
 * la identidad del filer; la única fuente que puede decir a qué emisor corresponde
 * un símbolo es la SEC (`universe-source-records.ts`). Tomar el CIK de acá sería
 * crear un join irreversible sobre una fuente que el registro declara como universo
 * de desarrollo. Reconciliar ambos CIK y reportar las discrepancias es útil y es
 * otro slice: exige decidir qué significa el desacuerdo, no sólo detectarlo.
 *
 * El sector se lee pero el planner no lo persiste: mezclar una taxonomía sin
 * registrar cuál es y en qué versión es lo que el modelo de identidad prohíbe. El
 * mapeo a industria es `F3-05`.
 */
export const SP500_CONSTITUENTS_PARSER_VERSION = "sp500-constituents-1.0.0";

const SYMBOL_COLUMN = "symbol";
const NAME_COLUMN = "security";
const SECTOR_COLUMN = "gics sector";

export type Sp500PayloadRejectionCode =
  /** El cuerpo está vacío o no tiene una fila de encabezado. */
  | "header_missing"
  /** Falta alguna columna de la que depende la claim. */
  | "required_column_missing"
  /** Una columna se declara dos veces: el encabezado no determina la posición. */
  | "duplicate_column"
  /** El archivo se lee y no deja una sola claim utilizable. */
  | "no_usable_rows";

export type Sp500RowRejectionCode =
  "row_arity_mismatch" | "symbol_missing" | "name_missing";

export type Sp500RowRejection = {
  readonly row: number;
  readonly code: Sp500RowRejectionCode;
  /** Nombre de la columna, nunca el valor recibido (`TM-02`). */
  readonly column: string | null;
};

export type Sp500ParseResult =
  | {
      readonly ok: true;
      readonly parserVersion: string;
      readonly columnOrder: readonly string[];
      readonly claims: readonly IndexConstituentClaim[];
      readonly rejections: readonly Sp500RowRejection[];
    }
  | {
      readonly ok: false;
      readonly parserVersion: string;
      readonly code: Sp500PayloadRejectionCode;
    };

/**
 * Lector con las reglas de comillas de la RFC 4180: un campo entrecomillado puede
 * contener comas, saltos de línea y comillas escritas como `""`. Devuelve filas de
 * celdas crudas; no interpreta ninguna columna.
 *
 * `\r\n` y `\n` terminan una fila por igual. El archivo real usa `\n`, pero un
 * lector que sólo entienda uno de los dos deja una celda con un `\r` pegado que
 * después no coincide con nada.
 */
function readCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let index = 0;

  const endCell = (): void => {
    row.push(cell);
    cell = "";
  };

  const endRow = (): void => {
    endCell();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }

        quoted = false;
        index += 1;
        continue;
      }

      cell += character;
      index += 1;
      continue;
    }

    if (character === '"' && cell.length === 0) {
      quoted = true;
      index += 1;
      continue;
    }

    if (character === ",") {
      endCell();
      index += 1;
      continue;
    }

    if (character === "\n") {
      endRow();
      index += 1;
      continue;
    }

    if (character === "\r" && text[index + 1] === "\n") {
      endRow();
      index += 2;
      continue;
    }

    cell += character;
    index += 1;
  }

  // Una última fila sin salto de línea final sigue siendo una fila; un salto final
  // no inventa una fila vacía.
  if (cell.length > 0 || row.length > 0) {
    endRow();
  }

  return rows;
}

export function parseSp500Constituents(text: string): Sp500ParseResult {
  const parserVersion = SP500_CONSTITUENTS_PARSER_VERSION;
  const rows = readCsvRows(text);
  const [header, ...dataRows] = rows;

  if (header === undefined || header.every((cell) => cell.trim() === "")) {
    return { ok: false, parserVersion, code: "header_missing" };
  }

  const columnOrder = header.map((cell) => cell.trim().toLowerCase());

  if (new Set(columnOrder).size !== columnOrder.length) {
    return { ok: false, parserVersion, code: "duplicate_column" };
  }

  const symbolAt = columnOrder.indexOf(SYMBOL_COLUMN);
  const nameAt = columnOrder.indexOf(NAME_COLUMN);
  const sectorAt = columnOrder.indexOf(SECTOR_COLUMN);

  if (symbolAt === -1 || nameAt === -1) {
    return { ok: false, parserVersion, code: "required_column_missing" };
  }

  const claims: IndexConstituentClaim[] = [];
  const rejections: Sp500RowRejection[] = [];

  dataRows.forEach((cells, index) => {
    // Una fila vacía al final del archivo no es un rechazo: es el salto final.
    if (cells.length === 1 && cells[0].trim() === "") {
      return;
    }

    if (cells.length !== columnOrder.length) {
      rejections.push({ row: index, code: "row_arity_mismatch", column: null });
      return;
    }

    const symbol = cells[symbolAt].trim();

    if (symbol.length === 0) {
      rejections.push({
        row: index,
        code: "symbol_missing",
        column: SYMBOL_COLUMN,
      });
      return;
    }

    const name = cells[nameAt].trim();

    if (name.length === 0) {
      rejections.push({
        row: index,
        code: "name_missing",
        column: NAME_COLUMN,
      });
      return;
    }

    // El sector es opcional: su ausencia no invalida la pertenencia al índice, que
    // es lo único que esta fuente puede afirmar.
    const rawSector = sectorAt === -1 ? "" : cells[sectorAt].trim();
    const parsed = indexConstituentClaimSchema.safeParse({
      symbol,
      name,
      sector: rawSector.length === 0 ? null : rawSector,
    });

    if (!parsed.success) {
      rejections.push({
        row: index,
        code: "symbol_missing",
        column: SYMBOL_COLUMN,
      });
      return;
    }

    claims.push(parsed.data);
  });

  if (claims.length === 0) {
    // Una lista que se lee y no deja un solo constituyente vaciaría el índice al
    // rebalancear. El orquestador ya corta antes, y acá se nombra el motivo
    // (`TM-05`).
    return { ok: false, parserVersion, code: "no_usable_rows" };
  }

  return { ok: true, parserVersion, columnOrder, claims, rejections };
}
