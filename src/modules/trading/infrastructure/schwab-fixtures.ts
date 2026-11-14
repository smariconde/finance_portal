/**
 * Respuestas sintéticas de Schwab para los tests (`F11-04`). Reproducen la forma
 * medida el 2026-11-13 —cuenta `CASH`, cotización de una acción— con valores
 * inventados; ningún payload real entra al repo. Posiciones y órdenes siguen el
 * schema publicado, porque la cuenta no tenía.
 */
export const SYNTHETIC_ACCOUNT_NUMBER = "12345678";
export const SYNTHETIC_HASH = "A".repeat(64);

export function accountNumbersBody(
  rows = [
    { accountNumber: SYNTHETIC_ACCOUNT_NUMBER, hashValue: SYNTHETIC_HASH },
  ],
): string {
  return JSON.stringify(rows);
}

export function cashAccountBody(
  options: {
    readonly positions?: readonly string[];
    readonly type?: string;
    readonly accountNumber?: string;
    readonly extraCurrentBalance?: string;
  } = {},
): string {
  const positions =
    options.positions === undefined
      ? ""
      : `"positions":[${options.positions.join(",")}],`;
  return `{"securitiesAccount":{"type":"${options.type ?? "CASH"}","accountNumber":"${options.accountNumber ?? SYNTHETIC_ACCOUNT_NUMBER}","roundTrips":0,"isDayTrader":false,"isClosingOnlyRestricted":false,"isPortfolioMargin":false,"pfcbFlag":false,${positions}
"initialBalances":{"accruedInterest":0,"cashAvailableForTrading":1500.25,"cashAvailableForWithdrawal":1500.25,"cashBalance":1500.25,"bondValue":0,"cashReceipts":0,"liquidationValue":2500.10,"longOptionMarketValue":0,"longStockValue":0,"moneyMarketFund":0,"mutualFundValue":999.85,"shortOptionMarketValue":0,"shortStockValue":0,"isInCall":false,"unsettledCash":0,"cashDebitCallValue":0,"pendingDeposits":0,"accountValue":2500.10},
"currentBalances":{"accruedInterest":0,"cashBalance":1500.25,"cashReceipts":0,"longOptionMarketValue":0,"liquidationValue":2512.37,"longMarketValue":1012.12,"moneyMarketFund":0,"savings":0,"shortMarketValue":0,"pendingDeposits":0,"mutualFundValue":0,"bondValue":0,"shortOptionMarketValue":0,"cashAvailableForTrading":1500.25,"cashAvailableForWithdrawal":1400.25,"cashCall":0,"longNonMarginableMarketValue":1012.12,"totalCash":1500.25,"cashDebitCallValue":0,"unsettledCash":100.00${options.extraCurrentBalance ?? ""}},
"projectedBalances":{"cashAvailableForTrading":1500.25,"cashAvailableForWithdrawal":1400.25}},
"aggregatedBalance":{"currentLiquidationValue":2512.37,"liquidationValue":2512.37,"intradayBuyingPowerAmount":0,"currentIntradayBuyingPowerAmount":0}}`;
}

export function equityPosition(
  symbol: string,
  options: {
    readonly long?: string;
    readonly short?: string;
    readonly assetType?: string;
  } = {},
): string {
  return `{"shortQuantity":${options.short ?? 0},"averagePrice":101.5,"currentDayProfitLoss":-3.2,"currentDayProfitLossPercentage":-0.31,"longQuantity":${options.long ?? 10},"settledLongQuantity":${options.long ?? 10},"settledShortQuantity":0,"instrument":{"assetType":"${options.assetType ?? "EQUITY"}","cusip":"000000000","symbol":"${symbol}","netChange":-0.32},"marketValue":1012.12,"maintenanceRequirement":0,"averageLongPrice":101.5,"longOpenProfitLoss":-2.88,"previousSessionLongQuantity":10,"currentDayCost":0}`;
}

export function order(
  orderId: number,
  status: string,
  options: {
    readonly children?: readonly string[];
    readonly enteredTime?: string;
    readonly extra?: string;
  } = {},
): string {
  const children =
    options.children === undefined
      ? ""
      : `,"childOrderStrategies":[${options.children.join(",")}]`;
  return `{"session":"NORMAL","duration":"GOOD_TILL_CANCEL","orderType":"LIMIT","complexOrderStrategyType":"NONE","quantity":5,"filledQuantity":0,"remainingQuantity":5,"price":95.25,"orderLegCollection":[{"orderLegType":"EQUITY","legId":1,"instrument":{"assetType":"EQUITY","cusip":"000000000","symbol":"SYN","instrumentId":1},"instruction":"BUY","positionEffect":"OPENING","quantity":5}],"orderStrategyType":"SINGLE","orderId":${orderId},"cancelable":true,"editable":true,"status":"${status}","enteredTime":"${options.enteredTime ?? "2026-11-12T15:00:00+0000"}","accountNumber":12345678${children}${options.extra ?? ""}}`;
}

export function quotesBody(symbols: readonly string[], extra = ""): string {
  return `{${symbols
    .map(
      (symbol) =>
        `"${symbol}":{"assetMainType":"EQUITY","assetSubType":"COE","quoteType":"NBBO","realtime":true,"ssid":1,"symbol":"${symbol}","quote":{"52WeekHigh":150.5,"52WeekLow":90.1,"askMICId":"XNAS","askPrice":101.21,"askSize":100,"askTime":1763060000000,"bidMICId":"XNAS","bidPrice":101.19,"bidSize":200,"bidTime":1763060000000,"closePrice":101.5,"highPrice":102.0,"lastMICId":"XNAS","lastPrice":101.2,"lastSize":10,"lowPrice":100.0,"mark":101.2,"markChange":-0.3,"markPercentChange":-0.29556650,"netChange":-0.3,"netPercentChange":-0.29556650,"openPrice":101.4,"quoteTime":1763060000000,"securityStatus":"Normal","totalVolume":1000000,"tradeTime":1763060000000${extra}}}`,
    )
    .join(",")}}`;
}

export function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
