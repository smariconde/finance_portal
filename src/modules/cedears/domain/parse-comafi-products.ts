import { z } from "zod";

import {
  finishPublication,
  isValidIsin,
  MAX_PUBLICATION_ROWS,
  normalizeLabel,
  parseCedearRatio,
  parseInvestorScope,
  parseProgramStatus,
  type CedearClaim,
  type CedearPublication,
  type CedearRowRejection,
  type CedearSkippedRow,
} from "./cedear-claim";
import { htmlToLines } from "./html-text";

/**
 * Parser del JSON que alimenta la tabla de programas de Comafi
 * ([ADR 0027](../../../../docs/architecture/adr/0027-cedear-registry-sources.md),
 * decisión 2).
 *
 * Es la publicación de registro de Comafi y no la planilla descargable: medido
 * el 2026-09-23, la planilla trae ratios mal escritos y valores viejos que ningún
 * parser distingue de los buenos, y el JSON fue el correcto en cada desacuerdo
 * que se pudo verificar. Sus errores son de otra clase —campos vacíos, o dos
 * campos de la misma fila que se contradicen— y se rechazan por nombre.
 *
 * El JSON es el que arma la página, no una API documentada: el parser valida la
 * forma, no asume nada más y **nunca repite un valor recibido en un rechazo**
 * (`TM-02`), salvo el ISIN, que es el nombre público del programa.
 */
export const COMAFI_PRODUCTS_PARSER_VERSION = "comafi-products-1.0.0";

const text = z.string().nullish();

const productsPayloadSchema = z.object({
  products: z.array(
    z.object({
      /** Ticker de origen del subyacente («Identificación Mercado»). */
      name: text,
      summary: text,
      section: text,
      /** ISIN del CEDEAR. */
      tip: text,
      /** ISIN del subyacente. */
      tech: text,
      /** Ratio CEDEAR / acción o ADR. */
      character: text,
      /** Código de Caja de Valores del CEDEAR. */
      code: text,
      /** Lista HTML con nombre, mercado, alcance, ticker y observaciones. */
      description: text,
    }),
  ),
});

/** Etiquetas de la descripción, normalizadas: sin tildes, dos puntos ni `*`. */
type DescriptionFields = ReadonlyMap<string, string>;

/**
 * La descripción es una lista de `Etiqueta: valor` que el emisor escribe a mano:
 * a veces como `<li>` y a veces como líneas separadas por `<br />`, con los dos
 * puntos dentro o fuera del `<strong>`, etiquetas en medio de una palabra y
 * `&nbsp;` sueltos. Se lee el texto de cada línea y se parte en el primer `:`.
 */
function readDescription(
  description: string | null | undefined,
): DescriptionFields {
  const fields = new Map<string, string>();

  for (const item of htmlToLines(description ?? "")) {
    const colon = item.indexOf(":");

    if (colon <= 0) {
      continue;
    }

    const label = normalizeLabel(item.slice(0, colon));
    const value = item.slice(colon + 1).trim();

    if (!fields.has(label)) {
      fields.set(label, value);
    }
  }

  return fields;
}

function compactSymbol(symbol: string): string {
  return symbol.replace(/\s+/gu, "").toUpperCase();
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();

  return trimmed.length === 0 ? null : trimmed;
}

export function parseComafiProducts(body: unknown): CedearPublication {
  const parsed = productsPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return { ok: false, code: "payload_unparsable" };
  }

  const rows = parsed.data.products;

  if (rows.length > MAX_PUBLICATION_ROWS) {
    return { ok: false, code: "too_many_rows" };
  }

  const claims: CedearClaim[] = [];
  const rejections: CedearRowRejection[] = [];
  const skipped: CedearSkippedRow[] = [];
  const listedIsins = new Set<string>();

  for (const row of rows) {
    const symbol = nonEmpty(row.name);
    const description = readDescription(row.description);
    const programName =
      nonEmpty(description.get("nombre")) ?? nonEmpty(row.summary) ?? symbol;
    const isin = nonEmpty(row.tip)?.toUpperCase() ?? null;

    if (isin === null) {
      rejections.push({ rowLabel: programName, code: "cedear_isin_absent" });
      continue;
    }

    if (!isValidIsin(isin)) {
      rejections.push({ rowLabel: programName, code: "cedear_isin_invalid" });
      continue;
    }

    listedIsins.add(isin);

    // El programa sobre un bono corporativo está listado —no se retira— pero
    // no es un programa sobre acciones ni ETF, y su subyacente es un CUSIP.
    if (normalizeLabel(row.section ?? "") === "cedear corporate") {
      skipped.push({ cedearIsin: isin, reason: "debt_program" });
      continue;
    }

    const code = nonEmpty(row.code);

    if (code === null || !/^[0-9]{1,12}$/u.test(code)) {
      rejections.push({ rowLabel: isin, code: "caja_valores_code_absent" });
      continue;
    }

    const ratio = parseCedearRatio(row.character);

    if (!ratio.ok) {
      rejections.push({ rowLabel: isin, code: ratio.code });
      continue;
    }

    if (symbol === null) {
      rejections.push({ rowLabel: isin, code: "origin_symbol_absent" });
      continue;
    }

    const underlyingIsin = nonEmpty(row.tech)?.toUpperCase() ?? null;
    const describedSymbol = nonEmpty(
      description.get("ticker en mercado de origen"),
    );
    const sameSymbol =
      describedSymbol === null ||
      compactSymbol(describedSymbol) === compactSymbol(symbol);

    claims.push({
      cedearIsin: isin,
      cajaValoresCode: code,
      programName: programName ?? isin,
      // El segundo ticker sólo viaja si dice otra cosa: dos veces el mismo no es
      // una segunda evidencia, es la misma escrita dos veces.
      originSymbols: sameSymbol ? [symbol] : [symbol, describedSymbol],
      originMarket: nonEmpty(description.get("mercado de valor subyacente")),
      reportedUnderlyingIsin:
        underlyingIsin !== null && isValidIsin(underlyingIsin)
          ? underlyingIsin
          : null,
      ratio: ratio.ratio,
      status: parseProgramStatus(description.get("observaciones programa")),
      investorScope: parseInvestorScope(
        description.get("alcance publico inversor"),
      ),
    });
  }

  return finishPublication(
    COMAFI_PRODUCTS_PARSER_VERSION,
    rows.length,
    claims,
    rejections,
    skipped,
    listedIsins,
  );
}
