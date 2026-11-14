"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useRef, useState } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import { StatusMark } from "@/app/_components/status-mark";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { LiveAccountReading } from "@/modules/trading/application/live-account-service";
import {
  liveCadence,
  liveFreshness,
} from "@/modules/trading/domain/live-cadence";
import type { PositionContext } from "@/modules/trading/domain/position-context";
import type { SchwabQuote } from "@/modules/trading/domain/schwab-quotes";
import {
  formatAmount,
  formatCalendarDate,
  formatSignedAmount,
} from "@/modules/valuation/domain/display-format";

import {
  readLiveAccount,
  readLiveQuotes,
  readPositionContext,
  type LiveAccountResult,
  type PositionContextResult,
} from "../actions";

import {
  CEDEAR_ABSENCE_COPY,
  formatClock,
  formatDateTime,
  formatMoney,
  formatQuantity,
  IDENTITY_ABSENCE_COPY,
  INSTRUCTION_COPY,
  liveFailureCopy,
  ORDER_STATUS_COPY,
  SECTOR_ABSENCE_COPY,
  VALUATION_ABSENCE_COPY,
} from "./live-account-copy";

type Reading = Extract<LiveAccountReading, { state: "read" }>;

type QuotesState = {
  readonly readAt: string;
  readonly bySymbol: ReadonlyMap<string, SchwabQuote>;
  readonly failedCode: string | null;
};

/** Cada cuánto se recalcula la luz sin pedir nada: sólo el reloj. */
const CLOCK_TICK_MS = 5_000;

function failureOf(result: LiveAccountResult): string | null {
  if (result.state === "read") return null;
  if (result.state === "failed") return result.code;
  return "unavailable";
}

function isVisible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState === "visible"
  );
}

/**
 * La cuenta en vivo (`F11-04`, ADR 0076). Llega leída por el servidor y se
 * relee con la cadencia de `schwab-live-cadence-1.0.0` sólo con la página
 * visible; las cotizaciones, sólo de las posiciones abiertas del alcance
 * firmado. Una lectura que falla deja la anterior en pantalla, marcada STALE con
 * su hora: nunca se presenta como actual.
 */
export function LiveAccount({
  initial,
}: {
  readonly initial: LiveAccountResult;
}) {
  const [reading, setReading] = useState<Reading | null>(
    initial.state === "read" ? initial : null,
  );
  const [failedCode, setFailedCode] = useState<string | null>(
    failureOf(initial),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date().toISOString());
  // La cadencia cuenta desde el último intento, no desde la última lectura
  // buena: una falla no se reintenta en ráfaga.
  const [lastAttemptAt, setLastAttemptAt] = useState(() =>
    initial.state === "read" ? initial.readAt : new Date().toISOString(),
  );
  const [quotes, setQuotes] = useState<QuotesState | null>(null);
  const [contextEntry, setContextEntry] = useState<{
    readonly key: string;
    readonly result: PositionContextResult;
  } | null>(null);

  const scope = reading?.quoteScope ?? null;
  const symbolsKey = reading?.quotableSymbols.join(",") ?? "";
  const inFlight = useRef(false);

  const refreshAccount = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    let result: LiveAccountResult;
    try {
      result = await readLiveAccount({});
    } catch {
      result = { state: "unavailable" };
    }
    inFlight.current = false;
    const finished = new Date().toISOString();
    setRefreshing(false);
    setNow(finished);
    setLastAttemptAt(finished);
    if (result.state === "read") {
      setReading(result);
      setFailedCode(null);
    } else {
      setFailedCode(failureOf(result));
    }
  }, []);

  // El reloj de la luz: barato, sin pedidos.
  useEffect(() => {
    const id = setInterval(
      () => setNow(new Date().toISOString()),
      CLOCK_TICK_MS,
    );
    return () => clearInterval(id);
  }, []);

  // La cuenta: un temporizador que se reprograma con la cadencia vigente y se
  // detiene con la página oculta. Al volver a verla, si la lectura venció, se
  // relee enseguida.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (!isVisible()) return;
      const current = new Date().toISOString();
      const interval = liveCadence(current).accountMs;
      const age = Date.parse(current) - Date.parse(lastAttemptAt);
      timer = setTimeout(
        () => void refreshAccount(),
        Math.max(interval - age, 0),
      );
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [lastAttemptAt, refreshAccount]);

  // Las cotizaciones del alcance firmado, con su propia cadencia.
  useEffect(() => {
    // Sin posiciones no se pide nada; una cotización vieja de un símbolo que
    // ya no está no se muestra, porque la tabla busca por posición.
    if (scope === null || symbolsKey === "") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!alive || !isVisible()) return;
      let result;
      try {
        result = await readLiveQuotes({ scope });
      } catch {
        result = { state: "unavailable" as const };
      }
      if (!alive) return;
      if (result.state === "read") {
        setQuotes({
          readAt: result.readAt,
          bySymbol: new Map(
            result.quotes.map((quote) => [quote.symbol, quote]),
          ),
          failedCode: null,
        });
      } else {
        const code = result.state === "failed" ? result.code : result.state;
        setQuotes((previous) =>
          previous === null
            ? { readAt: "", bySymbol: new Map(), failedCode: code }
            : { ...previous, failedCode: code },
        );
      }
      timer = setTimeout(
        () => void tick(),
        liveCadence(new Date().toISOString()).quotesMs,
      );
    };
    const onVisible = () => {
      if (isVisible()) {
        clearTimeout(timer);
        void tick();
      }
    };
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [scope, symbolsKey]);

  // El cruce, una vez por conjunto de símbolos: lee la base de análisis, no Schwab.
  const contextScope = useRef<string | null>(null);
  useEffect(() => {
    contextScope.current = scope;
  });
  useEffect(() => {
    if (symbolsKey === "" || contextScope.current === null) return;
    let alive = true;
    readPositionContext({ scope: contextScope.current })
      .catch(() => ({ state: "unavailable" as const }))
      .then((result) => {
        if (alive) setContextEntry({ key: symbolsKey, result });
      });
    return () => {
      alive = false;
    };
  }, [symbolsKey]);
  // Un cruce de otro conjunto de símbolos no vale para este: se espera el nuevo.
  const context = contextEntry?.key === symbolsKey ? contextEntry.result : null;

  if (reading === null) {
    const copy = liveFailureCopy(failedCode ?? "unavailable");
    return (
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle as="h2">Cuenta en vivo</CardTitle>
            <StatusMark status="degraded" label="Sin lectura" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-sm">
              <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
              {copy.title}
              <InfoTip title={copy.title}>
                <p>{copy.text}</p>
                <p className="font-mono text-xs">{failedCode}</p>
              </InfoTip>
            </p>
            <RefreshButton refreshing={refreshing} onRefresh={refreshAccount} />
          </div>
        </CardContent>
      </Card>
    );
  }

  const cadence = liveCadence(now);
  const freshness = liveFreshness({
    readAt: reading.readAt,
    now,
    intervalMs: cadence.accountMs,
    lastAttemptFailed: failedCode !== null,
  });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle as="h2" className="flex items-center gap-1">
              Cuenta{" "}
              <span className="numeric">···{reading.account.lastFour}</span>
              <InfoTip title="Cuenta en vivo">
                <p>
                  Leída de Schwab al momento y sin guardar. Con la página
                  visible se relee cada minuto en la sesión de Nueva York y cada
                  5 minutos fuera de ella.
                </p>
                <p>
                  Cuenta{" "}
                  {reading.account.accountType === "CASH"
                    ? "cash: el buying power overnight es el efectivo liquidado"
                    : reading.account.accountType}
                  {reading.account.isClosingOnlyRestricted
                    ? "; restringida a cerrar posiciones"
                    : ""}
                  .
                </p>
              </InfoTip>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <StatusMark
                status={freshness.light === "live" ? "ready" : "degraded"}
                label={freshness.light === "live" ? "LIVE" : "STALE"}
              />
              <time
                dateTime={reading.readAt}
                className="numeric text-sm text-muted-foreground"
                aria-live="polite"
              >
                {formatClock(reading.readAt)}
              </time>
              <RefreshButton
                refreshing={refreshing}
                onRefresh={refreshAccount}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {failedCode !== null ? (
            <StaleNotice code={failedCode} readAt={reading.readAt} />
          ) : null}
          <Balances reading={reading} />
        </CardContent>
      </Card>

      <PositionsCard reading={reading} quotes={quotes} context={context} />
      <OrdersCard reading={reading} />
    </div>
  );
}

function RefreshButton({
  refreshing,
  onRefresh,
}: {
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onRefresh}
      disabled={refreshing}
    >
      <RefreshCw
        data-icon="inline-start"
        className={refreshing ? "motion-safe:animate-spin" : undefined}
        aria-hidden="true"
      />
      {refreshing ? "Leyendo…" : "Actualizar"}
    </Button>
  );
}

function StaleNotice({
  code,
  readAt,
}: {
  readonly code: string;
  readonly readAt: string;
}) {
  const copy = liveFailureCopy(code);
  return (
    <Alert>
      <TriangleAlert aria-hidden="true" />
      <AlertTitle className="flex items-center gap-1">
        {copy.title} · lectura de las {formatClock(readAt)}
        <InfoTip title={copy.title}>
          <p>{copy.text}</p>
          <p className="font-mono text-xs">{code}</p>
        </InfoTip>
      </AlertTitle>
    </Alert>
  );
}

function Figure({
  term,
  gloss,
  value,
  detail,
}: {
  readonly term: string;
  readonly gloss: string;
  readonly value: string;
  readonly detail?: string;
}) {
  return (
    <div className="space-y-1">
      <dt>
        <span className="block font-medium">{term}</span>
        <span className="block text-xs text-muted-foreground">{gloss}</span>
      </dt>
      <dd className="numeric text-lg font-semibold">US$ {value}</dd>
      {detail !== undefined ? (
        <dd className="text-xs text-muted-foreground">{detail}</dd>
      ) : null}
    </div>
  );
}

function Balances({ reading }: { readonly reading: Reading }) {
  const b = reading.balances;
  return (
    <dl className="grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <Figure
        term="Liquidation value"
        gloss="valor de liquidación"
        value={formatMoney(b.liquidationValue)}
        detail={`Al abrir US$ ${formatMoney(b.liquidationValueAtOpen)}`}
      />
      <Figure
        term="Buying power overnight"
        gloss="disponible para operar"
        value={formatMoney(b.cashAvailableForTrading)}
      />
      <Figure
        term="Buying power intradía"
        gloss="según Schwab"
        value={formatMoney(b.currentIntradayBuyingPower)}
        detail={`Al abrir US$ ${formatMoney(b.intradayBuyingPowerAtOpen)}`}
      />
      <Figure
        term="Cash"
        gloss="efectivo total"
        value={formatMoney(b.totalCash)}
        detail={`Sin liquidar US$ ${formatMoney(b.unsettledCash)}`}
      />
    </dl>
  );
}

function Signed({
  value,
  scale = 2,
}: {
  readonly value: string | null;
  readonly scale?: number;
}) {
  if (value === null)
    return <span className="text-muted-foreground">Sin dato</span>;
  return (
    <span className="numeric">{formatSignedAmount(value, { scale })}</span>
  );
}

function contextFor(
  context: PositionContextResult | null,
  symbol: string,
): PositionContext | "loading" | null {
  if (context === null) return "loading";
  if (context.state !== "read") return null;
  return context.contexts.find((row) => row.symbol === symbol) ?? null;
}

function ContextCells({
  context,
}: {
  readonly context: PositionContext | "loading" | null;
}) {
  if (context === "loading") {
    return (
      <TableCell colSpan={3} className="text-muted-foreground">
        Cruzando…
      </TableCell>
    );
  }
  if (context === null) {
    return (
      <TableCell colSpan={3} className="text-muted-foreground">
        Sin cruce
      </TableCell>
    );
  }
  if (context.status === "unresolved") {
    return (
      <TableCell colSpan={3} className="text-muted-foreground">
        {IDENTITY_ABSENCE_COPY[context.reason] ?? context.reason}
      </TableCell>
    );
  }
  const { valuation, sector, cedear } = context;
  return (
    <>
      <TableCell>
        {valuation.status === "valued" ? (
          <Link
            href={`/valuacion/${encodeURIComponent(context.symbol)}` as Route}
            className="numeric underline-offset-4 hover:underline"
          >
            {valuation.currency} {formatMoney(valuation.valuePerShare)}
            <span className="block text-xs text-muted-foreground">
              al {formatCalendarDate(valuation.asOf)}
              {valuation.runStatus === "requires_review"
                ? " · en revisión"
                : ""}
            </span>
          </Link>
        ) : (
          <span className="text-muted-foreground">
            {VALUATION_ABSENCE_COPY[valuation.reason]}
          </span>
        )}
      </TableCell>
      <TableCell>
        {sector.status === "classified" ? (
          <Link
            href={`/sectores/${sector.code}` as Route}
            className="underline-offset-4 hover:underline"
          >
            {sector.label}
          </Link>
        ) : (
          <span className="text-muted-foreground">
            {SECTOR_ABSENCE_COPY[sector.reason]}
          </span>
        )}
      </TableCell>
      <TableCell>
        {cedear.status === "program" ? (
          <span className="numeric">
            Sí
            {cedear.ratios.some((ratio) => ratio !== null)
              ? ` · ${cedear.ratios.filter((ratio) => ratio !== null).join(", ")}`
              : ""}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {CEDEAR_ABSENCE_COPY[cedear.reason]}
          </span>
        )}
      </TableCell>
    </>
  );
}

function PositionsCard({
  reading,
  quotes,
  context,
}: {
  readonly reading: Reading;
  readonly quotes: QuotesState | null;
  readonly context: PositionContextResult | null;
}) {
  const positions = reading.positions;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b">
        <CardTitle as="h2" className="flex items-center gap-1">
          Posiciones
          <InfoTip title="Posiciones">
            <p>
              Market value y P&amp;L son los de Schwab a la hora de la cuenta.
              La cotización se pide cada 15 s en sesión, sólo de acciones y ETFs
              abiertos.
            </p>
            <p>
              Valuación, sector y CEDEAR salen del portal: la última valuación
              registrada, a su propia fecha.
            </p>
          </InfoTip>
        </CardTitle>
        {quotes === null || quotes.readAt === "" ? null : (
          <span
            className={cn(
              "numeric text-sm",
              quotes.failedCode === null
                ? "text-muted-foreground"
                : "text-amber-800 dark:text-amber-300",
            )}
          >
            Cotización {formatClock(quotes.readAt)}
            {quotes.failedCode === null ? "" : " · sin actualizar"}
          </span>
        )}
      </CardHeader>
      {positions.length === 0 ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sin posiciones abiertas.
          </p>
        </CardContent>
      ) : (
        <CardContent className="space-y-3 px-0">
          {context !== null && context.state === "analysis_unavailable" ? (
            <p className="px-4 text-sm text-muted-foreground">
              La base de análisis no respondió: valuación, sector y CEDEAR no se
              cruzaron. La cuenta no depende de ella. Referencia{" "}
              <code className="font-mono text-xs">{context.reference}</code>.
            </p>
          ) : null}
          <Table containerLabel="Posiciones, tabla desplazable">
            <TableHeader>
              <TableRow>
                <TableHead>Símbolo</TableHead>
                <TableHead>Lado</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Precio medio</TableHead>
                <TableHead className="text-right">Último</TableHead>
                <TableHead className="text-right">Market value</TableHead>
                <TableHead className="text-right">P&amp;L del día</TableHead>
                <TableHead className="text-right">P&amp;L abierto</TableHead>
                <TableHead>Valuación</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead>CEDEAR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((position) => {
                const quote = quotes?.bySymbol.get(position.symbol) ?? null;
                return (
                  <TableRow key={`${position.symbol}-${position.side}`}>
                    <TableCell className="font-medium">
                      {position.symbol}
                      {position.description !== null ? (
                        <span className="block max-w-48 truncate text-xs font-normal text-muted-foreground">
                          {position.description}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {position.side === "long"
                        ? "Largo"
                        : position.side === "short"
                          ? "Corto"
                          : "Cerrada hoy"}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {formatQuantity(position.quantity)}
                      {position.optionMultiplier !== null ? (
                        <span className="block text-xs text-muted-foreground">
                          × {formatQuantity(position.optionMultiplier)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {formatAmount(position.averagePrice, { scale: 2 })}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {quote === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          {formatAmount(quote.lastPrice, { scale: 2 })}
                          {quote.netPercentChange !== null ? (
                            <span className="block text-xs text-muted-foreground">
                              {formatSignedAmount(quote.netPercentChange, {
                                scale: 2,
                              })}{" "}
                              %
                            </span>
                          ) : null}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {formatMoney(position.marketValue)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Signed value={position.dayProfitLoss} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Signed value={position.openProfitLoss} />
                    </TableCell>
                    <ContextCells
                      context={contextFor(context, position.symbol)}
                    />
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}

function OrdersCard({ reading }: { readonly reading: Reading }) {
  const orders = reading.openOrders;
  const ordersWindow = reading.ordersWindow;
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2" className="flex items-center gap-1">
          Órdenes abiertas
          <InfoTip title="Órdenes abiertas">
            <p>
              Sólo para verlas: el portal no envía, modifica ni cancela órdenes.
            </p>
            <p>
              Todas las de los últimos {ordersWindow.recentDays} días y las
              activas de hasta {ordersWindow.workingDays}; una GTC más vieja no
              aparece.
            </p>
          </InfoTip>
        </CardTitle>
      </CardHeader>
      {orders.length === 0 ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Ninguna orden abierta.
          </p>
        </CardContent>
      ) : (
        <CardContent className="px-0">
          <Table containerLabel="Órdenes abiertas, tabla desplazable">
            <TableHeader>
              <TableRow>
                <TableHead>Ingresada</TableHead>
                <TableHead>Símbolo</TableHead>
                <TableHead>Instrucción</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Stop</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.orderId}>
                  <TableCell className="numeric whitespace-nowrap">
                    <time dateTime={order.enteredTime}>
                      {formatDateTime(order.enteredTime)}
                    </time>
                  </TableCell>
                  <TableCell className="font-medium">
                    {order.legs.map((leg) => leg.symbol).join(" / ") || "—"}
                  </TableCell>
                  <TableCell>
                    {order.legs
                      .map(
                        (leg) =>
                          INSTRUCTION_COPY[leg.instruction] ?? leg.instruction,
                      )
                      .join(" / ") || "—"}
                    {order.parentOrderId !== null ? (
                      <span className="block text-xs text-muted-foreground">
                        Pata de la orden {order.parentOrderId}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {order.orderType ?? "—"}
                    {order.duration !== null ? (
                      <span className="block text-xs text-muted-foreground">
                        {order.duration}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    {order.quantity === null
                      ? "—"
                      : formatQuantity(order.quantity)}
                    {order.filledQuantity !== null &&
                    !/^0(?:\.0+)?$/u.test(order.filledQuantity) ? (
                      <span className="block text-xs text-muted-foreground">
                        {formatQuantity(order.filledQuantity)} ejecutadas
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    {order.price === null
                      ? "—"
                      : formatAmount(order.price, { scale: 2 })}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    {order.stopPrice === null
                      ? "—"
                      : formatAmount(order.stopPrice, { scale: 2 })}
                  </TableCell>
                  <TableCell>
                    {ORDER_STATUS_COPY[order.status] ?? order.status}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}
