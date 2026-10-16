import { crc32, deflateRawSync } from "node:zlib";

/**
 * Libros `.xlsx` sintéticos para los tests del lector (ADR 0034). Ningún archivo
 * de Damodaran entra al repositorio: sus términos no lo permiten, y un libro
 * armado a mano deja probar también lo que la fuente nunca manda —un zip
 * hostil, una entidad, una bomba—.
 */
export type ZipEntryFixture = {
  readonly name: string;
  readonly data: Uint8Array | string;
  /** `8` deflate (por defecto) o `0` stored; otro valor prueba el rechazo. */
  readonly method?: number;
  readonly flags?: number;
  /** Mentir en el directorio central, para probar que el lector lo comprueba. */
  readonly declaredSize?: number;
  readonly declaredCrc?: number;
};

const encoder = new TextEncoder();

function bytesOf(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? encoder.encode(data) : data;
}

export function buildZip(
  entries: readonly ZipEntryFixture[],
  options: { readonly entryCountOverride?: number } = {},
): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = bytesOf(entry.data);
    const method = entry.method ?? 8;
    const stored = method === 8 ? deflateRawSync(raw) : raw;
    const name = encoder.encode(entry.name);
    const crc = entry.declaredCrc ?? crc32(raw) >>> 0;
    const size = entry.declaredSize ?? raw.byteLength;
    const flags = entry.flags ?? 0;

    const local = new Uint8Array(30 + name.byteLength + stored.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, stored.byteLength, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(stored, 30 + name.byteLength);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, flags, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, stored.byteLength, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.byteLength;
  }

  const centralSize = centrals.reduce(
    (total, part) => total + part.byteLength,
    0,
  );
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  const count = options.entryCountOverride ?? entries.length;
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, count, true);
  endView.setUint16(10, count, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const archive = new Uint8Array(offset + centralSize + end.byteLength);
  let cursor = 0;

  for (const part of [...locals, ...centrals, end]) {
    archive.set(part, cursor);
    cursor += part.byteLength;
  }

  return archive;
}

/** Una celda: texto (string compartido), número como texto, error o vacía. */
export type CellFixture =
  | string
  | { readonly n: string }
  | { readonly error: string }
  | { readonly inline: string }
  | null;

export type SheetFixture = {
  readonly name: string;
  readonly rows: readonly (readonly CellFixture[])[];
};

function escapeXml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function column(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Las partes de un libro mínimo; un test puede reemplazar o quitar alguna. */
export function workbookParts(
  sheets: readonly SheetFixture[],
): Map<string, string> {
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const stringIndex = (text: string) => {
    let index = sharedIndex.get(text);
    if (index === undefined) {
      index = shared.length;
      shared.push(text);
      sharedIndex.set(text, index);
    }
    return index;
  };

  const parts = new Map<string, string>();

  sheets.forEach((sheet, sheetIndex) => {
    const rows = sheet.rows
      .map((cells, rowIndex) => {
        const r = rowIndex + 1;
        const body = cells
          .map((cell, cellIndex) => {
            const ref = `${column(cellIndex)}${r}`;
            if (cell === null) return `<c r="${ref}" s="1"/>`;
            if (typeof cell === "string") {
              return `<c r="${ref}" t="s"><v>${stringIndex(cell)}</v></c>`;
            }
            if ("n" in cell) return `<c r="${ref}"><v>${cell.n}</v></c>`;
            if ("error" in cell) {
              return `<c r="${ref}" t="e"><f>VLOOKUP(A1,B:C,2)</f><v>${escapeXml(cell.error)}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell.inline)}</t></is></c>`;
          })
          .join("");
        return `<row r="${r}" spans="1:9">${body}</row>`;
      })
      .join("");

    parts.set(
      `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="20"/></cols><sheetData>${rows}</sheetData></worksheet>`,
    );
  });

  parts.set(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
  );
  parts.set(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map(
        (sheet, index) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
      )
      .join("")}</sheets></workbook>`,
  );
  parts.set(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships>${sheets
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  );
  parts.set(
    "xl/sharedStrings.xml",
    `<?xml version="1.0" encoding="UTF-8"?><sst count="${shared.length}">${shared
      .map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`)
      .join("")}</sst>`,
  );

  return parts;
}

export function buildXlsx(
  sheets: readonly SheetFixture[],
  replace: (parts: Map<string, string>) => void = () => {},
): Uint8Array {
  const parts = workbookParts(sheets);
  replace(parts);

  return buildZip([...parts].map(([name, data]) => ({ name, data })));
}
