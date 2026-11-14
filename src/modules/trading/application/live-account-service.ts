import type {
  EgressFetch,
  EgressFetchResponse,
} from "@/modules/ingestion/application/egress-fetch";
import {
  openDayPnl,
  OPEN_DAY_PNL_VERSION,
  type OpenDayPnl,
} from "@/modules/trading/domain/open-day-pnl";
import {
  issueQuoteScope,
  quotableSymbols,
  verifyQuoteScope,
} from "@/modules/trading/domain/quote-scope";
import {
  parseSchwabAccount,
  parseSchwabAccountNumbers,
  parseSchwabOpenOrders,
  SCHWAB_ACCOUNT_PARSER_VERSION,
  type SchwabCashBalances,
  type SchwabOpenOrder,
  type SchwabPosition,
} from "@/modules/trading/domain/schwab-account";
import {
  parseSchwabQuotes,
  SCHWAB_QUOTES_PARSER_VERSION,
  type SchwabQuote,
} from "@/modules/trading/domain/schwab-quotes";

/**
 * La cuenta en vivo (`schwab-live-account-1.0.0`, ADR 0076, sección 8; `F11-04`).
 * Posiciones, saldos, poder de compra y órdenes abiertas se leen al momento por
 * la puerta y no se guardan; tampoco las cotizaciones. Lo que sale de acá es una
 * vista sin el número de cuenta (sólo sus últimos cuatro dígitos), sin el
 * `hashValue` y sin el cuerpo de ninguna respuesta. Una falla es un código.
 */
export const LIVE_ACCOUNT_VERSION = "schwab-live-account-1.0.0";

const TRADER = "https://api.schwabapi.com/trader/v1/accounts";
const QUOTES = "https://api.schwabapi.com/marketdata/v1/quotes";

/**
 * `schwab-open-orders-window-1.0.0`: todas las órdenes de los últimos 7 días y
 * las que siguen `WORKING` de los últimos 60, que es el rango que documenta
 * Schwab. Una orden GTC ingresada hace más de 60 días no se ve, y la página lo
 * dice. Dos pedidos acotados en vez de 60 días de todas las órdenes, que para
 * un day trader serían miles cada minuto.
 */
export const OPEN_ORDERS_WINDOW = Object.freeze({
  version: "schwab-open-orders-window-1.0.0",
  recentDays: 7,
  workingDays: 60,
});

/** Sólo acciones y ETFs tienen una cotización medida (`schwab-quotes-1.0.0`). */
const QUOTABLE_ASSET_TYPES: ReadonlySet<string> = new Set([
  "EQUITY",
  "COLLECTIVE_INVESTMENT",
]);

const DAY_MS = 86_400_000;

export type LiveAccountDependencies = {
  readonly egress: EgressFetch;
  /** Subclave `quote-scope` derivada de `TRADING_SECRET_KEY`. */
  readonly quoteScopeKey: Buffer;
  readonly now: () => string;
};

export type LiveFailure = {
  readonly state: "failed";
  /** Código cerrado: `not_connected`, `http_401`, `source_daily_budget_exhausted`… */
  readonly code: string;
};

export type LiveAccountReading =
  | {
      readonly state: "read";
      /** Cuándo respondió Schwab la cuenta: la hora de la lectura. */
      readonly readAt: string;
      readonly account: {
        readonly lastFour: string;
        readonly accountType: "CASH";
        readonly roundTrips: number;
        readonly isDayTrader: boolean;
        readonly isClosingOnlyRestricted: boolean;
      };
      readonly balances: SchwabCashBalances;
      readonly positions: readonly SchwabPosition[];
      readonly openOrders: readonly SchwabOpenOrder[];
      readonly ordersWindow: typeof OPEN_ORDERS_WINDOW;
      /** Alcance firmado para pedir las cotizaciones de estas posiciones. */
      readonly quoteScope: string;
      readonly quotableSymbols: readonly string[];
      readonly versions: readonly string[];
    }
  | LiveFailure;

export type LiveQuotesReading =
  | {
      readonly state: "read";
      readonly readAt: string;
      readonly quotes: readonly SchwabQuote[];
      readonly invalidSymbols: readonly string[];
      readonly version: typeof SCHWAB_QUOTES_PARSER_VERSION;
    }
  | LiveFailure
  | { readonly state: "scope_rejected" };

/**
 * Un código cerrado para una falla de la puerta o del presupuesto. Nunca el
 * mensaje, que nombra destino y detalle.
 */
export function liveFailureCode(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = String((error as { code: unknown }).code);
    const name = (error as { name?: unknown }).name;
    if (/^[a-z0-9_]{1,48}$/u.test(code)) {
      // Sin conexión, con el login vencido o con una renovación fallida, el
      // proveedor no entrega token y la puerta se niega así.
      if (code === "credential_missing") return "not_connected";
      return name === "SourceRequestRefusedError"
        ? `source_${code}`
        : `egress_${code}`;
    }
  }
  return "unexpected";
}

async function get(
  dependencies: Pick<LiveAccountDependencies, "egress">,
  sourceId: "schwab-trader" | "schwab-marketdata",
  url: string,
): Promise<EgressFetchResponse> {
  return dependencies.egress({ sourceId, url, accept: "application/json" });
}

function httpFailure(response: EgressFetchResponse): LiveFailure | null {
  return response.status === 200
    ? null
    : { state: "failed", code: `http_${response.status}` };
}

function ordersUrl(
  hashValue: string,
  from: Date,
  to: Date,
  status?: string,
): string {
  const query = new URLSearchParams({
    fromEnteredTime: from.toISOString(),
    toEnteredTime: to.toISOString(),
  });
  if (status !== undefined) query.set("status", status);
  return `${TRADER}/${hashValue}/orders?${query.toString()}`;
}

export async function readLiveAccount(
  dependencies: LiveAccountDependencies,
): Promise<LiveAccountReading> {
  try {
    return await readUnguarded(dependencies);
  } catch (error) {
    return { state: "failed", code: liveFailureCode(error) };
  }
}

async function readAccountNumber(
  dependencies: Pick<LiveAccountDependencies, "egress">,
): Promise<
  { readonly accountNumber: string; readonly hashValue: string } | LiveFailure
> {
  const numbersResponse = await get(
    dependencies,
    "schwab-trader",
    `${TRADER}/accountNumbers`,
  );
  const numbersFailure = httpFailure(numbersResponse);
  if (numbersFailure !== null) return numbersFailure;

  const numbers = parseSchwabAccountNumbers(numbersResponse.body);
  if (!numbers.ok) return { state: "failed", code: numbers.code };
  // Medido: una cuenta. Más de una pide decidir cuál se muestra y cómo se
  // identifica en el diario; no se elige una en silencio.
  if (numbers.value.length === 0)
    return { state: "failed", code: "no_account" };
  if (numbers.value.length > 1) {
    return { state: "failed", code: "multiple_accounts_not_measured" };
  }
  return numbers.value[0]!;
}

async function readUnguarded(
  dependencies: LiveAccountDependencies,
): Promise<LiveAccountReading> {
  const number = await readAccountNumber(dependencies);
  if ("state" in number) return number;
  const { accountNumber, hashValue } = number;

  const to = new Date(dependencies.now());
  const [accountResponse, recentResponse, workingResponse] = await Promise.all([
    get(
      dependencies,
      "schwab-trader",
      `${TRADER}/${hashValue}?fields=positions`,
    ),
    get(
      dependencies,
      "schwab-trader",
      ordersUrl(
        hashValue,
        new Date(to.getTime() - OPEN_ORDERS_WINDOW.recentDays * DAY_MS),
        to,
      ),
    ),
    get(
      dependencies,
      "schwab-trader",
      ordersUrl(
        hashValue,
        new Date(to.getTime() - OPEN_ORDERS_WINDOW.workingDays * DAY_MS),
        to,
        "WORKING",
      ),
    ),
  ]);

  for (const response of [accountResponse, recentResponse, workingResponse]) {
    const failure = httpFailure(response);
    if (failure !== null) return failure;
  }

  const account = parseSchwabAccount(accountResponse.body);
  if (!account.ok) return { state: "failed", code: account.code };
  // La cuenta de `accountNumbers` y la leída tienen que ser la misma.
  if (account.value.accountNumber !== accountNumber) {
    return { state: "failed", code: "account_number_mismatch" };
  }

  const orders = parseSchwabOpenOrders([
    recentResponse.body,
    workingResponse.body,
  ]);
  if (!orders.ok) return { state: "failed", code: orders.code };

  const open = account.value.positions.filter(
    (position) =>
      position.side !== "flat" && QUOTABLE_ASSET_TYPES.has(position.assetType),
  );
  const symbols = quotableSymbols(open.map((position) => position.symbol));

  return {
    state: "read",
    readAt: accountResponse.fetchedAt,
    account: {
      lastFour: accountNumber.slice(-4),
      accountType: account.value.accountType,
      roundTrips: account.value.roundTrips,
      isDayTrader: account.value.isDayTrader,
      isClosingOnlyRestricted: account.value.isClosingOnlyRestricted,
    },
    balances: account.value.balances,
    positions: account.value.positions,
    openOrders: orders.value,
    ordersWindow: OPEN_ORDERS_WINDOW,
    quoteScope: issueQuoteScope(
      dependencies.quoteScopeKey,
      symbols,
      dependencies.now(),
    ),
    quotableSymbols: symbols,
    versions: [
      LIVE_ACCOUNT_VERSION,
      SCHWAB_ACCOUNT_PARSER_VERSION,
      OPEN_ORDERS_WINDOW.version,
    ],
  };
}

export type OpenDayPnlReading =
  | {
      readonly state: "read";
      readonly readAt: string;
      readonly pnl: OpenDayPnl;
      readonly versions: readonly string[];
    }
  | LiveFailure;

/**
 * Lo abierto del día para el diario (`F11-06`): dos `GET`, `accountNumbers` y la
 * cuenta con posiciones, sin órdenes ni cotizaciones. Sale de la cuenta sólo la
 * suma; ni el número ni las posiciones.
 */
export async function readOpenDayPnl(
  dependencies: Pick<LiveAccountDependencies, "egress">,
): Promise<OpenDayPnlReading> {
  try {
    const number = await readAccountNumber(dependencies);
    if ("state" in number) return number;

    const response = await get(
      dependencies,
      "schwab-trader",
      `${TRADER}/${number.hashValue}?fields=positions`,
    );
    const failure = httpFailure(response);
    if (failure !== null) return failure;

    const account = parseSchwabAccount(response.body);
    if (!account.ok) return { state: "failed", code: account.code };
    if (account.value.accountNumber !== number.accountNumber) {
      return { state: "failed", code: "account_number_mismatch" };
    }
    return {
      state: "read",
      readAt: response.fetchedAt,
      pnl: openDayPnl(account.value.positions),
      versions: [SCHWAB_ACCOUNT_PARSER_VERSION, OPEN_DAY_PNL_VERSION],
    };
  } catch (error) {
    return { state: "failed", code: liveFailureCode(error) };
  }
}

/**
 * Las cotizaciones de un alcance firmado. Un alcance vacío no gasta un pedido;
 * uno vencido, adulterado o malformado no sale a Schwab.
 */
export async function readLiveQuotes(
  dependencies: LiveAccountDependencies,
  token: string,
): Promise<LiveQuotesReading> {
  const check = verifyQuoteScope(
    dependencies.quoteScopeKey,
    token,
    dependencies.now(),
  );
  if (!check.ok) return { state: "scope_rejected" };

  if (check.scope.symbols.length === 0) {
    return {
      state: "read",
      readAt: dependencies.now(),
      quotes: [],
      invalidSymbols: [],
      version: SCHWAB_QUOTES_PARSER_VERSION,
    };
  }

  try {
    const query = new URLSearchParams({
      symbols: check.scope.symbols.join(","),
      fields: "quote",
      indicative: "false",
    });
    const response = await get(
      dependencies,
      "schwab-marketdata",
      `${QUOTES}?${query.toString()}`,
    );
    const failure = httpFailure(response);
    if (failure !== null) return failure;

    const parsed = parseSchwabQuotes(response.body);
    if (!parsed.ok) return { state: "failed", code: parsed.code };

    // Schwab no puede devolver un símbolo que no se pidió.
    const asked = new Set(check.scope.symbols);
    if (parsed.value.quotes.some((quote) => !asked.has(quote.symbol))) {
      return { state: "failed", code: "quote_symbol_not_requested" };
    }

    return {
      state: "read",
      readAt: response.fetchedAt,
      quotes: parsed.value.quotes,
      invalidSymbols: parsed.value.invalidSymbols,
      version: SCHWAB_QUOTES_PARSER_VERSION,
    };
  } catch (error) {
    return { state: "failed", code: liveFailureCode(error) };
  }
}
