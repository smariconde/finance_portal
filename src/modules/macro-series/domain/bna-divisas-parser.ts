/**
 * Reader of Banco Nación's FX download (ADR 0071): a `;` separated CSV with
 * one currency's «divisas» quotes, buyer and seller, oldest first.
 *
 * The cable trims trailing zeros, so «4,99» and even «5,» (2013-02-27) are
 * prices; values may carry padding spaces. Anything else stops the run by name.
 */
export const BNA_DIVISAS_PARSER_VERSION = "bna-divisas-1.0.0";

export const BNA_HEADER = "Moneda;Fecha cotizacion;Compra;Venta;";

export type BnaQuoteSide = "buyer" | "seller";

export type BnaDivisasPoint = {
  readonly periodOn: string;
  readonly value: string;
};

export type BnaDivisasParseResult =
  | { readonly ok: true; readonly points: readonly BnaDivisasPoint[] }
  | {
      readonly ok: false;
      readonly reason:
        | "header_changed"
        | "row_shape"
        | "currency_mismatch"
        | "invalid_date"
        | "invalid_value"
        | "unexpected_order"
        | "empty";
    };

function isoOf(text: string): string | null {
  const match =
    /^([1-9]|[12][0-9]|3[01])\/([1-9]|1[0-2])\/((?:19|20)[0-9]{2})$/u.exec(
      text,
    );
  if (match === null) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

function decimalOf(text: string): string | null {
  const match = /^([0-9]+)(?:,([0-9]*))?$/u.exec(text.trim());
  if (match === null) return null;
  const whole = match[1]!.replace(/^0+(?=\d)/u, "");
  const fraction = (match[2] ?? "").replace(/0+$/u, "");
  const value = fraction === "" ? whole : `${whole}.${fraction}`;
  return /^0(?:\.0*)?$/u.test(value) ? null : value;
}

export function parseBnaDivisas(
  text: string,
  currencyLabel: string,
  side: BnaQuoteSide,
): BnaDivisasParseResult {
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines[0] !== BNA_HEADER) return { ok: false, reason: "header_changed" };
  if (lines.length === 1) return { ok: false, reason: "empty" };

  const points: BnaDivisasPoint[] = [];
  for (const line of lines.slice(1)) {
    const fields = line.split(";");
    if (fields.length !== 5 || fields[4] !== "") {
      return { ok: false, reason: "row_shape" };
    }
    if (fields[0] !== currencyLabel) {
      return { ok: false, reason: "currency_mismatch" };
    }
    const periodOn = isoOf(fields[1]!);
    if (periodOn === null) return { ok: false, reason: "invalid_date" };
    const buyer = decimalOf(fields[2]!);
    const seller = decimalOf(fields[3]!);
    if (buyer === null || seller === null) {
      return { ok: false, reason: "invalid_value" };
    }
    const previous = points.at(-1);
    if (previous && periodOn <= previous.periodOn) {
      return { ok: false, reason: "unexpected_order" };
    }
    points.push({ periodOn, value: side === "buyer" ? buyer : seller });
  }
  return { ok: true, points };
}

/** Banco Nación's ID for each currency on its download form (2026-11-04). */
export const BNA_CURRENCY_CODES = { "Dolar U.S.A": "55" } as const;

export function bnaDivisasUrl(
  currencyCode: string,
  fromOn: string,
  untilOn: string,
): string {
  const day = (iso: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
    if (match === null) throw new Error("invalid_bna_request");
    return `${match[3]}/${match[2]}/${match[1]}`;
  };
  if (!/^[0-9]{1,3}$/u.test(currencyCode))
    throw new Error("invalid_bna_request");
  const params = new URLSearchParams({
    idMonedaDescarga: currencyCode,
    fechaDesde: day(fromOn),
    fechaHasta: day(untilOn),
    id: "monedas",
  });
  return `https://www.bna.com.ar/Cotizador/DescargarPorFecha?${params.toString()}`;
}
