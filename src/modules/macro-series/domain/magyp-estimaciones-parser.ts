import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

/**
 * Readers of the Ministry of Agriculture's crop estimates (ADR 0071).
 *
 * Estimaciones Agrícolas answers a form `POST` with a latin-1 CSV, one row per
 * campaign and the four variables as integers. The same series is published
 * under CC BY 4.0 at datos.magyp.gob.ar one campaign behind; every run
 * reconciles the campaigns both carry before anything is recorded.
 */
export const MAGYP_ESTIMACIONES_PARSER_VERSION = "magyp-estimaciones-1.0.0";
export const MAGYP_ANNUAL_PARSER_VERSION = "magyp-annual-csv-1.0.0";
export const MAGYP_RECONCILIATION_VERSION = "magyp-reconciliation-1.0.0";

/** Project convention: campaign `aaaa/aa` is dated July 1st of `aaaa`. */
export function campaignPeriodOn(firstYear: number): string {
  return `${firstYear}-07-01`;
}

export const MAGYP_VARIABLES = [
  "sown_ha",
  "harvested_ha",
  "production_t",
  "yield_kg_ha",
] as const;

export type MagypVariable = (typeof MAGYP_VARIABLES)[number];

export type MagypCampaign = {
  readonly firstYear: number;
  readonly periodOn: string;
  readonly values: Readonly<Record<MagypVariable, string>>;
};

export type MagypParseResult =
  | { readonly ok: true; readonly campaigns: readonly MagypCampaign[] }
  | {
      readonly ok: false;
      readonly reason:
        | "header_changed"
        | "row_shape"
        | "crop_mismatch"
        | "invalid_campaign"
        | "invalid_value"
        | "unexpected_order"
        | "empty";
    };

const ESTIMACIONES_HEADER =
  'Cultivo;Campaña;"Sup. Sembrada";"Sup. Cosechada";Producción;Rendimiento';
const ANNUAL_HEADER =
  "indice_tiempo,superficie_sembrada_soja_ha,superficie_cosechada_soja_ha,produccion_soja_t,rendimiento_soja_kgxha";

function linesOf(text: string): string[] {
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function checkOrder(
  campaigns: readonly MagypCampaign[],
  next: number,
): boolean {
  const previous = campaigns.at(-1);
  return previous === undefined || next === previous.firstYear + 1;
}

/** `bytes` is the response body as sent: latin-1, never re-encoded upstream. */
export function parseMagypEstimaciones(
  bytes: Uint8Array,
  crop: string,
): MagypParseResult {
  const lines = linesOf(new TextDecoder("latin1").decode(bytes));
  if (lines[0] !== ESTIMACIONES_HEADER) {
    return { ok: false, reason: "header_changed" };
  }
  if (lines.length === 1) return { ok: false, reason: "empty" };
  const campaigns: MagypCampaign[] = [];
  for (const line of lines.slice(1)) {
    const fields = line.split(";");
    if (fields.length !== 6) return { ok: false, reason: "row_shape" };
    if (fields[0] !== `"${crop}"`)
      return { ok: false, reason: "crop_mismatch" };
    const match = /^((?:19|20)[0-9]{2})\/([0-9]{2})$/u.exec(fields[1]!);
    const firstYear = match ? Number(match[1]) : null;
    if (
      firstYear === null ||
      match![2] !== String((firstYear + 1) % 100).padStart(2, "0")
    ) {
      return { ok: false, reason: "invalid_campaign" };
    }
    const numbers = fields.slice(2);
    if (numbers.some((value) => !/^(?:0|[1-9][0-9]*)$/u.test(value))) {
      return { ok: false, reason: "invalid_value" };
    }
    if (!checkOrder(campaigns, firstYear)) {
      return { ok: false, reason: "unexpected_order" };
    }
    campaigns.push({
      firstYear,
      periodOn: campaignPeriodOn(firstYear),
      values: {
        sown_ha: numbers[0]!,
        harvested_ha: numbers[1]!,
        production_t: numbers[2]!,
        yield_kg_ha: numbers[3]!,
      },
    });
  }
  return { ok: true, campaigns };
}

/** The CC BY annual file: `indice_tiempo` is the campaign's first year. */
export function parseMagypAnnual(text: string): MagypParseResult {
  const lines = linesOf(text);
  if (lines[0] !== ANNUAL_HEADER)
    return { ok: false, reason: "header_changed" };
  if (lines.length === 1) return { ok: false, reason: "empty" };
  const campaigns: MagypCampaign[] = [];
  for (const line of lines.slice(1)) {
    const fields = line.split(",");
    if (fields.length !== 5) return { ok: false, reason: "row_shape" };
    if (!/^(?:19|20)[0-9]{2}$/u.test(fields[0]!)) {
      return { ok: false, reason: "invalid_campaign" };
    }
    const firstYear = Number(fields[0]);
    const numbers = fields.slice(1);
    if (
      numbers.some((value) => !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value))
    ) {
      return { ok: false, reason: "invalid_value" };
    }
    if (!checkOrder(campaigns, firstYear)) {
      return { ok: false, reason: "unexpected_order" };
    }
    campaigns.push({
      firstYear,
      periodOn: campaignPeriodOn(firstYear),
      values: {
        sown_ha: numbers[0]!,
        harvested_ha: numbers[1]!,
        production_t: numbers[2]!,
        yield_kg_ha: numbers[3]!,
      },
    });
  }
  return { ok: true, campaigns };
}

/** Measured: amounts differ by at most 2e-7, yield only by rounding. */
const RELATIVE_TOLERANCE = "0.00001";
const YIELD_TOLERANCE_KG_HA = "0.5";

export type MagypReconciliation =
  | { readonly ok: true; readonly compared: number }
  | {
      readonly ok: false;
      readonly reason: "reconciliation_failed" | "nothing_to_reconcile";
      readonly campaign: string | null;
      readonly variable: MagypVariable | null;
    };

export function reconcileMagypEstimates(
  estimates: readonly MagypCampaign[],
  licensed: readonly MagypCampaign[],
): MagypReconciliation {
  const d = createDecimalOperations((code) => new Error(code));
  const byYear = new Map(licensed.map((item) => [item.firstYear, item]));
  let compared = 0;
  for (const campaign of estimates) {
    const other = byYear.get(campaign.firstYear);
    if (!other) continue;
    compared += 1;
    for (const variable of MAGYP_VARIABLES) {
      const ours = d.parseDecimal(campaign.values[variable], variable);
      const theirs = d.parseDecimal(other.values[variable], variable);
      const gap = ours.minus(theirs).abs();
      const within =
        variable === "yield_kg_ha"
          ? gap.lte(YIELD_TOLERANCE_KG_HA)
          : gap.isZero() ||
            (theirs.gt(0) && gap.div(theirs).lte(RELATIVE_TOLERANCE));
      if (!within) {
        return {
          ok: false,
          reason: "reconciliation_failed",
          campaign: `${campaign.firstYear}/${String((campaign.firstYear + 1) % 100).padStart(2, "0")}`,
          variable,
        };
      }
    }
  }
  return compared === 0
    ? {
        ok: false,
        reason: "nothing_to_reconcile",
        campaign: null,
        variable: null,
      }
    : { ok: true, compared };
}

/** Estimaciones' crop ID and the variables as its form names them. */
export const MAGYP_SOY_TOTAL_CROP = { id: "25", label: "Soja total" } as const;

export const MAGYP_ESTIMACIONES_URL =
  "https://datosestimaciones.magyp.gob.ar/reportes.php?reporte=Estimaciones";

export const MAGYP_SOY_ANNUAL_URL =
  "https://datos.magyp.gob.ar/dataset/8ae4865f-d2f2-45a2-9343-7a4a12728a90/resource/3bfe4630-91e2-46cd-82ad-cf8dc94d3dfb/download/soja-serie-1941-2024-anual.csv";

/**
 * The form body, UTF-8 encoded as the site's own form sends it. Campaign
 * options are not contiguous IDs (2025/26 is 59, 2023/24 is 57, 2022/23 is
 * 54); `hasta=999` returned the same bytes as the last option on 2026-11-04,
 * so a new campaign needs no change here.
 */
export function magypEstimacionesBody(cropId: string): string {
  if (!/^[0-9]{1,3}$/u.test(cropId)) {
    throw new Error("invalid_estimaciones_request");
  }
  const params = new URLSearchParams();
  params.append("cultivo[]", cropId);
  for (const variable of [
    "Sup. Sembrada",
    "Sup. Cosechada",
    "Producción",
    "Rendimiento",
  ]) {
    params.append("variable[]", variable);
  }
  params.append("desde", "1");
  params.append("hasta", "999");
  params.append("agregacion", "Total País");
  params.append("nombre", "");
  params.append("submit", "Descargar");
  return params.toString();
}
