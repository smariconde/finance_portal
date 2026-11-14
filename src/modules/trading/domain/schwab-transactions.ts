import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  createDecimalOperations,
  sum,
  ZERO,
} from "@/modules/numeric/domain/decimal-policy";

import {
  exactDecimalSchema,
  exactIntegerSchema,
  failure,
  issuePath,
  readExactJson,
  type SchwabParseResult,
} from "./schwab-exact";

/**
 * Parser cerrado de `/accounts/{hash}/transactions` (`schwab-transactions-1.0.0`,
 * ADR 0076, sección 8; `F11-05`).
 *
 * Medido el 2026-11-14 sobre tres años de la cuenta real (195 transacciones):
 *
 * - Seis tipos: `TRADE`, `DIVIDEND_OR_INTEREST`, `JOURNAL`, `CASH_RECEIPT`,
 *   `CASH_DISBURSEMENT` y `ELECTRONIC_FUND`. Otro tipo se rechaza por nombre.
 * - Un `TRADE` trae un ítem del instrumento (`amount` con signo: positivo es
 *   compra) y uno por comisión o tasa (`feeType`). `netAmount` es exactamente la
 *   suma de los `cost` de todos los ítems, 115 de 115. En los movimientos de
 *   caja el `cost` es cero y el neto es la suma de los `amount`, 80 de 80. Se
 *   verifica en cada fila.
 * - El `time` de un `TRADE` es la hora de la ejecución: igual al segundo que la
 *   `executionLegs[].time` de su orden, 8 de 8. `tradeDate` no sirve como hora:
 *   cae a veces 10 a 12 horas antes. Un `TRADE` no trae `settlementDate`.
 * - Precio por cantidad no siempre da el costo (el precio viene redondeado): el
 *   dinero sale de `netAmount`, nunca de multiplicar.
 * - Sólo acciones y ETFs, siempre largos; una opción no se midió y se rechaza.
 *
 * El rango por pedido es de un año como máximo: con más, Schwab responde `400`.
 */
export const SCHWAB_TRANSACTIONS_PARSER_VERSION = "schwab-transactions-1.0.0";

export const SCHWAB_TRANSACTION_TYPES = [
  "TRADE",
  "DIVIDEND_OR_INTEREST",
  "JOURNAL",
  "CASH_RECEIPT",
  "CASH_DISBURSEMENT",
  "ELECTRONIC_FUND",
] as const;

export type SchwabTransactionType = (typeof SCHWAB_TRANSACTION_TYPES)[number];

/** Los tipos que se piden: los medidos más los publicados que no aparecieron. */
export const SCHWAB_REQUESTED_TRANSACTION_TYPES = [
  ...SCHWAB_TRANSACTION_TYPES,
  "ACH_RECEIPT",
  "ACH_DISBURSEMENT",
  "WIRE_IN",
  "WIRE_OUT",
  "MEMORANDUM",
  "RECEIVE_AND_DELIVER",
  "MONEY_MARKET",
] as const;

const { parseDecimal, formatDecimal } = createDecimalOperations(
  (code) => new Error(code),
);

const instant = z
  .string()
  .max(40)
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/u,
  );

const instrumentSchema = z
  .object({
    assetType: z.enum([
      "CURRENCY",
      "EQUITY",
      "COLLECTIVE_INVESTMENT",
      "OPTION",
    ]),
    status: z.string().max(32).optional(),
    symbol: z.string().min(1).max(64),
    uniformSymbol: z.string().max(64).optional(),
    description: z.string().max(256).optional(),
    instrumentId: exactIntegerSchema,
    closingPrice: exactDecimalSchema.optional(),
    type: z.string().max(64).optional(),
  })
  .strict();

const transferItemSchema = z
  .object({
    instrument: instrumentSchema,
    amount: exactDecimalSchema,
    cost: exactDecimalSchema,
    price: exactDecimalSchema.optional(),
    feeType: z.string().max(32).optional(),
    positionEffect: z.enum(["OPENING", "CLOSING"]).optional(),
  })
  .strict();

const transactionSchema = z
  .object({
    activityId: exactIntegerSchema,
    time: instant,
    description: z.string().max(256).optional(),
    accountNumber: z.string().regex(/^\d{4,16}$/u),
    type: z.enum(SCHWAB_TRANSACTION_TYPES),
    status: z.string().max(32),
    subAccount: z.string().max(32),
    tradeDate: instant,
    settlementDate: instant.optional(),
    positionId: exactIntegerSchema.optional(),
    orderId: exactIntegerSchema.optional(),
    netAmount: exactDecimalSchema,
    qualifiedDividend: z.boolean().optional(),
    transferItems: z.array(transferItemSchema).min(1).max(16),
  })
  .strict();

/** El instrumento negociado de un `TRADE`. */
export type TransactionInstrument = {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly assetType: "EQUITY" | "COLLECTIVE_INVESTMENT";
  readonly instrumentType: string | null;
  readonly description: string | null;
  /** Con signo: positiva es compra. */
  readonly quantity: string;
  readonly price: string | null;
  readonly positionEffect: "OPENING" | "CLOSING" | null;
};

/**
 * Una transacción normalizada. Es lo único que se guarda: nunca el payload ni
 * el número de cuenta (`TM-15`).
 */
export type SchwabTransaction = {
  readonly activityId: string;
  readonly type: SchwabTransactionType;
  readonly status: string;
  /** Hora de la ejecución en un `TRADE`; del asiento en los demás. */
  readonly executedAt: string;
  /** `null` en un `TRADE`: Schwab no la informa. */
  readonly settledAt: string | null;
  readonly description: string | null;
  readonly orderId: string | null;
  readonly positionId: string | null;
  readonly netAmount: string;
  /** Comisiones y tasas, positivas; sólo en un `TRADE`. */
  readonly fees: string | null;
  readonly instrument: TransactionInstrument | null;
};

export type ParsedTransactions = {
  /** Los números de cuenta que aparecieron: quien llama los compara. */
  readonly accountNumbers: readonly string[];
  readonly transactions: readonly SchwabTransaction[];
};

function iso(value: string): string {
  return new Date(value).toISOString();
}

function normalize(
  raw: z.infer<typeof transactionSchema>,
): SchwabParseResult<SchwabTransaction> {
  const path = `activity:${raw.activityId}`;
  const items = raw.transferItems;
  // Un `TRADE` reconcilia por `cost` (115 de 115); los movimientos de caja, por
  // `amount`, porque su `cost` es cero (80 de 80).
  const reconciled = sum(
    items.map((item) =>
      parseDecimal(raw.type === "TRADE" ? item.cost : item.amount, path),
    ),
  );
  if (!reconciled.equals(parseDecimal(raw.netAmount, path))) {
    return failure("net_amount_not_reconciled");
  }

  const base = {
    activityId: String(raw.activityId),
    type: raw.type,
    status: raw.status,
    executedAt: iso(raw.time),
    settledAt:
      raw.settlementDate === undefined ? null : iso(raw.settlementDate),
    description: raw.description ?? null,
    orderId: raw.orderId === undefined ? null : String(raw.orderId),
    positionId: raw.positionId === undefined ? null : String(raw.positionId),
    netAmount: raw.netAmount,
  };

  const traded = items.filter(
    (item) => item.instrument.assetType !== "CURRENCY",
  );

  if (raw.type !== "TRADE") {
    if (traded.length > 0) return failure("non_trade_with_instrument");
    return { ok: true, value: { ...base, fees: null, instrument: null } };
  }

  if (traded.length !== 1) return failure("trade_legs_not_measured");
  const leg = traded[0]!;
  const assetType = leg.instrument.assetType;
  if (assetType !== "EQUITY" && assetType !== "COLLECTIVE_INVESTMENT") {
    return failure("option_trade_not_measured");
  }
  if (parseDecimal(leg.amount, path).isZero())
    return failure("trade_zero_quantity");

  const feeItems = items.filter((item) => item.feeType !== undefined);
  if (feeItems.length + traded.length !== items.length) {
    return failure("trade_currency_item_not_measured");
  }
  // Las tasas restan del neto: su costo es negativo y la comisión es su opuesto.
  const fees = ZERO.minus(
    sum(feeItems.map((item) => parseDecimal(item.cost, path))),
  );
  if (fees.isNegative()) return failure("trade_fee_refund_not_measured");

  return {
    ok: true,
    value: {
      ...base,
      fees: formatDecimal(fees, path),
      instrument: {
        instrumentId: String(leg.instrument.instrumentId),
        symbol: leg.instrument.symbol,
        assetType,
        instrumentType: leg.instrument.type ?? null,
        description: leg.instrument.description ?? null,
        quantity: leg.amount,
        price: leg.price ?? null,
        positionEffect: leg.positionEffect ?? null,
      },
    },
  };
}

export function parseSchwabTransactions(
  body: Uint8Array,
): SchwabParseResult<ParsedTransactions> {
  const json = readExactJson(body);
  if (json === null) return failure("invalid_json");
  if (!Array.isArray(json)) return failure("transactions_schema_changed");

  const transactions: SchwabTransaction[] = [];
  const accountNumbers = new Set<string>();

  for (const [index, raw] of json.entries()) {
    const parsed = transactionSchema.safeParse(raw);
    if (!parsed.success) {
      return failure(
        "transaction_schema_changed",
        issuePath(parsed.error, `[${index}]`),
      );
    }
    accountNumbers.add(parsed.data.accountNumber);
    const normalized = normalize(parsed.data);
    if (!normalized.ok) return failure(normalized.code, `[${index}]`);
    transactions.push(normalized.value);
  }

  const ids = new Set(transactions.map((t) => t.activityId));
  if (ids.size !== transactions.length) return failure("duplicate_activity_id");

  return {
    ok: true,
    value: { accountNumbers: [...accountNumbers], transactions },
  };
}

/**
 * Hash del contenido normalizado (`sha256` del JSON canónico, en hex): dos
 * lecturas con el mismo hash son la misma versión; otro hash es una revisión de
 * Schwab.
 */
export function transactionContentHash(transaction: SchwabTransaction): string {
  return computeContentHash({
    version: SCHWAB_TRANSACTIONS_PARSER_VERSION,
    transaction,
  });
}
