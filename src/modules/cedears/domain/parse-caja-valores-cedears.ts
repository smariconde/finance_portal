import {
  finishPublication,
  isValidIsin,
  MAX_PUBLICATION_ROWS,
  normalizeLabel,
  parseCedearRatio,
  parseInvestorScope,
  type CedearClaim,
  type CedearPublication,
  type CedearRowRejection,
} from "./cedear-claim";
import { htmlToText } from "./html-text";

/**
 * Parser de la página de CEDEAR de Caja de Valores
 * ([ADR 0027](../../../../docs/architecture/adr/0027-cedear-registry-sources.md),
 * decisión 2).
 *
 * El servidor entrega las dos tablas —CEDEAR de ETF y CEDEAR de acciones—
 * renderizadas y con columnas fijas. Lo único que el parser asume es ese orden
 * de columnas, y por eso lo **verifica contra los encabezados** antes de leer
 * una sola fila: una columna agregada o corrida haría que el ratio se lea del
 * monto máximo, y eso tiene que ser un rechazo de la publicación entera, no
 * quinientos ratios equivocados.
 */
export const CAJA_VALORES_CEDEARS_PARSER_VERSION = "cajval-cedears-html-1.0.0";

/**
 * Encabezados esperados, normalizados, desde la segunda columna. La primera
 * nombra la tabla («CEDEAR de ETF», «CEDEAR de Acciones») y la sexta y la
 * séptima dicen «ETF» o «Acción» según la tabla, así que se comparan por
 * prefijo.
 */
const EXPECTED_HEADERS: readonly string[] = [
  "simbolo byma",
  "ticker en mercado de origen",
  "codigo caja de valores cedear",
  "isin cedear",
  "codigo caja de valores",
  "isin",
  "mercado de origen",
  "ratio cedears / valor subyacente",
  "monto maximo",
  "alcance publico inversor",
];

const COLUMN = {
  name: 0,
  originSymbol: 2,
  cajaValoresCode: 3,
  cedearIsin: 4,
  underlyingIsin: 6,
  originMarket: 7,
  ratio: 8,
  investorScope: 10,
} as const;

function cellsOf(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/giu)].map(
    (match) => htmlToText(match[1]!),
  );
}

function headersMatch(headers: readonly string[]): boolean {
  if (headers.length !== EXPECTED_HEADERS.length + 1) {
    return false;
  }

  return EXPECTED_HEADERS.every((expected, index) =>
    normalizeLabel(headers[index + 1]!).startsWith(expected),
  );
}

export function parseCajaValoresCedears(html: string): CedearPublication {
  const tables = [
    ...html.matchAll(/<table[^>]*tabla-cedears[^>]*>([\s\S]*?)<\/table>/giu),
  ].map((match) => match[1]!);

  if (tables.length === 0) {
    return { ok: false, code: "payload_unparsable" };
  }

  const claims: CedearClaim[] = [];
  const rejections: CedearRowRejection[] = [];
  const listedIsins = new Set<string>();
  let rowsSeen = 0;

  for (const table of tables) {
    const head = /<thead[^>]*>([\s\S]*?)<\/thead>/iu.exec(table);
    const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/iu.exec(table);

    if (head === null || body === null || !headersMatch(cellsOf(head[1]!))) {
      return { ok: false, code: "payload_unparsable" };
    }

    for (const row of body[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/giu)) {
      rowsSeen += 1;

      if (rowsSeen > MAX_PUBLICATION_ROWS) {
        return { ok: false, code: "too_many_rows" };
      }

      const cells = cellsOf(row[1]!);

      if (cells.length !== EXPECTED_HEADERS.length + 1) {
        return { ok: false, code: "payload_unparsable" };
      }

      const programName = cells[COLUMN.name]!;
      const isin = cells[COLUMN.cedearIsin]!.toUpperCase();

      if (isin.length === 0) {
        rejections.push({ rowLabel: programName, code: "cedear_isin_absent" });
        continue;
      }

      if (!isValidIsin(isin)) {
        rejections.push({ rowLabel: programName, code: "cedear_isin_invalid" });
        continue;
      }

      listedIsins.add(isin);

      const code = cells[COLUMN.cajaValoresCode]!;

      if (!/^[0-9]{1,12}$/u.test(code)) {
        rejections.push({ rowLabel: isin, code: "caja_valores_code_absent" });
        continue;
      }

      const ratio = parseCedearRatio(cells[COLUMN.ratio]);

      if (!ratio.ok) {
        rejections.push({ rowLabel: isin, code: ratio.code });
        continue;
      }

      const symbol = cells[COLUMN.originSymbol]!;

      if (symbol.length === 0) {
        rejections.push({ rowLabel: isin, code: "origin_symbol_absent" });
        continue;
      }

      const underlyingIsin = cells[COLUMN.underlyingIsin]!.toUpperCase();
      const market = cells[COLUMN.originMarket]!;

      claims.push({
        cedearIsin: isin,
        cajaValoresCode: code,
        programName: programName.length === 0 ? isin : programName,
        // La columna «Símbolo BYMA» es el símbolo del CEDEAR, no el del
        // subyacente: no es un segundo ticker de origen y no se usa acá.
        originSymbols: [symbol],
        originMarket: market.length === 0 ? null : market,
        reportedUnderlyingIsin: isValidIsin(underlyingIsin)
          ? underlyingIsin
          : null,
        ratio: ratio.ratio,
        // La tabla no tiene columna de estado: es la lista de programas que el
        // emisor ofrece, y un programa listado sin marca está habilitado. Si
        // Caja de Valores empezara a marcar filas, el parser cambia de versión.
        status: "active",
        investorScope: parseInvestorScope(cells[COLUMN.investorScope]),
      });
    }
  }

  return finishPublication(
    CAJA_VALORES_CEDEARS_PARSER_VERSION,
    rowsSeen,
    claims,
    rejections,
    [],
    listedIsins,
  );
}
