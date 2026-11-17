import { z } from "zod";

import { tradeRefSchema } from "@/modules/trading/domain/trade-annotation";
import { valuationTickerSchema } from "@/modules/valuation/domain/valuation-job";

/**
 * El catálogo del MCP del owner
 * ([ADR 0078](../../../../docs/architecture/adr/0078-owner-read-only-mcp.md),
 * sección 3). Cada herramienta envuelve la lectura de una página, nunca una
 * copia de su lógica; no escribe, no abre la red y no lee la cuenta en vivo.
 *
 * `1.0.0` trae valuaciones y diario. Las demás lecturas (matrices, Argentina,
 * estadísticas, plan) entran de a una, cada una con su versión nueva.
 */
export const PORTAL_MCP_TOOLS_VERSION = "portal-mcp-tools-1.0.0";

/** Tope de cada respuesta. Una lectura más grande se acota, nunca se trunca. */
export const MCP_RESPONSE_BYTE_LIMIT = 256 * 1024;

/** De dónde sale cada sección de una respuesta, para `ownerAssistant`. */
export const VALUATION_RUN_SOURCES = [
  "sec-edgar",
  "damodaran-current-data",
] as const;
export const VALUATION_MARKET_SOURCES = ["yahoo-finance"] as const;
export const VALUATION_CEDEAR_SOURCES = [
  "comafi-cedear",
  "caja-valores-cedear",
] as const;
export const JOURNAL_SOURCES = ["schwab-trader"] as const;

const isoDate = z.iso.date();

export const listValuationsInputSchema = z.strictObject({});

export const getValuationInputSchema = z.strictObject({
  ticker: valuationTickerSchema.describe(
    "Ticker del universo, por ejemplo AAPL o BRK.B.",
  ),
});

export const listTradesInputSchema = z
  .strictObject({
    from: isoDate
      .optional()
      .describe("Primer día de apertura (YYYY-MM-DD, hora de Nueva York)."),
    to: isoDate
      .optional()
      .describe("Último día de apertura (YYYY-MM-DD, hora de Nueva York)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe("Máximo de trades, los más recientes primero."),
  })
  .refine(
    (input) =>
      input.from === undefined ||
      input.to === undefined ||
      input.from <= input.to,
    { message: "from must not be after to", path: ["from"] },
  );

export const getTradeInputSchema = z.strictObject({
  ref: tradeRefSchema.describe(
    "Referencia del trade como la da list_trades (`<instrumento>-<fill>`).",
  ),
});

export const MCP_TOOLS = [
  {
    name: "list_valuations",
    title: "Empresas valuadas",
    description:
      "La última valuación registrada de cada empresa: método, estado, valor por acción, cierre al día de la corrida y price/value. Sólo lo guardado.",
  },
  {
    name: "get_valuation",
    title: "Valuación de un ticker",
    description:
      "La última corrida registrada de un ticker con su procedencia: valor por acción con bear y bull, rigor, cierre al as_of, lo que exige el precio y el acceso por CEDEAR. Nunca recalcula ni encola.",
  },
  {
    name: "list_trades",
    title: "Trades del diario",
    description:
      "Los trades del diario de la cuenta Schwab guardados en el portal: entrada, salida, P&L realizado, R con el stop planeado, setup y revisión. Nunca lee la cuenta en vivo.",
  },
  {
    name: "get_trade",
    title: "Un trade del diario",
    description:
      "Un trade con sus ejecuciones, el plan, la adherencia, la emoción y las notas del owner, R y reward/risk planeado.",
  },
] as const;

export type McpToolName = (typeof MCP_TOOLS)[number]["name"];

export function isMcpToolName(value: unknown): value is McpToolName {
  return MCP_TOOLS.some((tool) => tool.name === value);
}

/** Una respuesta que excede el tope se rechaza con su tamaño, nunca se corta. */
export class McpResponseTooLargeError extends Error {
  readonly bytes: number;

  constructor(bytes: number) {
    super(`The response weighs ${bytes} bytes, above the MCP limit.`);
    this.name = "McpResponseTooLargeError";
    this.bytes = bytes;
  }
}

/** El JSON de una respuesta y su peso, o el error si pasa el tope. */
export function boundedJson(value: unknown): {
  readonly text: string;
  readonly bytes: number;
} {
  const text = JSON.stringify(value);
  const bytes = Buffer.byteLength(text, "utf8");

  if (bytes > MCP_RESPONSE_BYTE_LIMIT) {
    throw new McpResponseTooLargeError(bytes);
  }

  return { text, bytes };
}
