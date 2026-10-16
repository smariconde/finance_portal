import { crc32, inflateRawSync } from "node:zlib";

/**
 * Lector de hojas `.xlsx` sin dependencia (`F5-05`,
 * [ADR 0034](../../../../docs/architecture/adr/0034-operations-weighted-country-risk.md),
 * decisión 2).
 *
 * Un `.xlsx` es un zip de XML. Este lector es deliberadamente estrecho: lee el
 * directorio central —nunca recorre encabezados locales en busca de entradas—,
 * abre sólo el libro, sus relaciones, los strings compartidos y las hojas que se
 * le piden, con techos de tamaño y CRC32, y lee filas y celdas con un tokenizador
 * lineal que no conoce DTD ni entidades externas.
 *
 * Los números quedan **como texto**: lo que el Excel guarda es un double
 * (`4.2000000000000003E-2`), y ese texto es el dato de la fuente.
 */
export const XLSX_SHEET_READER_VERSION = "xlsx-sheet-reader-1.0.0";

/** Techo de cada parte inflada: la hoja más grande de Damodaran son ~490 KB. */
export const XLSX_MAX_PART_BYTES = 4 * 1024 * 1024;
/** Techo de todo lo que se infla en una lectura. */
export const XLSX_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 2_000;
const MAX_ROWS = 20_000;

export type XlsxRejection =
  | "not_a_zip"
  | "multi_disk_unsupported"
  | "zip64_unsupported"
  | "too_many_entries"
  | "central_directory_invalid"
  | "entry_name_unsafe"
  | "entry_duplicated"
  | "entry_encrypted"
  | "compression_unsupported"
  | "local_header_invalid"
  | "part_missing"
  | "part_too_large"
  | "archive_too_large"
  | "inflate_failed"
  | "size_mismatch"
  | "crc_mismatch"
  | "xml_declaration_forbidden"
  | "xml_entity_unknown"
  | "sheet_missing"
  | "relationship_missing"
  | "cell_reference_invalid"
  | "shared_string_missing"
  | "too_many_rows";

export type XlsxCell =
  | { readonly kind: "number"; readonly text: string }
  | { readonly kind: "string"; readonly text: string }
  | { readonly kind: "boolean"; readonly text: string }
  | { readonly kind: "error"; readonly text: string };

export type XlsxRow = {
  /** Número de fila de la hoja, desde 1. */
  readonly index: number;
  /** Celdas con valor, por letra de columna. */
  readonly cells: ReadonlyMap<string, XlsxCell>;
};

export type XlsxReadResult =
  | {
      readonly ok: true;
      readonly sheets: ReadonlyMap<string, readonly XlsxRow[]>;
    }
  | { readonly ok: false; readonly code: XlsxRejection };

class XlsxError extends Error {
  readonly code: XlsxRejection;

  constructor(code: XlsxRejection) {
    super(code);
    this.code = code;
  }
}

type Entry = {
  readonly name: string;
  readonly method: number;
  /** Bit 0 de las flags: se rechaza al abrirla, no si nadie la abre. */
  readonly encrypted: boolean;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localOffset: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function centralDirectory(bytes: Uint8Array): Map<string, Entry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // El registro final mide 22 bytes más un comentario de hasta 65.535.
  const lowest = Math.max(0, bytes.byteLength - 22 - 0xffff);
  let eocd = -1;

  for (let offset = bytes.byteLength - 22; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }

  if (eocd < 0) throw new XlsxError("not_a_zip");

  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entries = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const offset = view.getUint32(eocd + 16, true);

  if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    throw new XlsxError("zip64_unsupported");
  }
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entries) {
    throw new XlsxError("multi_disk_unsupported");
  }
  if (entries > MAX_ENTRIES) throw new XlsxError("too_many_entries");
  if (offset + size > eocd) throw new XlsxError("central_directory_invalid");

  const found = new Map<string, Entry>();
  let cursor = offset;
  const decoder = new TextDecoder("utf-8", { fatal: true });

  for (let index = 0; index < entries; index += 1) {
    if (
      cursor + 46 > offset + size ||
      view.getUint32(cursor, true) !== CENTRAL_SIGNATURE
    ) {
      throw new XlsxError("central_directory_invalid");
    }

    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const end = cursor + 46 + nameLength + extraLength + commentLength;

    if (end > offset + size) throw new XlsxError("central_directory_invalid");

    let name: string;

    try {
      name = decoder.decode(
        bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      );
    } catch {
      throw new XlsxError("entry_name_unsafe");
    }

    if (
      name === "" ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..")
    ) {
      throw new XlsxError("entry_name_unsafe");
    }
    if (found.has(name)) throw new XlsxError("entry_duplicated");
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new XlsxError("zip64_unsupported");
    }

    found.set(name, {
      name,
      method,
      encrypted: (flags & 0x1) !== 0,
      crc,
      compressedSize,
      size: uncompressedSize,
      localOffset,
    });
    cursor = end;
  }

  return found;
}

function openPart(
  bytes: Uint8Array,
  entries: ReadonlyMap<string, Entry>,
  name: string,
  budget: { remaining: number },
): string | null {
  const entry = entries.get(name);

  if (entry === undefined) return null;
  if (entry.encrypted) throw new XlsxError("entry_encrypted");
  if (entry.method !== 0 && entry.method !== 8) {
    throw new XlsxError("compression_unsupported");
  }
  if (entry.size > XLSX_MAX_PART_BYTES) throw new XlsxError("part_too_large");
  if (entry.size > budget.remaining) throw new XlsxError("archive_too_large");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const local = entry.localOffset;

  if (
    local + 30 > bytes.byteLength ||
    view.getUint32(local, true) !== LOCAL_SIGNATURE
  ) {
    throw new XlsxError("local_header_invalid");
  }

  const start =
    local +
    30 +
    view.getUint16(local + 26, true) +
    view.getUint16(local + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);

  if (data.byteLength !== entry.compressedSize) {
    throw new XlsxError("local_header_invalid");
  }

  let inflated: Uint8Array;

  if (entry.method === 0) {
    inflated = data;
  } else {
    try {
      // El techo corta el inflado: una bomba no llega a ocupar memoria.
      inflated = inflateRawSync(data, {
        maxOutputLength: Math.max(1, entry.size),
      });
    } catch (cause) {
      throw new XlsxError(
        cause instanceof RangeError ? "size_mismatch" : "inflate_failed",
      );
    }
  }

  if (inflated.byteLength !== entry.size) throw new XlsxError("size_mismatch");
  if (crc32(inflated) >>> 0 !== entry.crc >>> 0) {
    throw new XlsxError("crc_mismatch");
  }

  budget.remaining -= entry.size;

  const xml = new TextDecoder("utf-8").decode(inflated);

  if (/<!(?:DOCTYPE|ENTITY)/iu.test(xml)) {
    throw new XlsxError("xml_declaration_forbidden");
  }

  return xml;
}

const PREDEFINED: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

/** Las cinco entidades de XML y las numéricas; cualquier otra es un rechazo. */
export function decodeXmlText(text: string): string {
  return text.replace(/&([^;&\s]{1,10});/gu, (_, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      const code = Number.parseInt(name.slice(2), 16);
      if (/^[0-9a-f]{1,6}$/iu.test(name.slice(2)) && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
    } else if (name.startsWith("#")) {
      const code = Number.parseInt(name.slice(1), 10);
      if (/^[0-9]{1,7}$/u.test(name.slice(1)) && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
    } else if (PREDEFINED[name] !== undefined) {
      return PREDEFINED[name]!;
    }

    throw new XlsxError("xml_entity_unknown");
  });
}

function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();

  for (const match of tag.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/gu)) {
    attributes.set(match[1]!, decodeXmlText(match[2]!));
  }

  return attributes;
}

/** El texto de los `<t>` de un elemento, sin la guía fonética (`<rPh>`). */
function textRuns(xml: string): string {
  const withoutPhonetics = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/gu, "");
  let text = "";

  for (const match of withoutPhonetics.matchAll(
    /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/gu,
  )) {
    text += decodeXmlText(match[1] ?? "");
  }

  return text;
}

function sharedStringsOf(xml: string | null): string[] {
  if (xml === null) return [];

  return [...xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/gu)].map(
    (match) => textRuns(match[1] ?? ""),
  );
}

/** Nombre de hoja → ruta de su parte, por las relaciones del libro. */
function sheetPaths(
  workbook: string,
  relationships: string,
): Map<string, string> {
  const targets = new Map<string, string>();

  for (const match of relationships.matchAll(/<Relationship\b([^>]*?)\/?>/gu)) {
    const attributes = attributesOf(match[1]!);
    const id = attributes.get("Id");
    const target = attributes.get("Target");

    if (id !== undefined && target !== undefined) targets.set(id, target);
  }

  const paths = new Map<string, string>();

  for (const match of workbook.matchAll(/<sheet\b([^>]*?)\/?>/gu)) {
    const attributes = attributesOf(match[1]!);
    const name = attributes.get("name");
    const id = attributes.get("r:id");

    if (name === undefined || id === undefined) continue;

    const target = targets.get(id);

    if (target === undefined) throw new XlsxError("relationship_missing");

    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;

    if (path.split("/").includes("..")) {
      throw new XlsxError("entry_name_unsafe");
    }

    paths.set(name, path);
  }

  return paths;
}

function rowsOf(xml: string, shared: readonly string[]): XlsxRow[] {
  const rows: XlsxRow[] = [];

  for (const row of xml.matchAll(
    /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/gu,
  )) {
    if (rows.length >= MAX_ROWS) throw new XlsxError("too_many_rows");

    const cells = new Map<string, XlsxCell>();
    let index: number | null = null;

    for (const cell of (row[2] ?? "").matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu,
    )) {
      const attributes = attributesOf(cell[1]!);
      const reference = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(
        attributes.get("r") ?? "",
      );

      if (reference === null) throw new XlsxError("cell_reference_invalid");

      const rowIndex = Number(reference[2]);

      if (index !== null && rowIndex !== index) {
        throw new XlsxError("cell_reference_invalid");
      }
      index = rowIndex;

      const body = cell[2] ?? "";
      const type = attributes.get("t") ?? "n";
      const value = /<v>([\s\S]*?)<\/v>/u.exec(body)?.[1];
      let parsed: XlsxCell | null = null;

      switch (type) {
        case "inlineStr": {
          const inline = /<is>([\s\S]*?)<\/is>/u.exec(body)?.[1];
          if (inline !== undefined) {
            parsed = { kind: "string", text: textRuns(inline) };
          }
          break;
        }
        case "s": {
          if (value === undefined) break;
          const position = Number(value);
          const text = Number.isInteger(position)
            ? shared[position]
            : undefined;
          if (text === undefined) throw new XlsxError("shared_string_missing");
          parsed = { kind: "string", text };
          break;
        }
        case "str":
        case "d":
          if (value !== undefined) {
            parsed = { kind: "string", text: decodeXmlText(value) };
          }
          break;
        case "b":
          if (value !== undefined) parsed = { kind: "boolean", text: value };
          break;
        case "e":
          if (value !== undefined) {
            parsed = { kind: "error", text: decodeXmlText(value) };
          }
          break;
        default:
          if (value !== undefined) {
            parsed = { kind: "number", text: value.trim() };
          }
      }

      if (parsed !== null) cells.set(reference[1]!, parsed);
    }

    const declared = Number(attributesOf(row[1]!).get("r"));
    const rowIndex = index ?? (Number.isInteger(declared) ? declared : null);

    if (rowIndex === null) continue;
    rows.push({ index: rowIndex, cells });
  }

  return rows;
}

/**
 * Lee las hojas pedidas de un `.xlsx`. Una hoja pedida que el libro no tiene es
 * un rechazo: quien la pide sabe que tiene que estar.
 */
export function readXlsxSheets(
  bytes: Uint8Array,
  sheetNames: readonly string[],
): XlsxReadResult {
  try {
    const entries = centralDirectory(bytes);
    const budget = { remaining: XLSX_MAX_TOTAL_BYTES };
    const workbook = openPart(bytes, entries, "xl/workbook.xml", budget);
    const relationships = openPart(
      bytes,
      entries,
      "xl/_rels/workbook.xml.rels",
      budget,
    );

    if (workbook === null || relationships === null) {
      throw new XlsxError("part_missing");
    }

    const paths = sheetPaths(workbook, relationships);
    const shared = sharedStringsOf(
      openPart(bytes, entries, "xl/sharedStrings.xml", budget),
    );
    const sheets = new Map<string, readonly XlsxRow[]>();

    for (const sheetName of sheetNames) {
      const path = paths.get(sheetName);

      if (path === undefined) throw new XlsxError("sheet_missing");

      const xml = openPart(bytes, entries, path, budget);

      if (xml === null) throw new XlsxError("part_missing");
      sheets.set(sheetName, rowsOf(xml, shared));
    }

    return { ok: true, sheets };
  } catch (cause) {
    if (cause instanceof XlsxError) return { ok: false, code: cause.code };
    throw cause;
  }
}
